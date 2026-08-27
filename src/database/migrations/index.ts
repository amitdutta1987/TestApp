import type {SqlDriver} from '../driver';
import {CREATE_INDEXES, CREATE_PARTIAL_INDEXES, CREATE_TABLES} from '../schema';
import {CREATE_IMAGE_QUEUE, CREATE_IMAGE_QUEUE_INDEXES} from '../schema/images';
import {
  BACKFILL_OUTBOX,
  buildMetadataClockTrigger,
  buildSyncTriggers,
  CREATE_SYNC_INDEXES,
  CREATE_SYNC_TABLES,
  SEED_SYNC_CONTROL,
} from '../schema/sync';

export interface Migration {
  version: number;
  name: string;
  up: (driver: SqlDriver) => Promise<void>;
}

async function runAll(driver: SqlDriver, statements: string[]): Promise<void> {
  for (const statement of statements) {
    await driver.execute(statement);
  }
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial_schema',
    up: async driver => {
      await runAll(driver, CREATE_TABLES);
      await runAll(driver, CREATE_INDEXES);
      await runAll(driver, CREATE_PARTIAL_INDEXES);
    },
  },
  {
    version: 2,
    name: 'multi_device_sync',
    up: async driver => {
      /**
       * Metadata edits get their own timestamp. `updated_at` moves on every
       * stock change too, and last-write-wins on that column would let a sale
       * on one device outrank a genuine rename made earlier on another. The
       * merge compares metadata_updated_at so only real edits compete.
       */
      await driver.execute('ALTER TABLE products ADD COLUMN metadata_updated_at TEXT;');
      await driver.execute('UPDATE products SET metadata_updated_at = updated_at;');
      await runAll(driver, [
        'CREATE INDEX IF NOT EXISTS idx_products_metadata_updated ON products(metadata_updated_at);',
      ]);

      await runAll(driver, CREATE_SYNC_TABLES);
      await runAll(driver, CREATE_SYNC_INDEXES);
      await runAll(driver, CREATE_IMAGE_QUEUE);
      await runAll(driver, CREATE_IMAGE_QUEUE_INDEXES);

      // Seeded before the triggers exist: every trigger's WHEN clause reads the
      // 'applying' flag, and a missing row makes the comparison NULL, which
      // silently disables change tracking altogether.
      await runAll(driver, SEED_SYNC_CONTROL);
      await runAll(driver, buildSyncTriggers());

      /**
       * Everything already on this device predates sync, so it must all be
       * pushed once. The triggers only fire on future writes.
       */
      await runAll(driver, BACKFILL_OUTBOX);
    },
  },
  {
    version: 3,
    name: 'metadata_clock_trigger',
    up: async driver => {
      /**
       * Hands ownership of metadata_updated_at to a trigger. Five write paths
       * had been setting it by hand, and four of them forgot — so deactivating
       * a product, reactivating it, or changing its photo produced a row whose
       * timestamp had not moved, which last-write-wins then discarded. The
       * change looked applied locally and reached no other device.
       */
      await driver.execute(buildMetadataClockTrigger());

      /**
       * Those lost edits are still sitting in the local database with a stale
       * timestamp, so re-queueing them alone would not help — the server would
       * reject them again. Nudging the clock forward makes them win once, which
       * is correct: they are the most recent statement of intent this device
       * has, and they never reached anyone.
       *
       * `metadata_updated_at < updated_at` also catches products that were only
       * ever sold, since a sale moves updated_at too. That over-inclusion is
       * deliberate — the two cases are indistinguishable after the fact, and
       * re-pushing a product whose metadata never changed merely rewrites
       * identical values, whereas missing one loses a real edit for good.
       */
      await driver.execute(
        `UPDATE products
            SET metadata_updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
          WHERE metadata_updated_at IS NULL OR metadata_updated_at < updated_at;`,
      );
      await runAll(driver, [
        `INSERT OR IGNORE INTO sync_outbox (table_name, row_id, op, changed_at)
           SELECT 'products', id, 'UPSERT', metadata_updated_at FROM products;`,
      ]);
    },
  },
];

/**
 * Uses SQLite's own `user_version` pragma as the migration marker so there is no
 * bootstrap ordering problem (no table needs to exist before we can read it).
 */
export async function getSchemaVersion(driver: SqlDriver): Promise<number> {
  const result = await driver.execute<{user_version: number}>('PRAGMA user_version;');
  return Number(result.rows[0]?.user_version ?? 0);
}

async function setSchemaVersion(driver: SqlDriver, version: number): Promise<void> {
  // PRAGMA does not accept bound parameters; version is an internal integer.
  await driver.execute(`PRAGMA user_version = ${Math.floor(version)};`);
}

export async function migrate(driver: SqlDriver): Promise<number> {
  const current = await getSchemaVersion(driver);
  const pending = MIGRATIONS.filter(m => m.version > current).sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    await migration.up(driver);
    await setSchemaVersion(driver, migration.version);
  }

  return pending.length > 0 ? pending[pending.length - 1].version : current;
}

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
