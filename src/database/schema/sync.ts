/**
 * Schema v2 — the local half of multi-device sync.
 *
 * Design notes that matter:
 *
 *  - **Change tracking is done with triggers, not by editing write paths.**
 *    Every repository INSERT/UPDATE/DELETE would otherwise need a matching
 *    outbox write, and a single missed one silently loses a row on another
 *    device. A trigger cannot be forgotten.
 *
 *  - **The outbox is a set, not a log.** Its primary key is
 *    (table_name, row_id), so editing a product ten times offline still pushes
 *    one row carrying the final state. Push sends current state, never diffs.
 *
 *  - **`sync_control.applying` suppresses the triggers during a pull.** Without
 *    it, applying a row that arrived from the server would enqueue it right back
 *    into the outbox and the two devices would push to each other forever.
 *    SQLite has no session variables, so the flag lives in a table the triggers
 *    read in their WHEN clause.
 */

/** Tables that participate in sync, with the column holding their primary key. */
export const SYNCED_TABLES = {
  products: 'id',
  product_images: 'id',
  sales: 'id',
  sale_items: 'id',
  inventory_transactions: 'id',
  app_settings: 'key',
} as const;

export type SyncedTable = keyof typeof SYNCED_TABLES;

/**
 * How the server merges each table.
 *
 * APPEND rows are immutable facts — a sale happened, stock moved. Merging two
 * devices is a set union, which can never conflict and never loses a sale.
 *
 * LWW rows are mutable descriptions. Two devices renaming one product is a real
 * conflict with no correct answer, so the later edit wins.
 */
export const TABLE_MERGE_STRATEGY: Record<SyncedTable, 'APPEND' | 'LWW'> = {
  products: 'LWW',
  product_images: 'LWW',
  app_settings: 'LWW',
  sales: 'APPEND',
  sale_items: 'APPEND',
  inventory_transactions: 'APPEND',
};

export const CREATE_SYNC_TABLES: string[] = [
  /**
   * One row per locally-changed record awaiting push. Deleted on server ack.
   */
  `CREATE TABLE IF NOT EXISTS sync_outbox (
      table_name  TEXT NOT NULL,
      row_id      TEXT NOT NULL,
      op          TEXT NOT NULL CHECK (op IN ('UPSERT','DELETE')),
      changed_at  TEXT NOT NULL,
      PRIMARY KEY (table_name, row_id)
   ) WITHOUT ROWID;`,

  /**
   * Sync bookkeeping. Keys: 'applying', 'device_id', 'cursor', 'last_sync_at',
   * 'last_error'. Deliberately separate from app_settings, which is itself
   * synced — this table must stay device-local.
   */
  `CREATE TABLE IF NOT EXISTS sync_control (
      key    TEXT PRIMARY KEY NOT NULL,
      value  TEXT NOT NULL
   ) WITHOUT ROWID;`,

  /**
   * Tombstones for rows deleted locally. The row itself is gone, so the outbox
   * alone cannot tell the server *what* to delete after a restart; this keeps
   * the delete durable and lets a pull skip resurrecting it.
   */
  `CREATE TABLE IF NOT EXISTS sync_tombstones (
      table_name  TEXT NOT NULL,
      row_id      TEXT NOT NULL,
      deleted_at  TEXT NOT NULL,
      PRIMARY KEY (table_name, row_id)
   ) WITHOUT ROWID;`,
];

export const CREATE_SYNC_INDEXES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_sync_outbox_changed ON sync_outbox(changed_at);',
];

/** ISO-8601 UTC with milliseconds — the same shape nowIso() produces. */
const TRIGGER_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Fires only when the change came from the user, not from an incoming pull. */
const NOT_APPLYING = "(SELECT value FROM sync_control WHERE key = 'applying') = '0'";

function enqueue(table: SyncedTable, op: 'UPSERT' | 'DELETE', idExpr: string): string {
  return `INSERT INTO sync_outbox (table_name, row_id, op, changed_at)
          VALUES ('${table}', ${idExpr}, '${op}', ${TRIGGER_NOW})
          ON CONFLICT(table_name, row_id)
          DO UPDATE SET op = excluded.op, changed_at = excluded.changed_at;`;
}

/**
 * Builds the nine-per-table triggers that keep the outbox complete.
 *
 * A DELETE additionally writes a tombstone, because once the row is gone the
 * outbox entry is the only remaining evidence that it ever existed, and that
 * entry is removed as soon as the push is acknowledged.
 */
export function buildSyncTriggers(): string[] {
  const statements: string[] = [];

  for (const [table, pk] of Object.entries(SYNCED_TABLES) as [SyncedTable, string][]) {
    statements.push(
      `CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_ai
         AFTER INSERT ON ${table}
         WHEN ${NOT_APPLYING}
       BEGIN
         ${enqueue(table, 'UPSERT', `NEW.${pk}`)}
       END;`,

      `CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_au
         AFTER UPDATE ON ${table}
         WHEN ${NOT_APPLYING}
       BEGIN
         ${enqueue(table, 'UPSERT', `NEW.${pk}`)}
       END;`,

      `CREATE TRIGGER IF NOT EXISTS trg_${table}_sync_ad
         AFTER DELETE ON ${table}
         WHEN ${NOT_APPLYING}
       BEGIN
         ${enqueue(table, 'DELETE', `OLD.${pk}`)}
         INSERT INTO sync_tombstones (table_name, row_id, deleted_at)
         VALUES ('${table}', OLD.${pk}, ${TRIGGER_NOW})
         ON CONFLICT(table_name, row_id)
         DO UPDATE SET deleted_at = excluded.deleted_at;
       END;`,
    );
  }

  return statements;
}

/** Seeds the flag the triggers read. Must exist before any write happens. */
export const SEED_SYNC_CONTROL: string[] = [
  "INSERT OR IGNORE INTO sync_control (key, value) VALUES ('applying', '0');",
  "INSERT OR IGNORE INTO sync_control (key, value) VALUES ('cursor', '0');",
  /**
   * Minted here, in SQL, rather than by the first caller that happens to need
   * it. Sale numbers embed a device tag, and a sale can be rung up before any
   * sync has ever run — so the id has to exist the moment the schema does.
   * randomblob is per-install, which is exactly the scope wanted.
   */
  "INSERT OR IGNORE INTO sync_control (key, value) VALUES ('device_id', 'dev_' || lower(hex(randomblob(6))));",
];

/**
 * Seeds the outbox with every existing row.
 *
 * Used twice: once by the v2 migration, so a device that has been running
 * offline uploads its whole inventory on first sync rather than only what
 * changes afterwards; and again after a restore, where the incoming database
 * may contain rows the server has never seen.
 */
export const BACKFILL_OUTBOX: string[] = [
  `INSERT OR IGNORE INTO sync_outbox (table_name, row_id, op, changed_at)
     SELECT 'products', id, 'UPSERT', updated_at FROM products;`,
  `INSERT OR IGNORE INTO sync_outbox (table_name, row_id, op, changed_at)
     SELECT 'product_images', id, 'UPSERT', created_at FROM product_images;`,
  `INSERT OR IGNORE INTO sync_outbox (table_name, row_id, op, changed_at)
     SELECT 'sales', id, 'UPSERT', created_at FROM sales;`,
  `INSERT OR IGNORE INTO sync_outbox (table_name, row_id, op, changed_at)
     SELECT 'sale_items', id, 'UPSERT',
            (SELECT created_at FROM sales WHERE sales.id = sale_items.sale_id)
       FROM sale_items;`,
  `INSERT OR IGNORE INTO sync_outbox (table_name, row_id, op, changed_at)
     SELECT 'inventory_transactions', id, 'UPSERT', created_at FROM inventory_transactions;`,
  `INSERT OR IGNORE INTO sync_outbox (table_name, row_id, op, changed_at)
     SELECT 'app_settings', key, 'UPSERT', updated_at FROM app_settings;`,
  // Every image already on disk needs uploading to object storage.
  `INSERT OR IGNORE INTO image_sync_queue (path, direction, attempts, queued_at)
     SELECT image_uri, 'UPLOAD', 0, created_at FROM product_images;`,
];

/**
 * Product columns that count as a metadata edit.
 *
 * Deliberately excludes current_quantity, status and updated_at: those move on
 * every sale, and letting a sale advance the metadata clock is what would allow
 * a busy till to out-rank a genuine edit made earlier on another device.
 */
export const PRODUCT_METADATA_COLUMNS = [
  'barcode',
  'sku',
  'name',
  'category',
  'brand',
  'description',
  'color',
  'size',
  'material',
  'supplier',
  'rack_location',
  'purchase_price',
  'selling_price',
  'minimum_stock',
  'lifecycle',
  'primary_image',
] as const;

/**
 * Keeps products.metadata_updated_at correct without any repository having to
 * remember to set it.
 *
 * The column decides which of two devices' edits wins. Setting it by hand at
 * each write site failed exactly as the outbox would have: deactivate(),
 * reactivate() and all three primary-image writes forgot, so those changes were
 * pushed carrying an unchanged timestamp and the server's last-write-wins guard
 * silently discarded them. Marking a product inactive appeared to work locally
 * and reached no other device.
 *
 * A trigger cannot be forgotten by code written later, which is the same reason
 * change tracking uses one.
 *
 * `IS NOT` rather than `<>` because most of these columns are nullable, and
 * `NULL <> NULL` is NULL — a column going from a value to NULL would not
 * register as a change.
 */
export function buildMetadataClockTrigger(): string {
  const changed = PRODUCT_METADATA_COLUMNS.map(
    column => `NEW.${column} IS NOT OLD.${column}`,
  ).join(' OR ');

  return `CREATE TRIGGER IF NOT EXISTS trg_products_metadata_clock
            AFTER UPDATE ON products
            WHEN ${NOT_APPLYING} AND (${changed})
          BEGIN
            UPDATE products
               SET metadata_updated_at = ${TRIGGER_NOW}
             WHERE id = NEW.id;
          END;`;
}
