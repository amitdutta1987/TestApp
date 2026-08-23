import {useNavigation, useRoute} from '@react-navigation/native';
import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {Screen} from '@/components/Screen';
import {colors, fontSize, spacing} from '@/constants/theme';
import type {RootScreenProps} from '@/navigation/types';
import {formatBarcodeForDisplay, validateBarcode} from '@/utils/barcode';

/**
 * Where an unrecognised scan lands. The barcode is already in hand, so the
 * only useful next step is creating the product with it pre-filled.
 */
export function ScanResultScreen() {
  const navigation = useNavigation<RootScreenProps<'ScanResult'>['navigation']>();
  const {barcode} = useRoute<RootScreenProps<'ScanResult'>['route']>().params;

  const check = validateBarcode(barcode);

  return (
    <Screen>
      <View style={styles.body}>
        <Text style={styles.heading}>No product with this barcode</Text>

        <Card style={styles.card}>
          <Text style={styles.label}>Scanned barcode</Text>
          <Text style={styles.barcode} selectable>
            {formatBarcodeForDisplay(barcode)}
          </Text>
          {check.detectedFormat ? (
            <Text style={styles.format}>Looks like {check.detectedFormat.replace('_', '-')}</Text>
          ) : null}
          {check.warning ? <Text style={styles.warning}>{check.warning}</Text> : null}
        </Card>

        <Text style={styles.message}>
          Add it now and the barcode will be saved exactly as scanned, including any leading zeros.
        </Text>

        <Button
          title="Add this product"
          size="lg"
          fullWidth
          onPress={() => navigation.replace('ProductForm', {barcode})}
        />
        <Button
          title="Scan again"
          variant="secondary"
          fullWidth
          style={styles.secondary}
          onPress={() => navigation.replace('Scanner', {mode: 'lookup'})}
        />
        <Button
          title="Back"
          variant="ghost"
          fullWidth
          style={styles.secondary}
          onPress={() => navigation.navigate('Tabs')}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  heading: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    textAlign: 'center',
  },
  card: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  barcode: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
    letterSpacing: 2,
    marginTop: spacing.sm,
  },
  format: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  warning: {
    color: colors.warning,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  message: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    lineHeight: 22,
    marginBottom: spacing.xl,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
  secondary: {
    marginTop: spacing.sm,
  },
});
