import type {SqlDriver} from '@/database/driver';
import {ProductRepository} from '@/repositories/ProductRepository';
import {SalesRepository} from '@/repositories/SalesRepository';
import {InventoryService} from '@/services/InventoryService';
import type {Product} from '@/types';
import {todayRange} from '@/utils/date';
import {makeTestDb} from './helpers/db';

let driver: SqlDriver;
let products: ProductRepository;
let sales: SalesRepository;
let inventory: InventoryService;
let pen: Product;

beforeEach(async () => {
  driver = await makeTestDb();
  products = new ProductRepository(driver);
  sales = new SalesRepository(driver);
  inventory = new InventoryService(driver);
  pen = await products.create({
    name: 'Ballpoint Pen Blue',
    barcode: '001234567890',
    sellingPrice: 10,
    initialQuantity: 240,
    minimumStock: 50,
  });
});

afterEach(async () => {
  await driver.close();
});

describe('recording a sale', () => {
  test('one sale writes a sale, a sale item and a stock movement together', async () => {
    const result = await inventory.sellProduct(pen.id, 3);

    const stored = await sales.findSaleWithItems(result.sale.id);
    expect(stored).not.toBeNull();
    expect(stored?.items).toHaveLength(1);

    const movements = await driver.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM inventory_transactions WHERE reference_id = ?;',
      [result.sale.id],
    );
    expect(Number(movements.rows[0].total)).toBe(1);
  });

  test('the total is the unit price times the quantity', async () => {
    const result = await inventory.sellProduct(pen.id, 12);
    expect(result.sale.totalAmount).toBe(120);
    expect(result.items[0].unitPrice).toBe(10);
    expect(result.items[0].totalPrice).toBe(120);
  });

  test('fractional prices do not accumulate floating point noise', async () => {
    const oil = await products.create({
      name: 'Sunflower Oil 1L',
      barcode: '890111222340',
      sellingPrice: 155.35,
      initialQuantity: 40,
      minimumStock: 10,
    });
    const result = await inventory.sellProduct(oil.id, 3);
    expect(result.sale.totalAmount).toBe(466.05);
  });

  test('the sale line keeps the name and barcode as they were at the time', async () => {
    const result = await inventory.sellProduct(pen.id, 1);
    await products.update(pen.id, {name: 'Ballpoint Pen Blue (old stock)'});

    const stored = await sales.findSaleWithItems(result.sale.id);
    expect(stored?.items[0].productName).toBe('Ballpoint Pen Blue');
    expect(stored?.items[0].barcode).toBe('001234567890');
  });

  test('a sold barcode with leading zeros is stored on the sale line unchanged', async () => {
    const result = await inventory.sellProduct(pen.id, 1);
    expect(result.items[0].barcode).toBe('001234567890');
  });
});

describe('sale numbers', () => {
  test('the sequence increments within the day', async () => {
    const first = await inventory.sellProduct(pen.id, 1);
    const second = await inventory.sellProduct(pen.id, 1);
    const third = await inventory.sellProduct(pen.id, 1);

    const sequences = [first, second, third].map(result =>
      Number(result.sale.saleNumber.split('-')[2]),
    );
    expect(sequences).toEqual([1, 2, 3]);
  });

  test('the shape is S-YYYYMMDD-NNNN-DEV', async () => {
    const result = await inventory.sellProduct(pen.id, 1);
    expect(result.sale.saleNumber).toMatch(/^S-\d{8}-\d{4}-[0-9A-F]{3}$/);
  });

  describe('when the phone is in a timezone offset from UTC', () => {
    beforeEach(() => {
      // 01:00 on 24 August in Asia/Kolkata, which is still 23 August in UTC.
      // Counting the day's sales by the UTC date here would restart the
      // sequence mid-day and reissue a sale_number that the schema declares
      // UNIQUE, so the second sale of the morning would fail outright.
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-23T19:30:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('consecutive sales still get distinct, local-dated numbers', async () => {
      const first = await inventory.sellProduct(pen.id, 1);
      const second = await inventory.sellProduct(pen.id, 1);

      // The device tag is random per install, so the assertion is on the part
      // this test is actually about: the local date and the per-day sequence.
      expect(first.sale.saleNumber).toMatch(/^S-20260824-0001-[0-9A-F]{3}$/);
      expect(second.sale.saleNumber).toMatch(/^S-20260824-0002-[0-9A-F]{3}$/);
    });
  });
});

describe('reading sales back', () => {
  beforeEach(async () => {
    const rice = await products.create({
      name: 'Basmati Rice 5kg',
      barcode: '890111222333',
      sellingPrice: 640,
      initialQuantity: 24,
      minimumStock: 6,
    });
    await inventory.sellProduct(pen.id, 12);
    await inventory.sellProduct(rice.id, 2);
  });

  test('the feed is one row per line item, newest first', async () => {
    const page = await sales.listSaleItems(null);
    expect(page.total).toBe(2);
    expect(page.items[0].productName).toBe('Basmati Rice 5kg');
  });

  test('the day summary adds up units and money separately', async () => {
    const summary = await sales.summaryForRange(todayRange());
    expect(summary.itemsSold).toBe(14);
    expect(summary.revenue).toBe(1400);
  });

  test('a range that excludes today reports nothing rather than failing', async () => {
    const summary = await sales.summaryForRange({
      from: '2020-01-01T00:00:00.000Z',
      to: '2020-01-02T00:00:00.000Z',
    });
    expect(summary).toEqual({itemsSold: 0, revenue: 0});
  });

  test('pagination reports the full total alongside the page', async () => {
    const page = await sales.listSales(null, 1, 0);
    expect(page.items).toHaveLength(1);
    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(true);
  });

  test('the export feed is unpaginated and oldest first', async () => {
    const rows = await sales.listAllForExport();
    expect(rows).toHaveLength(2);
    expect(rows[0].productName).toBe('Ballpoint Pen Blue');
  });
});

describe('returns', () => {
  test('a return puts stock back without erasing the sale', async () => {
    const result = await inventory.sellProduct(pen.id, 5);
    await inventory.recordReturn(pen.id, 2, `Return against ${result.sale.saleNumber}`);

    expect((await products.requireById(pen.id)).currentQuantity).toBe(237);
    expect(await sales.count()).toBe(1);
    expect((await sales.findSaleWithItems(result.sale.id))?.totalAmount).toBe(50);
  });
});
