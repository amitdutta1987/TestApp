/**
 * Domain model for the offline inventory app.
 *
 * Everything here is storage-agnostic on purpose: repositories map SQLite rows
 * to these shapes, so a future backend can be swapped in behind the same types.
 */

/** Stock status, derived from quantity vs. minimum stock. Never set by hand. */
export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'SOLD_OUT';

/** Soft-delete flag. Inactive products stay in history but leave the pick lists. */
export type ProductLifecycle = 'ACTIVE' | 'INACTIVE';

export type InventoryTransactionType =
  | 'INITIAL_STOCK'
  | 'STOCK_IN'
  | 'SALE'
  | 'RETURN'
  | 'DAMAGE'
  | 'STOCK_ADJUSTMENT';

export interface Product {
  id: string;
  /** Always a string — barcodes may have significant leading zeros. */
  barcode: string;
  sku: string | null;
  name: string;
  category: string | null;
  brand: string | null;
  description: string | null;
  color: string | null;
  size: string | null;
  material: string | null;
  supplier: string | null;
  rackLocation: string | null;
  purchasePrice: number | null;
  sellingPrice: number;
  minimumStock: number;
  currentQuantity: number;
  status: StockStatus;
  lifecycle: ProductLifecycle;
  /** Relative path inside app-private storage, e.g. "product-images/abc.jpg". */
  primaryImage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: string;
  productId: string;
  imageUri: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface Sale {
  id: string;
  saleNumber: string;
  totalAmount: number;
  createdAt: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  barcode: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface SaleWithItems extends Sale {
  items: SaleItem[];
}

export interface InventoryTransaction {
  id: string;
  productId: string;
  type: InventoryTransactionType;
  /** Signed: negative for SALE/DAMAGE, positive for stock increases. */
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  referenceId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface InventoryTransactionWithProduct extends InventoryTransaction {
  productName: string;
  barcode: string;
}

/** Payload accepted by ProductRepository.create — id/status/timestamps are derived. */
export interface NewProductInput {
  barcode: string;
  name: string;
  sellingPrice: number;
  initialQuantity: number;
  sku?: string | null;
  category?: string | null;
  brand?: string | null;
  purchasePrice?: number | null;
  description?: string | null;
  color?: string | null;
  size?: string | null;
  material?: string | null;
  supplier?: string | null;
  rackLocation?: string | null;
  minimumStock?: number;
  primaryImage?: string | null;
  images?: string[];
}

/**
 * Editable product fields. Quantity is deliberately absent: stock only moves
 * through InventoryService so every change leaves an audit trail.
 */
export type ProductUpdateInput = Partial<
  Omit<NewProductInput, 'initialQuantity' | 'images'>
>;

export interface ProductFilter {
  search?: string;
  category?: string | null;
  status?: StockStatus | null;
  includeInactive?: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface DashboardStats {
  totalProducts: number;
  totalUnits: number;
  lowStockCount: number;
  soldOutCount: number;
  todayItemsSold: number;
  todayRevenue: number;
  inventoryValueAtCost: number;
  inventoryValueAtRetail: number;
}

export type BarcodeFormat =
  | 'EAN_13'
  | 'EAN_8'
  | 'UPC_A'
  | 'UPC_E'
  | 'CODE_128'
  | 'CODE_39'
  | 'CODE_93'
  | 'ITF'
  | 'CODABAR'
  | 'QR_CODE'
  | 'DATA_MATRIX'
  | 'PDF_417'
  | 'AZTEC'
  | 'UNKNOWN';

export interface BarcodeResult {
  value: string;
  format: BarcodeFormat;
  /** Normalised 0..1 bounding box, when the detector reports one. */
  bounds?: {x: number; y: number; width: number; height: number};
}

/** Which stage of the image pipeline produced a hit — surfaced in the UI. */
export type ImageScanStrategy =
  | 'FULL_IMAGE'
  | 'UPSCALED'
  | 'ROTATED'
  | 'TILED'
  | 'MANUAL_CROP';

export interface ImageScanOutcome {
  barcode: BarcodeResult | null;
  strategy: ImageScanStrategy | null;
  /** Every strategy attempted, in order — used for the "why did it fail" hint. */
  attempts: ImageScanStrategy[];
  imageUri: string;
}

export interface SaleLineInput {
  productId: string;
  quantity: number;
}

export interface SaleResult {
  sale: Sale;
  items: SaleItem[];
  /** Post-sale stock, keyed by product id. */
  remainingStock: Record<string, number>;
}

export interface DateRange {
  from: string;
  to: string;
}

export interface BackupMetadata {
  appName: string;
  appVersion: string;
  schemaVersion: number;
  createdAt: string;
  deviceInfo: string;
  counts: {
    products: number;
    productImages: number;
    sales: number;
    saleItems: number;
    inventoryTransactions: number;
    imageFiles: number;
  };
  /** Every image path the database refers to, so restore can verify the archive. */
  referencedImages: string[];
  /** Referenced files that were already missing from this device at backup time. */
  missingImages: string[];
}

export interface BackupValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: BackupMetadata | null;
}
