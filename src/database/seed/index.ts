import type {SqlDriver} from '@/database/driver';
import {ProductRepository} from '@/repositories/ProductRepository';
import {InventoryService} from '@/services/InventoryService';
import type {NewProductInput} from '@/types';

/**
 * Demo catalogue for manual testing and for the integration tests.
 *
 * Never called from the app's startup path — a shop's real inventory must not be
 * polluted with sample rows. Invoke it explicitly from a dev build or a test.
 */

/**
 * Appends the modulo-10 check digit so the seeded GTINs are genuinely valid
 * rather than plausible-looking. Weights alternate 3/1 from the right.
 *
 * The body must be one digit short of a real GTIN length — 7, 11, 12 or 13 —
 * otherwise the result carries a correct check digit at a length no symbology
 * defines, which is not a valid barcode however right the arithmetic is.
 */
export function withCheckDigit(body: string): string {
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return `${body}${(10 - (sum % 10)) % 10}`;
}

export const SEED_PRODUCTS: NewProductInput[] = [
  {
    // 11-digit body -> 12-digit UPC-A. The leading zeros are the point: this row
    // is the regression guard for "barcodes are strings, never numbers".
    barcode: withCheckDigit('00123456789'),
    name: 'Ballpoint Pen Blue',
    sku: 'STA-PEN-BLU',
    category: 'Stationery',
    brand: 'Cello',
    purchasePrice: 4,
    sellingPrice: 10,
    initialQuantity: 240,
    minimumStock: 50,
    rackLocation: 'A1',
    supplier: 'Metro Wholesale',
  },
  {
    barcode: withCheckDigit('890123456789'),
    name: 'A4 Notebook 200 Pages',
    sku: 'STA-NB-A4',
    category: 'Stationery',
    brand: 'Classmate',
    purchasePrice: 45,
    sellingPrice: 70,
    initialQuantity: 60,
    minimumStock: 15,
    rackLocation: 'A2',
  },
  {
    barcode: withCheckDigit('890123456796'),
    name: 'Whiteboard Marker Black',
    category: 'Stationery',
    brand: 'Camlin',
    purchasePrice: 22,
    sellingPrice: 40,
    initialQuantity: 8,
    minimumStock: 12,
    rackLocation: 'A3',
  },
  {
    // 7-digit body -> 8-digit EAN-8, the short code used on small items.
    barcode: withCheckDigit('8901234'),
    name: 'Stapler Small',
    category: 'Stationery',
    purchasePrice: 60,
    sellingPrice: 110,
    initialQuantity: 0,
    minimumStock: 5,
    rackLocation: 'A4',
  },
  {
    barcode: withCheckDigit('5901234'),
    name: 'Eraser Pack of 10',
    category: 'Stationery',
    purchasePrice: 25,
    sellingPrice: 50,
    initialQuantity: 32,
    minimumStock: 10,
  },
  {
    barcode: withCheckDigit('890111222333'),
    name: 'Basmati Rice 5kg',
    sku: 'GRO-RICE-5',
    category: 'Groceries',
    brand: 'India Gate',
    purchasePrice: 520,
    sellingPrice: 640,
    initialQuantity: 24,
    minimumStock: 6,
    rackLocation: 'C1',
    supplier: 'Sunrise Distributors',
  },
  {
    barcode: withCheckDigit('890111222340'),
    name: 'Sunflower Oil 1L',
    category: 'Groceries',
    brand: 'Fortune',
    purchasePrice: 120,
    sellingPrice: 155,
    initialQuantity: 40,
    minimumStock: 10,
    rackLocation: 'C2',
  },
  {
    barcode: withCheckDigit('890111222357'),
    name: 'Toor Dal 1kg',
    category: 'Groceries',
    purchasePrice: 130,
    sellingPrice: 168,
    initialQuantity: 5,
    minimumStock: 8,
    rackLocation: 'C2',
  },
  {
    barcode: withCheckDigit('890111222364'),
    name: 'Tea Leaves 500g',
    category: 'Groceries',
    brand: 'Tata',
    purchasePrice: 210,
    sellingPrice: 265,
    initialQuantity: 18,
    minimumStock: 6,
  },
  {
    barcode: withCheckDigit('890111222371'),
    name: 'Sugar 1kg',
    category: 'Groceries',
    purchasePrice: 42,
    sellingPrice: 55,
    initialQuantity: 0,
    minimumStock: 10,
  },
  {
    barcode: withCheckDigit('890222333444'),
    name: 'Bath Soap 125g',
    category: 'Personal Care',
    brand: 'Santoor',
    purchasePrice: 28,
    sellingPrice: 42,
    initialQuantity: 96,
    minimumStock: 24,
    rackLocation: 'D1',
  },
  {
    barcode: withCheckDigit('890222333451'),
    name: 'Shampoo Sachet Strip',
    category: 'Personal Care',
    purchasePrice: 55,
    sellingPrice: 80,
    initialQuantity: 14,
    minimumStock: 20,
    rackLocation: 'D1',
  },
  {
    barcode: withCheckDigit('890222333468'),
    name: 'Toothpaste 100g',
    category: 'Personal Care',
    brand: 'Colgate',
    purchasePrice: 68,
    sellingPrice: 95,
    initialQuantity: 36,
    minimumStock: 12,
  },
  {
    // In-house Code 128 label: alphanumeric, no check digit, still valid stock.
    barcode: 'INH-TSHIRT-M-BLK',
    name: 'Cotton T-Shirt Medium Black',
    sku: 'APP-TS-M-BLK',
    category: 'Apparel',
    color: 'Black',
    size: 'M',
    material: 'Cotton',
    purchasePrice: 210,
    sellingPrice: 399,
    initialQuantity: 12,
    minimumStock: 4,
    rackLocation: 'B1',
  },
  {
    barcode: 'INH-TSHIRT-L-BLK',
    name: 'Cotton T-Shirt Large Black',
    category: 'Apparel',
    color: 'Black',
    size: 'L',
    material: 'Cotton',
    purchasePrice: 210,
    sellingPrice: 399,
    initialQuantity: 3,
    minimumStock: 4,
    rackLocation: 'B1',
  },
  {
    barcode: 'INH-SOCKS-FREE',
    name: 'Ankle Socks Free Size',
    category: 'Apparel',
    purchasePrice: 45,
    sellingPrice: 99,
    initialQuantity: 50,
    minimumStock: 10,
  },
  {
    // 11-digit bodies -> 12-digit UPC-A, the usual code on imported electronics.
    barcode: withCheckDigit('04549659001'),
    name: 'AA Battery Pack of 4',
    category: 'Electronics',
    brand: 'Duracell',
    purchasePrice: 95,
    sellingPrice: 140,
    initialQuantity: 22,
    minimumStock: 8,
    rackLocation: 'E1',
  },
  {
    barcode: withCheckDigit('04549659002'),
    name: 'USB-C Cable 1m',
    category: 'Electronics',
    purchasePrice: 105,
    sellingPrice: 199,
    initialQuantity: 0,
    minimumStock: 5,
    rackLocation: 'E1',
  },
  {
    barcode: withCheckDigit('04549659003'),
    name: 'LED Bulb 9W',
    category: 'Electronics',
    brand: 'Philips',
    purchasePrice: 78,
    sellingPrice: 120,
    initialQuantity: 45,
    minimumStock: 12,
    rackLocation: 'E2',
  },
  {
    barcode: withCheckDigit('04549659004'),
    name: 'Extension Board 4 Socket',
    category: 'Electronics',
    purchasePrice: 260,
    sellingPrice: 420,
    initialQuantity: 6,
    minimumStock: 6,
    rackLocation: 'E2',
  },
];

export interface SeedSummary {
  productsCreated: number;
  salesRecorded: number;
  skipped: boolean;
}

/**
 * Inserts the demo catalogue. Refuses to run when products already exist so it
 * can never overwrite a real inventory.
 */
export async function seedDatabase(
  driver?: SqlDriver,
  options: {recordSampleSales?: boolean; force?: boolean} = {},
): Promise<SeedSummary> {
  const products = new ProductRepository(driver);
  const inventory = new InventoryService(driver);

  const existing = await products.list({includeInactive: true}, 1, 0);
  if (existing.total > 0 && !options.force) {
    return {productsCreated: 0, salesRecorded: 0, skipped: true};
  }

  const created = [];
  for (const input of SEED_PRODUCTS) {
    created.push(await products.create(input));
  }

  let salesRecorded = 0;
  if (options.recordSampleSales) {
    // Small, deterministic sales so the dashboard and sales screen have content.
    const plan: Array<[string, number]> = [
      ['Ballpoint Pen Blue', 12],
      ['A4 Notebook 200 Pages', 3],
      ['Basmati Rice 5kg', 2],
      ['Bath Soap 125g', 6],
      ['Cotton T-Shirt Medium Black', 1],
    ];
    for (const [name, quantity] of plan) {
      const product = created.find(item => item.name === name);
      if (product) {
        await inventory.sellProduct(product.id, quantity);
        salesRecorded += 1;
      }
    }
  }

  return {productsCreated: created.length, salesRecorded, skipped: false};
}
