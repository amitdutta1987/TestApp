import {useNavigation, useRoute} from '@react-navigation/native';
import React, {useCallback} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Card} from '@/components/Card';
import {ErrorState, LoadingState} from '@/components/EmptyState';
import {Screen} from '@/components/Screen';
import {colors, fontSize, spacing} from '@/constants/theme';
import {useAsyncData} from '@/hooks/useAsyncData';
import type {RootScreenProps} from '@/navigation/types';
import {SalesRepository} from '@/repositories/SalesRepository';
import type {SaleWithItems} from '@/types';
import {formatBarcodeForDisplay} from '@/utils/barcode';
import {formatCurrency, formatDateTime} from '@/utils/format';

const sales = new SalesRepository();

export function SaleDetailScreen() {
  const navigation = useNavigation<RootScreenProps<'SaleDetail'>['navigation']>();
  const {saleId} = useRoute<RootScreenProps<'SaleDetail'>['route']>().params;

  const load = useCallback(() => sales.findSaleWithItems(saleId), [saleId]);
  const {data, loading, error, reload} = useAsyncData<SaleWithItems | null>(load, [saleId]);

  if (loading && !data) {
    return (
      <Screen>
        <LoadingState />
      </Screen>
    );
  }

  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'That sale was not found.'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={styles.saleNumber}>{data.saleNumber}</Text>
          <Text style={styles.date}>{formatDateTime(data.createdAt)}</Text>
          <Text style={styles.total}>{formatCurrency(data.totalAmount)}</Text>
        </Card>

        <Text style={styles.sectionTitle}>Items</Text>

        {data.items.map(item => (
          <Pressable
            key={item.id}
            onPress={() => navigation.navigate('ProductDetail', {productId: item.productId})}
            style={({pressed}) => [styles.item, pressed && styles.pressed]}>
            <View style={styles.itemBody}>
              <Text style={styles.itemName}>{item.productName}</Text>
              <Text style={styles.itemMeta}>{formatBarcodeForDisplay(item.barcode)}</Text>
            </View>
            <View style={styles.itemRight}>
              <Text style={styles.itemTotal}>{formatCurrency(item.totalPrice)}</Text>
              <Text style={styles.itemQty}>
                {item.quantity} × {formatCurrency(item.unitPrice)}
              </Text>
            </View>
          </Pressable>
        ))}

        <Text style={styles.note}>
          Sales are permanent records. To put stock back, use Adjust → Return on the product.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
  },
  saleNumber: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    fontWeight: '700',
    letterSpacing: 1,
  },
  date: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  total: {
    color: colors.success,
    fontSize: fontSize.xxl,
    fontWeight: '800',
    marginTop: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  item: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.75,
  },
  itemBody: {
    flex: 1,
  },
  itemName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  itemMeta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  itemRight: {
    alignItems: 'flex-end',
  },
  itemTotal: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  itemQty: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  note: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginTop: spacing.xl,
  },
});
