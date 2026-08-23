import type {BarcodeFormat} from '@/types';

/**
 * Barcodes are ALWAYS strings. "001234567890" and 1234567890 are different
 * products, so nothing in this module may go through Number().
 */

// Hardware scanners append CR/LF and occasionally NUL. Strip control characters
// and whitespace, but never touch the digits themselves.
// eslint-disable-next-line no-control-regex
const CONTROL_AND_SPACE = /[\x00-\x1F\x7F\s]/g;

export function normalizeBarcode(raw: string): string {
  return raw.replace(CONTROL_AND_SPACE, '');
}

export interface BarcodeValidation {
  valid: boolean;
  /** Why it was rejected. Only set when `valid` is false. */
  reason?: string;
  /** Non-blocking problem, e.g. a GTIN whose check digit does not add up. */
  warning?: string;
  /** Set when the length and digits identify a specific symbology. */
  detectedFormat?: BarcodeFormat;
}

/**
 * Modulo-10 check digit shared by EAN-13, EAN-8, UPC-A and ITF-14.
 * Weights alternate 3/1 from the rightmost data digit leftwards.
 */
export function isValidGtinCheckDigit(digits: string): boolean {
  if (!/^\d+$/.test(digits) || digits.length < 8) {
    return false;
  }
  const body = digits.slice(0, -1);
  const expected = Number(digits[digits.length - 1]);
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === expected;
}

/**
 * Permissive by design. Retail stock in the wild includes in-house Code 128
 * labels and QR payloads, so we reject only what cannot be a barcode at all and
 * merely warn on a bad GTIN check digit — blocking there would lock users out
 * of their own pre-printed labels.
 */
export function validateBarcode(raw: string): BarcodeValidation {
  const value = normalizeBarcode(raw);

  if (value.length === 0) {
    return {valid: false, reason: 'Barcode cannot be empty.'};
  }
  if (value.length < 4) {
    return {valid: false, reason: 'Barcode is too short to be valid.'};
  }
  if (value.length > 128) {
    return {valid: false, reason: 'Barcode is too long.'};
  }

  if (/^\d+$/.test(value)) {
    const gtin: Partial<Record<number, BarcodeFormat>> = {
      8: 'EAN_8',
      12: 'UPC_A',
      13: 'EAN_13',
      14: 'ITF',
    };
    const detectedFormat = gtin[value.length];
    if (detectedFormat) {
      return {
        valid: true,
        detectedFormat,
        warning: isValidGtinCheckDigit(value)
          ? undefined
          : `Check digit does not match ${detectedFormat.replace('_', '-')}. Saved as entered.`,
      };
    }
  }

  return {valid: true, detectedFormat: 'CODE_128'};
}

/** True when the string parses as a standards-compliant retail GTIN. */
export function isRetailGtin(raw: string): boolean {
  const value = normalizeBarcode(raw);
  return (
    /^\d+$/.test(value) && [8, 12, 13, 14].includes(value.length) && isValidGtinCheckDigit(value)
  );
}

/** Groups digits for readability. Never mutates the stored value. */
export function formatBarcodeForDisplay(barcode: string): string {
  if (/^\d{13}$/.test(barcode)) {
    return `${barcode.slice(0, 1)} ${barcode.slice(1, 7)} ${barcode.slice(7)}`;
  }
  if (/^\d{12}$/.test(barcode)) {
    return `${barcode.slice(0, 1)} ${barcode.slice(1, 6)} ${barcode.slice(6, 11)} ${barcode.slice(11)}`;
  }
  return barcode;
}

const ML_KIT_FORMAT_MAP: Record<string, BarcodeFormat> = {
  ean13: 'EAN_13',
  ean8: 'EAN_8',
  upca: 'UPC_A',
  upce: 'UPC_E',
  code128: 'CODE_128',
  code39: 'CODE_39',
  code93: 'CODE_93',
  itf: 'ITF',
  itf14: 'ITF',
  codabar: 'CODABAR',
  qr: 'QR_CODE',
  qrcode: 'QR_CODE',
  datamatrix: 'DATA_MATRIX',
  pdf417: 'PDF_417',
  aztec: 'AZTEC',
};

/** Maps the various spellings used by VisionCamera / ML Kit onto our enum. */
export function toBarcodeFormat(raw: string | number | undefined | null): BarcodeFormat {
  if (raw === undefined || raw === null) {
    return 'UNKNOWN';
  }
  const key = String(raw).toLowerCase().replace(/[-_\s]/g, '');
  return ML_KIT_FORMAT_MAP[key] ?? 'UNKNOWN';
}
