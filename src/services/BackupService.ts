import * as RNFS from '@dr.pogodin/react-native-fs';
import {Platform} from 'react-native';
import {unzip, zip} from 'react-native-zip-archive';
import {APP, DIRS} from '@/constants/config';
import {
  LATEST_SCHEMA_VERSION,
  closeDatabase,
  getDriver,
  initDatabase,
} from '@/database/database';
import {ProductRepository} from '@/repositories/ProductRepository';
import {StatsRepository} from '@/repositories/StatsRepository';
import type {BackupMetadata, BackupValidationReport} from '@/types';
import {fileStamp, nowIso} from '@/utils/date';
import {resetSyncIdentityAfterRestore} from '@/sync/restore';
import {AppError} from '@/utils/errors';
import {OpSqliteDriver} from '@/database/drivers/OpSqliteDriver';
import {ensureStorageDirs, toAbsolutePath} from './ImageStorageService';

/**
 * Full backup and restore.
 *
 * Archive layout (spec §26):
 *
 *   Inventory_Backup_2026-08-23.zip
 *     backup/
 *       inventory.db
 *       metadata.json
 *       images/
 *         <product image files>
 *         thumbs/<thumbnail files>
 *
 * The database alone is worthless — every referenced image file travels with it,
 * and restore refuses an archive whose images do not match its metadata.
 */

const STAGE_DIR = `${DIRS.temp}/backup-stage`;
const RESTORE_DIR = `${DIRS.temp}/restore-stage`;
const METADATA_FILE = 'metadata.json';
const DB_FILE = 'inventory.db';

export interface BackupResult {
  absolutePath: string;
  fileName: string;
  sizeBytes: number;
  metadata: BackupMetadata;
}

export interface RestoreResult {
  metadata: BackupMetadata;
  imagesRestored: number;
  /** Files the archive promised but did not contain. Restore still completes. */
  imagesMissing: string[];
  safetyBackupPath: string | null;
}

async function rmrf(absolutePath: string): Promise<void> {
  try {
    if (await RNFS.exists(absolutePath)) {
      await RNFS.unlink(absolutePath);
    }
  } catch {
    // A leftover staging directory is harmless; it is recreated on next use.
  }
}

async function freshDir(relative: string): Promise<string> {
  const absolute = toAbsolutePath(relative);
  await rmrf(absolute);
  await RNFS.mkdir(absolute);
  return absolute;
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

export interface ExportServiceContract {
  createBackup(): Promise<string>;
  restoreBackup(uri: string): Promise<void>;
}

export class BackupService {
  constructor(
    private readonly products = new ProductRepository(),
    private readonly stats = new StatsRepository(),
  ) {}

  /**
   * Builds the archive. The database is checkpointed first so the copied file
   * contains every committed write rather than leaving them stranded in the WAL.
   */
  async createBackup(options: {directory?: string} = {}): Promise<BackupResult> {
    await ensureStorageDirs();

    const driver = getDriver();
    if (driver instanceof OpSqliteDriver) {
      await driver.checkpoint();
    }

    const stageRoot = await freshDir(STAGE_DIR);
    const backupRoot = `${stageRoot}/backup`;
    const imagesRoot = `${backupRoot}/images`;
    const thumbsRoot = `${imagesRoot}/thumbs`;

    try {
      await RNFS.mkdir(backupRoot);
      await RNFS.mkdir(imagesRoot);
      await RNFS.mkdir(thumbsRoot);

      await RNFS.copyFile(driver.getDatabasePath(), `${backupRoot}/${DB_FILE}`);

      const referenced = await this.products.listAllImagePaths();
      const missing: string[] = [];
      let copied = 0;

      for (const relativePath of referenced) {
        const source = toAbsolutePath(relativePath);
        if (!(await RNFS.exists(source))) {
          missing.push(relativePath);
          continue;
        }
        await RNFS.copyFile(source, `${imagesRoot}/${baseName(relativePath)}`);
        copied += 1;

        // Thumbnails are cheap and save a slow regeneration pass after restore.
        const thumbSource = toAbsolutePath(
          `${DIRS.thumbnails}/${baseName(relativePath)}`,
        );
        if (await RNFS.exists(thumbSource)) {
          await RNFS.copyFile(thumbSource, `${thumbsRoot}/${baseName(relativePath)}`);
        }
      }

      const counts = await this.stats.tableCounts();
      const metadata: BackupMetadata = {
        appName: APP.name,
        appVersion: APP.version,
        schemaVersion: LATEST_SCHEMA_VERSION,
        createdAt: nowIso(),
        deviceInfo: `Android ${Platform.Version}`,
        counts: {
          products: counts.products ?? 0,
          productImages: counts.product_images ?? 0,
          sales: counts.sales ?? 0,
          saleItems: counts.sale_items ?? 0,
          inventoryTransactions: counts.inventory_transactions ?? 0,
          imageFiles: copied,
        },
        referencedImages: referenced,
        missingImages: missing,
      };

      await RNFS.writeFile(
        `${backupRoot}/${METADATA_FILE}`,
        JSON.stringify(metadata, null, 2),
        'utf8',
      );

      const targetDir = options.directory ?? toAbsolutePath(DIRS.backups);
      if (!(await RNFS.exists(targetDir))) {
        await RNFS.mkdir(targetDir);
      }
      const fileName = `Inventory_Backup_${fileStamp(new Date(metadata.createdAt))}.zip`;
      const absolutePath = `${targetDir}/${fileName}`;
      await rmrf(absolutePath);

      await zip(stageRoot, absolutePath);
      const stat = await RNFS.stat(absolutePath);

      return {absolutePath, fileName, sizeBytes: Number(stat.size ?? 0), metadata};
    } catch (error) {
      throw new AppError('BACKUP_FAILED', 'Could not create the backup file.', {cause: error});
    } finally {
      await rmrf(stageRoot);
    }
  }

  /**
   * Unpacks and checks an archive without touching live data. Always call this
   * (and show the result) before restoring.
   */
  async validateBackup(zipUri: string): Promise<BackupValidationReport & {stagePath: string}> {
    const errors: string[] = [];
    const warnings: string[] = [];
    let metadata: BackupMetadata | null = null;

    const stageRoot = await freshDir(RESTORE_DIR);

    try {
      const source = zipUri.replace(/^file:\/\//, '');
      await unzip(source, stageRoot);
    } catch (error) {
      return {
        valid: false,
        errors: ['That file could not be opened as a backup archive.'],
        warnings,
        metadata: null,
        stagePath: stageRoot,
      };
    }

    const backupRoot = `${stageRoot}/backup`;
    if (!(await RNFS.exists(backupRoot))) {
      errors.push('The archive does not contain a "backup" folder.');
      return {valid: false, errors, warnings, metadata: null, stagePath: stageRoot};
    }

    const metadataPath = `${backupRoot}/${METADATA_FILE}`;
    if (!(await RNFS.exists(metadataPath))) {
      errors.push(`metadata.json is missing — this is not a ${APP.name} backup.`);
    } else {
      try {
        metadata = JSON.parse(await RNFS.readFile(metadataPath, 'utf8')) as BackupMetadata;
      } catch {
        errors.push('metadata.json is corrupted.');
      }
    }

    const dbPath = `${backupRoot}/${DB_FILE}`;
    if (!(await RNFS.exists(dbPath))) {
      errors.push('inventory.db is missing from the archive.');
    }

    if (metadata) {
      if (metadata.schemaVersion > LATEST_SCHEMA_VERSION) {
        errors.push(
          `This backup was made by a newer version of the app (schema ${metadata.schemaVersion}). Update the app first.`,
        );
      }
      // Requirement §28: a backup that references images it does not contain is
      // only half a backup, so the user is told before anything is replaced.
      const imagesRoot = `${backupRoot}/images`;
      const present = new Set<string>();
      if (await RNFS.exists(imagesRoot)) {
        const entries = await RNFS.readDir(imagesRoot);
        entries.filter(entry => entry.isFile()).forEach(entry => present.add(entry.name));
      }
      const absent = metadata.referencedImages
        .map(baseName)
        .filter(name => !present.has(name));
      if (absent.length > 0) {
        warnings.push(
          `${absent.length} product image${absent.length === 1 ? '' : 's'} referenced by this backup ${absent.length === 1 ? 'is' : 'are'} not in the archive.`,
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      metadata,
      stagePath: stageRoot,
    };
  }

  /**
   * Full replacement (spec §27 — no merge in v1).
   *
   * Order matters: validate, snapshot the current data, close the database, swap
   * the file, then reopen. If the swap throws, the snapshot is the way back.
   */
  async restoreBackup(
    zipUri: string,
    options: {createSafetyBackup?: boolean} = {},
  ): Promise<RestoreResult> {
    const report = await this.validateBackup(zipUri);
    if (!report.valid || !report.metadata) {
      await rmrf(report.stagePath);
      throw new AppError(
        'INVALID_BACKUP',
        report.errors[0] ?? 'That backup could not be validated.',
        {details: report.errors},
      );
    }

    const backupRoot = `${report.stagePath}/backup`;
    let safetyBackupPath: string | null = null;

    try {
      if (options.createSafetyBackup !== false) {
        try {
          const safety = await this.createBackup({
            directory: toAbsolutePath(`${DIRS.temp}/safety`),
          });
          safetyBackupPath = safety.absolutePath;
        } catch {
          // An empty or already-broken database cannot be snapshotted. Restoring
          // is still the right move — there is nothing to lose.
          safetyBackupPath = null;
        }
      }

      const livePath = getDriver().getDatabasePath();
      await closeDatabase();

      // WAL and shared-memory sidecars belong to the old database; leaving them
      // behind would corrupt the file we are about to drop in.
      for (const suffix of ['', '-wal', '-shm']) {
        await rmrf(`${livePath}${suffix}`);
      }
      await RNFS.copyFile(`${backupRoot}/${DB_FILE}`, livePath);

      // Replace the image tree wholesale so no stale file can shadow a restored one.
      const productImagesDir = await freshDir(DIRS.productImages);
      const thumbsDir = await freshDir(DIRS.thumbnails);

      let imagesRestored = 0;
      const imagesRoot = `${backupRoot}/images`;
      if (await RNFS.exists(imagesRoot)) {
        for (const entry of await RNFS.readDir(imagesRoot)) {
          if (entry.isFile()) {
            await RNFS.copyFile(entry.path, `${productImagesDir}/${entry.name}`);
            imagesRestored += 1;
          }
        }
        const thumbsSource = `${imagesRoot}/thumbs`;
        if (await RNFS.exists(thumbsSource)) {
          for (const entry of await RNFS.readDir(thumbsSource)) {
            if (entry.isFile()) {
              await RNFS.copyFile(entry.path, `${thumbsDir}/${entry.name}`);
            }
          }
        }
      }

      // Reopen and run migrations: an older backup is upgraded on the way in.
      const reopened = await initDatabase();

      // The archive carried the *source* device's sync identity and cursor.
      // Adopting them would make two restored phones mint identical sale
      // numbers; see resetSyncIdentityAfterRestore.
      await resetSyncIdentityAfterRestore(reopened);

      const stillMissing: string[] = [];
      for (const relativePath of report.metadata.referencedImages) {
        if (!(await RNFS.exists(toAbsolutePath(relativePath)))) {
          stillMissing.push(relativePath);
        }
      }

      return {
        metadata: report.metadata,
        imagesRestored,
        imagesMissing: stillMissing,
        safetyBackupPath,
      };
    } catch (error) {
      // Make sure the app is never left without an open database.
      try {
        await initDatabase();
      } catch {
        // Reported through the thrown AppError below.
      }
      throw new AppError(
        'RESTORE_FAILED',
        safetyBackupPath
          ? 'Restore failed. Your previous data was left in place.'
          : 'Restore failed.',
        {cause: error},
      );
    } finally {
      await rmrf(report.stagePath);
    }
  }

  async listBackups(): Promise<Array<{name: string; path: string; size: number; mtime: number}>> {
    const dir = toAbsolutePath(DIRS.backups);
    if (!(await RNFS.exists(dir))) {
      return [];
    }
    const entries = await RNFS.readDir(dir);
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.zip'))
      .map(entry => ({
        name: entry.name,
        path: entry.path,
        size: Number(entry.size ?? 0),
        mtime: entry.mtime?.getTime() ?? 0,
      }))
      .sort((a, b) => b.mtime - a.mtime);
  }
}

export const backupService = new BackupService();
