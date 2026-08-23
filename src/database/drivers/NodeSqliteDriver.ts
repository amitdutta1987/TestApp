import {DatabaseSync} from 'node:sqlite';
import type {SqlDriver, SqlResult, SqlTransaction, SqlValue} from '../driver';

/**
 * Test-only driver backed by Node's built-in SQLite.
 *
 * This is never reachable from index.js, so Metro will not bundle it. It exists
 * so the repository, inventory and export tests run against a real SQLite engine
 * — same DDL, same constraints, same transaction semantics as the device.
 */
export class NodeSqliteDriver implements SqlDriver {
  private readonly db: DatabaseSync;
  private readonly path: string;

  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.path = path;
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  private run<TRow>(sql: string, params: SqlValue[]): SqlResult<TRow> {
    const statement = this.db.prepare(sql);
    // `all()` throws on non-SELECT statements in node:sqlite, so branch on
    // whether the compiled statement actually returns a result set.
    if (statement.get === undefined) {
      throw new Error(`Could not prepare statement: ${sql}`);
    }
    const isRead = /^\s*(SELECT|PRAGMA|WITH|EXPLAIN)/i.test(sql);
    if (isRead) {
      const rows = statement.all(...(params as never[])) as TRow[];
      return {rows: rows.map(row => ({...row})), rowsAffected: 0};
    }
    const info = statement.run(...(params as never[]));
    return {
      rows: [],
      rowsAffected: Number(info.changes ?? 0),
      insertId: info.lastInsertRowid === undefined ? undefined : Number(info.lastInsertRowid),
    };
  }

  async execute<TRow = Record<string, SqlValue>>(
    sql: string,
    params: SqlValue[] = [],
  ): Promise<SqlResult<TRow>> {
    return this.run<TRow>(sql, params);
  }

  async transaction<T>(work: (tx: SqlTransaction) => T): Promise<T> {
    const tx: SqlTransaction = {
      execute: <TRow = Record<string, SqlValue>>(sql: string, params: SqlValue[] = []) =>
        this.run<TRow>(sql, params),
    };
    this.db.exec('BEGIN IMMEDIATE;');
    try {
      const value = work(tx);
      this.db.exec('COMMIT;');
      return value;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK;');
      } catch {
        // Already unwound by SQLite.
      }
      throw error;
    }
  }

  getDatabasePath(): string {
    return this.path;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
