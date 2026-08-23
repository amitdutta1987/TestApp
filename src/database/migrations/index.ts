import type {SqlDriver} from '../driver';
import {CREATE_INDEXES, CREATE_PARTIAL_INDEXES, CREATE_TABLES} from '../schema';

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
