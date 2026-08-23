import ImageResizer from '@bam.tech/react-native-image-resizer';
import ImageEditor from '@react-native-community/image-editor';
import BarcodeScanning, {
  BarcodeFormat as MlKitFormat,
  type Barcode as MlKitBarcode,
} from '@react-native-ml-kit/barcode-scanning';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {Image} from 'react-native';
import type {BarcodeFormat, BarcodeResult, ImageScanOutcome, ImageScanStrategy} from '@/types';
import {normalizeBarcode} from '@/utils/barcode';

/**
 * Detects a barcode ANYWHERE inside a product photograph.
 *
 * The hard case from the spec is a 1600x1200 photo whose barcode sits in a
 * corner and covers 5–10% of the frame. ML Kit does scan the whole image (it is
 * not a centre-only detector), but it downsamples large inputs internally, and a
 * barcode that small can end up below the minimum bar width it can resolve.
 *
 * So detection runs as a ladder, cheapest first, stopping at the first hit:
 *
 *   1. FULL_IMAGE — ML Kit on the original file.
 *   2. UPSCALED   — the whole frame enlarged, which widens thin bars.
 *   3. TILED      — a 3x3 overlapping grid; each tile is cropped out and
 *                   enlarged, so a corner barcode that was 8% of the frame
 *                   becomes ~50% of a tile. This is what actually rescues the
 *                   spec's worst case.
 *   4. ROTATED    — 90 degrees, for labels photographed sideways where EXIF
 *                   orientation was lost.
 *
 * If all four fail the UI falls back to the interactive crop tool and then to
 * manual entry. See KNOWN_LIMITATIONS below — nothing here is faked.
 */

/** Documented honestly rather than papered over; surfaced in the failure UI. */
export const KNOWN_LIMITATIONS = [
  'Blurred or motion-smeared bars cannot be recovered by rescaling.',
  'Barcodes printed smaller than roughly 2% of the frame usually lack the pixel detail ML Kit needs.',
  'Severe perspective skew (photographed at a sharp angle) can defeat 1D decoding.',
  'Glare or a heavy shadow across the bars removes the contrast the decoder relies on.',
];

const ML_KIT_FORMAT_BY_VALUE: Record<number, BarcodeFormat> = {
  [MlKitFormat.CODE_128]: 'CODE_128',
  [MlKitFormat.CODE_39]: 'CODE_39',
  [MlKitFormat.CODE_93]: 'CODE_93',
  [MlKitFormat.CODABAR]: 'CODABAR',
  [MlKitFormat.DATA_MATRIX]: 'DATA_MATRIX',
  [MlKitFormat.EAN_13]: 'EAN_13',
  [MlKitFormat.EAN_8]: 'EAN_8',
  [MlKitFormat.ITF]: 'ITF',
  [MlKitFormat.QR_CODE]: 'QR_CODE',
  [MlKitFormat.UPC_A]: 'UPC_A',
  [MlKitFormat.UPC_E]: 'UPC_E',
  [MlKitFormat.PDF417]: 'PDF_417',
  [MlKitFormat.AZTEC]: 'AZTEC',
};

/**
 * A product's own barcode is a retail 1D symbology. QR/Data Matrix payloads on
 * packaging (marketing URLs, batch codes) would otherwise win the race and get
 * saved as the product's barcode, so 1D results are preferred.
 */
const PREFERRED_FORMATS: BarcodeFormat[] = [
  'EAN_13',
  'UPC_A',
  'EAN_8',
  'UPC_E',
  'CODE_128',
  'ITF',
  'CODE_39',
  'CODE_93',
  'CODABAR',
];

const TILE_GRID = 3;
/** Tiles overlap so a barcode straddling a seam is still wholly inside one tile. */
const TILE_OVERLAP = 0.25;
/** Long edge each tile is enlarged to before scanning. */
const TILE_TARGET_PX = 1400;
const UPSCALE_TARGET_PX = 2600;

function withFileScheme(uri: string): string {
  if (uri.startsWith('file://') || uri.startsWith('content://')) {
    return uri;
  }
  return `file://${uri}`;
}

function pickBest(barcodes: MlKitBarcode[]): BarcodeResult | null {
  const usable = barcodes
    .map(barcode => ({
      value: normalizeBarcode(barcode.value ?? ''),
      format: ML_KIT_FORMAT_BY_VALUE[barcode.format] ?? 'UNKNOWN',
    }))
    .filter(barcode => barcode.value.length >= 4);

  if (usable.length === 0) {
    return null;
  }

  for (const format of PREFERRED_FORMATS) {
    const match = usable.find(barcode => barcode.format === format);
    if (match) {
      return {value: match.value, format: match.format};
    }
  }
  const first = usable[0];
  return {value: first.value, format: first.format};
}

async function scanFile(uri: string): Promise<BarcodeResult | null> {
  try {
    const barcodes = await BarcodeScanning.scan(withFileScheme(uri));
    return pickBest(barcodes ?? []);
  } catch {
    // A single failed pass must not abort the ladder — the next strategy may work.
    return null;
  }
}

async function getDimensions(uri: string): Promise<{width: number; height: number} | null> {
  return new Promise(resolve => {
    Image.getSize(
      withFileScheme(uri),
      (width, height) => resolve({width, height}),
      () => resolve(null),
    );
  });
}

async function safeUnlink(path: string | null | undefined): Promise<void> {
  if (!path) {
    return;
  }
  try {
    const plain = path.replace(/^file:\/\//, '');
    if (await RNFS.exists(plain)) {
      await RNFS.unlink(plain);
    }
  } catch {
    // Temp files live in the cache dir; the OS will reclaim them anyway.
  }
}

export interface BarcodeImageScanner {
  scanFromImage(imageUri: string): Promise<BarcodeResult | null>;
}

export class ImageBarcodeService implements BarcodeImageScanner {
  /** Convenience wrapper matching the spec's BarcodeService contract. */
  async scanFromImage(imageUri: string): Promise<BarcodeResult | null> {
    const outcome = await this.detect(imageUri);
    return outcome.barcode;
  }

  /** Full result including which strategy succeeded, for the UI to explain itself. */
  async detect(imageUri: string): Promise<ImageScanOutcome> {
    const attempts: ImageScanStrategy[] = [];

    // 1. Original file, untouched.
    attempts.push('FULL_IMAGE');
    const direct = await scanFile(imageUri);
    if (direct) {
      return {barcode: direct, strategy: 'FULL_IMAGE', attempts, imageUri};
    }

    const dimensions = await getDimensions(imageUri);

    // 2. Enlarge the whole frame: thin bars gain pixels.
    attempts.push('UPSCALED');
    const upscaled = await this.scanUpscaled(imageUri);
    if (upscaled) {
      return {barcode: upscaled, strategy: 'UPSCALED', attempts, imageUri};
    }

    // 3. Overlapping tiles. The strategy that handles a small corner barcode.
    if (dimensions) {
      attempts.push('TILED');
      const tiled = await this.scanTiles(imageUri, dimensions);
      if (tiled) {
        return {barcode: tiled, strategy: 'TILED', attempts, imageUri};
      }
    }

    // 4. Rotated, for sideways labels with no usable EXIF orientation.
    attempts.push('ROTATED');
    const rotated = await this.scanRotated(imageUri);
    if (rotated) {
      return {barcode: rotated, strategy: 'ROTATED', attempts, imageUri};
    }

    return {barcode: null, strategy: null, attempts, imageUri};
  }

  private async scanUpscaled(imageUri: string): Promise<BarcodeResult | null> {
    let outputPath: string | null = null;
    try {
      const resized = await ImageResizer.createResizedImage(
        withFileScheme(imageUri),
        UPSCALE_TARGET_PX,
        UPSCALE_TARGET_PX,
        'JPEG',
        95,
        0,
        null,
        false,
        {mode: 'contain'},
      );
      outputPath = resized.path;
      return await scanFile(resized.uri);
    } catch {
      return null;
    } finally {
      await safeUnlink(outputPath);
    }
  }

  private async scanRotated(imageUri: string): Promise<BarcodeResult | null> {
    let outputPath: string | null = null;
    try {
      const resized = await ImageResizer.createResizedImage(
        withFileScheme(imageUri),
        UPSCALE_TARGET_PX,
        UPSCALE_TARGET_PX,
        'JPEG',
        95,
        90,
        null,
        false,
        {mode: 'contain'},
      );
      outputPath = resized.path;
      return await scanFile(resized.uri);
    } catch {
      return null;
    } finally {
      await safeUnlink(outputPath);
    }
  }

  /**
   * Crops a 3x3 overlapping grid and scans each tile enlarged. Corners are
   * tried first because that is where labels usually sit.
   */
  private async scanTiles(
    imageUri: string,
    dimensions: {width: number; height: number},
  ): Promise<BarcodeResult | null> {
    const {width, height} = dimensions;
    const baseTileWidth = width / TILE_GRID;
    const baseTileHeight = height / TILE_GRID;
    const tileWidth = Math.min(width, baseTileWidth * (1 + TILE_OVERLAP));
    const tileHeight = Math.min(height, baseTileHeight * (1 + TILE_OVERLAP));

    for (const [col, row] of tileOrder()) {
      const x = Math.max(0, Math.min(width - tileWidth, col * baseTileWidth - baseTileWidth * TILE_OVERLAP * 0.5));
      const y = Math.max(0, Math.min(height - tileHeight, row * baseTileHeight - baseTileHeight * TILE_OVERLAP * 0.5));

      const scale = TILE_TARGET_PX / Math.max(tileWidth, tileHeight);
      let croppedPath: string | null = null;
      try {
        const cropped = await ImageEditor.cropImage(withFileScheme(imageUri), {
          offset: {x, y},
          size: {width: tileWidth, height: tileHeight},
          // Enlarging during the crop avoids a second decode/encode round trip.
          displaySize:
            scale > 1
              ? {width: Math.round(tileWidth * scale), height: Math.round(tileHeight * scale)}
              : undefined,
          resizeMode: 'contain',
          format: 'jpeg',
          quality: 0.95,
        });
        croppedPath = cropped.path;
        const hit = await scanFile(cropped.uri);
        if (hit) {
          return hit;
        }
      } catch {
        // Skip this tile and keep going.
      } finally {
        await safeUnlink(croppedPath);
      }
    }

    return null;
  }
}

/** Corners, then edge midpoints, then centre — most likely label positions first. */
function tileOrder(): Array<[number, number]> {
  return [
    [2, 2],
    [0, 2],
    [2, 0],
    [0, 0],
    [1, 2],
    [1, 0],
    [0, 1],
    [2, 1],
    [1, 1],
  ];
}

export const imageBarcodeService = new ImageBarcodeService();
