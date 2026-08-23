import type {SqlDriver} from '@/database/driver';
import {ProductRepository} from '@/repositories/ProductRepository';
import {SEED_PRODUCTS, seedDatabase, withCheckDigit} from '@/database/seed';
import {isRetailGtin, validateBarcode} from '@/utils/barcode';
import {makeTestDb} from './helpers/db';

let driver: SqlDriver;
let products: ProductRepository;

beforeEach(async () => {
  driver = await makeTestDb();
  products = new ProductRepository(driver);
});

afterEach(async () => {
  await driver.close();
});

describe('the demo catalogue', () => {
  test('every seeded barcode is one the app would accept', () => {
    for (const product of SEED_PRODUCTS) {
      expect(validateBarcode(product.barcode)).toMatchObject({valid: true});
    }
  });

  test('the numeric barcodes are real GTINs, not plausible-looking digits', () => {
    const numeric = SEED_PRODUCTS.filter(product => /^\d+$/.test(product.barcode));
    expect(numeric.length).toBeGreaterThan(10);
    for (const product of numeric) {
      expect(isRetailGtin(product.barcode)).toBe(true);
    }
  });

  test('no two seeded products share a barcode', () => {
    const barcodes = SEED_PRODUCTS.map(product => product.barcode);
    expect(new Set(barcodes).size).toBe(barcodes.length);
  });

  test('withCheckDigit appends exactly one digit', () => {
    expect(withCheckDigit('00123456789')).toHaveLength(12);
    expect(withCheckDigit('00123456789').startsWith('00123456789')).toBe(true);
  });
});

describe('seeding', () => {
  test('inserts the whole catalogue into an empty database', async () => {
    const summary = await seedDatabase(driver);

    expect(summary.skipped).toBe(false);
    expect(summary.productsCreated).toBe(SEED_PRODUCTS.length);
    expect((await products.listAll()).length).toBe(SEED_PRODUCTS.length);
  });

  test('the catalogue covers all three stock states so the UI has something to show', async () => {
    await seedDatabase(driver);

    for (const status of ['IN_STOCK', 'LOW_STOCK', 'SOLD_OUT'] as const) {
      const page = await products.list({status});
      expect(page.total).toBeGreaterThan(0);
    }
  });

  test('a leading-zero barcode survives into the database', async () => {
    await seedDatabase(driver);

    const upc = withCheckDigit('00123456789');
    expect(upc.startsWith('00')).toBe(true);
    expect((await products.findByBarcode(upc))?.name).toBe('Ballpoint Pen Blue');
  });

  test('it refuses to run against a shop that already has stock', async () => {
    await products.create({
      name: 'A real product',
      barcode: '890111222333',
      sellingPrice: 100,
      initialQuantity: 5,
      minimumStock: 1,
    });

    const summary = await seedDatabase(driver);

    expect(summary).toEqual({productsCreated: 0, salesRecorded: 0, skipped: true});
    expect((await products.listAll()).length).toBe(1);
  });

  test('sample sales are recorded only when asked for', async () => {
    const summary = await seedDatabase(driver, {recordSampleSales: true});

    expect(summary.salesRecorded).toBe(5);
    const sold = await driver.execute<{total: number}>('SELECT COUNT(*) AS total FROM sales;');
    expect(Number(sold.rows[0].total)).toBe(5);
  });

  test('sample sales actually move the stock they claim to', async () => {
    await seedDatabase(driver, {recordSampleSales: true});

    const pen = await products.findByBarcode(withCheckDigit('00123456789'));
    // Opened at 240, twelve sold.
    expect(pen?.currentQuantity).toBe(228);
  });
});
