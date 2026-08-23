# Inventory — offline Android stock manager

A barcode-driven inventory and sales app for a single shop counter. It runs
entirely on the phone: local SQLite, local file storage, no server, no account,
no network call at any point.

Scan a product's barcode, see its stock, sell it. The target is under ten
seconds from opening the app to a recorded sale.

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

Release builds strip the `INTERNET` permission, so the shipped APK cannot reach
the network even in principle.

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
  screens/      one file per screen
  components/   shared UI
  navigation/   stack + tabs, typed routes
  utils/        barcode, stock, dates, ids, errors
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

Only three, each tied to a feature you can point at:

| Permission | Why |
|---|---|
| `CAMERA` | live barcode scanning |
| `READ_MEDIA_IMAGES` (API 33+) / `READ_EXTERNAL_STORAGE` (API ≤32) | choosing a product photo from the gallery |
| `INTERNET` | Metro dev server only; removed from release builds |

Sharing exports and backups goes through a `FileProvider`, so no write-storage
permission is needed.

## No accounts, no cloud

Version 1 has no login and no sync, by design. Data lives on the phone; the only
way it leaves is a backup or an export that you explicitly share. If
authentication is ever added, it belongs in front of the navigation container in
`App.tsx` — nothing in the data layer assumes a single anonymous user.

## Demo data

`seedDatabase()` in `src/database/seed` inserts a twenty-product demo catalogue
spanning all three stock states. It is never called on the startup path, and it
refuses to run if any product already exists, so it cannot pollute a real
inventory. Call it from a dev build or a test.
