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

/** Wipes every row but keeps the schema. Used by "Clear all data" and restore. */
export async function clearAllTables(target: SqlDriver = getDriver()): Promise<void> {
  await target.transaction(tx => {
    // Children first — foreign keys are enforced.
    for (const table of [...ALL_TABLES].reverse()) {
      tx.execute(`DELETE FROM ${table};`);
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
