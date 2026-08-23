import {errorCodes, isErrorWithCode, keepLocalCopy, pick, types} from '@react-native-documents/picker';
import React, {useCallback, useState} from 'react';
import {ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {Screen} from '@/components/Screen';
import {APP} from '@/constants/config';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import {clearAllTables} from '@/database/database';
import {useAsyncData} from '@/hooks/useAsyncData';
import {StatsRepository} from '@/repositories/StatsRepository';
import {backupService} from '@/services/BackupService';
import {excelExportService} from '@/services/ExcelExportService';
import {imageStorageService} from '@/services/ImageStorageService';
import {MIME, shareService} from '@/services/ShareService';
import {toUserMessage} from '@/utils/errors';
import {formatDateTime, formatFileSize, formatNumber} from '@/utils/format';

const stats = new StatsRepository();

type Busy = 'export' | 'backup' | 'restore' | 'clear' | null;

interface Overview {
  counts: Record<string, number>;
  backups: Array<{name: string; path: string; size: number; mtime: number}>;
}

const COUNT_LABELS: Array<[string, string]> = [
  ['products', 'Products'],
  ['product_images', 'Product photos'],
  ['sales', 'Sales'],
  ['sale_items', 'Sale lines'],
  ['inventory_transactions', 'Stock movements'],
];

export function SettingsScreen() {
  const [busy, setBusy] = useState<Busy>(null);

  const load = useCallback(async (): Promise<Overview> => {
    const [counts, backups] = await Promise.all([
      stats.tableCounts(),
      backupService.listBackups(),
    ]);
    return {counts, backups};
  }, []);

  const {data, error, reload} = useAsyncData<Overview>(load, []);

  const exportExcel = async () => {
    setBusy('export');
    try {
      const result = await excelExportService.exportToExcel();
      await excelExportService.pruneOldExports();
      Alert.alert(
        'Excel file created',
        `${result.fileName} (${formatFileSize(result.sizeBytes)})`,
        [
          {text: 'Done', style: 'cancel'},
          {
            text: 'Share',
            onPress: () => {
              void shareService.shareFile(result.absolutePath, {
                mimeType: MIME.xlsx,
                title: 'Inventory export',
                fileName: result.fileName,
              });
            },
          },
        ],
      );
    } catch (caught) {
      Alert.alert('Export failed', toUserMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const createBackup = async () => {
    setBusy('backup');
    try {
      const result = await backupService.createBackup();
      const {counts} = result.metadata;
      const missing = result.metadata.missingImages.length;
      Alert.alert(
        'Backup created',
        `${result.fileName}\n${formatFileSize(result.sizeBytes)}\n\n` +
          `${counts.products} products · ${counts.sales} sales · ${counts.imageFiles} photos` +
          (missing > 0
            ? `\n\nWarning: ${missing} photo file${missing === 1 ? '' : 's'} referenced by the database ${missing === 1 ? 'is' : 'are'} missing from this device and could not be included.`
            : ''),
        [
          {text: 'Done', style: 'cancel', onPress: () => void reload()},
          {
            text: 'Share',
            onPress: () => {
              void shareService.shareFile(result.absolutePath, {
                mimeType: MIME.zip,
                title: 'Inventory backup',
                fileName: result.fileName,
              });
              void reload();
            },
          },
        ],
      );
    } catch (caught) {
      Alert.alert('Backup failed', toUserMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  /** Shared by "Restore from a file" and by tapping a backup in the list. */
  const restoreFrom = async (uri: string, label: string) => {
    setBusy('restore');
    try {
      const report = await backupService.validateBackup(uri);
      if (!report.valid || !report.metadata) {
        Alert.alert('This backup cannot be used', report.errors.join('\n'));
        return;
      }
      const {metadata} = report;
      const summary =
        `${label}\n\n` +
        `Created ${formatDateTime(metadata.createdAt)}\n` +
        `${metadata.counts.products} products · ${metadata.counts.sales} sales · ` +
        `${metadata.counts.imageFiles} photos` +
        (report.warnings.length > 0 ? `\n\n${report.warnings.join('\n')}` : '');

      await new Promise<void>(resolve => {
        Alert.alert(
          'Replace all current data?',
          `${summary}\n\nEverything currently in the app will be replaced by this backup. A safety copy of your current data is made first.`,
          [
            {text: 'Cancel', style: 'cancel', onPress: () => resolve()},
            {
              text: 'Restore',
              style: 'destructive',
              onPress: () => {
                void (async () => {
                  try {
                    const result = await backupService.restoreBackup(uri);
                    Alert.alert(
                      'Restore complete',
                      `${result.metadata.counts.products} products and ${result.imagesRestored} photos were restored.` +
                        (result.imagesMissing.length > 0
                          ? `\n\n${result.imagesMissing.length} photo file${result.imagesMissing.length === 1 ? '' : 's'} could not be found in the archive.`
                          : ''),
                    );
                    await reload();
                  } catch (caught) {
                    Alert.alert('Restore failed', toUserMessage(caught));
                  } finally {
                    resolve();
                  }
                })();
              },
            },
          ],
          {cancelable: false},
        );
      });
    } catch (caught) {
      Alert.alert('Restore failed', toUserMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const pickAndRestore = async () => {
    try {
      const [picked] = await pick({type: [types.zip, types.allFiles]});
      // Android hands back a content:// uri that the unzip native module cannot
      // open, so it is copied into app storage first.
      const [copy] = await keepLocalCopy({
        files: [{uri: picked.uri, fileName: picked.name ?? 'backup.zip'}],
        destination: 'cachesDirectory',
      });
      if (copy.status !== 'success') {
        Alert.alert('Could not open that file', copy.copyError);
        return;
      }
      await restoreFrom(copy.localUri, picked.name ?? 'Selected file');
    } catch (caught) {
      if (isErrorWithCode(caught) && caught.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      Alert.alert('Could not open that file', toUserMessage(caught));
    }
  };

  const clearAllData = () => {
    Alert.alert(
      'Clear all data?',
      'This permanently deletes every product, sale, stock movement and photo on this device. It cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Continue',
          style: 'destructive',
          onPress: () =>
            Alert.alert(
              'Last chance',
              'Create a backup first if there is anything you want to keep. Delete everything now?',
              [
                {text: 'Cancel', style: 'cancel'},
                {
                  text: 'Delete everything',
                  style: 'destructive',
                  onPress: () => {
                    void (async () => {
                      setBusy('clear');
                      try {
                        await clearAllTables();
                        // No product references any file now, so every stored
                        // image is an orphan and gets swept.
                        await imageStorageService.deleteOrphans([]);
                        await reload();
                        Alert.alert('All data cleared', 'The app is back to a clean state.');
                      } catch (caught) {
                        Alert.alert('Could not clear the data', toUserMessage(caught));
                      } finally {
                        setBusy(null);
                      }
                    })();
                  },
                },
              ],
            ),
        },
      ],
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Export</Text>
        <Card>
          <Text style={styles.cardTitle}>Excel spreadsheet</Text>
          <Text style={styles.cardBody}>
            A real .xlsx file with Products, Sales, Inventory Transactions and Summary sheets.
            Created on the phone and shareable to Drive, Gmail or Sheets.
          </Text>
          <Button
            title="Export to Excel"
            fullWidth
            loading={busy === 'export'}
            disabled={busy !== null}
            style={styles.action}
            onPress={() => void exportExcel()}
          />
        </Card>

        <Text style={styles.sectionTitle}>Backup and restore</Text>
        <Card>
          <Text style={styles.cardTitle}>Create a backup</Text>
          <Text style={styles.cardBody}>
            A .zip containing the database and every product photo. Save it somewhere off the
            phone — a backup on a lost phone is no backup at all.
          </Text>
          <Button
            title="Create backup"
            fullWidth
            loading={busy === 'backup'}
            disabled={busy !== null}
            style={styles.action}
            onPress={() => void createBackup()}
          />
          <Button
            title="Restore from a file"
            variant="secondary"
            fullWidth
            loading={busy === 'restore'}
            disabled={busy !== null}
            style={styles.action}
            onPress={() => void pickAndRestore()}
          />
        </Card>

        {data && data.backups.length > 0 ? (
          <Card style={styles.listCard}>
            <Text style={styles.cardTitle}>Backups on this device</Text>
            {data.backups.map(backup => (
              <View key={backup.path} style={styles.backupRow}>
                <View style={styles.backupBody}>
                  <Text style={styles.backupName} numberOfLines={1}>
                    {backup.name}
                  </Text>
                  <Text style={styles.backupMeta}>
                    {formatFileSize(backup.size)}
                    {backup.mtime > 0
                      ? ` · ${formatDateTime(new Date(backup.mtime).toISOString())}`
                      : ''}
                  </Text>
                </View>
                <Pressable
                  disabled={busy !== null}
                  onPress={() => {
                    void shareService.shareFile(backup.path, {
                      mimeType: MIME.zip,
                      title: 'Inventory backup',
                      fileName: backup.name,
                    });
                  }}
                  style={({pressed}) => [styles.smallAction, pressed && styles.pressed]}>
                  <Text style={styles.smallActionLabel}>Share</Text>
                </Pressable>
                <Pressable
                  disabled={busy !== null}
                  onPress={() => void restoreFrom(backup.path, backup.name)}
                  style={({pressed}) => [styles.smallAction, pressed && styles.pressed]}>
                  <Text style={[styles.smallActionLabel, styles.restoreLabel]}>Restore</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        ) : null}

        <Text style={styles.sectionTitle}>Stored data</Text>
        <Card>
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : data ? (
            COUNT_LABELS.map(([key, label]) => (
              <View key={key} style={styles.statRow}>
                <Text style={styles.statLabel}>{label}</Text>
                <Text style={styles.statValue}>{formatNumber(data.counts[key] ?? 0)}</Text>
              </View>
            ))
          ) : (
            <ActivityIndicator color={colors.primary} />
          )}
        </Card>

        <Text style={styles.sectionTitle}>Danger zone</Text>
        <Card style={styles.danger}>
          <Text style={styles.cardTitle}>Clear all data</Text>
          <Text style={styles.cardBody}>
            Deletes every product, sale, stock movement and photo. There is no undo.
          </Text>
          <Button
            title="Clear all data"
            variant="danger"
            fullWidth
            loading={busy === 'clear'}
            disabled={busy !== null}
            style={styles.action}
            onPress={clearAllData}
          />
        </Card>

        <Text style={styles.footer}>
          {APP.name} {APP.version} · works fully offline · no account required
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
    textTransform: 'uppercase',
  },
  cardTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  cardBody: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
  },
  listCard: {
    marginTop: spacing.sm,
  },
  backupRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  backupBody: {
    flex: 1,
  },
  backupName: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  backupMeta: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    marginTop: 2,
  },
  smallAction: {
    borderRadius: radius.sm,
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.6,
  },
  smallActionLabel: {
    color: colors.primary,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  restoreLabel: {
    color: colors.warning,
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  statValue: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSize.sm,
  },
  danger: {
    borderColor: colors.dangerSoft,
  },
  footer: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});
