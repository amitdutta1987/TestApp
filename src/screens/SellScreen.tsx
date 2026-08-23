import {useNavigation, useRoute} from '@react-navigation/native';
import React, {useCallback, useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {ErrorState, LoadingState} from '@/components/EmptyState';
import {QuantityStepper} from '@/components/QuantityStepper';
import {Screen} from '@/components/Screen';
import {StatusBadge} from '@/components/StatusBadge';
import {colors, fontSize, spacing} from '@/constants/theme';
import {useAsyncData} from '@/hooks/useAsyncData';
import type {RootScreenProps} from '@/navigation/types';
import {ProductRepository} from '@/repositories/ProductRepository';
import {inventoryService} from '@/services/InventoryService';
import type {Product} from '@/types';
import {formatBarcodeForDisplay} from '@/utils/barcode';
import {toUserMessage} from '@/utils/errors';
import {formatCurrency} from '@/utils/format';

const products = new ProductRepository();

export function SellScreen() {
  const navigation = useNavigation<RootScreenProps<'Sell'>['navigation']>();
  const {productId} = useRoute<RootScreenProps<'Sell'>['route']>().params;

  const [quantity, setQuantity] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => products.requireById(productId), [productId]);
  const {data: product, loading, error, reload} = useAsyncData<Product>(load, [productId]);

  if (loading && !product) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (error || !product) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Product not found.'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const available = product.currentQuantity;
  const total = product.sellingPrice * quantity;

  const confirmSale = async () => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      // One SQLite transaction: stock, sale, sale item and the audit row all
      // land together, or none of them do.
      const result = await inventoryService.sellProduct(product.id, quantity);
      const remaining = result.remainingStock[product.id] ?? 0;
      Alert.alert(
        'Sale recorded',
        `${quantity} × ${product.name}\n${formatCurrency(result.sale.totalAmount)}\n\n${remaining} left in stock.`,
        [
          {
            text: 'Scan next',
            onPress: () => navigation.replace('Scanner', {mode: 'lookup'}),
          },
          {text: 'Done', style: 'cancel', onPress: () => navigation.goBack()},
        ],
      );
    } catch (caught) {
      Alert.alert('Sale not recorded', toUserMessage(caught));
      void reload();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.barcode}>{formatBarcodeForDisplay(product.barcode)}</Text>
          <View style={styles.metaRow}>
            <StatusBadge status={product.status} small />
            <Text style={styles.available}>{available} in stock</Text>
          </View>
        </Card>

        <View style={styles.stepper}>
          <QuantityStepper
            label="Quantity to sell"
            value={quantity}
            onChange={setQuantity}
            min={1}
            max={available}
          />
        </View>

        <Card style={styles.totalCard}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Unit price</Text>
            <Text style={styles.totalValue}>{formatCurrency(product.sellingPrice)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Quantity</Text>
            <Text style={styles.totalValue}>{quantity}</Text>
          </View>
          <View style={[styles.totalRow, styles.grandRow]}>
            <Text style={styles.grandLabel}>Total</Text>
            <Text style={styles.grandValue}>{formatCurrency(total)}</Text>
          </View>
          <Text style={styles.after}>Stock after this sale: {available - quantity}</Text>
        </Card>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={`Confirm sale · ${formatCurrency(total)}`}
          size="lg"
          variant="success"
          fullWidth
          loading={submitting}
          disabled={available <= 0}
          onPress={() => void confirmSale()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
  },
  name: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  barcode: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    letterSpacing: 1,
    marginTop: 2,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  available: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  stepper: {
    marginTop: spacing.xl,
  },
  totalCard: {
    marginTop: spacing.xl,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  totalLabel: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  totalValue: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  grandRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  grandLabel: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  grandValue: {
    color: colors.success,
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  after: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.md,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.lg,
  },
});
