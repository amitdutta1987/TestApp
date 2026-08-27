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
  schemaVersion: 3,
} as const;

export const APP = {
  name: 'Inventory',
  version: '1.0.0',
  currency: '₹',
  locale: 'en-IN',
} as const;

/**
 * Cloud sync.
 *
 * The app talks to its own Worker, never to Postgres or S3 directly: React
 * Native cannot open a TCP socket to Postgres, and any AWS or database
 * credential shipped inside an APK is readable by anyone who unzips it. The
 * Worker holds those and exposes only the endpoints below.
 *
 * `apiKey` is still embedded here and is therefore extractable from a release
 * APK. Unlike a database password it is revocable and reaches only these
 * endpoints — but it is the reason this build is not suitable for a public
 * release; see KNOWN_LIMITATIONS.md.
 */
export const SYNC = {
  /** Your deployed Worker, e.g. "https://inventory-sync.<subdomain>.workers.dev". */
  baseUrl: 'https://inventory-sync.sareessutaghor.workers.dev',
  /** Must match the SYNC_API_KEY secret set on the Worker. */
  apiKey: '4lRed0lejF+OnVZOUWK39XV5GA2WsWnvzWKTLTCZ2ug=',
  /** React Native's fetch has no timeout; the client applies this one. */
  requestTimeoutMs: 20000,
  /** How often a foreground app syncs when idle. */
  intervalMs: 60000,
  /** Rows per push and per pull page. */
  pushBatchSize: 500,
  pullPageSize: 200,
  /** Give up on an image after this many failed transfers. */
  maxImageAttempts: 5,
} as const;

/** Android FileProvider authority — must match AndroidManifest.xml. */
export const FILE_PROVIDER_AUTHORITY = 'com.inventoryapp.provider';
