/**
 * Schema v1.
 *
 * Design notes that matter:
 *  - `barcode` is TEXT with a UNIQUE index. Leading zeros are significant, so it
 *    must never be stored as INTEGER.
 *  - `status` denormalises the quantity/minimum_stock rule so the inventory list
 *    can filter on an index at 5k+ products. src/utils/stock.ts owns the rule.
 *  - Timestamps are ISO-8601 UTC TEXT, which sorts lexicographically in SQLite.
 *  - Money is REAL. Rupee amounts in a single-shop app stay well inside the
 *    exact range of a double; the alternative (integer paise) buys nothing here.
 */

export const CREATE_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS products (
      id                TEXT PRIMARY KEY NOT NULL,
      barcode           TEXT NOT NULL UNIQUE,
      sku               TEXT,
      name              TEXT NOT NULL,
      category          TEXT,
      brand             TEXT,
      description       TEXT,
      color             TEXT,
      size              TEXT,
      material          TEXT,
      supplier          TEXT,
      rack_location     TEXT,
      purchase_price    REAL,
      selling_price     REAL NOT NULL DEFAULT 0 CHECK (selling_price >= 0),
      minimum_stock     INTEGER NOT NULL DEFAULT 0 CHECK (minimum_stock >= 0),
      current_quantity  INTEGER NOT NULL DEFAULT 0 CHECK (current_quantity >= 0),
      status            TEXT NOT NULL DEFAULT 'SOLD_OUT'
                          CHECK (status IN ('IN_STOCK','LOW_STOCK','SOLD_OUT')),
      lifecycle         TEXT NOT NULL DEFAULT 'ACTIVE'
                          CHECK (lifecycle IN ('ACTIVE','INACTIVE')),
      primary_image     TEXT,
      created_at        TEXT NOT NULL,
      updated_at        TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS product_images (
      id          TEXT PRIMARY KEY NOT NULL,
      product_id  TEXT NOT NULL,
      image_uri   TEXT NOT NULL,
      is_primary  INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
      created_at  TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
   );`,

  `CREATE TABLE IF NOT EXISTS sales (
      id            TEXT PRIMARY KEY NOT NULL,
      sale_number   TEXT NOT NULL UNIQUE,
      total_amount  REAL NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL
   );`,

  `CREATE TABLE IF NOT EXISTS sale_items (
      id            TEXT PRIMARY KEY NOT NULL,
      sale_id       TEXT NOT NULL,
      product_id    TEXT NOT NULL,
      barcode       TEXT NOT NULL,
      product_name  TEXT NOT NULL,
      quantity      INTEGER NOT NULL CHECK (quantity > 0),
      unit_price    REAL NOT NULL CHECK (unit_price >= 0),
      total_price   REAL NOT NULL CHECK (total_price >= 0),
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE RESTRICT
   );`,

  `CREATE TABLE IF NOT EXISTS inventory_transactions (
      id               TEXT PRIMARY KEY NOT NULL,
      product_id       TEXT NOT NULL,
      type             TEXT NOT NULL CHECK (type IN
                         ('INITIAL_STOCK','STOCK_IN','SALE','RETURN','DAMAGE','STOCK_ADJUSTMENT')),
      quantity         INTEGER NOT NULL,
      quantity_before  INTEGER NOT NULL CHECK (quantity_before >= 0),
      quantity_after   INTEGER NOT NULL CHECK (quantity_after >= 0),
      reference_id     TEXT,
      notes            TEXT,
      created_at       TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
   );`,

  `CREATE TABLE IF NOT EXISTS app_settings (
      key         TEXT PRIMARY KEY NOT NULL,
      value       TEXT NOT NULL,
      updated_at  TEXT NOT NULL
   );`,
];

export const CREATE_INDEXES: string[] = [
  // The hot path: scan a barcode, find the product. Unique + exact match.
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);',
  'CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);',
  'CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);',
  'CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);',
  // Covers the inventory list's default filter (active products by status).
  'CREATE INDEX IF NOT EXISTS idx_products_lifecycle_status ON products(lifecycle, status);',
  'CREATE INDEX IF NOT EXISTS idx_products_updated_at ON products(updated_at);',

  'CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);',

  'CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);',

  'CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);',
  'CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);',
  'CREATE INDEX IF NOT EXISTS idx_sale_items_barcode ON sale_items(barcode);',

  'CREATE INDEX IF NOT EXISTS idx_inv_tx_product ON inventory_transactions(product_id);',
  'CREATE INDEX IF NOT EXISTS idx_inv_tx_created_at ON inventory_transactions(created_at);',
  // Product history screen orders by date within one product.
  'CREATE INDEX IF NOT EXISTS idx_inv_tx_product_created ON inventory_transactions(product_id, created_at);',
  'CREATE INDEX IF NOT EXISTS idx_inv_tx_type ON inventory_transactions(type);',
];

/** Only one product_images row per product may be flagged primary. */
export const CREATE_PARTIAL_INDEXES: string[] = [
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_one_primary
     ON product_images(product_id) WHERE is_primary = 1;`,
];

export const ALL_TABLES = [
  'products',
  'product_images',
  'sales',
  'sale_items',
  'inventory_transactions',
  'app_settings',
] as const;

export type TableName = (typeof ALL_TABLES)[number];
