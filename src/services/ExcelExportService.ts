import * as RNFS from '@dr.pogodin/react-native-fs';
import * as XLSX from 'xlsx';
import {APP, DIRS} from '@/constants/config';
import {InventoryRepository} from '@/repositories/InventoryRepository';
import {ProductRepository} from '@/repositories/ProductRepository';
import {SalesRepository, type SaleItemWithSale} from '@/repositories/SalesRepository';
import {StatsRepository} from '@/repositories/StatsRepository';
import type {DashboardStats, InventoryTransactionWithProduct, Product} from '@/types';
import {fileStamp} from '@/utils/date';
import {AppError} from '@/utils/errors';
import {ensureStorageDirs, toAbsolutePath} from './ImageStorageService';

/**
 * Real .xlsx generation, entirely offline. SheetJS builds the workbook in JS and
 * we write the base64 payload straight to app-private storage — no server, no
 * template file, no network.
 */

export interface ExcelExportData {
  products: Product[];
  saleItems: SaleItemWithSale[];
  transactions: InventoryTransactionWithProduct[];
  stats: DashboardStats;
  generatedAt: Date;
}

const STATUS_LABELS: Record<string, string> = {
  IN_STOCK: 'IN STOCK',
  LOW_STOCK: 'LOW STOCK',
  SOLD_OUT: 'SOLD OUT',
};

const TX_LABELS: Record<string, string> = {
  INITIAL_STOCK: 'Initial Stock',
  STOCK_IN: 'Stock In',
  SALE: 'Sale',
  RETURN: 'Return',
  DAMAGE: 'Damage',
  STOCK_ADJUSTMENT: 'Stock Adjustment',
};

function excelDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function autoWidths(rows: Array<Array<string | number>>): XLSX.ColInfo[] {
  if (rows.length === 0) {
    return [];
  }
  const widths = rows[0].map((_, column) => {
    const longest = rows.reduce((max, row) => {
      const cell = row[column];
      const length = cell === undefined || cell === null ? 0 : String(cell).length;
      return Math.max(max, length);
    }, 0);
    return {wch: Math.min(Math.max(longest + 2, 10), 45)};
  });
  return widths;
}

function sheetFromRows(rows: Array<Array<string | number>>): XLSX.WorkSheet {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = autoWidths(rows);
  // Keeps headers visible when scrolling a few thousand rows.
  sheet['!freeze'] = {xSplit: '0', ySplit: '1'};
  return sheet;
}

/**
 * Pure workbook construction — no filesystem, no native modules — so the sheet
 * contents can be asserted directly in tests.
 */
export function buildWorkbook(data: ExcelExportData): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();

  const productRows: Array<Array<string | number>> = [
    [
      'Product ID',
      'Barcode',
      'SKU',
      'Product Name',
      'Category',
      'Brand',
      'Purchase Price',
      'Selling Price',
      'Current Quantity',
      'Minimum Stock',
      'Status',
      'Created Date',
      'Updated Date',
    ],
    ...data.products.map(product => [
      product.id,
      // Leading zeros survive because the cell is written as text.
      product.barcode,
      product.sku ?? '',
      product.name,
      product.category ?? '',
      product.brand ?? '',
      product.purchasePrice ?? '',
      product.sellingPrice,
      product.currentQuantity,
      product.minimumStock,
      STATUS_LABELS[product.status] ?? product.status,
      excelDate(product.createdAt),
      excelDate(product.updatedAt),
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(productRows), 'Products');

  const salesRows: Array<Array<string | number>> = [
    ['Sale Number', 'Date', 'Barcode', 'Product', 'Quantity', 'Unit Price', 'Total Price'],
    ...data.saleItems.map(item => [
      item.saleNumber,
      excelDate(item.createdAt),
      item.barcode,
      item.productName,
      item.quantity,
      item.unitPrice,
      item.totalPrice,
    ]),
  ];
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(salesRows), 'Sales');

  const transactionRows: Array<Array<string | number>> = [
    [
      'Date',
      'Barcode',
      'Product',
      'Transaction Type',
      'Quantity',
      'Quantity Before',
      'Quantity After',
      'Notes',
    ],
    ...data.transactions.map(transaction => [
      excelDate(transaction.createdAt),
      transaction.barcode,
      transaction.productName,
      TX_LABELS[transaction.type] ?? transaction.type,
      transaction.quantity,
      transaction.quantityBefore,
      transaction.quantityAfter,
      transaction.notes ?? '',
    ]),
  ];
  XLSX.utils.book_append_sheet(
    workbook,
    sheetFromRows(transactionRows),
    'Inventory Transactions',
  );

  const summaryRows: Array<Array<string | number>> = [
    ['Metric', 'Value'],
    ['Total Products', data.stats.totalProducts],
    ['Total Units', data.stats.totalUnits],
    ['Low Stock Products', data.stats.lowStockCount],
    ['Sold Out Products', data.stats.soldOutCount],
    ["Today's Items Sold", data.stats.todayItemsSold],
    ["Today's Revenue", data.stats.todayRevenue],
    ['Inventory Value (Cost)', data.stats.inventoryValueAtCost],
    ['Inventory Value (Retail)', data.stats.inventoryValueAtRetail],
    ['Generated At', excelDate(data.generatedAt.toISOString())],
    ['App Version', APP.version],
  ];
  XLSX.utils.book_append_sheet(workbook, sheetFromRows(summaryRows), 'Summary');

  return workbook;
}

export interface ExcelExportResult {
  absolutePath: string;
  fileName: string;
  sizeBytes: number;
}

export class ExcelExportService {
  constructor(
    private readonly products = new ProductRepository(),
    private readonly sales = new SalesRepository(),
    private readonly inventory = new InventoryRepository(),
    private readonly stats = new StatsRepository(),
  ) {}

  async collect(): Promise<ExcelExportData> {
    const [products, saleItems, transactions, stats] = await Promise.all([
      this.products.listAll(),
      this.sales.listAllForExport(),
      this.inventory.listAllForExport(),
      this.stats.dashboard(),
    ]);
    return {products, saleItems, transactions, stats, generatedAt: new Date()};
  }

  /** Writes the workbook and returns its on-device path. */
  async exportToExcel(): Promise<ExcelExportResult> {
    try {
      await ensureStorageDirs();
      const data = await this.collect();
      const workbook = buildWorkbook(data);

      const base64 = XLSX.write(workbook, {type: 'base64', bookType: 'xlsx'}) as string;

      const fileName = `Inventory_Export_${fileStamp(data.generatedAt)}.xlsx`;
      const relativePath = `${DIRS.exports}/${fileName}`;
      const absolutePath = toAbsolutePath(relativePath);

      await RNFS.writeFile(absolutePath, base64, 'base64');
      const stat = await RNFS.stat(absolutePath);

      return {absolutePath, fileName, sizeBytes: Number(stat.size ?? 0)};
    } catch (error) {
      throw new AppError('EXPORT_FAILED', 'Could not create the Excel file.', {cause: error});
    }
  }

  /** Removes older exports so the app does not accumulate stale spreadsheets. */
  async pruneOldExports(keep = 5): Promise<void> {
    try {
      const dir = toAbsolutePath(DIRS.exports);
      if (!(await RNFS.exists(dir))) {
        return;
      }
      const entries = await RNFS.readDir(dir);
      const files = entries
        .filter(entry => entry.isFile() && entry.name.endsWith('.xlsx'))
        .sort((a, b) => (b.mtime?.getTime() ?? 0) - (a.mtime?.getTime() ?? 0));
      for (const file of files.slice(keep)) {
        await RNFS.unlink(file.path);
      }
    } catch {
      // Housekeeping only — never block an export because cleanup failed.
    }
  }
}

export const excelExportService = new ExcelExportService();
