import type {StockStatus} from '@/types';
import {AppError} from './errors';

/**
 * The single source of truth for stock status (spec §14). The value is also
 * denormalised into products.status so the inventory list can filter on an
 * index instead of computing it per row — both paths must agree, so everything
 * goes through this function.
 */
export function deriveStatus(quantity: number, minimumStock: number): StockStatus {
  if (quantity <= 0) {
    return 'SOLD_OUT';
  }
  if (quantity <= minimumStock) {
    return 'LOW_STOCK';
  }
  return 'IN_STOCK';
}

/** Rejects fractional, negative and absurd quantities before they reach SQL. */
export function assertValidQuantity(quantity: number, label = 'Quantity'): void {
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    throw new AppError('INVALID_QUANTITY', `${label} must be a whole number.`);
  }
  if (quantity <= 0) {
    throw new AppError('INVALID_QUANTITY', `${label} must be at least 1.`);
  }
  if (quantity > 1_000_000) {
    throw new AppError('INVALID_QUANTITY', `${label} is unrealistically large.`);
  }
}

export function assertValidPrice(price: number, label = 'Price'): void {
  if (!Number.isFinite(price) || price < 0) {
    throw new AppError('VALIDATION_ERROR', `${label} must be zero or more.`);
  }
  if (price > 100_000_000) {
    throw new AppError('VALIDATION_ERROR', `${label} is unrealistically large.`);
  }
}

/** Parses user input that may contain grouping separators or a currency symbol. */
export function parseNumericInput(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') {
    return null;
  }
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
