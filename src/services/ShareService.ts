import Share from 'react-native-share';
import {AppError} from '@/utils/errors';

/**
 * Hands a local file to Android's share sheet (Drive, Gmail, WhatsApp, Sheets…).
 * Everything is produced offline; sharing is the only step that involves other
 * apps, and it is always user-initiated.
 */
export class ShareService {
  async shareFile(
    absolutePath: string,
    options: {mimeType: string; title: string; fileName?: string},
  ): Promise<boolean> {
    const url = absolutePath.startsWith('file://') ? absolutePath : `file://${absolutePath}`;
    try {
      await Share.open({
        url,
        type: options.mimeType,
        title: options.title,
        subject: options.title,
        filename: options.fileName,
        failOnCancel: false,
      });
      return true;
    } catch (error) {
      // react-native-share still rejects on some OEM share sheets when the user
      // dismisses it, so a cancel must not surface as a failure.
      const message = (error as {message?: string} | null)?.message ?? '';
      if (/cancel/i.test(message)) {
        return false;
      }
      throw new AppError('EXPORT_FAILED', 'Could not open the share sheet for that file.', {
        cause: error,
      });
    }
  }
}

export const shareService = new ShareService();

export const MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
} as const;
