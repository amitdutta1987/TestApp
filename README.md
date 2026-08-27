# Inventory — offline-first Android stock manager

A barcode-driven inventory and sales app for a shop counter. Every sale and
stock movement is written to local SQLite first and works with no signal at
all; when a connection is available those changes sync to a shared database so
several devices see one inventory.

Scan a product's barcode, see its stock, sell it. The target is under ten
seconds from opening the app to a recorded sale — which is why the network is
never on that path.

Sync is optional and off until configured. Leave it unset and the app behaves
exactly as it did before: entirely on the phone, no account, no network call.

## What it does

- **Live barcode scanning** — EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, QR,
  with torch, camera switch and a scan-again flow.
- **Barcode from a photograph** — for products you cannot hold under the camera.
  The barcode does not need to be centred; see [Reading a barcode from a photo](#reading-a-barcode-from-a-photo).
- **Products** — photos, SKU, category, brand, prices, rack location, supplier,
  and apparel fields (size, colour, material).
- **Stock** — every change is journalled (opening stock, stock in, sale, return,
  damage, stock count) with the quantity before and after. Stock can never go
  negative and a sale is one SQLite transaction: it either lands completely or
  not at all.
- **Sales** — per-day receipt numbers, daily and range summaries.
- **Excel export** — a real `.xlsx` with Products, Sales, Inventory Transactions
  and Summary sheets, generated on the device and shareable to any app.
- **Backup and restore** — one ZIP containing the database, its metadata and
  every product image. Restore validates the archive before replacing anything
  and takes a safety snapshot first.
- **Multi-device sync** — an optional shared Postgres database and S3 bucket, so
  two counters run off one inventory. Offline-first: the till never waits on the
  network. See [Multi-device sync](#multi-device-sync).

## Requirements

| | |
|---|---|
| Node.js | 20 or newer (24 recommended — the test suite uses `node:sqlite`) |
| JDK | 17 |
| Android SDK | Platform 35, Build-Tools 35.0.0, NDK 27.1.12297006 |
| Device | Android 7.0 (API 24) or newer, with a camera |

Set `ANDROID_HOME` (or `sdk.dir` in `android/local.properties`) to your SDK
location before building.

> The tests, type checking and linting run on any machine with Node alone. The
> Android build needs the JDK and SDK above.

## Getting started

```sh
npm install
```

### Run on a device or emulator

```sh
npm start          # terminal 1 — Metro
npm run android    # terminal 2 — build, install, launch
```

### Build an APK

```sh
npm run build:android:debug   # android/app/build/outputs/apk/debug/app-debug.apk
npm run build:android         # release; needs a signing config, see below
```

Without a signing config, `assembleRelease` falls back to the debug keystore so
the build still runs locally. **Do not distribute that APK.** To sign properly,
put your keystore at `android/app/release.keystore` and add the credentials to
`~/.gradle/gradle.properties` (not to the repository):

```properties
INVENTORY_UPLOAD_STORE_FILE=release.keystore
INVENTORY_UPLOAD_STORE_PASSWORD=...
INVENTORY_UPLOAD_KEY_ALIAS=...
INVENTORY_UPLOAD_KEY_PASSWORD=...
```

### Verify

```sh
npm run verify     # typecheck + lint + tests
```

Individually: `npm run typecheck`, `npm run lint`, `npm test`.

## How it is put together

```
src/
  database/     driver abstraction, schema, migrations, demo seed data
  repositories/ SQL per entity — products, sales, inventory, stats
  services/     scanning, image storage, inventory maths, Excel, backup
  sync/         change tracking, merge rules, sync engine, image transfer
  screens/      one file per screen
  components/   shared UI
  navigation/   stack + tabs, typed routes
  utils/        barcode, stock, dates, ids, errors
server/         the sync API: a Cloudflare Worker over Neon Postgres and S3
```

Some decisions worth knowing about before changing things:

**Barcodes are strings, never numbers.** `001234567890` and `1234567890` are
different products. Nothing may pass a barcode through `Number()` — the leading
zeros are real. This is enforced in the schema, the Excel export writes them as
text cells, and there are tests guarding each of those.

**Images are files, not BLOBs.** SQLite stores a *relative* path such as
`product-images/abc.jpg`; the JPEG lives in app-private storage. Relative,
because a backup restored onto a different phone lands in a different absolute
directory. Backups carry the image files alongside the database.

**The database driver is an interface.** On the device it is op-sqlite. In tests
it is Node's built-in `node:sqlite`, running the same DDL, the same constraints
and the same `BEGIN IMMEDIATE`/`COMMIT` semantics — so the repository, inventory,
sales and export tests exercise production SQL rather than a stand-in.

**Timestamps are stored as UTC, but days are local.** "Today's sales" has to mean
the shopkeeper's today. The test suite runs in `Asia/Kolkata` rather than UTC so
off-by-one-day bugs cannot hide.

**Stock is a ledger, not a number.** `products.current_quantity` is a cache;
the truth is `SUM(quantity)` over `inventory_transactions`. Everything that
moves stock writes a journal row, and there is a test asserting the two always
agree. This is what makes multi-device safe — see below.

**Local changes are tracked by SQLite triggers**, not by code at each write
site. `src/database/schema/sync.ts` installs them. A repository method that
forgot to record its change would leave a row that exists on one phone and
nowhere else, and there are enough write paths that "remember to add it" is not
a plan.

## Reading a barcode from a photo

A barcode in a product photograph may be small, in a corner, or at an angle — the
app does not assume it is centred. Detection runs cheapest-first and stops at the
first hit:

1. ML Kit on the original file.
2. The whole frame enlarged, which widens thin bars.
3. A 3×3 overlapping grid, each tile cropped and enlarged, corners first. This is
   what rescues a barcode covering 5–10% of the frame.
4. Rotated 90°, for sideways labels with no usable EXIF orientation.

If all four fail you are offered a crop tool to point at the barcode yourself,
and then manual entry. Nothing is faked: when detection fails the app says so.
The cases it genuinely cannot handle are listed in
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Permissions

Each tied to a feature you can point at:

| Permission | Why |
|---|---|
| `CAMERA` | live barcode scanning |
| `READ_MEDIA_IMAGES` (API 33+) / `READ_EXTERNAL_STORAGE` (API ≤32) | choosing a product photo from the gallery |
| `INTERNET` | cloud sync, and the Metro dev server in debug builds |
| `ACCESS_NETWORK_STATE` | skipping a sync that would only time out |

Sharing exports and backups goes through a `FileProvider`, so no write-storage
permission is needed.

## Multi-device sync

Off by default. Fill in the `SYNC` block in `src/constants/config.ts` with your
Worker URL and key and rebuild; until then nothing touches the network. Setting
the server up takes about fifteen minutes — see [server/README.md](server/README.md).

### Offline-first, not online

Every write goes to local SQLite and returns immediately. A background pass
pushes the outbox and pulls other devices' changes roughly once a minute and on
launch. Pulling the plug on the router changes nothing about how the till
behaves; the outbox simply grows until the connection returns.

### How two tills stay correct

Stock is never sent as a number, only as the signed movements that produced it.
Merging two devices is a union of their ledgers, so if both sell one unit while
offline, both sales survive and the total is right. Had `current_quantity` been
synced as a value, last-write-wins would have thrown one of the sales away.

| Data | Rule |
|---|---|
| Stock movements, sales, sale lines | Append-only. Recorded once, never rewritten. |
| Product details, settings | Last write wins, on a timestamp that only genuine edits move. |
| Stock quantity and status | Never synced. Recomputed from the ledger on every device. |

Sale numbers carry a device tag (`S-20260827-0007-A3F`). Without it two counters
both reach sequence 0007 offline and one receipt is lost on merge.

If two counters add the same barcode offline, both products are kept and one
barcode is suffixed, with a warning in Settings asking you to merge them. A row
the merge genuinely cannot apply is reported and skipped rather than being
retried forever, so one bad row can never stall sync.

### What it cannot prevent

If two devices are both offline and each sells the last unit, both sales are
real and the merged ledger is short. No design fixes that after the fact. The
app detects it, keeps both sales, and shows a "stock needs checking" warning in
Settings naming the product and the shortfall, rather than quietly clamping.

### Photos

Product photos go to S3 under the same relative path SQLite already stores, so
the path is both the local filename and the object key. Uploads are queued and
retried; a photo that will not transfer never blocks the rows, because the
product's price and stock matter more than its picture. Thumbnails are rebuilt
locally rather than transferred.

## Demo data

`seedDatabase()` in `src/database/seed` inserts a twenty-product demo catalogue
spanning all three stock states. It is never called on the startup path, and it
refuses to run if any product already exists, so it cannot pollute a real
inventory. Call it from a dev build or a test.
