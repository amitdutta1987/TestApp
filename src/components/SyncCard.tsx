import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {SYNC} from '@/constants/config';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import {useSync} from '@/hooks/useSync';
import {formatDateTime} from '@/utils/format';

/**
 * Sync status and a manual trigger.
 *
 * "Offline" is shown as an ordinary state, not a failure — the app is built to
 * run without a connection, and a red error every time a shop's signal drops
 * would train the user to ignore the one that matters.
 */
export function SyncCard() {
  const {status, discrepancies, conflicts, syncNow} = useSync();
  const configured = SYNC.baseUrl.length > 0 && SYNC.apiKey.length > 0;

  return (
    <Card>
      <Text style={styles.title}>Cloud sync</Text>

      {!configured ? (
        <Text style={styles.body}>
          Not set up on this device. Add your sync server URL and key to
          src/constants/config.ts, then rebuild. Until then everything still works
          offline and stays on this phone.
        </Text>
      ) : (
        <>
          <View style={styles.statusRow}>
            <View style={[styles.dot, {backgroundColor: toneFor(status.state)}]} />
            <Text style={styles.statusText}>{describe(status)}</Text>
            {status.state === 'SYNCING' ? (
              <ActivityIndicator color={colors.primary} style={styles.spinner} />
            ) : null}
          </View>

          <Text style={styles.body}>
            Sales and stock are saved on this phone first and sent up when there is a
            connection, so the counter keeps working with no signal.
          </Text>

          <Button
            title="Sync now"
            fullWidth
            disabled={status.state === 'SYNCING'}
            style={styles.action}
            onPress={() => void syncNow()}
          />
        </>
      )}

      {duplicates(conflicts).length > 0 ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>Same barcode used twice</Text>
          <Text style={styles.warningBody}>
            The same barcode was given to different products on two devices. Both products
            were kept and nothing was lost, but one had its barcode changed so scanning still
            finds a single item. Open them and merge them by hand.
          </Text>
          {duplicates(conflicts).map(item => (
            <Text key={item.renamedProductId} style={styles.warningItem}>
              • {item.barcode} — one copy is now {item.renamedTo}
            </Text>
          ))}
        </View>
      ) : null}

      {discrepancies.length > 0 ? (
        <View style={styles.warning}>
          <Text style={styles.warningTitle}>Stock needs checking</Text>
          <Text style={styles.warningBody}>
            {discrepancies.length === 1 ? 'This product was' : 'These products were'} sold on
            more than one device while they were offline, so more units were sold than were in
            stock. Count what is actually on the shelf and use Stock count to correct it.
          </Text>
          {discrepancies.map(item => (
            <Text key={item.productId} style={styles.warningItem}>
              • {item.productName} — short by {Math.abs(item.ledgerQuantity)}
            </Text>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Narrowed here so the JSX above stays readable. */
function duplicates(
  conflicts: ReturnType<typeof useSync>['conflicts'],
): Extract<ReturnType<typeof useSync>['conflicts'][number], {kind: 'DUPLICATE_BARCODE'}>[] {
  return conflicts.filter(
    (item): item is Extract<typeof item, {kind: 'DUPLICATE_BARCODE'}> =>
      item.kind === 'DUPLICATE_BARCODE',
  );
}

function toneFor(state: SyncStatusState): string {
  switch (state) {
    case 'IDLE':
      return colors.success;
    case 'SYNCING':
      return colors.primary;
    case 'OFFLINE':
      return colors.textMuted;
    case 'ERROR':
      return colors.danger;
  }
}

type SyncStatusState = ReturnType<typeof useSync>['status']['state'];

function describe(status: ReturnType<typeof useSync>['status']): string {
  switch (status.state) {
    case 'SYNCING':
      return 'Syncing…';
    case 'IDLE':
      return status.lastSyncAt
        ? `Up to date — last synced ${formatDateTime(status.lastSyncAt)}`
        : 'Up to date';
    case 'OFFLINE':
      return status.pendingChanges > 0
        ? `Offline — ${status.pendingChanges} change${
            status.pendingChanges === 1 ? '' : 's'
          } waiting to send`
        : 'Offline — nothing waiting to send';
    case 'ERROR':
      return status.pendingChanges > 0
        ? `${status.message} ${status.pendingChanges} change${
            status.pendingChanges === 1 ? '' : 's'
          } still waiting.`
        : status.message;
  }
}

const styles = StyleSheet.create({
  title: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  statusRow: {
    alignItems: 'center',
    flexDirection: 'row',
    marginTop: spacing.sm,
  },
  dot: {
    borderRadius: 5,
    height: 10,
    marginRight: spacing.sm,
    width: 10,
  },
  statusText: {
    color: colors.text,
    flexShrink: 1,
    fontSize: fontSize.sm,
  },
  spinner: {
    marginLeft: spacing.sm,
  },
  body: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.sm,
  },
  action: {
    marginTop: spacing.md,
  },
  warning: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  warningTitle: {
    color: colors.warning,
    fontSize: fontSize.sm,
    fontWeight: '800',
  },
  warningBody: {
    color: colors.text,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.xs,
  },
  warningItem: {
    color: colors.text,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
});
