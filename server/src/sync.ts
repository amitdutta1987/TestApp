import type {NeonQueryFunction} from '@neondatabase/serverless';
import {PUSH_ORDER, TABLES, isKnownTable} from './tables';

export interface SyncChange {
  table: string;
  id: string;
  op: 'UPSERT' | 'DELETE';
  row?: Record<string, unknown>;
}

export interface PushResult {
  accepted: {table: string; id: string}[];
  rejected: {table: string; id: string; reason: string}[];
}

/** Postgres identifiers here come only from TABLES, never from request data. */
function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Applies a client batch.
 *
 * Each row is written with its own statement rather than one big transaction:
 * a single malformed row from an old app build should cost that row, not the
 * whole push. The client only clears its outbox for rows reported accepted, so
 * anything rejected is retried on the next sync instead of being lost.
 */
export async function applyPush(
  sql: NeonQueryFunction<false, false>,
  changes: readonly SyncChange[],
): Promise<PushResult> {
  const accepted: PushResult['accepted'] = [];
  const rejected: PushResult['rejected'] = [];

  // Group by table so parents are written before children.
  const byTable = new Map<string, SyncChange[]>();
  for (const change of changes) {
    if (!isKnownTable(change.table)) {
      rejected.push({table: change.table, id: change.id, reason: 'unknown table'});
      continue;
    }
    const bucket = byTable.get(change.table);
    if (bucket) {
      bucket.push(change);
    } else {
      byTable.set(change.table, [change]);
    }
  }

  for (const table of PUSH_ORDER) {
    for (const change of byTable.get(table) ?? []) {
      try {
        if (change.op === 'DELETE') {
          await softDelete(sql, table, change.id);
        } else {
          await upsert(sql, table, change);
        }
        accepted.push({table, id: change.id});
      } catch (error) {
        rejected.push({
          table,
          id: change.id,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }
  }

  return {accepted, rejected};
}

async function softDelete(
  sql: NeonQueryFunction<false, false>,
  table: string,
  id: string,
): Promise<void> {
  const spec = TABLES[table];
  // Tombstoned rather than removed: a device that was offline during the delete
  // would otherwise re-upload its own copy and resurrect the row.
  await sql(
    `UPDATE ${quote(table)}
        SET deleted_at = $1, server_seq = nextval('sync_seq')
      WHERE ${quote(spec.pk)} = $2 AND deleted_at IS NULL`,
    [new Date().toISOString(), id],
  );
}

async function upsert(
  sql: NeonQueryFunction<false, false>,
  table: string,
  change: SyncChange,
): Promise<void> {
  const spec = TABLES[table];
  const row = change.row;
  if (!row) {
    throw new Error('UPSERT without a row');
  }

  // Only whitelisted columns survive. An app build sending an unknown column
  // (or a crafted one) cannot reach the SQL.
  const columns = spec.columns.filter(column => row[column] !== undefined);
  if (!columns.includes(spec.pk)) {
    throw new Error(`missing primary key ${spec.pk}`);
  }
  const values = columns.map(column => normalise(row[column]));

  const columnList = columns.map(quote).join(', ');
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

  if (spec.strategy === 'APPEND') {
    // Immutable facts. An existing row is left exactly as first recorded.
    await sql(
      `INSERT INTO ${quote(table)} (${columnList}, server_seq)
       VALUES (${placeholders}, nextval('sync_seq'))
       ON CONFLICT (${quote(spec.pk)}) DO NOTHING`,
      values,
    );
    return;
  }

  const assignments = columns
    .filter(column => column !== spec.pk)
    .map(column => `${quote(column)} = EXCLUDED.${quote(column)}`)
    .join(', ');

  // The WHERE on the DO UPDATE is what makes this last-write-wins rather than
  // last-to-arrive-wins: an older edit that reaches the server late is dropped.
  // Undeleting on a newer edit is intentional — editing a product on a device
  // that had not yet seen the delete is a real, if rare, revival.
  const guard = spec.lwwColumn
    ? `WHERE EXCLUDED.${quote(spec.lwwColumn)} > ${quote(table)}.${quote(spec.lwwColumn)}`
    : '';

  await sql(
    `INSERT INTO ${quote(table)} (${columnList}, server_seq)
     VALUES (${placeholders}, nextval('sync_seq'))
     ON CONFLICT (${quote(spec.pk)}) DO UPDATE
        SET ${assignments}, deleted_at = NULL, server_seq = nextval('sync_seq')
     ${guard}`,
    values,
  );
}

/**
 * SQLite has no boolean type and stores 0/1; Postgres columns here are INTEGER,
 * so a client that sent a JSON boolean still lands as the right number.
 */
function normalise(value: unknown): unknown {
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return value === undefined ? null : value;
}

export interface PullResult {
  changes: SyncChange[];
  cursor: string;
  hasMore: boolean;
}

/**
 * Returns every row changed above `cursor`, oldest change first.
 *
 * Reading from the live tables rather than a change log means a device syncing
 * for the first time receives one row per record — current state — instead of
 * replaying every edit ever made.
 */
export async function pullChanges(
  sql: NeonQueryFunction<false, false>,
  cursor: string,
  limit: number,
): Promise<PullResult> {
  const since = /^\d+$/.test(cursor) ? cursor : '0';

  const selects = PUSH_ORDER.map(table => {
    const spec = TABLES[table];
    // The pk is always among spec.columns, so it is not selected twice — doing
    // so would put a duplicate key in the jsonb payload.
    const columns = spec.columns.map(quote).join(', ');
    return `SELECT '${table}' AS table_name,
                   x.${quote(spec.pk)}::text AS row_id,
                   x.server_seq::text AS server_seq,
                   (x.deleted_at IS NOT NULL) AS deleted,
                   to_jsonb(x) - 'server_seq' - 'deleted_at' AS payload
              FROM (SELECT ${columns}, server_seq, deleted_at
                      FROM ${quote(table)}) AS x
             WHERE x.server_seq > $1::bigint`;
  }).join(' UNION ALL ');

  const rows = (await sql(
    `SELECT table_name, row_id, server_seq, deleted, payload
       FROM (${selects}) AS feed
      ORDER BY server_seq ASC
      LIMIT $2`,
    [since, limit + 1],
  )) as {
    table_name: string;
    row_id: string;
    server_seq: string;
    deleted: boolean;
    payload: Record<string, unknown>;
  }[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const changes: SyncChange[] = page.map(row => {
    if (row.deleted) {
      return {table: row.table_name, id: row.row_id, op: 'DELETE' as const};
    }
    // server_seq and deleted_at are stripped in SQL; the payload is exactly the
    // set of columns the client's own schema declares.
    return {table: row.table_name, id: row.row_id, op: 'UPSERT' as const, row: row.payload};
  });

  // Advancing only to the last row actually returned is what makes a truncated
  // page safe to resume from: nothing between the last delivered change and the
  // page limit is ever skipped.
  const nextCursor = page.length > 0 ? String(page[page.length - 1].server_seq) : since;

  return {changes, cursor: nextCursor, hasMore};
}
