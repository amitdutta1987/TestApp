/**
 * Queue of product images awaiting transfer to or from object storage.
 *
 * The stored path doubles as the S3 object key. SQLite already holds a relative
 * path ("product-images/abc.jpg") precisely so it survives moving between
 * devices, and that same string is a valid, stable, globally-unique key — so no
 * column had to be added to products or product_images to hold a remote id.
 */
export const CREATE_IMAGE_QUEUE: string[] = [
  `CREATE TABLE IF NOT EXISTS image_sync_queue (
      path        TEXT PRIMARY KEY NOT NULL,
      direction   TEXT NOT NULL CHECK (direction IN ('UPLOAD','DOWNLOAD')),
      attempts    INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT,
      queued_at   TEXT NOT NULL
   ) WITHOUT ROWID;`,
];

export const CREATE_IMAGE_QUEUE_INDEXES: string[] = [
  'CREATE INDEX IF NOT EXISTS idx_image_queue_direction ON image_sync_queue(direction, attempts);',
];
