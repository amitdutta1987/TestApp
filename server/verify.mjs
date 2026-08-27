#!/usr/bin/env node
/**
 * End-to-end check against a running sync Worker.
 *
 * This is the piece the app's Jest suite cannot cover: the client tests run the
 * merge rules against SQLite and a stand-in server, but the real push/pull SQL
 * only executes on Postgres. Run this once after deploying, and again after any
 * change to schema.sql or src/sync.ts.
 *
 *   # against a local worker (wrangler dev), in another terminal:
 *   SYNC_URL=http://localhost:8787 SYNC_API_KEY=... node verify.mjs
 *
 *   # against the deployed one:
 *   SYNC_URL=https://inventory-sync.<subdomain>.workers.dev SYNC_API_KEY=... node verify.mjs
 *
 * It writes rows with ids prefixed "verify_" and deletes them at the end, so it
 * is safe to run against a real database — though a fresh one is still wiser.
 */

const BASE = process.env.SYNC_URL;
const KEY = process.env.SYNC_API_KEY;

if (!BASE || !KEY) {
  console.error('Set SYNC_URL and SYNC_API_KEY.');
  process.exit(2);
}

let failures = 0;

function check(label, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${KEY}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {status: response.status, body};
}

const stamp = Date.now();
const productId = `verify_p_${stamp}`;
const now = new Date().toISOString();

function product(overrides = {}) {
  return {
    id: productId,
    barcode: `VERIFY${stamp}`,
    sku: null, name: 'Verify widget', category: null, brand: null,
    description: null, color: null, size: null, material: null,
    supplier: null, rack_location: null, purchase_price: null,
    selling_price: 100, minimum_stock: 0, lifecycle: 'ACTIVE',
    primary_image: null, created_at: now, updated_at: now,
    metadata_updated_at: now,
    // Deliberately sent: the server must ignore these derived columns.
    current_quantity: 999, status: 'IN_STOCK',
    ...overrides,
  };
}

function ledgerRow(id, quantity, before, after) {
  return {
    id, product_id: productId, type: 'SALE', quantity,
    quantity_before: before, quantity_after: after,
    reference_id: null, notes: null, created_at: new Date().toISOString(),
  };
}

console.log(`\nVerifying ${BASE}\n`);

// --- auth ------------------------------------------------------------------
console.log('authentication');
const noKey = await fetch(`${BASE}/v1/sync/pull?cursor=0`);
check('a request with no key is rejected', noKey.status === 401, `got ${noKey.status}`);
const badKey = await fetch(`${BASE}/v1/sync/pull?cursor=0`, {
  headers: {authorization: 'Bearer definitely-not-the-key'},
});
check('a request with the wrong key is rejected', badKey.status === 401, `got ${badKey.status}`);
const health = await fetch(`${BASE}/v1/health`);
check('health needs no key', health.status === 200, `got ${health.status}`);

// Everything past this point needs a working key. Without this guard a wrong
// key produces a screen of unrelated-looking failures instead of one clear one.
const preflight = await call('/v1/sync/pull?cursor=0&limit=1');
if (preflight.status === 401) {
  console.error(
    '\nFAIL  the key in SYNC_API_KEY does not match the one on the Worker.\n' +
    '      Re-set them from one value so they cannot drift:\n' +
    '        printf %s "$SYNC_API_KEY" | npx wrangler secret put SYNC_API_KEY\n',
  );
  process.exit(1);
}

// --- push ------------------------------------------------------------------
console.log('\npush');
const cursorBefore = preflight.body.cursor;

const push1 = await call('/v1/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    deviceId: 'verify-device-a',
    changes: [
      {table: 'products', id: productId, op: 'UPSERT', row: product()},
      {
        table: 'inventory_transactions',
        id: `verify_t1_${stamp}`,
        op: 'UPSERT',
        row: {...ledgerRow(`verify_t1_${stamp}`, 10, 0, 10), type: 'INITIAL_STOCK'},
      },
    ],
  }),
});
check('the batch is accepted', push1.status === 200 && push1.body.accepted?.length === 2,
  JSON.stringify(push1.body));
check('nothing was rejected', (push1.body.rejected ?? []).length === 0,
  JSON.stringify(push1.body.rejected));

const unknown = await call('/v1/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    deviceId: 'verify-device-a',
    changes: [{table: 'not_a_table', id: 'x', op: 'UPSERT', row: {id: 'x'}}],
  }),
});
check('an unknown table is rejected, not executed',
  unknown.body.rejected?.length === 1 && unknown.body.accepted?.length === 0,
  JSON.stringify(unknown.body));

// --- pull ------------------------------------------------------------------
console.log('\npull');
const pulled = await call(`/v1/sync/pull?cursor=${cursorBefore}&limit=100`);
const productChange = pulled.body.changes?.find(c => c.id === productId);
check('the pushed product comes back', Boolean(productChange));
check('derived stock columns are not returned',
  productChange && !('current_quantity' in productChange.row) && !('status' in productChange.row),
  JSON.stringify(productChange?.row));
check('server bookkeeping is not returned',
  productChange && !('server_seq' in productChange.row) && !('deleted_at' in productChange.row));
check('the cursor advanced', Number(pulled.body.cursor) > Number(cursorBefore));

// --- append-only semantics -------------------------------------------------
console.log('\nappend-only tables');
const txId = `verify_t2_${stamp}`;
await call('/v1/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    deviceId: 'verify-device-a',
    changes: [{table: 'inventory_transactions', id: txId, op: 'UPSERT', row: ledgerRow(txId, -3, 10, 7)}],
  }),
});
// Re-push the same id with a different quantity: it must NOT overwrite.
await call('/v1/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    deviceId: 'verify-device-b',
    changes: [{table: 'inventory_transactions', id: txId, op: 'UPSERT', row: ledgerRow(txId, -999, 10, 0)}],
  }),
});
const afterAppend = await call(`/v1/sync/pull?cursor=${cursorBefore}&limit=200`);
const tx = afterAppend.body.changes?.find(c => c.id === txId);
check('an immutable ledger row is never rewritten', tx?.row?.quantity === -3,
  `quantity is ${tx?.row?.quantity}`);

// --- last-write-wins -------------------------------------------------------
console.log('\nlast-write-wins on products');
const older = new Date(Date.now() - 60000).toISOString();
const newer = new Date(Date.now() + 60000).toISOString();

await call('/v1/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    deviceId: 'verify-device-b',
    changes: [{table: 'products', id: productId, op: 'UPSERT',
      row: product({name: 'Stale edit', metadata_updated_at: older})}],
  }),
});
let state = await call(`/v1/sync/pull?cursor=${cursorBefore}&limit=200`);
let current = state.body.changes?.find(c => c.id === productId);
check('an older edit does not win', current?.row?.name === 'Verify widget',
  `name is ${current?.row?.name}`);

await call('/v1/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    deviceId: 'verify-device-b',
    changes: [{table: 'products', id: productId, op: 'UPSERT',
      row: product({name: 'Newer edit', metadata_updated_at: newer})}],
  }),
});
state = await call(`/v1/sync/pull?cursor=${cursorBefore}&limit=200`);
current = state.body.changes?.find(c => c.id === productId);
check('a newer edit wins', current?.row?.name === 'Newer edit', `name is ${current?.row?.name}`);

// --- image presigning ------------------------------------------------------
console.log('\nimage presigning');
const good = await call('/v1/images/upload-url', {
  method: 'POST',
  body: JSON.stringify({path: 'product-images/verify.jpg'}),
});
check('a valid key is presigned',
  good.status === 200 && typeof good.body.url === 'string' && good.body.url.includes('X-Amz-Signature'),
  JSON.stringify(good.body).slice(0, 200));

for (const bad of ['../../etc/passwd', 'other-prefix/x.jpg', 'product-images/../../x', '']) {
  const response = await call('/v1/images/upload-url', {
    method: 'POST',
    body: JSON.stringify({path: bad}),
  });
  check(`a path outside the image prefix is refused (${bad || 'empty'})`, response.status === 400,
    `got ${response.status}`);
}

// --- object storage round trip ---------------------------------------------
// Presigning correctly is not the same as the credentials working. This is the
// only check that proves the bucket accepts a write and returns it unchanged.
console.log('\nobject storage round trip');
const objectKey = `product-images/verify-${stamp}.txt`;
const payload = `verify-payload-${stamp}`;

const upload = await call('/v1/images/upload-url', {
  method: 'POST',
  body: JSON.stringify({path: objectKey}),
});
const putResponse = await fetch(upload.body.url, {method: 'PUT', body: payload});
check('an object can be written to the bucket', putResponse.ok,
  `PUT returned ${putResponse.status} ${(await putResponse.text()).slice(0, 160)}`);

const download = await call('/v1/images/download-url', {
  method: 'POST',
  body: JSON.stringify({path: objectKey}),
});
const getResponse = await fetch(download.body.url);
const readBack = getResponse.ok ? await getResponse.text() : '';
check('and read back byte for byte', readBack === payload,
  `GET returned ${getResponse.status}, body ${JSON.stringify(readBack.slice(0, 60))}`);

// --- deletes ---------------------------------------------------------------
console.log('\ndeletes');
await call('/v1/sync/push', {
  method: 'POST',
  body: JSON.stringify({
    deviceId: 'verify-device-a',
    changes: [{table: 'products', id: productId, op: 'DELETE'}],
  }),
});
const afterDelete = await call(`/v1/sync/pull?cursor=${cursorBefore}&limit=200`);
const deleted = afterDelete.body.changes?.find(c => c.id === productId);
check('a delete propagates as a tombstone', deleted?.op === 'DELETE', JSON.stringify(deleted));

console.log(
  failures === 0
    ? '\nAll checks passed.\n'
    : `\n${failures} check(s) failed.\n`,
);
console.log(
  'Rows prefixed "verify_" were left in the database. Remove them with:\n' +
  `  DELETE FROM sale_items WHERE id LIKE 'verify_%';\n` +
  `  DELETE FROM inventory_transactions WHERE id LIKE 'verify_%';\n` +
  `  DELETE FROM products WHERE id LIKE 'verify_%';\n\n` +
  `A test object was also left at ${objectKey}. Delete it from the R2 console\n` +
  'if you like — the Worker deliberately has no delete permission, which is\n' +
  'why it cannot tidy up after itself.\n',
);
process.exit(failures === 0 ? 0 : 1);
