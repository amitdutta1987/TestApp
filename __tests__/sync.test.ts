import {makeTestDb} from './helpers/db';
import {clearAllTables} from '@/database/database';
import type {SqlDriver} from '@/database/driver';
import {ChangeTracker} from '@/sync/ChangeTracker';
import {applyRemoteChanges} from '@/sync/merge';
import {ProductRepository} from '@/repositories/ProductRepository';
import {InventoryService} from '@/services/InventoryService';

/** Moves every pending change from one device to another, as a sync would. */
async function relay(from: SqlDriver, to: SqlDriver): Promise<number> {
  const tracker = new ChangeTracker(from);
  const changes = await tracker.collect();
  const result = await applyRemoteChanges(to, changes);
  return result.applied;
}

async function quantityOf(db: SqlDriver, id: string): Promise<number> {
  const r = await db.execute<{current_quantity: number}>(
    'SELECT current_quantity FROM products WHERE id = ?;',
    [id],
  );
  return Number(r.rows[0]?.current_quantity);
}

async function ledgerOf(db: SqlDriver, id: string): Promise<number> {
  const r = await db.execute<{total: number | null}>(
    'SELECT COALESCE(SUM(quantity),0) AS total FROM inventory_transactions WHERE product_id = ?;',
    [id],
  );
  return Number(r.rows[0]?.total ?? 0);
}

describe('change tracking', () => {
  test('triggers enqueue inserts, updates and deletes', async () => {
    const db = await makeTestDb();
    const products = new ProductRepository(db);
    const product = await products.create({
      barcode: '001234567890',
      name: 'Shirt',
      sellingPrice: 500,
      initialQuantity: 3,
    });

    const outbox = await db.execute<{table_name: string; row_id: string; op: string}>(
      'SELECT table_name, row_id, op FROM sync_outbox ORDER BY table_name;',
    );
    const tables = outbox.rows.map(r => r.table_name);
    expect(tables).toContain('products');
    expect(tables).toContain('inventory_transactions');
    expect(outbox.rows.find(r => r.row_id === product.id)?.op).toBe('UPSERT');
  });

  test('repeated edits to one row collapse into a single outbox entry', async () => {
    const db = await makeTestDb();
    const products = new ProductRepository(db);
    const product = await products.create({
      barcode: 'P111', name: 'A', sellingPrice: 1, initialQuantity: 1,
    });

    await products.update(product.id, {name: 'B'});
    await products.update(product.id, {name: 'C'});
    await products.update(product.id, {name: 'D'});

    const r = await db.execute<{total: number}>(
      "SELECT COUNT(*) AS total FROM sync_outbox WHERE table_name='products' AND row_id=?;",
      [product.id],
    );
    expect(Number(r.rows[0].total)).toBe(1);

    // And the single entry carries the *final* state, not the first edit.
    const changes = await new ChangeTracker(db).collect();
    const productChange = changes.find(c => c.table === 'products' && c.id === product.id);
    expect(productChange?.row?.name).toBe('D');
  });

  test('applying a remote batch does not re-enqueue it', async () => {
    const source = await makeTestDb();
    const target = await makeTestDb();
    const products = new ProductRepository(source);
    await products.create({barcode: 'P222', name: 'Cap', sellingPrice: 10, initialQuantity: 2});

    await relay(source, target);

    const r = await target.execute<{total: number}>('SELECT COUNT(*) AS total FROM sync_outbox;');
    expect(Number(r.rows[0].total)).toBe(0);
  });
});

describe('two devices', () => {
  test('concurrent offline sales both survive the merge', async () => {
    const deviceA = await makeTestDb();
    const deviceB = await makeTestDb();

    // A creates a product with 10 units and B syncs it down.
    const productsA = await new ProductRepository(deviceA).create({
      barcode: 'P333', name: 'Mug', sellingPrice: 200, initialQuantity: 10,
    });
    await relay(deviceA, deviceB);
    await new ChangeTracker(deviceA).acknowledge(
      (await new ChangeTracker(deviceA).collect()).map(c => ({table: c.table, id: c.id})),
    );

    expect(await quantityOf(deviceB, productsA.id)).toBe(10);

    // Both go offline and sell independently.
    await new InventoryService(deviceA).sellProduct(productsA.id, 3);
    await new InventoryService(deviceB).sellProduct(productsA.id, 4);

    expect(await quantityOf(deviceA, productsA.id)).toBe(7);
    expect(await quantityOf(deviceB, productsA.id)).toBe(6);

    // They reconnect and exchange changes.
    await relay(deviceA, deviceB);
    await relay(deviceB, deviceA);

    // Neither sale is lost: 10 - 3 - 4 = 3 on both devices.
    expect(await ledgerOf(deviceA, productsA.id)).toBe(3);
    expect(await ledgerOf(deviceB, productsA.id)).toBe(3);
    expect(await quantityOf(deviceA, productsA.id)).toBe(3);
    expect(await quantityOf(deviceB, productsA.id)).toBe(3);

    // And both receipts exist everywhere.
    for (const db of [deviceA, deviceB]) {
      const sales = await db.execute<{total: number}>('SELECT COUNT(*) AS total FROM sales;');
      expect(Number(sales.rows[0].total)).toBe(2);
    }
  });

  test('overselling offline is reported, not silently swallowed', async () => {
    const deviceA = await makeTestDb();
    const deviceB = await makeTestDb();

    const product = await new ProductRepository(deviceA).create({
      barcode: 'P444', name: 'Last one', sellingPrice: 50, initialQuantity: 1,
    });
    await relay(deviceA, deviceB);

    // Both counters sell the single remaining unit while offline.
    await new InventoryService(deviceA).sellProduct(product.id, 1);
    await new InventoryService(deviceB).sellProduct(product.id, 1);

    const changes = await new ChangeTracker(deviceB).collect();
    const merged = await applyRemoteChanges(deviceA, changes);

    expect(merged.discrepancies).toHaveLength(1);
    expect(merged.discrepancies[0]).toMatchObject({
      productId: product.id,
      productName: 'Last one',
      ledgerQuantity: -1,
    });
    // Clamped in storage so the CHECK constraint holds, but both sales remain.
    expect(await quantityOf(deviceA, product.id)).toBe(0);
    expect(await ledgerOf(deviceA, product.id)).toBe(-1);
  });

  test('the later metadata edit wins, and a sale does not outrank it', async () => {
    const deviceA = await makeTestDb();
    const deviceB = await makeTestDb();

    const product = await new ProductRepository(deviceA).create({
      barcode: 'P555', name: 'Original', sellingPrice: 10, initialQuantity: 5,
    });
    await relay(deviceA, deviceB);

    // B renames the product; A later sells one, which bumps A's updated_at but
    // must not count as a competing metadata edit.
    await new ProductRepository(deviceB).update(product.id, {name: 'Renamed'});
    // Pinned forward: create and update can land in the same millisecond, and
    // this test is about which column decides, not about clock resolution.
    await deviceB.execute('UPDATE products SET metadata_updated_at = ? WHERE id = ?;', [
      '2030-01-01T00:00:00.000Z',
      product.id,
    ]);
    await new InventoryService(deviceA).sellProduct(product.id, 1);

    await relay(deviceB, deviceA);

    const r = await deviceA.execute<{name: string}>('SELECT name FROM products WHERE id = ?;', [
      product.id,
    ]);
    expect(r.rows[0].name).toBe('Renamed');
    expect(await quantityOf(deviceA, product.id)).toBe(4);
  });

  test('merging is idempotent — replaying a batch changes nothing', async () => {
    const deviceA = await makeTestDb();
    const deviceB = await makeTestDb();

    const product = await new ProductRepository(deviceA).create({
      barcode: 'P666', name: 'Idem', sellingPrice: 10, initialQuantity: 8,
    });
    await new InventoryService(deviceA).sellProduct(product.id, 2);

    const changes = await new ChangeTracker(deviceA).collect();
    await applyRemoteChanges(deviceB, changes);
    const first = await quantityOf(deviceB, product.id);

    await applyRemoteChanges(deviceB, changes);
    await applyRemoteChanges(deviceB, changes);

    expect(await quantityOf(deviceB, product.id)).toBe(first);
    expect(first).toBe(6);

    const sales = await deviceB.execute<{total: number}>('SELECT COUNT(*) AS total FROM sales;');
    expect(Number(sales.rows[0].total)).toBe(1);
  });
});

describe('conflicting rows', () => {
  test('the same barcode added on two devices does not stall the merge', async () => {
    const deviceA = await makeTestDb();
    const deviceB = await makeTestDb();

    const fromA = await new ProductRepository(deviceA).create({
      barcode: 'DUP123', name: 'From A', sellingPrice: 10, initialQuantity: 1,
    });
    const fromB = await new ProductRepository(deviceB).create({
      barcode: 'DUP123', name: 'From B', sellingPrice: 20, initialQuantity: 2,
    });

    const intoA = await applyRemoteChanges(deviceA, await new ChangeTracker(deviceB).collect());
    const intoB = await applyRemoteChanges(deviceB, await new ChangeTracker(deviceA).collect());

    // Whichever device did the renaming, the outcome has to be the same on both.
    // (Only one of them reports a conflict: if A renames its own row, it then
    // pushes the already-suffixed barcode and B sees nothing to resolve.)
    expect([...intoA.conflicts, ...intoB.conflicts]).toContainEqual(
      expect.objectContaining({kind: 'DUPLICATE_BARCODE', barcode: 'DUP123'}),
    );

    const holders: string[] = [];
    for (const db of [deviceA, deviceB]) {
      // Neither device lost a product.
      const count = await db.execute<{total: number}>('SELECT COUNT(*) AS total FROM products;');
      expect(Number(count.rows[0].total)).toBe(2);

      // Exactly one product answers to the barcode.
      const holder = await db.execute<{id: string}>(
        'SELECT id FROM products WHERE barcode = ?;',
        ['DUP123'],
      );
      expect(holder.rows).toHaveLength(1);
      holders.push(holder.rows[0].id);

      // And the other one is still there, under a suffixed barcode.
      const loserId = holder.rows[0].id === fromA.id ? fromB.id : fromA.id;
      const loser = await db.execute<{barcode: string}>(
        'SELECT barcode FROM products WHERE id = ?;',
        [loserId],
      );
      expect(loser.rows[0].barcode).toMatch(/^DUP123-DUP-/);
    }

    // The heart of it: both devices independently chose the same winner.
    expect(holders[0]).toBe(holders[1]);
  });

  test('a row that cannot be applied is reported, not fatal', async () => {
    const db = await makeTestDb();

    const merged = await applyRemoteChanges(db, [
      // References a product that does not exist here: violates the foreign key.
      {
        table: 'inventory_transactions',
        id: 'orphan_tx',
        op: 'UPSERT',
        row: {
          id: 'orphan_tx', product_id: 'no_such_product', type: 'SALE', quantity: -1,
          quantity_before: 1, quantity_after: 0, reference_id: null, notes: null,
          created_at: '2026-08-27T00:00:00.000Z',
        },
      },
      // A perfectly good row in the same batch must still land.
      {
        table: 'app_settings',
        id: 'theme',
        op: 'UPSERT',
        row: {key: 'theme', value: 'dark', updated_at: '2026-08-27T00:00:00.000Z'},
      },
    ]);

    expect(merged.conflicts).toContainEqual(
      expect.objectContaining({kind: 'REJECTED', id: 'orphan_tx'}),
    );
    const setting = await db.execute<{value: string}>(
      "SELECT value FROM app_settings WHERE key = 'theme';",
    );
    expect(setting.rows[0].value).toBe('dark');
  });
});

describe('last-write-wins on product metadata', () => {
  test('an older edit arriving late does not overwrite a newer one', async () => {
    const db = await makeTestDb();
    const product = await new ProductRepository(db).create({
      barcode: 'LWW001', name: 'Current name', sellingPrice: 10, initialQuantity: 1,
    });

    // Pin the local edit to a known, recent time.
    await db.execute("UPDATE products SET metadata_updated_at = ? WHERE id = ?;", [
      '2026-08-27T12:00:00.000Z',
      product.id,
    ]);

    const row = await db.execute<Record<string, string>>(
      'SELECT * FROM products WHERE id = ?;',
      [product.id],
    );

    // A change from another device, edited an hour earlier.
    await applyRemoteChanges(db, [
      {
        table: 'products',
        id: product.id,
        op: 'UPSERT',
        row: {...row.rows[0], name: 'Stale name', metadata_updated_at: '2026-08-27T11:00:00.000Z'},
      },
    ]);

    const after = await db.execute<{name: string}>('SELECT name FROM products WHERE id = ?;', [
      product.id,
    ]);
    expect(after.rows[0].name).toBe('Current name');
  });

  test('a newer edit does overwrite', async () => {
    const db = await makeTestDb();
    const product = await new ProductRepository(db).create({
      barcode: 'LWW002', name: 'Old name', sellingPrice: 10, initialQuantity: 1,
    });
    await db.execute("UPDATE products SET metadata_updated_at = ? WHERE id = ?;", [
      '2026-08-27T11:00:00.000Z',
      product.id,
    ]);

    const row = await db.execute<Record<string, string>>(
      'SELECT * FROM products WHERE id = ?;',
      [product.id],
    );

    await applyRemoteChanges(db, [
      {
        table: 'products',
        id: product.id,
        op: 'UPSERT',
        row: {...row.rows[0], name: 'New name', metadata_updated_at: '2026-08-27T12:00:00.000Z'},
      },
    ]);

    const after = await db.execute<{name: string}>('SELECT name FROM products WHERE id = ?;', [
      product.id,
    ]);
    expect(after.rows[0].name).toBe('New name');
  });

  test('creating a product stamps the metadata clock', async () => {
    const db = await makeTestDb();
    const product = await new ProductRepository(db).create({
      barcode: 'LWW003', name: 'Stamped', sellingPrice: 10, initialQuantity: 1,
    });
    const row = await db.execute<{metadata_updated_at: string | null}>(
      'SELECT metadata_updated_at FROM products WHERE id = ?;',
      [product.id],
    );
    // A null here would silently disable last-write-wins for every new product.
    expect(row.rows[0].metadata_updated_at).toBe(product.createdAt);
  });

  test('a sale does not move the metadata clock, but an edit does', async () => {
    const db = await makeTestDb();
    const product = await new ProductRepository(db).create({
      barcode: 'LWW004', name: 'Tracked', sellingPrice: 10, initialQuantity: 5,
    });
    const clock = async () => {
      const r = await db.execute<{metadata_updated_at: string}>(
        'SELECT metadata_updated_at FROM products WHERE id = ?;',
        [product.id],
      );
      return r.rows[0].metadata_updated_at;
    };

    // Pinned to a known past value rather than trusting the wall clock: create
    // and update can land in the same millisecond when the suite runs fast, and
    // the assertion is about which operations touch the column, not about clock
    // resolution.
    await db.execute('UPDATE products SET metadata_updated_at = ? WHERE id = ?;', [
      '2020-01-01T00:00:00.000Z',
      product.id,
    ]);

    await new InventoryService(db).sellProduct(product.id, 1);
    expect(await clock()).toBe('2020-01-01T00:00:00.000Z');

    await new ProductRepository(db).update(product.id, {name: 'Renamed'});
    expect(await clock()).not.toBe('2020-01-01T00:00:00.000Z');
  });
});

describe('clearing one device', () => {
  test('does not queue deletions that would wipe the other devices', async () => {
    const db = await makeTestDb();
    const products = new ProductRepository(db);
    await products.create({
      barcode: 'CLR001', name: 'Kept elsewhere', sellingPrice: 10, initialQuantity: 3,
    });
    await products.create({
      barcode: 'CLR002', name: 'Also kept', sellingPrice: 20, initialQuantity: 1,
    });

    await clearAllTables(db);

    const rows = await db.execute<{total: number}>('SELECT COUNT(*) AS total FROM products;');
    expect(Number(rows.rows[0].total)).toBe(0);

    // The critical part: nothing is pending. A queued DELETE per row would be
    // pushed and would empty the shop's inventory on every other device.
    const outbox = await db.execute<{total: number}>('SELECT COUNT(*) AS total FROM sync_outbox;');
    expect(Number(outbox.rows[0].total)).toBe(0);

    const tombstones = await db.execute<{total: number}>(
      'SELECT COUNT(*) AS total FROM sync_tombstones;',
    );
    expect(Number(tombstones.rows[0].total)).toBe(0);

    // And the device is rewound, so the next sync downloads the shop again.
    const cursor = await db.execute<{value: string}>(
      "SELECT value FROM sync_control WHERE key = 'cursor';",
    );
    expect(cursor.rows[0].value).toBe('0');
  });

  test('a cleared device repopulates from the server instead of emptying it', async () => {
    const db = await makeTestDb();
    const source = await makeTestDb();

    await new ProductRepository(source).create({
      barcode: 'CLR003', name: 'Shop stock', sellingPrice: 50, initialQuantity: 4,
    });
    const fromServer = await new ChangeTracker(source).collect();

    await applyRemoteChanges(db, fromServer);
    expect(await countProducts(db)).toBe(1);

    await clearAllTables(db);
    expect(await countProducts(db)).toBe(0);

    // Replaying what the server holds brings it straight back.
    await applyRemoteChanges(db, fromServer);
    expect(await countProducts(db)).toBe(1);

    const restored = await db.execute<{current_quantity: number}>(
      'SELECT current_quantity FROM products WHERE barcode = ?;',
      ['CLR003'],
    );
    expect(Number(restored.rows[0].current_quantity)).toBe(4);
  });
});

async function countProducts(db: SqlDriver): Promise<number> {
  const r = await db.execute<{total: number}>('SELECT COUNT(*) AS total FROM products;');
  return Number(r.rows[0].total);
}

describe('the metadata clock is maintained by the database, not by callers', () => {
  const clockOf = async (db: SqlDriver, id: string): Promise<string> => {
    const r = await db.execute<{metadata_updated_at: string}>(
      'SELECT metadata_updated_at FROM products WHERE id = ?;',
      [id],
    );
    return r.rows[0].metadata_updated_at;
  };

  /** Pins the clock into the past so any advance is unambiguous. */
  const pinBack = async (db: SqlDriver, id: string): Promise<string> => {
    const past = '2020-01-01T00:00:00.000Z';
    await db.execute(
      "UPDATE sync_control SET value = '1' WHERE key = 'applying';",
    );
    await db.execute('UPDATE products SET metadata_updated_at = ? WHERE id = ?;', [past, id]);
    await db.execute("UPDATE sync_control SET value = '0' WHERE key = 'applying';");
    return past;
  };

  /**
   * Each of these silently failed to sync before the trigger existed: the row
   * was pushed with an unmoved timestamp, and last-write-wins discarded it.
   */
  test.each([
    ['deactivate', (r: ProductRepository, id: string) => r.deactivate(id)],
    // Deactivated first: reactivating an already-active product changes
    // nothing, and the trigger is right not to fire on a no-op.
    ['reactivate', async (r: ProductRepository, id: string) => {
      await r.deactivate(id);
      await r.reactivate(id);
    }],
    ['rename', (r: ProductRepository, id: string) => r.update(id, {name: 'New name'}).then(() => undefined)],
    ['reprice', (r: ProductRepository, id: string) => r.update(id, {sellingPrice: 99}).then(() => undefined)],
    ['recategorise', (r: ProductRepository, id: string) => r.update(id, {category: 'New'}).then(() => undefined)],
  ])('%s advances the clock', async (_label, act) => {
    const db = await makeTestDb();
    const repo = new ProductRepository(db);
    const product = await repo.create({
      barcode: `MC${Math.random().toString(36).slice(2, 8)}`,
      name: 'Subject', sellingPrice: 10, initialQuantity: 2,
    });
    const past = await pinBack(db, product.id);

    await act(repo, product.id);

    expect(await clockOf(db, product.id)).not.toBe(past);
  });

  test('an update that changes nothing leaves the clock alone', async () => {
    const db = await makeTestDb();
    const repo = new ProductRepository(db);
    const product = await repo.create({
      barcode: 'MCNOOP', name: 'Same', sellingPrice: 10, initialQuantity: 1,
    });
    const past = await pinBack(db, product.id);

    // Already ACTIVE, and renamed to the name it already has.
    await repo.reactivate(product.id);
    await repo.update(product.id, {name: 'Same'});

    // A no-op edit must not win a last-write-wins contest against a real one.
    expect(await clockOf(db, product.id)).toBe(past);
  });

  test('a sale does not advance it', async () => {
    const db = await makeTestDb();
    const product = await new ProductRepository(db).create({
      barcode: 'MCSALE', name: 'Sold', sellingPrice: 10, initialQuantity: 5,
    });
    const past = await pinBack(db, product.id);

    await new InventoryService(db).sellProduct(product.id, 1);

    expect(await clockOf(db, product.id)).toBe(past);
  });

  test('deactivating on one device reaches the other', async () => {
    const deviceA = await makeTestDb();
    const deviceB = await makeTestDb();

    const product = await new ProductRepository(deviceA).create({
      barcode: 'MCSYNC', name: 'Discontinued', sellingPrice: 10, initialQuantity: 1,
    });
    await applyRemoteChanges(deviceB, await new ChangeTracker(deviceA).collect());
    await deviceA.execute('DELETE FROM sync_outbox;');

    // B's copy is pinned into the past so the incoming edit is unambiguously
    // newer. Creating and deactivating can otherwise land in the same
    // millisecond, and equal timestamps deliberately keep the local copy.
    await pinBack(deviceB, product.id);

    await new ProductRepository(deviceA).deactivate(product.id);
    await applyRemoteChanges(deviceB, await new ChangeTracker(deviceA).collect());

    const onB = await deviceB.execute<{lifecycle: string}>(
      'SELECT lifecycle FROM products WHERE id = ?;',
      [product.id],
    );
    expect(onB.rows[0].lifecycle).toBe('INACTIVE');
  });

  test('applying a remote change does not advance it', async () => {
    const db = await makeTestDb();
    const product = await new ProductRepository(db).create({
      barcode: 'MCREM', name: 'Remote', sellingPrice: 10, initialQuantity: 1,
    });
    const row = await db.execute<Record<string, string>>(
      'SELECT * FROM products WHERE id = ?;',
      [product.id],
    );

    // If the trigger fired while merging, the clock would jump to "now" on
    // arrival and this device would then out-rank everyone else's edits.
    const incoming = '2030-06-01T00:00:00.000Z';
    await applyRemoteChanges(db, [
      {table: 'products', id: product.id, op: 'UPSERT',
       row: {...row.rows[0], name: 'From elsewhere', metadata_updated_at: incoming}},
    ]);

    expect(await clockOf(db, product.id)).toBe(incoming);
  });
});
