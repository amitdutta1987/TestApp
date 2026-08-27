import type {SqlDriver, SqlValue} from '@/database/driver';
import {SYNCED_TABLES, type SyncedTable} from '@/database/schema/sync';
import {nowIso} from '@/utils/date';
import {generateId} from '@/utils/id';
import type {SyncChange} from './types';

interface OutboxRow {
  table_name: SyncedTable;
  row_id: string;
  op: 'UPSERT' | 'DELETE';
  changed_at: string;
}

/**
 * Reads and clears the trigger-maintained outbox.
 *
 * Push sends whole current rows rather than diffs. The outbox is keyed by
 * (table, row_id), so ten offline edits to one product collapse into a single
 * entry carrying the final state — which is both smaller and immune to a
 * partially-applied diff sequence.
 */
export class ChangeTracker {
  constructor(private readonly driver: SqlDriver) {}

  async pendingCount(): Promise<number> {
    const result = await this.driver.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM sync_outbox;',
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  /** Oldest changes first, so a backlog drains in the order it was created. */
  async collect(limit = 500): Promise<SyncChange[]> {
    const outbox = await this.driver.execute<OutboxRow>(
      'SELECT table_name, row_id, op, changed_at FROM sync_outbox ORDER BY changed_at ASC LIMIT ?;',
      [limit],
    );

    const changes: SyncChange[] = [];
    for (const entry of outbox.rows) {
      if (entry.op === 'DELETE') {
        changes.push({table: entry.table_name, id: entry.row_id, op: 'DELETE'});
        continue;
      }

      const pk = SYNCED_TABLES[entry.table_name];
      const result = await this.driver.execute<Record<string, SqlValue>>(
        `SELECT * FROM ${entry.table_name} WHERE ${pk} = ?;`,
        [entry.row_id],
      );
      const row = result.rows[0];
      if (!row) {
        // Created and deleted between two syncs. The delete trigger will have
        // replaced this entry already in most cases; this covers the rest.
        changes.push({table: entry.table_name, id: entry.row_id, op: 'DELETE'});
        continue;
      }

      changes.push({table: entry.table_name, id: entry.row_id, op: 'UPSERT', row});
    }

    return changes;
  }

  /**
   * Clears acknowledged entries.
   *
   * Only rows the server confirmed are removed. A row changed again while the
   * push was in flight keeps a fresh outbox entry, because the trigger's
   * ON CONFLICT updated changed_at rather than inserting a duplicate — so the
   * newer state is still pending and this delete cannot drop it silently.
   */
  async acknowledge(accepted: readonly {table: SyncedTable; id: string}[]): Promise<void> {
    if (accepted.length === 0) {
      return;
    }
    await this.driver.transaction(tx => {
      for (const entry of accepted) {
        tx.execute('DELETE FROM sync_outbox WHERE table_name = ? AND row_id = ?;', [
          entry.table,
          entry.id,
        ]);
      }
    });
  }

  async getControl(key: string): Promise<string | null> {
    const result = await this.driver.execute<{value: string}>(
      'SELECT value FROM sync_control WHERE key = ?;',
      [key],
    );
    return result.rows[0]?.value ?? null;
  }

  async setControl(key: string, value: string): Promise<void> {
    await this.driver.execute(
      `INSERT INTO sync_control (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value;`,
      [key, value],
    );
  }

  /**
   * Stable per-install identifier, minted once.
   *
   * It disambiguates sale numbers between counters, so it has to survive
   * restarts — and it must not live in app_settings, which is itself synced and
   * would hand every device the same id.
   */
  async deviceId(): Promise<string> {
    const existing = await this.getControl('device_id');
    if (existing) {
      return existing;
    }
    const minted = generateId('dev');
    await this.setControl('device_id', minted);
    return minted;
  }

  async markSynced(cursor: string): Promise<void> {
    await this.setControl('cursor', cursor);
    await this.setControl('last_sync_at', nowIso());
  }
}
