import {AppError} from '@/utils/errors';
import type {SqlDriver} from './driver';
import {OpSqliteDriver} from './drivers/OpSqliteDriver';
import {LATEST_SCHEMA_VERSION, migrate} from './migrations';
import {ALL_TABLES} from './schema';

/**
 * Process-wide database handle.
 *
 * The driver is injectable so tests (and, later, a different SQLite binding)
 * can swap in another implementation without touching repositories.
 */
let driver: SqlDriver | null = null;
let initPromise: Promise<SqlDriver> | null = null;

export function setDriver(next: SqlDriver | null): void {
  driver = next;
  initPromise = null;
}

export function getDriver(): SqlDriver {
  if (!driver) {
    throw new AppError('DB_ERROR', 'The database has not been opened yet.');
  }
  return driver;
}

/** Idempotent: concurrent callers share one open+migrate pass. */
export async function initDatabase(): Promise<SqlDriver> {
  if (driver) {
    return driver;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const opened = OpSqliteDriver.open();
    await migrate(opened);
    driver = opened;
    return opened;
  })().catch(error => {
    initPromise = null;
    throw error instanceof AppError
      ? error
      : new AppError('DB_ERROR', 'Could not prepare the local database.', {cause: error});
  });

  return initPromise;
}

/** Runs migrations against an already-open driver (used by tests and restore). */
export async function prepareDatabase(target: SqlDriver): Promise<void> {
  await migrate(target);
}

export {LATEST_SCHEMA_VERSION};

/**
 * Wipes every row on *this device* but keeps the schema.
 *
 * Deliberately local-only. The change-tracking triggers would otherwise turn a
 * wipe into a delete for every row, push it, and erase the shop's inventory on
 * every other device — an unrecoverable outcome from a button whose dialog
 * promises to clear "this device". So the triggers are suppressed, the sync
 * bookkeeping is dropped, and the cursor is reset: the next sync repopulates
 * this device from the server rather than emptying everyone else's.
 *
 * Wiping the shop's data everywhere is not something the app offers; it is done
 * against the database directly, deliberately.
 */
export async function clearAllTables(target: SqlDriver = getDriver()): Promise<void> {
  await target.transaction(tx => {
    tx.execute("UPDATE sync_control SET value = '1' WHERE key = 'applying';");
    try {
      // Children first — foreign keys are enforced.
      for (const table of [...ALL_TABLES].reverse()) {
        tx.execute(`DELETE FROM ${table};`);
      }
      // Nothing is left to push, and nothing must be resurrected as a tombstone.
      tx.execute('DELETE FROM sync_outbox;');
      tx.execute('DELETE FROM sync_tombstones;');
      tx.execute('DELETE FROM image_sync_queue;');
      // Rewound so the next sync pulls the shop's data back down in full.
      tx.execute("UPDATE sync_control SET value = '0' WHERE key = 'cursor';");
    } finally {
      tx.execute("UPDATE sync_control SET value = '0' WHERE key = 'applying';");
    }
  });
  await target.execute('VACUUM;');
}

export async function closeDatabase(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
    initPromise = null;
  }
}
