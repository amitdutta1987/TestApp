import ImagePicker, {type Image as PickedImage} from 'react-native-image-crop-picker';
import {AppError} from '@/utils/errors';
import {permissionService} from './PermissionService';

export interface PickedPhoto {
  uri: string;
  width: number;
  height: number;
}

function isCancellation(error: unknown): boolean {
  const code = (error as {code?: string} | null)?.code;
  return code === 'E_PICKER_CANCELLED' || code === 'E_NO_IMAGE_DATA_FOUND';
}

function toPickedPhoto(image: PickedImage): PickedPhoto {
  return {uri: image.path, width: image.width, height: image.height};
}

/**
 * Photos are picked at full resolution here on purpose: the barcode-detection
 * ladder needs every pixel it can get. Downscaling to storage size happens later,
 * in ImageStorageService, once detection is done.
 */
export class ImagePickerService {
  async takePhoto(): Promise<PickedPhoto | null> {
    const permission = await permissionService.requestCamera();
    if (permission !== 'granted') {
      throw new AppError(
        'CAMERA_PERMISSION_DENIED',
        'Camera permission is required to take a product photo.',
      );
    }
    try {
      const image = await ImagePicker.openCamera({mediaType: 'photo', cropping: false});
      return toPickedPhoto(image);
    } catch (error) {
      if (isCancellation(error)) {
        return null;
      }
      throw new AppError('IMAGE_PROCESSING_FAILED', 'Could not open the camera.', {cause: error});
    }
  }

  async pickFromGallery(): Promise<PickedPhoto | null> {
    const permission = await permissionService.requestPhotoLibrary();
    if (permission === 'blocked') {
      throw new AppError(
        'IMAGE_PROCESSING_FAILED',
        'Photo access is blocked. Enable it in Settings to pick a product image.',
      );
    }
    try {
      const image = await ImagePicker.openPicker({mediaType: 'photo', cropping: false});
      return toPickedPhoto(image);
    } catch (error) {
      if (isCancellation(error)) {
        return null;
      }
      throw new AppError('IMAGE_PROCESSING_FAILED', 'Could not open the gallery.', {cause: error});
    }
  }

  async pickManyFromGallery(maxFiles = 5): Promise<PickedPhoto[]> {
    const permission = await permissionService.requestPhotoLibrary();
    if (permission === 'blocked') {
      throw new AppError(
        'IMAGE_PROCESSING_FAILED',
        'Photo access is blocked. Enable it in Settings to pick product images.',
      );
    }
    try {
      const images = await ImagePicker.openPicker({
        mediaType: 'photo',
        multiple: true,
        maxFiles,
        cropping: false,
      });
      return (Array.isArray(images) ? images : [images]).map(toPickedPhoto);
    } catch (error) {
      if (isCancellation(error)) {
        return [];
      }
      throw new AppError('IMAGE_PROCESSING_FAILED', 'Could not open the gallery.', {cause: error});
    }
  }

  /**
   * Free-form crop used as the barcode fallback: automatic detection has failed,
   * so the user drags a box around the barcode and only that region is rescanned.
   */
  async cropForBarcode(uri: string): Promise<PickedPhoto | null> {
    try {
      const image = await ImagePicker.openCropper({
        path: uri,
        mediaType: 'photo',
        freeStyleCropEnabled: true,
        cropperToolbarTitle: 'Select the barcode',
        cropperActiveWidgetColor: '#1B5E9C',
        cropperToolbarColor: '#134672',
        cropperToolbarWidgetColor: '#FFFFFF',
        compressImageQuality: 1,
        // Deliberately generous: cropping down then re-enlarging is what makes
        // a small barcode legible to the detector.
        width: 1200,
        height: 1200,
      });
      return toPickedPhoto(image);
    } catch (error) {
      if (isCancellation(error)) {
        return null;
      }
      throw new AppError('IMAGE_PROCESSING_FAILED', 'Could not open the crop tool.', {
        cause: error,
      });
    }
  }

  /** Clears the picker's temp files once photos have been copied into storage. */
  async cleanTempFiles(): Promise<void> {
    try {
      await ImagePicker.clean();
    } catch {
      // Best effort — the OS reclaims the cache directory regardless.
    }
  }
}

export const imagePickerService = new ImagePickerService();
