import {BACKFILL_OUTBOX} from '@/database/schema/sync';
import type {SqlDriver} from '@/database/driver';

/**
 * Re-establishes this device's sync identity after a backup is restored.
 *
 * A backup archive contains the whole SQLite file, including sync_control — so
 * a restore silently adopts the *source* device's identity. Two phones restored
 * from one archive would then share a device tag and mint identical sale
 * numbers, which is precisely the collision the tag exists to prevent. They
 * would also inherit a sync cursor describing changes this device never saw.
 *
 * So the restored bookkeeping is discarded and rebuilt:
 *
 *  - a fresh device id, so sale numbers stay distinct;
 *  - the cursor reset to zero, so the whole shop state is pulled back down.
 *    Re-applying changes already present is free — the merge is idempotent;
 *  - the outbox refilled from the restored rows, because nothing guarantees the
 *    server ever saw them.
 */
export async function resetSyncIdentityAfterRestore(driver: SqlDriver): Promise<void> {
  await driver.transaction(tx => {
    // The triggers must not treat the rebuild as user edits.
    tx.execute("UPDATE sync_control SET value = '1' WHERE key = 'applying';");
    try {
      tx.execute("DELETE FROM sync_control WHERE key IN ('device_id', 'cursor', 'last_sync_at');");
      tx.execute(
        `INSERT INTO sync_control (key, value)
         VALUES ('device_id', 'dev_' || lower(hex(randomblob(6))));`,
      );
      tx.execute("INSERT INTO sync_control (key, value) VALUES ('cursor', '0');");

      tx.execute('DELETE FROM sync_outbox;');
      tx.execute('DELETE FROM sync_tombstones;');
      tx.execute('DELETE FROM image_sync_queue;');

      for (const statement of BACKFILL_OUTBOX) {
        tx.execute(statement);
      }
    } finally {
      tx.execute("UPDATE sync_control SET value = '0' WHERE key = 'applying';");
    }
  });
}
