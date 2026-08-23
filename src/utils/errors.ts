/**
 * Typed errors so screens can show a specific, actionable message instead of a
 * generic "something went wrong". Every catch site in the UI narrows on `code`.
 */
export type AppErrorCode =
  | 'DB_ERROR'
  | 'PRODUCT_NOT_FOUND'
  | 'DUPLICATE_BARCODE'
  | 'INVALID_BARCODE'
  | 'INSUFFICIENT_STOCK'
  | 'INVALID_QUANTITY'
  | 'VALIDATION_ERROR'
  | 'CAMERA_PERMISSION_DENIED'
  | 'CAMERA_UNAVAILABLE'
  | 'BARCODE_NOT_DETECTED'
  | 'IMAGE_PROCESSING_FAILED'
  | 'IMAGE_STORAGE_FAILED'
  | 'EXPORT_FAILED'
  | 'BACKUP_FAILED'
  | 'RESTORE_FAILED'
  | 'INVALID_BACKUP'
  | 'CANCELLED'
  | 'UNKNOWN';

export class AppError extends Error {
  readonly code: AppErrorCode;
  /** Safe to render verbatim in a dialog. */
  readonly userMessage: string;
  readonly details?: unknown;

  constructor(
    code: AppErrorCode,
    userMessage: string,
    options?: {cause?: unknown; details?: unknown},
  ) {
    super(`${code}: ${userMessage}`);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    this.details = options?.details;
    if (options?.cause !== undefined) {
      (this as {cause?: unknown}).cause = options.cause;
    }
  }
}

export class InsufficientStockError extends AppError {
  readonly available: number;
  readonly requested: number;

  constructor(available: number, requested: number, productName?: string) {
    super(
      'INSUFFICIENT_STOCK',
      available === 0
        ? `${productName ?? 'This product'} is sold out.`
        : `Only ${available} unit${available === 1 ? '' : 's'} available, but ${requested} requested.`,
    );
    this.name = 'InsufficientStockError';
    this.available = available;
    this.requested = requested;
  }
}

export class DuplicateBarcodeError extends AppError {
  readonly barcode: string;
  readonly existingProductId: string;
  /** Carried so the "Product already exists" dialog can name it. */
  readonly existingName: string;

  constructor(barcode: string, existingProductId: string, productName: string) {
    super('DUPLICATE_BARCODE', `"${productName}" already uses barcode ${barcode}.`);
    this.name = 'DuplicateBarcodeError';
    this.barcode = barcode;
    this.existingProductId = existingProductId;
    this.existingName = productName;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Never let a raw stack trace reach the user. */
export function toUserMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (isAppError(error)) {
    return error.userMessage;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function wrapDbError(error: unknown, action: string): AppError {
  if (isAppError(error)) {
    return error;
  }
  return new AppError('DB_ERROR', `Could not ${action}. The local database reported an error.`, {
    cause: error,
  });
}
