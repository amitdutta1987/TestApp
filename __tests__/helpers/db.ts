import {prepareDatabase} from '@/database/database';
import type {SqlDriver} from '@/database/driver';
import {NodeSqliteDriver} from '@/database/drivers/NodeSqliteDriver';

/**
 * A real, migrated SQLite database for tests.
 *
 * node:sqlite runs the same DDL, the same constraints and the same
 * BEGIN/COMMIT semantics as op-sqlite on the device, so these tests exercise the
 * production SQL rather than a stand-in.
 */
export async function makeTestDb(path = ':memory:'): Promise<SqlDriver> {
  const driver = new NodeSqliteDriver(path);
  await prepareDatabase(driver);
  return driver;
}
