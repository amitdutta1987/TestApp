import {open, type DB} from '@op-engineering/op-sqlite';
import {DB as DB_CONFIG} from '@/constants/config';
import {AppError} from '@/utils/errors';
import type {SqlDriver, SqlResult, SqlTransaction, SqlValue} from '../driver';

/**
 * On-device driver.
 *
 * Transactions are driven with explicit BEGIN/COMMIT over `executeSync` rather
 * than op-sqlite's async `db.transaction()`. The synchronous path is what makes
 * a sale atomic: no other statement can interleave between the stock check and
 * the stock write, so overselling is impossible even if the user double-taps.
 */
export class OpSqliteDriver implements SqlDriver {
  private readonly db: DB;
  private readonly path: string;

  private constructor(db: DB) {
    this.db = db;
    this.path = db.getDbPath();
  }

  static open(name: string = DB_CONFIG.name): OpSqliteDriver {
    try {
      const db = open({name});
      // Foreign keys are OFF by default in SQLite and are per-connection.
      db.executeSync('PRAGMA foreign_keys = ON;');
      // WAL keeps reads (inventory list) from blocking writes (a sale).
      db.executeSync('PRAGMA journal_mode = WAL;');
      db.executeSync('PRAGMA synchronous = NORMAL;');
      db.executeSync('PRAGMA busy_timeout = 5000;');
      return new OpSqliteDriver(db);
    } catch (error) {
      throw new AppError('DB_ERROR', 'Could not open the local inventory database.', {
        cause: error,
      });
    }
  }

  async execute<TRow = Record<string, SqlValue>>(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    try {
      const result = await this.db.execute(sql, params);
      return {
        rows: (result.rows ?? []) as TRow[],
        rowsAffected: result.rowsAffected ?? 0,
        insertId: result.insertId,
      };
    } catch (error) {
      throw new AppError('DB_ERROR', 'A database query failed.', {cause: error, details: sql});
    }
  }

  async transaction<T>(work: (tx: SqlTransaction) => T): Promise<T> {
    const tx: SqlTransaction = {
      execute: <TRow = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) => {
        const result = this.db.executeSync(sql, params);
        return {
          rows: (result.rows ?? []) as TRow[],
          rowsAffected: result.rowsAffected ?? 0,
          insertId: result.insertId,
        } satisfies SqlResult<TRow>;
      },
    };

    this.db.executeSync('BEGIN IMMEDIATE;');
    try {
      const value = work(tx);
      this.db.executeSync('COMMIT;');
      return value;
    } catch (error) {
      try {
        this.db.executeSync('ROLLBACK;');
      } catch {
        // A rollback failure means SQLite already unwound the transaction.
        // Surfacing it would mask the real error from `work`.
      }
      throw error;
    }
  }

  getDatabasePath(): string {
    return this.path;
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }

  /** Flushes the WAL into the main file so a backup copies a complete database. */
  async checkpoint(): Promise<void> {
    await this.execute('PRAGMA wal_checkpoint(TRUNCATE);');
  }
}
