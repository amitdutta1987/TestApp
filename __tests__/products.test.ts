import type {SqlDriver} from '@/database/driver';
import {ProductRepository} from '@/repositories/ProductRepository';
import {InventoryService} from '@/services/InventoryService';
import {AppError, DuplicateBarcodeError} from '@/utils/errors';
import {makeTestDb} from './helpers/db';

let driver: SqlDriver;
let products: ProductRepository;

const base = {
  name: 'Test Product',
  sellingPrice: 100,
  initialQuantity: 10,
  minimumStock: 3,
};

beforeEach(async () => {
  driver = await makeTestDb();
  products = new ProductRepository(driver);
});

afterEach(async () => {
  await driver.close();
});

describe('creating products', () => {
  test('a barcode with leading zeros round-trips through SQLite unchanged', async () => {
    const created = await products.create({...base, barcode: '001234567890'});
    expect(created.barcode).toBe('001234567890');

    const found = await products.findByBarcode('001234567890');
    expect(found?.id).toBe(created.id);

    // The numeric form is a different product entirely and must not match.
    expect(await products.findByBarcode('1234567890')).toBeNull();
  });

  test('the opening quantity creates an INITIAL_STOCK transaction', async () => {
    const created = await products.create({...base, barcode: '890111222333', initialQuantity: 25});

    const result = await driver.execute<{
      type: string;
      quantity: number;
      quantity_before: number;
      quantity_after: number;
    }>('SELECT type, quantity, quantity_before, quantity_after FROM inventory_transactions WHERE product_id = ?;', [
      created.id,
    ]);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      type: 'INITIAL_STOCK',
      quantity: 25,
      quantity_before: 0,
      quantity_after: 25,
    });
  });

  test('a product opened with zero stock is SOLD_OUT and logs no movement', async () => {
    const created = await products.create({...base, barcode: '890111222340', initialQuantity: 0});
    expect(created.status).toBe('SOLD_OUT');

    const result = await driver.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM inventory_transactions WHERE product_id = ?;',
      [created.id],
    );
    expect(Number(result.rows[0].total)).toBe(0);
  });

  test('status is derived from quantity and minimum stock at creation', async () => {
    const low = await products.create({
      ...base,
      barcode: '890111222357',
      initialQuantity: 3,
      minimumStock: 5,
    });
    expect(low.status).toBe('LOW_STOCK');
  });

  test('an empty name is rejected', async () => {
    await expect(products.create({...base, barcode: '890111222364', name: '  '})).rejects.toThrow(
      AppError,
    );
  });

  test('a negative opening quantity is rejected', async () => {
    await expect(
      products.create({...base, barcode: '890111222371', initialQuantity: -1}),
    ).rejects.toThrow(AppError);
  });

  test('an unusable barcode is rejected before it reaches SQL', async () => {
    await expect(products.create({...base, barcode: '12'})).rejects.toThrow(AppError);
  });
});

describe('duplicate barcodes', () => {
  test('a second product with the same barcode is refused', async () => {
    const first = await products.create({...base, barcode: '001234567890', name: 'Blue Pen'});

    await expect(
      products.create({...base, barcode: '001234567890', name: 'Red Pen'}),
    ).rejects.toBeInstanceOf(DuplicateBarcodeError);

    // Nothing was written, so the barcode still resolves to the original.
    const all = await products.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(first.id);
  });

  test('the error carries what the duplicate dialog needs to show', async () => {
    const first = await products.create({...base, barcode: '001234567890', name: 'Blue Pen'});
    expect.assertions(3);
    try {
      await products.create({...base, barcode: '001234567890', name: 'Red Pen'});
    } catch (error) {
      const duplicate = error as DuplicateBarcodeError;
      expect(duplicate.barcode).toBe('001234567890');
      expect(duplicate.existingProductId).toBe(first.id);
      expect(duplicate.existingName).toBe('Blue Pen');
    }
  });

  test('editing a product onto another product’s barcode is refused', async () => {
    await products.create({...base, barcode: '001234567890', name: 'Blue Pen'});
    const second = await products.create({...base, barcode: '890111222333', name: 'Notebook'});

    await expect(products.update(second.id, {barcode: '001234567890'})).rejects.toBeInstanceOf(
      DuplicateBarcodeError,
    );
  });

  test('saving a product with its own unchanged barcode is allowed', async () => {
    const created = await products.create({...base, barcode: '001234567890'});
    const updated = await products.update(created.id, {
      barcode: '001234567890',
      name: 'Renamed',
    });
    expect(updated.name).toBe('Renamed');
    expect(updated.barcode).toBe('001234567890');
  });
});

describe('updating products', () => {
  test('raising the minimum stock flips the status without any stock movement', async () => {
    const created = await products.create({
      ...base,
      barcode: '890111222333',
      initialQuantity: 10,
      minimumStock: 3,
    });
    expect(created.status).toBe('IN_STOCK');

    const updated = await products.update(created.id, {minimumStock: 20});
    expect(updated.status).toBe('LOW_STOCK');
    expect(updated.currentQuantity).toBe(10);

    const movements = await driver.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM inventory_transactions WHERE product_id = ?;',
      [created.id],
    );
    expect(Number(movements.rows[0].total)).toBe(1); // still just the opening stock
  });

  test('blank optional text is stored as NULL rather than an empty string', async () => {
    const created = await products.create({...base, barcode: '890111222333', brand: 'Cello'});
    const updated = await products.update(created.id, {brand: '   '});
    expect(updated.brand).toBeNull();
  });
});

describe('searching and filtering', () => {
  beforeEach(async () => {
    await products.create({
      ...base,
      barcode: '001234567890',
      name: 'Ballpoint Pen Blue',
      sku: 'STA-PEN-BLU',
      category: 'Stationery',
    });
    await products.create({
      ...base,
      barcode: '890111222333',
      name: 'Basmati Rice 5kg',
      category: 'Groceries',
      initialQuantity: 2,
      minimumStock: 5,
    });
    await products.create({
      ...base,
      barcode: '890111222340',
      name: 'Sugar 1kg',
      category: 'Groceries',
      initialQuantity: 0,
    });
  });

  test('an exact barcode search finds the product', async () => {
    const page = await products.list({search: '001234567890'});
    expect(page.items).toHaveLength(1);
    expect(page.items[0].name).toBe('Ballpoint Pen Blue');
  });

  test('partial name and SKU search both work', async () => {
    expect((await products.list({search: 'rice'})).items).toHaveLength(1);
    expect((await products.list({search: 'STA-PEN'})).items).toHaveLength(1);
  });

  test('status filtering uses the denormalised column', async () => {
    expect((await products.list({status: 'SOLD_OUT'})).items).toHaveLength(1);
    expect((await products.list({status: 'LOW_STOCK'})).items).toHaveLength(1);
    expect((await products.list({status: 'IN_STOCK'})).items).toHaveLength(1);
  });

  test('pagination reports the full total alongside the page', async () => {
    const page = await products.list({}, 2, 0);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(3);
    expect(page.hasMore).toBe(true);

    const next = await products.list({}, 2, 2);
    expect(next.items).toHaveLength(1);
    expect(next.hasMore).toBe(false);
  });

  test('categories are listed without duplicates', async () => {
    expect(await products.listCategories()).toEqual(['Groceries', 'Stationery']);
  });

  test('deactivated products leave the default list but keep their row', async () => {
    const page = await products.list({search: 'Sugar'});
    await products.deactivate(page.items[0].id);

    expect((await products.list({search: 'Sugar'})).items).toHaveLength(0);
    expect((await products.list({search: 'Sugar', includeInactive: true})).items).toHaveLength(1);

    await products.reactivate(page.items[0].id);
    expect((await products.list({search: 'Sugar'})).items).toHaveLength(1);
  });
});

describe('deleting products', () => {
  test('a product that was never sold can be deleted permanently', async () => {
    const created = await products.create({...base, barcode: '890111222333'});
    await products.deletePermanently(created.id);
    expect(await products.findById(created.id)).toBeNull();
  });

  test('a product with sales history cannot be deleted', async () => {
    const inventory = new InventoryService(driver);
    const created = await products.create({...base, barcode: '890111222333'});
    await inventory.sellProduct(created.id, 1);

    await expect(products.deletePermanently(created.id)).rejects.toThrow(AppError);
    expect(await products.findById(created.id)).not.toBeNull();
  });

  test('deleting returns the image paths so the files can be removed', async () => {
    const created = await products.create({
      ...base,
      barcode: '890111222333',
      images: ['product-images/a.jpg'],
      primaryImage: 'product-images/a.jpg',
    });
    const paths = await products.deletePermanently(created.id);
    expect(paths).toContain('product-images/a.jpg');
  });
});

describe('product images', () => {
  test('the first image becomes the primary one automatically', async () => {
    const created = await products.create({...base, barcode: '890111222333'});
    const image = await products.addImage(created.id, 'product-images/a.jpg');

    expect(image.isPrimary).toBe(true);
    expect((await products.requireById(created.id)).primaryImage).toBe('product-images/a.jpg');
  });

  test('setting a new primary demotes the previous one', async () => {
    const created = await products.create({...base, barcode: '890111222333'});
    await products.addImage(created.id, 'product-images/a.jpg');
    const second = await products.addImage(created.id, 'product-images/b.jpg');

    await products.setPrimaryImage(created.id, second.id);

    const images = await products.listImages(created.id);
    expect(images.filter(image => image.isPrimary)).toHaveLength(1);
    expect((await products.requireById(created.id)).primaryImage).toBe('product-images/b.jpg');
  });

  test('removing the primary image promotes the next one', async () => {
    const created = await products.create({...base, barcode: '890111222333'});
    const first = await products.addImage(created.id, 'product-images/a.jpg');
    await products.addImage(created.id, 'product-images/b.jpg');

    const removed = await products.removeImage(created.id, first.id);

    expect(removed).toBe('product-images/a.jpg');
    expect((await products.requireById(created.id)).primaryImage).toBe('product-images/b.jpg');
  });

  test('every referenced path is discoverable for the backup archive', async () => {
    const created = await products.create({...base, barcode: '890111222333'});
    await products.addImage(created.id, 'product-images/a.jpg');
    await products.addImage(created.id, 'product-images/b.jpg');

    const paths = await products.listAllImagePaths();
    expect(paths.sort()).toEqual(['product-images/a.jpg', 'product-images/b.jpg']);
  });
});
