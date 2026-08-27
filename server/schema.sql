-- ============================================================================
--  Inventory sync — Postgres schema (Neon)
--
--  Run once against your Neon database:
--      psql "$DATABASE_URL" -f schema.sql
--
--  Mirrors the app's SQLite schema, with three deliberate differences.
--
--  1. Every row carries `server_seq`, drawn from one global sequence and
--     rewritten on each change. A device pulls "everything above my cursor",
--     which yields current state only — a new phone gets one row per record
--     rather than replaying the shop's entire edit history.
--
--  2. Deletes are soft. A hard DELETE is invisible to a device that was offline
--     when it happened, and the row would simply be re-uploaded from that
--     device's copy on its next push. A tombstone propagates.
--
--  3. There is no current_quantity or status column on products. Stock is not
--     a value to be overwritten; it is the sum of an append-only ledger, and
--     storing a second copy here would invite exactly the lost-update bug that
--     the ledger design exists to prevent. See the product_stock view.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS sync_seq;

-- ---------------------------------------------------------------- products --
CREATE TABLE IF NOT EXISTS products (
  id                    TEXT PRIMARY KEY,
  -- TEXT, never numeric: leading zeros in a barcode are significant.
  barcode               TEXT NOT NULL,
  sku                   TEXT,
  name                  TEXT NOT NULL,
  category              TEXT,
  brand                 TEXT,
  description           TEXT,
  color                 TEXT,
  size                  TEXT,
  material              TEXT,
  supplier              TEXT,
  rack_location         TEXT,
  purchase_price        DOUBLE PRECISION,
  selling_price         DOUBLE PRECISION NOT NULL DEFAULT 0,
  minimum_stock         INTEGER NOT NULL DEFAULT 0,
  lifecycle             TEXT NOT NULL DEFAULT 'ACTIVE',
  primary_image         TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  -- Decides last-write-wins. Distinct from updated_at, which also moves on
  -- every sale and would let a busy till outrank a genuine edit made earlier.
  metadata_updated_at   TEXT NOT NULL,
  deleted_at            TEXT,
  server_seq            BIGINT NOT NULL DEFAULT nextval('sync_seq')
);

-- Deliberately NOT unique. Two counters can each add the same physical item
-- while offline, and both rows are real. Rejecting the second here would strand
-- it in that device's outbox forever, retrying on every sync. The clients settle
-- it instead, by a rule that depends only on the row contents (earliest
-- created_at wins the barcode, ties broken by id) so every device independently
-- reaches the same answer. See resolveBarcodeConflict in src/sync/merge.ts.
CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON products(barcode) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_products_seq ON products(server_seq);

-- --------------------------------------------------------- product_images --
CREATE TABLE IF NOT EXISTS product_images (
  id          TEXT PRIMARY KEY,
  product_id  TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- Doubles as the S3 object key; see server/src/images.ts.
  image_uri   TEXT NOT NULL,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL,
  deleted_at  TEXT,
  server_seq  BIGINT NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);
CREATE INDEX IF NOT EXISTS idx_product_images_seq ON product_images(server_seq);

-- ------------------------------------------------------------------- sales --
CREATE TABLE IF NOT EXISTS sales (
  id            TEXT PRIMARY KEY,
  -- Carries a per-device tag (S-YYYYMMDD-NNNN-XXX). Without it two counters
  -- selling offline both mint sequence 0001 and one sale is lost on merge.
  sale_number   TEXT NOT NULL UNIQUE,
  total_amount  DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  deleted_at    TEXT,
  server_seq    BIGINT NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_seq ON sales(server_seq);

-- -------------------------------------------------------------- sale_items --
CREATE TABLE IF NOT EXISTS sale_items (
  id            TEXT PRIMARY KEY,
  sale_id       TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL REFERENCES products(id),
  barcode       TEXT NOT NULL,
  product_name  TEXT NOT NULL,
  quantity      INTEGER NOT NULL,
  unit_price    DOUBLE PRECISION NOT NULL,
  total_price   DOUBLE PRECISION NOT NULL,
  deleted_at    TEXT,
  server_seq    BIGINT NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_seq ON sale_items(server_seq);

-- -------------------------------------------------- inventory_transactions --
-- The authoritative record of stock. Append-only and immutable: merging two
-- devices is a set union, which cannot lose a movement or double-count one.
CREATE TABLE IF NOT EXISTS inventory_transactions (
  id               TEXT PRIMARY KEY,
  product_id       TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  -- Signed: negative for SALE and DAMAGE.
  quantity         INTEGER NOT NULL,
  -- What the originating device saw at the time. Kept as recorded rather than
  -- rewritten on merge: it is a truthful account of that counter's view, and
  -- the authoritative current stock is SUM(quantity), not this column.
  quantity_before  INTEGER NOT NULL,
  quantity_after   INTEGER NOT NULL,
  reference_id     TEXT,
  notes            TEXT,
  created_at       TEXT NOT NULL,
  deleted_at       TEXT,
  server_seq       BIGINT NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS idx_inv_tx_product ON inventory_transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_tx_seq ON inventory_transactions(server_seq);

-- ------------------------------------------------------------ app_settings --
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT,
  server_seq  BIGINT NOT NULL DEFAULT nextval('sync_seq')
);
CREATE INDEX IF NOT EXISTS idx_app_settings_seq ON app_settings(server_seq);

-- ------------------------------------------------------------------- views --
-- Authoritative stock, derived rather than stored. A negative figure is real
-- and means two devices sold the same unit while offline; it is surfaced in the
-- app rather than clamped away here.
CREATE OR REPLACE VIEW product_stock AS
  SELECT p.id AS product_id,
         p.name,
         p.barcode,
         p.minimum_stock,
         COALESCE(SUM(t.quantity) FILTER (WHERE t.deleted_at IS NULL), 0) AS quantity
    FROM products p
    LEFT JOIN inventory_transactions t ON t.product_id = p.id
   WHERE p.deleted_at IS NULL
   GROUP BY p.id, p.name, p.barcode, p.minimum_stock;
