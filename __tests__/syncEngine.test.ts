import * as RNFS from '@dr.pogodin/react-native-fs';
import {makeTestDb} from './helpers/db';
import {FakeSyncServer} from './helpers/fakeSyncServer';
import type {SqlDriver} from '@/database/driver';
import {ProductRepository} from '@/repositories/ProductRepository';
import {InventoryService} from '@/services/InventoryService';
import {SyncEngine} from '@/sync/SyncEngine';
import {resetSyncIdentityAfterRestore} from '@/sync/restore';

/** Images are covered by their own tests; here they must simply not get in the way. */
beforeEach(() => {
  (RNFS.exists as jest.Mock).mockResolvedValue(true);
  (RNFS.mkdir as jest.Mock).mockResolvedValue(undefined);
});

async function quantityOf(db: SqlDriver, id: string): Promise<number> {
  const r = await db.execute<{current_quantity: number}>(
    'SELECT current_quantity FROM products WHERE id = ?;',
    [id],
  );
  return Number(r.rows[0]?.current_quantity);
}

async function pendingCount(db: SqlDriver): Promise<number> {
  const r = await db.execute<{total: number}>('SELECT COUNT(*) AS total FROM sync_outbox;');
  return Number(r.rows[0].total);
}

describe('the sync engine', () => {
  test('two devices converge through the server', async () => {
    const server = new FakeSyncServer();
    const deviceA = await makeTestDb();
    const deviceB = await makeTestDb();
    const engineA = new SyncEngine(deviceA, server);
    const engineB = new SyncEngine(deviceB, server);

    const product = await new ProductRepository(deviceA).create({
      barcode: 'SYNC01',
      name: 'Kettle',
      sellingPrice: 1500,
      initialQuantity: 6,
    });

    await engineA.sync();
    await engineB.sync();

    expect(await quantityOf(deviceB, product.id)).toBe(6);

    // Each device sells while the other cannot see it.
    await new InventoryService(deviceA).sellProduct(product.id, 2);
    await new InventoryService(deviceB).sellProduct(product.id, 1);

    await engineA.sync();
    await engineB.sync();
    await engineA.sync();

    // 6 - 2 - 1, on both devices, with both receipts everywhere.
    expect(await quantityOf(deviceA, product.id)).toBe(3);
    expect(await quantityOf(deviceB, product.id)).toBe(3);
    for (const db of [deviceA, deviceB]) {
      const sales = await db.execute<{total: number}>('SELECT COUNT(*) AS total FROM sales;');
      expect(Number(sales.rows[0].total)).toBe(2);
    }
  });

  test('a successful sync empties the outbox', async () => {
    const server = new FakeSyncServer();
    const db = await makeTestDb();
    const engine = new SyncEngine(db, server);

    await new ProductRepository(db).create({
      barcode: 'SYNC02', name: 'Tray', sellingPrice: 100, initialQuantity: 1,
    });
    expect(await pendingCount(db)).toBeGreaterThan(0);

    await engine.sync();
    expect(await pendingCount(db)).toBe(0);
  });

  test('a failed push keeps the work queued instead of losing it', async () => {
    const server = new FakeSyncServer();
    const db = await makeTestDb();
    const engine = new SyncEngine(db, server);

    await new ProductRepository(db).create({
      barcode: 'SYNC03', name: 'Lamp', sellingPrice: 300, initialQuantity: 2,
    });
    const queued = await pendingCount(db);

    server.failNextPush = new Error('connection reset');
    await expect(engine.sync()).rejects.toThrow();

    // Nothing was acknowledged, so nothing was cleared.
    expect(await pendingCount(db)).toBe(queued);

    // And the next attempt gets it through.
    await engine.sync();
    expect(await pendingCount(db)).toBe(0);
    expect(server.rowsFor('products')).toHaveLength(1);
  });

  test('syncing twice with no local changes sends nothing the second time', async () => {
    const server = new FakeSyncServer();
    const db = await makeTestDb();
    const engine = new SyncEngine(db, server);

    await new ProductRepository(db).create({
      barcode: 'SYNC04', name: 'Bowl', sellingPrice: 80, initialQuantity: 4,
    });

    const first = await engine.sync();
    const second = await engine.sync();

    expect(first.pushed).toBeGreaterThan(0);
    expect(second.pushed).toBe(0);
    // The cursor advanced, so the device does not re-download its own rows.
    expect(second.pulled).toBe(0);
  });

  test('a restored backup does not inherit the source device identity', async () => {
    const original = await makeTestDb();
    const restored = await makeTestDb();

    const idOf = async (db: SqlDriver) => {
      const r = await db.execute<{value: string}>(
        "SELECT value FROM sync_control WHERE key = 'device_id';",
      );
      return r.rows[0].value;
    };

    // Simulate the restore: the archive's sync_control lands on the new device.
    const sourceId = await idOf(original);
    await restored.execute("UPDATE sync_control SET value = ? WHERE key = 'device_id';", [
      sourceId,
    ]);
    await restored.execute("UPDATE sync_control SET value = '42' WHERE key = 'cursor';");
    expect(await idOf(restored)).toBe(sourceId);

    await new ProductRepository(restored).create({
      barcode: 'SYNC05', name: 'Restored', sellingPrice: 10, initialQuantity: 1,
    });
    await restored.execute('DELETE FROM sync_outbox;');

    await resetSyncIdentityAfterRestore(restored);

    // A fresh identity, so sale numbers cannot collide with the source phone.
    expect(await idOf(restored)).not.toBe(sourceId);
    // Pulled from scratch, because this device never saw the server's history.
    const cursor = await restored.execute<{value: string}>(
      "SELECT value FROM sync_control WHERE key = 'cursor';",
    );
    expect(cursor.rows[0].value).toBe('0');
    // And the restored rows are queued for upload — the server may never have
    // seen them.
    expect(await pendingCount(restored)).toBeGreaterThan(0);
  });
});
