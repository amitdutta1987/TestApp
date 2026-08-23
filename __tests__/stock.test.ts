import {AppError} from '@/utils/errors';
import {assertValidPrice, assertValidQuantity, deriveStatus, parseNumericInput} from '@/utils/stock';

describe('deriveStatus', () => {
  test('zero stock is SOLD_OUT regardless of the threshold', () => {
    expect(deriveStatus(0, 0)).toBe('SOLD_OUT');
    expect(deriveStatus(0, 10)).toBe('SOLD_OUT');
  });

  test('at or below the minimum is LOW_STOCK', () => {
    expect(deriveStatus(5, 5)).toBe('LOW_STOCK');
    expect(deriveStatus(3, 5)).toBe('LOW_STOCK');
  });

  test('above the minimum is IN_STOCK', () => {
    expect(deriveStatus(6, 5)).toBe('IN_STOCK');
    expect(deriveStatus(1, 0)).toBe('IN_STOCK');
  });

  test('the full transition as stock is sold down', () => {
    const minimum = 3;
    const statuses = [6, 5, 4, 3, 2, 1, 0].map(quantity => deriveStatus(quantity, minimum));
    expect(statuses).toEqual([
      'IN_STOCK',
      'IN_STOCK',
      'IN_STOCK',
      'LOW_STOCK',
      'LOW_STOCK',
      'LOW_STOCK',
      'SOLD_OUT',
    ]);
  });

  test('a negative quantity can never present as in stock', () => {
    expect(deriveStatus(-1, 5)).toBe('SOLD_OUT');
  });
});

describe('assertValidQuantity', () => {
  test('accepts positive whole numbers', () => {
    expect(() => assertValidQuantity(1)).not.toThrow();
    expect(() => assertValidQuantity(500)).not.toThrow();
  });

  test('rejects zero, negatives and fractions', () => {
    for (const bad of [0, -1, 2.5, NaN, Infinity]) {
      expect(() => assertValidQuantity(bad)).toThrow(AppError);
    }
  });

  test('rejects unrealistic quantities', () => {
    expect(() => assertValidQuantity(1_000_001)).toThrow(AppError);
  });
});

describe('assertValidPrice', () => {
  test('zero is a legitimate price', () => {
    expect(() => assertValidPrice(0)).not.toThrow();
  });

  test('negative prices are rejected', () => {
    expect(() => assertValidPrice(-0.01)).toThrow(AppError);
  });
});

describe('parseNumericInput', () => {
  test('strips currency symbols and grouping', () => {
    expect(parseNumericInput('₹1,250.50')).toBe(1250.5);
    expect(parseNumericInput('  99 ')).toBe(99);
  });

  test('returns null for input that is not yet a number', () => {
    expect(parseNumericInput('')).toBeNull();
    expect(parseNumericInput('-')).toBeNull();
    expect(parseNumericInput('.')).toBeNull();
    expect(parseNumericInput('abc')).toBeNull();
  });
});
