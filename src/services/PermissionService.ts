import {Alert, Linking, PermissionsAndroid, Platform} from 'react-native';
import {Camera} from 'react-native-vision-camera';

export type PermissionOutcome = 'granted' | 'denied' | 'blocked';

/**
 * Only the two permissions the app actually needs are ever requested:
 * CAMERA for scanning, and media read for picking an existing product photo.
 */
export class PermissionService {
  async requestCamera(): Promise<PermissionOutcome> {
    const current = Camera.getCameraPermissionStatus();
    if (current === 'granted') {
      return 'granted';
    }
    const result = await Camera.requestCameraPermission();
    if (result === 'granted') {
      return 'granted';
    }
    // VisionCamera reports 'denied' once the user has ticked "don't ask again",
    // at which point only the system settings screen can change it.
    return result === 'denied' ? 'blocked' : 'denied';
  }

  cameraStatus(): PermissionOutcome {
    return Camera.getCameraPermissionStatus() === 'granted' ? 'granted' : 'denied';
  }

  /**
   * Android 13+ replaced READ_EXTERNAL_STORAGE with READ_MEDIA_IMAGES, and
   * Android 14+ can grant partial access. The gallery picker itself handles the
   * photo-picker path, so this is only needed on older releases.
   */
  async requestPhotoLibrary(): Promise<PermissionOutcome> {
    if (Platform.OS !== 'android') {
      return 'granted';
    }
    const apiLevel = Number(Platform.Version);
    if (apiLevel >= 33) {
      // The system photo picker used by the gallery flow needs no permission.
      return 'granted';
    }
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
    );
    if (result === PermissionsAndroid.RESULTS.GRANTED) {
      return 'granted';
    }
    return result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ? 'blocked' : 'denied';
  }

  /** Standard "we need this, here's how to fix it" dialog. */
  showCameraDeniedDialog(onCancel?: () => void): void {
    Alert.alert(
      'Camera permission required',
      'Camera permission is required for barcode scanning. Enable it in Settings to continue.',
      [
        {text: 'Cancel', style: 'cancel', onPress: onCancel},
        {text: 'Open Settings', onPress: () => void Linking.openSettings()},
      ],
    );
  }
}

export const permissionService = new PermissionService();
