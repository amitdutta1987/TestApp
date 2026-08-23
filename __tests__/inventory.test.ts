import type {SqlDriver} from '@/database/driver';
import {InventoryRepository} from '@/repositories/InventoryRepository';
import {ProductRepository} from '@/repositories/ProductRepository';
import {InventoryService} from '@/services/InventoryService';
import type {Product} from '@/types';
import {AppError, InsufficientStockError} from '@/utils/errors';
import {makeTestDb} from './helpers/db';

let driver: SqlDriver;
let products: ProductRepository;
let history: InventoryRepository;
let inventory: InventoryService;
let product: Product;

async function countRows(table: string): Promise<number> {
  const result = await driver.execute<{total: number}>(`SELECT COUNT(*) AS total FROM ${table};`);
  return Number(result.rows[0].total);
}

beforeEach(async () => {
  driver = await makeTestDb();
  products = new ProductRepository(driver);
  history = new InventoryRepository(driver);
  inventory = new InventoryService(driver);
  product = await products.create({
    name: 'Basmati Rice 5kg',
    barcode: '890111222333',
    sellingPrice: 640,
    initialQuantity: 10,
    minimumStock: 3,
  });
});

afterEach(async () => {
  await driver.close();
});

describe('stock arithmetic', () => {
  test('selling 1 of 10 leaves 9', async () => {
    const result = await inventory.sellProduct(product.id, 1);
    expect(result.remainingStock[product.id]).toBe(9);
    expect((await products.requireById(product.id)).currentQuantity).toBe(9);
  });

  test('selling all 10 leaves 0 and the product becomes SOLD_OUT', async () => {
    await inventory.sellProduct(product.id, 10);

    const after = await products.requireById(product.id);
    expect(after.currentQuantity).toBe(0);
    expect(after.status).toBe('SOLD_OUT');
  });

  test('adding 5 to 10 gives 15', async () => {
    const result = await inventory.addStock(product.id, 5);
    expect(result.quantityBefore).toBe(10);
    expect(result.quantityAfter).toBe(15);
    expect((await products.requireById(product.id)).currentQuantity).toBe(15);
  });

  test('selling down past the minimum flips the status to LOW_STOCK', async () => {
    await inventory.sellProduct(product.id, 7);
    expect((await products.requireById(product.id)).status).toBe('LOW_STOCK');
  });

  test('restocking a sold-out product brings it back to IN_STOCK', async () => {
    await inventory.sellProduct(product.id, 10);
    await inventory.addStock(product.id, 20);
    expect((await products.requireById(product.id)).status).toBe('IN_STOCK');
  });
});

describe('stock can never go negative', () => {
  test('selling 11 of 10 is refused', async () => {
    await expect(inventory.sellProduct(product.id, 11)).rejects.toBeInstanceOf(
      InsufficientStockError,
    );
  });

  test('the refusal rolls back every write, not just the stock column', async () => {
    const movementsBefore = await countRows('inventory_transactions');

    await expect(inventory.sellProduct(product.id, 11)).rejects.toBeInstanceOf(
      InsufficientStockError,
    );

    expect((await products.requireById(product.id)).currentQuantity).toBe(10);
    expect(await countRows('sales')).toBe(0);
    expect(await countRows('sale_items')).toBe(0);
    expect(await countRows('inventory_transactions')).toBe(movementsBefore);
  });

  test('the error reports what was available so the dialog can offer that amount', async () => {
    expect.assertions(2);
    try {
      await inventory.sellProduct(product.id, 11);
    } catch (error) {
      const insufficient = error as InsufficientStockError;
      expect(insufficient.available).toBe(10);
      expect(insufficient.requested).toBe(11);
    }
  });

  test('a sold-out product cannot be sold at all', async () => {
    await inventory.sellProduct(product.id, 10);
    await expect(inventory.sellProduct(product.id, 1)).rejects.toBeInstanceOf(
      InsufficientStockError,
    );
  });

  test('writing off more than is on the shelf is refused', async () => {
    await expect(inventory.recordDamage(product.id, 11)).rejects.toBeInstanceOf(
      InsufficientStockError,
    );
    expect((await products.requireById(product.id)).currentQuantity).toBe(10);
  });

  test('zero and fractional quantities never reach the database', async () => {
    await expect(inventory.sellProduct(product.id, 0)).rejects.toThrow(AppError);
    await expect(inventory.sellProduct(product.id, 1.5)).rejects.toThrow(AppError);
    await expect(inventory.sellProduct(product.id, -2)).rejects.toThrow(AppError);
    expect(await countRows('sales')).toBe(0);
  });

  test('selling against a product that no longer exists is refused', async () => {
    await expect(inventory.sellProduct('prd_missing', 1)).rejects.toThrow(AppError);
  });
});

describe('the movement history reconciles', () => {
  test('every stock change records before and after quantities', async () => {
    await inventory.sellProduct(product.id, 4);
    await inventory.addStock(product.id, 6, 'Delivery from Metro');
    await inventory.recordReturn(product.id, 1);
    await inventory.recordDamage(product.id, 2);

    const page = await history.listForProduct(product.id);
    // Newest first, plus the opening stock row from create().
    expect(page.items.map(item => item.type)).toEqual([
      'DAMAGE',
      'RETURN',
      'STOCK_IN',
      'SALE',
      'INITIAL_STOCK',
    ]);

    // Walking the deltas from zero must land on the current quantity.
    const total = page.items.reduce((sum, item) => sum + item.quantity, 0);
    expect(total).toBe(11);
    expect((await products.requireById(product.id)).currentQuantity).toBe(11);

    // And each row's own before/after must agree with its delta.
    for (const item of page.items) {
      expect(item.quantityAfter - item.quantityBefore).toBe(item.quantity);
    }
  });

  test('outgoing movements are stored as negative deltas', async () => {
    await inventory.sellProduct(product.id, 3);
    const page = await history.listForProduct(product.id);
    const sale = page.items.find(item => item.type === 'SALE');
    expect(sale?.quantity).toBe(-3);
    expect(sale?.quantityBefore).toBe(10);
    expect(sale?.quantityAfter).toBe(7);
  });

  test('a sale movement points back at the sale that caused it', async () => {
    const result = await inventory.sellProduct(product.id, 2);
    const page = await history.listForProduct(product.id);
    const sale = page.items.find(item => item.type === 'SALE');
    expect(sale?.referenceId).toBe(result.sale.id);
    expect(sale?.notes).toBe(result.sale.saleNumber);
  });
});

describe('stock take', () => {
  test('counting fewer units than recorded records the shortfall', async () => {
    const result = await inventory.adjustTo(product.id, 7, 'Monday count');
    expect(result.quantityAfter).toBe(7);

    const page = await history.listForProduct(product.id);
    const adjustment = page.items.find(item => item.type === 'STOCK_ADJUSTMENT');
    expect(adjustment?.quantity).toBe(-3);
    expect(adjustment?.notes).toBe('Monday count');
  });

  test('counting more units than recorded records a positive correction', async () => {
    await inventory.adjustTo(product.id, 14);
    const page = await history.listForProduct(product.id);
    expect(page.items[0].quantity).toBe(4);
  });

  test('counting exactly what was recorded writes no movement', async () => {
    const before = await countRows('inventory_transactions');
    const result = await inventory.adjustTo(product.id, 10);

    expect(result.quantityAfter).toBe(10);
    expect(await countRows('inventory_transactions')).toBe(before);
  });

  test('a stock take can legitimately zero a product', async () => {
    await inventory.adjustTo(product.id, 0, 'All units missing');
    expect((await products.requireById(product.id)).status).toBe('SOLD_OUT');
  });

  test('a negative or fractional count is refused', async () => {
    await expect(inventory.adjustTo(product.id, -1)).rejects.toThrow(AppError);
    await expect(inventory.adjustTo(product.id, 2.5)).rejects.toThrow(AppError);
  });
});
