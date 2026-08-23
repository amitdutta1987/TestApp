import * as RNFS from '@dr.pogodin/react-native-fs';
import type {SqlDriver} from '@/database/driver';
import {NodeSqliteDriver} from '@/database/drivers/NodeSqliteDriver';
import {prepareDatabase, setDriver} from '@/database/database';
import {ProductRepository} from '@/repositories/ProductRepository';
import {StatsRepository} from '@/repositories/StatsRepository';
import {BackupService} from '@/services/BackupService';
import {InventoryService} from '@/services/InventoryService';

/**
 * Backup coverage.
 *
 * KNOWN LIMITATION: react-native-zip-archive is a native module with no JS
 * implementation, so `zip`/`unzip` are replaced below with a real
 * pack-to-a-single-file / unpack round trip rather than DEFLATE. That means the
 * *compression* is not exercised here — it can only be verified on a device.
 * Everything that is our own logic is: what gets staged into the archive,
 * whether the archive is self-contained, whether metadata matches the database,
 * and whether the packed inventory.db still opens and holds the same rows.
 *
 * A full restoreBackup() is likewise not covered: it ends by calling
 * initDatabase(), which constructs the op-sqlite driver that does not exist off
 * the device. The steps before that — validation and refusal — are tested.
 */

jest.mock('@dr.pogodin/react-native-fs', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const nodePath = require('node:path');

  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'inv-docs-'));
  const caches = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'inv-cache-'));

  return {
    DocumentDirectoryPath: root,
    CachesDirectoryPath: caches,
    mkdir: jest.fn(async (path: string) => {
      fs.mkdirSync(path, {recursive: true});
    }),
    exists: jest.fn(async (path: string) => fs.existsSync(path)),
    unlink: jest.fn(async (path: string) => {
      fs.rmSync(path, {recursive: true, force: true});
    }),
    copyFile: jest.fn(async (from: string, to: string) => {
      fs.mkdirSync(nodePath.dirname(to), {recursive: true});
      fs.copyFileSync(from, to);
    }),
    moveFile: jest.fn(async (from: string, to: string) => {
      fs.mkdirSync(nodePath.dirname(to), {recursive: true});
      fs.renameSync(from, to);
    }),
    writeFile: jest.fn(async (path: string, contents: string, encoding?: string) => {
      fs.mkdirSync(nodePath.dirname(path), {recursive: true});
      fs.writeFileSync(path, contents, encoding === 'base64' ? 'base64' : 'utf8');
    }),
    readFile: jest.fn(async (path: string, encoding?: string) =>
      fs.readFileSync(path, encoding === 'base64' ? 'base64' : 'utf8'),
    ),
    readDir: jest.fn(async (path: string) =>
      fs.readdirSync(path, {withFileTypes: true}).map((entry: {name: string}) => {
        // Always "/" — the production code joins paths that way because Android
        // does, and a Windows separator here would break the comparisons it makes.
        const full = `${path}/${entry.name}`;
        const stat = fs.statSync(full);
        return {
          name: entry.name,
          path: full,
          size: stat.size,
          mtime: stat.mtime,
          isFile: () => stat.isFile(),
          isDirectory: () => stat.isDirectory(),
        };
      }),
    ),
    stat: jest.fn(async (path: string) => {
      const stat = fs.statSync(path);
      return {size: stat.size, mtime: stat.mtime, isFile: () => stat.isFile()};
    }),
  };
});

/**
 * Stands in for the native archiver: packs the directory tree into one real
 * file and unpacks it again. Not compressed, but genuinely a single
 * self-contained artefact, so "did the backup include everything?" is a
 * question this can still answer honestly.
 */
jest.mock('react-native-zip-archive', () => {
  const fs = require('node:fs');
  const nodePath = require('node:path');

  function walk(dir: string, base: string, into: Record<string, string>): void {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const full = nodePath.join(dir, entry.name);
      const relative = nodePath.relative(base, full).split(nodePath.sep).join('/');
      if (entry.isDirectory()) {
        walk(full, base, into);
      } else {
        into[relative] = fs.readFileSync(full).toString('base64');
      }
    }
  }

  return {
    zip: jest.fn(async (source: string, destination: string) => {
      const entries: Record<string, string> = {};
      walk(source, source, entries);
      fs.mkdirSync(nodePath.dirname(destination), {recursive: true});
      fs.writeFileSync(destination, JSON.stringify(entries));
      return destination;
    }),
    unzip: jest.fn(async (source: string, destination: string) => {
      const entries = JSON.parse(fs.readFileSync(source, 'utf8')) as Record<string, string>;
      for (const [relative, base64] of Object.entries(entries)) {
        const target = nodePath.join(destination, relative);
        fs.mkdirSync(nodePath.dirname(target), {recursive: true});
        fs.writeFileSync(target, Buffer.from(base64, 'base64'));
      }
      return destination;
    }),
  };
});

const fs = require('node:fs') as typeof import('node:fs');

let driver: SqlDriver;
let dbPath: string;
let products: ProductRepository;
let backup: BackupService;

/** Reads the packed archive back as a plain map of entry path -> contents. */
function archiveEntries(zipPath: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(zipPath, 'utf8')) as Record<string, string>;
}

function writeFakeImage(relativePath: string): void {
  const absolute = `${RNFS.DocumentDirectoryPath}/${relativePath}`;
  fs.mkdirSync(absolute.slice(0, absolute.lastIndexOf('/')), {recursive: true});
  fs.writeFileSync(absolute, Buffer.from('not-really-a-jpeg'));
}

beforeEach(async () => {
  // One shared temp root serves the whole file, so wipe it between tests —
  // otherwise a backup written by one test is still on disk for the next.
  for (const entry of fs.readdirSync(RNFS.DocumentDirectoryPath)) {
    fs.rmSync(`${RNFS.DocumentDirectoryPath}/${entry}`, {recursive: true, force: true});
  }

  dbPath = `${RNFS.DocumentDirectoryPath}/inventory.db`;
  driver = new NodeSqliteDriver(dbPath);
  await prepareDatabase(driver);
  setDriver(driver);

  products = new ProductRepository(driver);
  backup = new BackupService(products, new StatsRepository(driver));
});

afterEach(async () => {
  setDriver(null);
  await driver.close();
});

describe('creating a backup', () => {
  test('the archive holds the database and the metadata in a backup/ folder', async () => {
    await products.create({
      name: 'Basmati Rice 5kg',
      barcode: '890111222333',
      sellingPrice: 640,
      initialQuantity: 24,
      minimumStock: 6,
    });

    const result = await backup.createBackup();
    const entries = Object.keys(archiveEntries(result.absolutePath));

    expect(entries).toContain('backup/inventory.db');
    expect(entries).toContain('backup/metadata.json');
    expect(result.fileName).toMatch(/^Inventory_Backup_.*\.zip$/);
    expect(result.sizeBytes).toBeGreaterThan(0);
  });

  test('the metadata counts what is actually in the database', async () => {
    const rice = await products.create({
      name: 'Basmati Rice 5kg',
      barcode: '890111222333',
      sellingPrice: 640,
      initialQuantity: 24,
      minimumStock: 6,
    });
    await new InventoryService(driver).sellProduct(rice.id, 2);

    const result = await backup.createBackup();

    expect(result.metadata.counts).toMatchObject({
      products: 1,
      sales: 1,
      saleItems: 1,
      inventoryTransactions: 2,
    });
    expect(result.metadata.schemaVersion).toBe(1);
    expect(result.metadata.appName).toBe('Inventory');
  });

  test('every referenced image file travels inside the archive', async () => {
    writeFakeImage('product-images/a.jpg');
    writeFakeImage('product-images/thumbs/a.jpg');
    await products.create({
      name: 'Cotton T-Shirt',
      barcode: 'INH-TSHIRT-M-BLK',
      sellingPrice: 399,
      initialQuantity: 12,
      minimumStock: 4,
      images: ['product-images/a.jpg'],
      primaryImage: 'product-images/a.jpg',
    });

    const result = await backup.createBackup();
    const entries = archiveEntries(result.absolutePath);

    expect(Object.keys(entries)).toContain('backup/images/a.jpg');
    expect(Object.keys(entries)).toContain('backup/images/thumbs/a.jpg');
    expect(result.metadata.counts.imageFiles).toBe(1);
    expect(result.metadata.missingImages).toEqual([]);
  });

  test('an image the database references but the phone has lost is reported, not hidden', async () => {
    await products.create({
      name: 'Ankle Socks',
      barcode: 'INH-SOCKS-FREE',
      sellingPrice: 99,
      initialQuantity: 50,
      minimumStock: 10,
      images: ['product-images/gone.jpg'],
      primaryImage: 'product-images/gone.jpg',
    });

    const result = await backup.createBackup();

    expect(result.metadata.missingImages).toEqual(['product-images/gone.jpg']);
    expect(result.metadata.counts.imageFiles).toBe(0);
  });

  test('the packed database still opens and holds the same rows', async () => {
    await products.create({
      name: 'Ballpoint Pen Blue',
      barcode: '001234567890',
      sellingPrice: 10,
      initialQuantity: 240,
      minimumStock: 50,
    });

    const result = await backup.createBackup();

    // Unpack the archived copy and query it directly — this is what a restore
    // would hand back to the app.
    const extracted = `${RNFS.CachesDirectoryPath}/extracted.db`;
    fs.writeFileSync(
      extracted,
      Buffer.from(archiveEntries(result.absolutePath)['backup/inventory.db'], 'base64'),
    );

    const restored = new NodeSqliteDriver(extracted);
    const rows = await restored.execute<{barcode: string; current_quantity: number}>(
      'SELECT barcode, current_quantity FROM products;',
    );

    expect(rows.rows).toHaveLength(1);
    // The whole point of §10, checked after a full file round trip.
    expect(rows.rows[0].barcode).toBe('001234567890');
    expect(rows.rows[0].current_quantity).toBe(240);

    await restored.close();
  });
});

describe('validating a backup before restoring it', () => {
  test('a backup this app just made is accepted', async () => {
    await products.create({
      name: 'Sugar 1kg',
      barcode: '890111222371',
      sellingPrice: 55,
      initialQuantity: 10,
      minimumStock: 2,
    });
    const result = await backup.createBackup();

    const report = await backup.validateBackup(result.absolutePath);

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.metadata?.counts.products).toBe(1);
  });

  test('a file that is not an archive at all is rejected', async () => {
    const notAnArchive = `${RNFS.CachesDirectoryPath}/holiday-photo.zip`;
    fs.writeFileSync(notAnArchive, 'this is not a zip');

    const report = await backup.validateBackup(notAnArchive);

    expect(report.valid).toBe(false);
    expect(report.errors[0]).toMatch(/could not be opened/i);
  });

  test('an archive without a backup folder is rejected', async () => {
    const wrongShape = `${RNFS.CachesDirectoryPath}/wrong-shape.zip`;
    fs.writeFileSync(
      wrongShape,
      JSON.stringify({'notes.txt': Buffer.from('hello').toString('base64')}),
    );

    const report = await backup.validateBackup(wrongShape);

    expect(report.valid).toBe(false);
    expect(report.errors[0]).toMatch(/backup/i);
  });

  test('an archive missing inventory.db is rejected even though metadata is present', async () => {
    const result = await backup.createBackup();
    const entries = archiveEntries(result.absolutePath);
    delete entries['backup/inventory.db'];

    const broken = `${RNFS.CachesDirectoryPath}/no-db.zip`;
    fs.writeFileSync(broken, JSON.stringify(entries));

    const report = await backup.validateBackup(broken);

    expect(report.valid).toBe(false);
    expect(report.errors.join(' ')).toMatch(/inventory\.db is missing/i);
  });

  test('a backup from a newer app version is refused rather than half-applied', async () => {
    const result = await backup.createBackup();
    const entries = archiveEntries(result.absolutePath);
    const metadata = JSON.parse(Buffer.from(entries['backup/metadata.json'], 'base64').toString());
    metadata.schemaVersion = 99;
    entries['backup/metadata.json'] = Buffer.from(JSON.stringify(metadata)).toString('base64');

    const fromFuture = `${RNFS.CachesDirectoryPath}/from-future.zip`;
    fs.writeFileSync(fromFuture, JSON.stringify(entries));

    const report = await backup.validateBackup(fromFuture);

    expect(report.valid).toBe(false);
    expect(report.errors.join(' ')).toMatch(/newer version/i);
  });

  test('an archive whose images were stripped warns before anything is replaced', async () => {
    writeFakeImage('product-images/a.jpg');
    await products.create({
      name: 'Cotton T-Shirt',
      barcode: 'INH-TSHIRT-M-BLK',
      sellingPrice: 399,
      initialQuantity: 12,
      minimumStock: 4,
      images: ['product-images/a.jpg'],
      primaryImage: 'product-images/a.jpg',
    });
    const result = await backup.createBackup();

    const entries = archiveEntries(result.absolutePath);
    delete entries['backup/images/a.jpg'];
    const stripped = `${RNFS.CachesDirectoryPath}/stripped.zip`;
    fs.writeFileSync(stripped, JSON.stringify(entries));

    const report = await backup.validateBackup(stripped);

    // Still restorable — the data is intact — but the user must be told.
    expect(report.valid).toBe(true);
    expect(report.warnings.join(' ')).toMatch(/1 product image/i);
  });

  test('restoring an invalid archive throws instead of touching live data', async () => {
    await products.create({
      name: 'Sugar 1kg',
      barcode: '890111222371',
      sellingPrice: 55,
      initialQuantity: 10,
      minimumStock: 2,
    });

    const notAnArchive = `${RNFS.CachesDirectoryPath}/junk.zip`;
    fs.writeFileSync(notAnArchive, 'junk');

    await expect(backup.restoreBackup(notAnArchive)).rejects.toThrow(/could not be opened/i);

    // The live database is untouched.
    const rows = await driver.execute<{total: number}>('SELECT COUNT(*) AS total FROM products;');
    expect(Number(rows.rows[0].total)).toBe(1);
  });
});

describe('listing saved backups', () => {
  test('a saved backup shows up with a usable path and size', async () => {
    const result = await backup.createBackup();
    const listed = await backup.listBackups();

    const entry = listed.find(item => item.name === result.fileName);
    expect(entry).toBeDefined();
    expect(entry?.path).toBe(result.absolutePath);
    expect(entry?.size).toBe(result.sizeBytes);
  });

  test('an untouched phone has no backups rather than an error', async () => {
    expect(await backup.listBackups()).toEqual([]);
  });
});
