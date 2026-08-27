import * as XLSX from 'xlsx';
import type {SqlDriver} from '@/database/driver';
import {InventoryRepository} from '@/repositories/InventoryRepository';
import {ProductRepository} from '@/repositories/ProductRepository';
import {SalesRepository} from '@/repositories/SalesRepository';
import {StatsRepository} from '@/repositories/StatsRepository';
import {ExcelExportService, buildWorkbook} from '@/services/ExcelExportService';
import {InventoryService} from '@/services/InventoryService';
import {makeTestDb} from './helpers/db';

let driver: SqlDriver;
let products: ProductRepository;
let inventory: InventoryService;
let exporter: ExcelExportService;

/**
 * Serialises the workbook to a real .xlsx and parses it back. Asserting on the
 * in-memory object alone would not prove SheetJS can actually write the file the
 * shopkeeper opens, so every assertion below runs against the round-tripped copy.
 */
function roundTrip(workbook: XLSX.WorkBook): XLSX.WorkBook {
  const base64 = XLSX.write(workbook, {type: 'base64', bookType: 'xlsx'}) as string;
  return XLSX.read(base64, {type: 'base64'});
}

function rowsOf(workbook: XLSX.WorkBook, sheet: string): string[][] {
  return XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[sheet], {header: 1, raw: false});
}

beforeEach(async () => {
  driver = await makeTestDb();
  products = new ProductRepository(driver);
  inventory = new InventoryService(driver);
  exporter = new ExcelExportService(
    products,
    new SalesRepository(driver),
    new InventoryRepository(driver),
    new StatsRepository(driver),
  );

  const pen = await products.create({
    name: 'Ballpoint Pen Blue',
    barcode: '001234567890',
    sku: 'STA-PEN-BLU',
    category: 'Stationery',
    purchasePrice: 4,
    sellingPrice: 10,
    initialQuantity: 240,
    minimumStock: 50,
  });
  await products.create({
    name: 'Sugar 1kg',
    barcode: '890111222371',
    category: 'Groceries',
    sellingPrice: 55,
    initialQuantity: 0,
    minimumStock: 10,
  });
  await inventory.sellProduct(pen.id, 12);
});

afterEach(async () => {
  await driver.close();
});

describe('the exported workbook', () => {
  test('has the four expected worksheets', async () => {
    const workbook = roundTrip(buildWorkbook(await exporter.collect()));
    expect(workbook.SheetNames).toEqual([
      'Products',
      'Sales',
      'Inventory Transactions',
      'Summary',
    ]);
  });

  test('lists every product under a header row', async () => {
    const rows = rowsOf(roundTrip(buildWorkbook(await exporter.collect())), 'Products');
    expect(rows[0]).toContain('Barcode');
    expect(rows).toHaveLength(3);
    expect(rows.slice(1).map(row => row[3])).toEqual(
      expect.arrayContaining(['Ballpoint Pen Blue', 'Sugar 1kg']),
    );
  });

  test('a barcode with leading zeros survives the spreadsheet as text', async () => {
    const workbook = roundTrip(buildWorkbook(await exporter.collect()));
    const sheet = workbook.Sheets.Products;

    const rows = rowsOf(workbook, 'Products');
    const penRow = rows.findIndex(row => row[3] === 'Ballpoint Pen Blue');
    const address = XLSX.utils.encode_cell({r: penRow, c: 1});

    // 's' is a text cell. If SheetJS had stored this numerically, Excel would
    // reopen it as 1234567890 and the barcode would no longer match anything.
    expect(sheet[address].t).toBe('s');
    expect(sheet[address].v).toBe('001234567890');
  });

  test('sold-out and low-stock states are spelled out for the reader', async () => {
    const rows = rowsOf(roundTrip(buildWorkbook(await exporter.collect())), 'Products');
    const statuses = rows.slice(1).map(row => row[10]);
    expect(statuses).toEqual(expect.arrayContaining(['IN STOCK', 'SOLD OUT']));
  });

  test('the sales sheet carries the line that was actually sold', async () => {
    const rows = rowsOf(roundTrip(buildWorkbook(await exporter.collect())), 'Sales');
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toMatch(/^S-\d{8}-\d{4}-[0-9A-F]{3}$/);
    expect(rows[1][2]).toBe('001234567890');
    expect(rows[1][4]).toBe('12');
    expect(rows[1][6]).toBe('120');
  });

  test('the transactions sheet holds the full audit trail', async () => {
    const rows = rowsOf(roundTrip(buildWorkbook(await exporter.collect())), 'Inventory Transactions');
    // Two opening-stock rows (Sugar opened at zero, so it has none) plus the sale.
    const types = rows.slice(1).map(row => row[3]);
    expect(types).toEqual(['Initial Stock', 'Sale']);
  });

  test('the summary totals match the database', async () => {
    const rows = rowsOf(roundTrip(buildWorkbook(await exporter.collect())), 'Summary');
    const summary = Object.fromEntries(rows.slice(1).map(row => [row[0], row[1]]));

    expect(summary['Total Products']).toBe('2');
    expect(summary['Total Units']).toBe('228');
    expect(summary['Sold Out Products']).toBe('1');
    expect(summary["Today's Items Sold"]).toBe('12');
    expect(summary["Today's Revenue"]).toBe('120');
  });

  test('an empty shop still produces a valid workbook rather than failing', async () => {
    const empty = await makeTestDb();
    const emptyExporter = new ExcelExportService(
      new ProductRepository(empty),
      new SalesRepository(empty),
      new InventoryRepository(empty),
      new StatsRepository(empty),
    );

    const workbook = roundTrip(buildWorkbook(await emptyExporter.collect()));
    expect(workbook.SheetNames).toHaveLength(4);
    expect(rowsOf(workbook, 'Products')).toHaveLength(1); // headers only

    await empty.close();
  });
});
