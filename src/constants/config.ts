/** Directory names inside the app-private documents folder. */
export const DIRS = {
  productImages: 'product-images',
  thumbnails: 'product-images/thumbs',
  exports: 'exports',
  backups: 'backups',
  temp: 'tmp',
} as const;

export const IMAGE = {
  /** Long-edge cap for stored product photos (spec: 1200–1600px). */
  maxDimension: 1600,
  quality: 82,
  /** Small enough to keep long inventory lists smooth. */
  thumbDimension: 240,
  thumbQuality: 70,
} as const;

export const LIST = {
  pageSize: 30,
  salesPageSize: 30,
  historyPageSize: 50,
} as const;

export const SCANNER = {
  /** Ignore repeat reads of the same code inside this window. */
  duplicateWindowMs: 2500,
  /** Freeze the camera briefly after a hit so it does not re-fire mid-navigation. */
  pauseAfterScanMs: 900,
} as const;

export const DB = {
  name: 'inventory.db',
  /** Bump only alongside a new entry in src/database/migrations. */
  schemaVersion: 1,
} as const;

export const APP = {
  name: 'Inventory',
  version: '1.0.0',
  currency: '₹',
  locale: 'en-IN',
} as const;

/** Android FileProvider authority — must match AndroidManifest.xml. */
export const FILE_PROVIDER_AUTHORITY = 'com.inventoryapp.provider';
