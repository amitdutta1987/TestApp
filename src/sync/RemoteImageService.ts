import * as RNFS from '@dr.pogodin/react-native-fs';
import {SYNC} from '@/constants/config';
import type {SqlDriver} from '@/database/driver';
import {toAbsolutePath, ensureStorageDirs, thumbPathFor} from '@/services/ImageStorageService';
import {nowIso} from '@/utils/date';
import type {SyncApiContract} from './SyncApi';

interface QueueRow {
  path: string;
  direction: 'UPLOAD' | 'DOWNLOAD';
  attempts: number;
}

/**
 * Moves product photos between the device and object storage.
 *
 * The relative path SQLite already stores ("product-images/abc.jpg") is used
 * verbatim as the S3 object key. That path was chosen to be device-independent
 * so a restored backup would resolve on another phone, which makes it just as
 * suitable as a global key — so no column had to be added anywhere to track a
 * remote id, and an image is addressable from any device that has the row.
 *
 * Thumbnails are deliberately not uploaded. They are derived, small, and cheap
 * to regenerate locally; paying storage and transfer for them would double the
 * bill for a file the receiving device can rebuild in milliseconds.
 */
export class RemoteImageService {
  constructor(
    private readonly driver: SqlDriver,
    private readonly api: SyncApiContract,
  ) {}

  async enqueueUpload(path: string): Promise<void> {
    await this.enqueue(path, 'UPLOAD');
  }

  async enqueueDownload(path: string): Promise<void> {
    await this.enqueue(path, 'DOWNLOAD');
  }

  private async enqueue(path: string, direction: 'UPLOAD' | 'DOWNLOAD'): Promise<void> {
    if (!path || path.startsWith('/') || path.startsWith('file://')) {
      // Only relative, in-sandbox paths are valid object keys.
      return;
    }
    await this.driver.execute(
      `INSERT INTO image_sync_queue (path, direction, attempts, queued_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(path) DO UPDATE SET direction = excluded.direction;`,
      [path, direction, nowIso()],
    );
  }

  /**
   * Queues a download for every image a product row refers to that is not on
   * this device. Called after a pull: the rows arrive over the sync API, but
   * the bytes have to come from object storage separately.
   */
  async queueMissingImages(): Promise<number> {
    const referenced = await this.driver.execute<{image_uri: string}>(
      `SELECT DISTINCT image_uri FROM product_images
        UNION
       SELECT DISTINCT primary_image FROM products WHERE primary_image IS NOT NULL;`,
    );

    let queued = 0;
    for (const row of referenced.rows) {
      const path = row.image_uri;
      if (!path || path.startsWith('/') || path.startsWith('file://')) {
        continue;
      }
      if (await RNFS.exists(toAbsolutePath(path))) {
        continue;
      }
      await this.enqueueDownload(path);
      queued += 1;
    }
    return queued;
  }

  /** Returns how many transfers succeeded. Failures stay queued for retry. */
  async processQueue(limit = 20): Promise<{uploaded: number; downloaded: number}> {
    await ensureStorageDirs();

    const pending = await this.driver.execute<QueueRow>(
      `SELECT path, direction, attempts FROM image_sync_queue
        WHERE attempts < ?
        ORDER BY queued_at ASC LIMIT ?;`,
      [SYNC.maxImageAttempts, limit],
    );

    let uploaded = 0;
    let downloaded = 0;

    for (const item of pending.rows) {
      try {
        if (item.direction === 'UPLOAD') {
          await this.upload(item.path);
          uploaded += 1;
        } else {
          await this.download(item.path);
          downloaded += 1;
        }
        await this.driver.execute('DELETE FROM image_sync_queue WHERE path = ?;', [item.path]);
      } catch (error) {
        // A photo that will not transfer must never block the row sync — the
        // product, its price and its stock matter more than its picture.
        await this.driver.execute(
          'UPDATE image_sync_queue SET attempts = attempts + 1, last_error = ? WHERE path = ?;',
          [error instanceof Error ? error.message : 'unknown error', item.path],
        );
      }
    }

    return {uploaded, downloaded};
  }

  private async upload(path: string): Promise<void> {
    const absolute = toAbsolutePath(path);
    if (!(await RNFS.exists(absolute))) {
      // Nothing to send. Dropping it here stops a deleted photo retrying forever.
      return;
    }

    const {url} = await this.api.uploadUrl(path);
    const result = await RNFS.uploadFiles({
      toUrl: url,
      method: 'PUT',
      // S3 expects the raw bytes as the body; a multipart wrapper would be
      // stored verbatim and the object would not be a valid JPEG.
      binaryStreamOnly: true,
      files: [{name: 'file', filename: path.split('/').pop() ?? 'image.jpg', filepath: absolute}],
    }).promise;

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`upload rejected with ${result.statusCode}`);
    }
  }

  private async download(path: string): Promise<void> {
    const {url} = await this.api.downloadUrl(path);
    const absolute = toAbsolutePath(path);

    // Written to a temp name first: a download interrupted midway would
    // otherwise leave a truncated file that `exists()` reports as present, and
    // the image would never be fetched again.
    const staging = `${absolute}.part`;
    const result = await RNFS.downloadFile({fromUrl: url, toFile: staging}).promise;

    if (result.statusCode < 200 || result.statusCode >= 300) {
      await RNFS.unlink(staging).catch(() => undefined);
      throw new Error(`download failed with ${result.statusCode}`);
    }
    await RNFS.moveFile(staging, absolute);

    // The thumbnail is rebuilt locally rather than transferred; see the note on
    // this class. A missing one only costs list performance.
    await this.regenerateThumbnail(path);
  }

  private async regenerateThumbnail(path: string): Promise<void> {
    try {
      const {imageStorageService} = await import('@/services/ImageStorageService');
      const thumb = toAbsolutePath(thumbPathFor(path));
      if (!(await RNFS.exists(thumb))) {
        await imageStorageService.generateThumbnail(path);
      }
    } catch {
      // The list falls back to the full image.
    }
  }
}
