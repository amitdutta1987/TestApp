import ImageResizer from '@bam.tech/react-native-image-resizer';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {DIRS, IMAGE} from '@/constants/config';
import {AppError} from '@/utils/errors';
import {generateId} from '@/utils/id';

/**
 * Contract from the spec. Paths handed back are *relative* (e.g.
 * "product-images/abc.jpg") — that is what SQLite stores, so a backup restored
 * onto a different phone still resolves even though the absolute app-private
 * directory changes.
 */
export interface ImageStorageServiceContract {
  saveImage(uri: string): Promise<string>;
  deleteImage(path: string): Promise<void>;
  getImage(path: string): Promise<string>;
}

/** Absolute root of app-private storage. Never leaves the app sandbox. */
export function storageRoot(): string {
  return RNFS.DocumentDirectoryPath;
}

/** Turns a stored relative path into something <Image source={{uri}} /> accepts. */
export function toDisplayUri(relativePath: string | null | undefined): string | null {
  if (!relativePath) {
    return null;
  }
  if (relativePath.startsWith('file://') || relativePath.startsWith('content://')) {
    return relativePath;
  }
  const absolute = relativePath.startsWith('/')
    ? relativePath
    : `${storageRoot()}/${relativePath}`;
  return `file://${absolute}`;
}

export function toAbsolutePath(relativePath: string): string {
  if (relativePath.startsWith('/')) {
    return relativePath;
  }
  return `${storageRoot()}/${relativePath}`;
}

/** Convention: "product-images/x.jpg" -> "product-images/thumbs/x.jpg". */
export function thumbPathFor(relativePath: string): string {
  const fileName = relativePath.split('/').pop() ?? relativePath;
  return `${DIRS.thumbnails}/${fileName}`;
}

async function ensureDir(relative: string): Promise<void> {
  const absolute = `${storageRoot()}/${relative}`;
  const exists = await RNFS.exists(absolute);
  if (!exists) {
    await RNFS.mkdir(absolute);
  }
}

export async function ensureStorageDirs(): Promise<void> {
  for (const dir of [DIRS.productImages, DIRS.thumbnails, DIRS.exports, DIRS.backups, DIRS.temp]) {
    await ensureDir(dir);
  }
}

export class ImageStorageService implements ImageStorageServiceContract {
  /**
   * Copies a picked/captured photo into app-private storage, resized and
   * compressed. The original camera file (often 4–8 MB) is never kept.
   *
   * Returns the relative path to store in SQLite.
   */
  async saveImage(uri: string): Promise<string> {
    if (!uri) {
      throw new AppError('IMAGE_STORAGE_FAILED', 'No image was provided.');
    }
    await ensureStorageDirs();

    const fileName = `${generateId()}.jpg`;
    const relativePath = `${DIRS.productImages}/${fileName}`;
    const absolutePath = toAbsolutePath(relativePath);

    try {
      const resized = await ImageResizer.createResizedImage(
        uri,
        IMAGE.maxDimension,
        IMAGE.maxDimension,
        'JPEG',
        IMAGE.quality,
        0,
        null,
        false,
        {mode: 'contain', onlyScaleDown: true},
      );
      // The resizer writes to a temp location; move it into our own tree so the
      // OS cannot reclaim it and so backup can find every file in one folder.
      await RNFS.moveFile(resized.path, absolutePath);
    } catch (error) {
      throw new AppError(
        'IMAGE_PROCESSING_FAILED',
        'Could not process that image. Try taking the photo again.',
        {cause: error},
      );
    }

    // A missing thumbnail only costs list performance, so it must not fail the save.
    try {
      await this.generateThumbnail(relativePath);
    } catch {
      // Ignored: the list falls back to the full image.
    }

    return relativePath;
  }

  /** Small copy used by the inventory list so full-size photos never load there. */
  async generateThumbnail(relativePath: string): Promise<string> {
    await ensureDir(DIRS.thumbnails);
    const thumbRelative = thumbPathFor(relativePath);
    const thumbAbsolute = toAbsolutePath(thumbRelative);

    const resized = await ImageResizer.createResizedImage(
      `file://${toAbsolutePath(relativePath)}`,
      IMAGE.thumbDimension,
      IMAGE.thumbDimension,
      'JPEG',
      IMAGE.thumbQuality,
      0,
      null,
      false,
      {mode: 'cover', onlyScaleDown: true},
    );
    await RNFS.moveFile(resized.path, thumbAbsolute);
    return thumbRelative;
  }

  /** Falls back to the full image when no thumbnail was generated. */
  async resolveThumbnail(relativePath: string | null): Promise<string | null> {
    if (!relativePath) {
      return null;
    }
    const thumbRelative = thumbPathFor(relativePath);
    const exists = await RNFS.exists(toAbsolutePath(thumbRelative));
    return exists ? thumbRelative : relativePath;
  }

  async deleteImage(path: string): Promise<void> {
    if (!path) {
      return;
    }
    for (const candidate of [path, thumbPathFor(path)]) {
      try {
        const absolute = toAbsolutePath(candidate);
        if (await RNFS.exists(absolute)) {
          await RNFS.unlink(absolute);
        }
      } catch {
        // A stale file that cannot be removed is not worth failing the user's
        // action over; it will be cleaned up by the orphan sweep.
      }
    }
  }

  /** Resolves a stored path to a displayable URI, or throws if the file is gone. */
  async getImage(path: string): Promise<string> {
    const absolute = toAbsolutePath(path);
    const exists = await RNFS.exists(absolute);
    if (!exists) {
      throw new AppError('IMAGE_STORAGE_FAILED', 'That image file is missing from this device.');
    }
    return `file://${absolute}`;
  }

  async exists(path: string): Promise<boolean> {
    try {
      return await RNFS.exists(toAbsolutePath(path));
    } catch {
      return false;
    }
  }

  /** Every file currently on disk, as relative paths. */
  async listStoredImages(): Promise<string[]> {
    await ensureStorageDirs();
    const dir = toAbsolutePath(DIRS.productImages);
    const entries = await RNFS.readDir(dir);
    return entries
      .filter(entry => entry.isFile())
      .map(entry => `${DIRS.productImages}/${entry.name}`);
  }

  /**
   * Removes image files no longer referenced by any product. Runs after a
   * restore, where the incoming database may reference a different set.
   */
  async deleteOrphans(referenced: string[]): Promise<number> {
    const referencedSet = new Set(referenced);
    const stored = await this.listStoredImages();
    let removed = 0;
    for (const path of stored) {
      if (!referencedSet.has(path)) {
        await this.deleteImage(path);
        removed += 1;
      }
    }
    return removed;
  }
}

export const imageStorageService = new ImageStorageService();
