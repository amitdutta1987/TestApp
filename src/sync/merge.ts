import type {SqlDriver, SqlTransaction, SqlValue} from '@/database/driver';
import {
  SYNCED_TABLES,
  TABLE_MERGE_STRATEGY,
  type SyncedTable,
} from '@/database/schema/sync';
import {recomputeDerivedStock, type StockDiscrepancy} from './stock';
import type {SyncChange} from './types';

/** Something the merge had to decide, or could not apply, worth telling the user. */
export type MergeConflict =
  | {
      kind: 'DUPLICATE_BARCODE';
      barcode: string;
      /** The product that keeps the barcode. */
      keptProductId: string;
      /** The product whose barcode was suffixed to make room. */
      renamedProductId: string;
      renamedTo: string;
    }
  | {kind: 'REJECTED'; table: SyncedTable; id: string; reason: string};

/**
 * Column whose value decides a last-write-wins contest, per table.
 *
 * products deliberately uses metadata_updated_at rather than updated_at: the
 * latter also moves on every sale, so a busy till would keep out-ranking a
 * genuine edit made earlier elsewhere.
 */
const LWW_COLUMN: Partial<Record<SyncedTable, string>> = {
  products: 'metadata_updated_at',
  product_images: 'created_at',
  app_settings: 'updated_at',
};

/**
 * Columns the server is not allowed to dictate, because every device derives
 * them locally from the ledger. Accepting a remote value here would reintroduce
 * exactly the lost-update problem the ledger exists to avoid.
 */
const DERIVED_COLUMNS: Partial<Record<SyncedTable, string[]>> = {
  products: ['current_quantity', 'status'],
};

function setApplying(target: SqlTransaction, on: boolean): void {
  target.execute("UPDATE sync_control SET value = ? WHERE key = 'applying';", [on ? '1' : '0']);
}

function localTimestamp(
  tx: SqlTransaction,
  table: SyncedTable,
  id: string,
  column: string,
): string | null {
  const pk = SYNCED_TABLES[table];
  const result = tx.execute<Record<string, SqlValue>>(
    `SELECT ${column} AS ts FROM ${table} WHERE ${pk} = ?;`,
    [id],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  const value = row.ts;
  return typeof value === 'string' ? value : null;
}

/**
 * Settles two products claiming one barcode.
 *
 * Two counters adding the same physical item while offline is ordinary, not
 * exotic — and the UNIQUE index on products.barcode would otherwise abort the
 * entire merge transaction, leaving sync permanently stuck at that row.
 *
 * The loser keeps its data but has its barcode suffixed, so nothing is thrown
 * away and the user is told to merge the two by hand. The winner is chosen from
 * the row contents alone — earliest created_at, ties broken by id — so every
 * device reaches the same answer regardless of the order changes arrive in.
 * That determinism is what makes it safe to resolve this locally on each device
 * rather than centrally.
 */
function resolveBarcodeConflict(
  tx: SqlTransaction,
  incoming: Record<string, SqlValue>,
): MergeConflict | null {
  const barcode = incoming.barcode;
  const incomingId = incoming.id;
  if (typeof barcode !== 'string' || typeof incomingId !== 'string') {
    return null;
  }

  const holder = tx.execute<{id: string; created_at: string}>(
    'SELECT id, created_at FROM products WHERE barcode = ? AND id <> ? LIMIT 1;',
    [barcode, incomingId],
  ).rows[0];
  if (!holder) {
    return null;
  }

  const incomingKey = `${String(incoming.created_at ?? '')}|${incomingId}`;
  const holderKey = `${holder.created_at}|${holder.id}`;
  const incomingWins = incomingKey < holderKey;

  const loserId = incomingWins ? holder.id : incomingId;
  const suffixed = `${barcode}-DUP-${loserId.slice(-4)}`;

  if (incomingWins) {
    // Free the barcode by renaming the copy already here. Done under the
    // applying flag, so it is not pushed — every other device derives the same
    // rename from the same two rows.
    tx.execute('UPDATE products SET barcode = ? WHERE id = ?;', [suffixed, holder.id]);
  } else {
    incoming.barcode = suffixed;
  }

  return {
    kind: 'DUPLICATE_BARCODE',
    barcode,
    keptProductId: incomingWins ? incomingId : holder.id,
    renamedProductId: loserId,
    renamedTo: suffixed,
  };
}

function upsert(tx: SqlTransaction, table: SyncedTable, row: Record<string, SqlValue>): void {
  const pk = SYNCED_TABLES[table];
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(',');
  const updates = columns
    .filter(column => column !== pk)
    .map(column => `${column} = excluded.${column}`)
    .join(', ');

  tx.execute(
    `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})
     ON CONFLICT(${pk}) DO UPDATE SET ${updates};`,
    columns.map(column => row[column]),
  );
}

/**
 * Applies one change, returning whether it was written.
 *
 * APPEND tables hold immutable facts — a sale that happened, stock that moved.
 * Merging them is a set union, so an incoming row is inserted if absent and
 * otherwise ignored; overwriting could only ever corrupt a record of something
 * that already occurred.
 */
function applyChange(
  tx: SqlTransaction,
  change: SyncChange,
  conflicts: MergeConflict[],
): boolean {
  const {table, id, op} = change;
  const pk = SYNCED_TABLES[table];

  if (op === 'DELETE') {
    tx.execute(`DELETE FROM ${table} WHERE ${pk} = ?;`, [id]);
    return true;
  }

  const row = change.row;
  if (!row) {
    return false;
  }

  // A row deleted locally must not be resurrected by a stale copy still being
  // relayed from another device that had not yet seen the delete.
  const tombstone = tx.execute<{deleted_at: string}>(
    'SELECT deleted_at FROM sync_tombstones WHERE table_name = ? AND row_id = ?;',
    [table, id],
  );
  if (tombstone.rows[0]) {
    return false;
  }

  const incoming = {...row};

  // Never let the server dictate derived stock; recomputed from the ledger below.
  for (const column of DERIVED_COLUMNS[table] ?? []) {
    delete incoming[column];
  }

  if (TABLE_MERGE_STRATEGY[table] === 'APPEND') {
    const columns = Object.keys(incoming);
    tx.execute(
      `INSERT OR IGNORE INTO ${table} (${columns.join(',')})
       VALUES (${columns.map(() => '?').join(',')});`,
      columns.map(column => incoming[column]),
    );
    return true;
  }

  const lwwColumn = LWW_COLUMN[table];
  if (lwwColumn) {
    const mine = localTimestamp(tx, table, id, lwwColumn);
    const theirs = incoming[lwwColumn];
    // Strictly-older loses. Equal timestamps keep the local copy, which makes a
    // replayed batch a no-op rather than a rewrite.
    if (mine !== null && typeof theirs === 'string' && theirs <= mine) {
      return false;
    }
  }

  if (table === 'products') {
    const conflict = resolveBarcodeConflict(tx, incoming);
    if (conflict) {
      conflicts.push(conflict);
    }
  }

  upsert(tx, table, incoming);
  return true;
}

export interface MergeResult {
  applied: number;
  discrepancies: StockDiscrepancy[];
  conflicts: MergeConflict[];
}

/**
 * Applies a pulled batch in one transaction.
 *
 * The whole batch runs with sync_control.applying = '1' so the change-tracking
 * triggers stay quiet. Without that, every row received would be re-enqueued
 * into the outbox and pushed straight back, and two devices would trade the
 * same rows indefinitely.
 */
export async function applyRemoteChanges(
  driver: SqlDriver,
  changes: readonly SyncChange[],
): Promise<MergeResult> {
  if (changes.length === 0) {
    return {applied: 0, discrepancies: [], conflicts: []};
  }

  return driver.transaction(tx => {
    setApplying(tx, true);
    try {
      let applied = 0;

      // Products first: a sale_item or ledger row has a foreign key to its
      // product, and a batch may legitimately carry both.
      const ordered = [...changes].sort(
        (a, b) => tableOrder(a.table) - tableOrder(b.table),
      );

      const touchedProducts = new Set<string>();
      const conflicts: MergeConflict[] = [];

      for (const change of ordered) {
        try {
          if (applyChange(tx, change, conflicts)) {
            applied += 1;
          }
        } catch (error) {
          /**
           * One unusable row must never cost the whole batch. Letting it throw
           * would roll back every other change and leave the device retrying
           * the same failing batch forever — stuck, and silently out of date.
           * Skipping it advances the cursor; the row is reported instead.
           */
          conflicts.push({
            kind: 'REJECTED',
            table: change.table,
            id: change.id,
            reason: error instanceof Error ? error.message : 'unknown error',
          });
          continue;
        }
        const productId = productIdFor(change);
        if (productId) {
          touchedProducts.add(productId);
        }
      }

      const discrepancies = recomputeDerivedStock(tx, [...touchedProducts]);
      return {applied, discrepancies, conflicts};
    } finally {
      // Restored inside the transaction so a rollback cannot strand the flag on
      // and silently disable change tracking for the rest of the session.
      setApplying(tx, false);
    }
  });
}

/** Parents before children, so foreign keys hold mid-batch. */
function tableOrder(table: SyncedTable): number {
  switch (table) {
    case 'products':
      return 0;
    case 'sales':
      return 1;
    case 'product_images':
    case 'sale_items':
    case 'inventory_transactions':
      return 2;
    default:
      return 3;
  }
}

/** Which product's derived stock this change could have invalidated. */
function productIdFor(change: SyncChange): string | null {
  if (change.table === 'products') {
    return change.id;
  }
  if (change.table === 'inventory_transactions') {
    const value = change.row?.product_id;
    return typeof value === 'string' ? value : null;
  }
  return null;
}
