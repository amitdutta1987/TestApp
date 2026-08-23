import {getDriver} from '@/database/database';
import type {SqlDriver} from '@/database/driver';

/**
 * Resolves the driver on every access instead of capturing it in the
 * constructor. Two things depend on this:
 *
 *  - Repositories can be instantiated at module scope, before initDatabase().
 *  - Restore closes the database and opens a new handle; a captured driver
 *    would leave every long-lived repository writing to a closed connection.
 *
 * Tests inject their own driver, which then wins over the global one.
 */
export abstract class BaseRepository {
  constructor(private readonly injectedDriver?: SqlDriver) {}

  protected get driver(): SqlDriver {
    return this.injectedDriver ?? getDriver();
  }
}
