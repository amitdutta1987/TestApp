/**
 * Minimal SQL surface the rest of the app is allowed to use.
 *
 * Two implementations exist: op-sqlite on the device, and node:sqlite under
 * Jest. Because both run the *same* SQL, the repository and inventory tests
 * exercise real queries, real constraints and real transactions rather than a
 * hand-written fake.
 */

export type SqlValue = string | number | null;

export interface SqlResult<TRow = Record<string, SqlValue>> {
  rows: TRow[];
  rowsAffected: number;
  insertId?: number;
}

export interface SqlTransaction {
  execute<TRow = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): SqlResult<TRow>;
}

export interface SqlDriver {
  execute<TRow = Record<string, SqlValue>>(
    sql: string,
    params?: SqlValue[],
  ): Promise<SqlResult<TRow>>;

  /**
   * Runs `work` inside BEGIN/COMMIT. Any throw rolls back — this is what makes
   * "sell N units" atomic across the product, sale, sale_item and transaction
   * rows. `work` is synchronous so no other statement can interleave.
   */
  transaction<T>(work: (tx: SqlTransaction) => T): Promise<T>;

  /** Absolute on-device path of the database file, needed by backup/restore. */
  getDatabasePath(): string;

  close(): Promise<void>;
}
