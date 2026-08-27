import type {SqlValue} from '@/database/driver';
import type {SyncApiContract} from '@/sync/SyncApi';
import type {PullResponse, PushRequest, PushResponse, SyncChange} from '@/sync/types';

interface StoredRow {
  change: SyncChange;
  seq: number;
}

/**
 * In-memory stand-in for the sync Worker.
 *
 * It mirrors the server's *contract* — monotonic cursor, append-only tables
 * never overwritten, last-write-wins on a timestamp column, one row per record
 * on pull — so these tests exercise the client's push/pull/acknowledge loop.
 *
 * It is not a substitute for running the real SQL: server/__tests__ does that
 * against Postgres. What is verified here is the engine, not the Worker.
 */
export class FakeSyncServer implements SyncApiContract {
  readonly configured = true;
  private seq = 0;
  private readonly rows = new Map<string, StoredRow>();
  /** Set by a test to make the next call fail, as a dropped connection would. */
  failNextPush: Error | null = null;

  private static readonly APPEND = new Set([
    'sales',
    'sale_items',
    'inventory_transactions',
  ]);
  private static readonly LWW_COLUMN: Record<string, string> = {
    products: 'metadata_updated_at',
    product_images: 'created_at',
    app_settings: 'updated_at',
  };

  async push(body: PushRequest): Promise<PushResponse> {
    if (this.failNextPush) {
      const error = this.failNextPush;
      this.failNextPush = null;
      throw error;
    }

    const accepted: PushResponse['accepted'] = [];
    for (const change of body.changes) {
      const key = `${change.table}:${change.id}`;
      const existing = this.rows.get(key);

      if (change.op === 'DELETE') {
        this.rows.set(key, {change, seq: ++this.seq});
        accepted.push({table: change.table, id: change.id});
        continue;
      }

      // Immutable facts are recorded once and never rewritten.
      if (FakeSyncServer.APPEND.has(change.table) && existing) {
        accepted.push({table: change.table, id: change.id});
        continue;
      }

      const lwwColumn = FakeSyncServer.LWW_COLUMN[change.table];
      if (lwwColumn && existing?.change.row) {
        const mine = existing.change.row[lwwColumn];
        const theirs = change.row?.[lwwColumn];
        if (typeof mine === 'string' && typeof theirs === 'string' && theirs <= mine) {
          accepted.push({table: change.table, id: change.id});
          continue;
        }
      }

      this.rows.set(key, {change, seq: ++this.seq});
      accepted.push({table: change.table, id: change.id});
    }

    return {accepted, rejected: []};
  }

  async pull(cursor: string, limit: number): Promise<PullResponse> {
    const since = Number(cursor) || 0;
    const ordered = [...this.rows.values()]
      .filter(entry => entry.seq > since)
      .sort((a, b) => a.seq - b.seq);

    const page = ordered.slice(0, limit);
    return {
      changes: page.map(entry => entry.change),
      cursor: page.length > 0 ? String(page[page.length - 1].seq) : cursor,
      hasMore: ordered.length > page.length,
    };
  }

  async uploadUrl(path: string): Promise<{url: string}> {
    return {url: `https://example.invalid/upload/${path}`};
  }

  async downloadUrl(path: string): Promise<{url: string}> {
    return {url: `https://example.invalid/download/${path}`};
  }

  /** Test helper: what the server currently holds for a table. */
  rowsFor(table: string): Record<string, SqlValue>[] {
    return [...this.rows.values()]
      .filter(entry => entry.change.table === table && entry.change.op === 'UPSERT')
      .map(entry => entry.change.row as Record<string, SqlValue>);
  }
}
