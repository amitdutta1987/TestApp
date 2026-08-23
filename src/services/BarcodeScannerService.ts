import type {BarcodeResult} from '@/types';
import {navigate} from '@/navigation/navigationRef';
import {imageBarcodeService} from './ImageBarcodeService';

/** The contract from the spec, satisfied by BarcodeScannerService below. */
export interface BarcodeService {
  scanFromCamera(): Promise<BarcodeResult | null>;
  scanFromImage(imageUri: string): Promise<BarcodeResult | null>;
}

/**
 * Camera scanning needs a full-screen UI, but callers want a promise. This
 * bridge lets a caller `await scanFromCamera()` while the Scanner screen does
 * the work and settles the request.
 */
interface PendingRequest {
  resolve: (value: BarcodeResult | null) => void;
}

let pending: PendingRequest | null = null;

/** Called by ScannerScreen when it detects a code (or the user backs out). */
export function fulfilScanRequest(result: BarcodeResult | null): void {
  const request = pending;
  pending = null;
  request?.resolve(result);
}

export function hasPendingScanRequest(): boolean {
  return pending !== null;
}

/** VisionCamera code types, kept in one place so scanner and docs agree. */
export const SUPPORTED_CODE_TYPES = [
  'ean-13',
  'ean-8',
  'upc-a',
  'upc-e',
  'code-128',
  'code-39',
  'code-93',
  'itf',
  'codabar',
  'qr',
] as const;

export class BarcodeScannerService implements BarcodeService {
  /**
   * Opens the scanner and resolves with the first accepted code, or null if the
   * user backs out. Only one request can be in flight; a second supersedes the
   * first rather than leaking a promise that never settles.
   */
  scanFromCamera(): Promise<BarcodeResult | null> {
    if (pending) {
      pending.resolve(null);
      pending = null;
    }
    return new Promise<BarcodeResult | null>(resolve => {
      pending = {resolve};
      navigate('Scanner', {mode: 'request'});
    });
  }

  scanFromImage(imageUri: string): Promise<BarcodeResult | null> {
    return imageBarcodeService.scanFromImage(imageUri);
  }
}

export const barcodeScannerService = new BarcodeScannerService();
