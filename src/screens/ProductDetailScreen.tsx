import {useNavigation, useRoute} from '@react-navigation/native';
import React, {useCallback} from 'react';
import {Alert, Image, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {ErrorState, LoadingState} from '@/components/EmptyState';
import {Screen} from '@/components/Screen';
import {StatusBadge} from '@/components/StatusBadge';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import {useAsyncData} from '@/hooks/useAsyncData';
import type {RootScreenProps} from '@/navigation/types';
import {InventoryRepository} from '@/repositories/InventoryRepository';
import {ProductRepository} from '@/repositories/ProductRepository';
import {toDisplayUri} from '@/services/ImageStorageService';
import type {InventoryTransaction, Product} from '@/types';
import {formatBarcodeForDisplay} from '@/utils/barcode';
import {toUserMessage} from '@/utils/errors';
import {formatCurrency, formatDateTime} from '@/utils/format';

const products = new ProductRepository();
const inventory = new InventoryRepository();

const TYPE_LABELS: Record<string, string> = {
  INITIAL_STOCK: 'Initial stock',
  STOCK_IN: 'Stock in',
  SALE: 'Sale',
  RETURN: 'Return',
  DAMAGE: 'Damage',
  STOCK_ADJUSTMENT: 'Adjustment',
};

export function ProductDetailScreen() {
  const navigation = useNavigation<RootScreenProps<'ProductDetail'>['navigation']>();
  const {productId} = useRoute<RootScreenProps<'ProductDetail'>['route']>().params;

  const load = useCallback(async () => {
    const product = await products.requireById(productId);
    const history = await inventory.listForProduct(productId, 8, 0);
    return {product, history: history.items};
  }, [productId]);

  const {data, loading, error, refreshing, reload} = useAsyncData<{
    product: Product;
    history: InventoryTransaction[];
  }>(load, [productId]);

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
        <ErrorState message={error ?? 'Product not found.'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const {product, history} = data;
  const soldOut = product.currentQuantity <= 0;
  const image = toDisplayUri(product.primaryImage);

  const confirmDeactivate = () => {
    Alert.alert(
      'Mark inactive?',
      `"${product.name}" will be hidden from the product list but its sales history is kept.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Mark inactive',
          style: 'destructive',
          onPress: () => {
            void products
              .deactivate(product.id)
              .then(() => reload())
              .catch(caught => Alert.alert('Could not update', toUserMessage(caught)));
          },
        },
      ],
    );
  };

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />
        }>
        {image ? (
          <Image source={{uri: image}} style={styles.hero} resizeMode="cover" />
        ) : null}

        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.barcode}>{formatBarcodeForDisplay(product.barcode)}</Text>

        <View style={styles.badgeRow}>
          <StatusBadge status={product.status} />
          {product.lifecycle === 'INACTIVE' ? (
            <Text style={styles.inactiveTag}>INACTIVE</Text>
          ) : null}
        </View>

        <Card style={styles.stockCard}>
          <View style={styles.stockRow}>
            <View>
              <Text style={styles.stockLabel}>In stock</Text>
              <Text style={styles.stockValue}>{product.currentQuantity}</Text>
            </View>
            <View style={styles.stockRight}>
              <Text style={styles.stockLabel}>Selling price</Text>
              <Text style={styles.stockValue}>{formatCurrency(product.sellingPrice)}</Text>
            </View>
          </View>
          <Text style={styles.minimum}>Alerts below {product.minimumStock} units</Text>
        </Card>

        <Button
          title={soldOut ? 'Out of stock' : 'SELL'}
          size="lg"
          variant="success"
          fullWidth
          disabled={soldOut}
          onPress={() => navigation.navigate('Sell', {productId: product.id})}
          style={styles.sell}
        />

        <View style={styles.actionRow}>
          <Button
            title="Add stock"
            variant="secondary"
            style={styles.action}
            onPress={() => navigation.navigate('AddStock', {productId: product.id})}
          />
          <Button
            title="Adjust"
            variant="secondary"
            style={styles.action}
            onPress={() => navigation.navigate('StockAdjust', {productId: product.id})}
          />
        </View>

        <View style={styles.actionRow}>
          <Button
            title="Edit"
            variant="ghost"
            style={styles.action}
            onPress={() => navigation.navigate('ProductForm', {productId: product.id})}
          />
          <Button
            title="Photos"
            variant="ghost"
            style={styles.action}
            onPress={() => navigation.navigate('ProductImages', {productId: product.id})}
          />
        </View>

        <Card style={styles.detailsCard}>
          <Text style={styles.sectionTitle}>Details</Text>
          <Detail label="SKU" value={product.sku} />
          <Detail label="Category" value={product.category} />
          <Detail label="Brand" value={product.brand} />
          <Detail label="Colour" value={product.color} />
          <Detail label="Size" value={product.size} />
          <Detail label="Material" value={product.material} />
          <Detail label="Supplier" value={product.supplier} />
          <Detail label="Rack" value={product.rackLocation} />
          <Detail
            label="Purchase price"
            value={product.purchasePrice === null ? null : formatCurrency(product.purchasePrice)}
          />
          <Detail label="Added" value={formatDateTime(product.createdAt)} />
          {product.description ? (
            <Text style={styles.description}>{product.description}</Text>
          ) : null}
        </Card>

        <View style={styles.historyHeader}>
          <Text style={styles.sectionTitle}>Recent stock movement</Text>
          <Button
            title="All"
            variant="ghost"
            size="sm"
            onPress={() => navigation.navigate('InventoryHistory', {productId: product.id})}
          />
        </View>

        {history.length === 0 ? (
          <Card>
            <Text style={styles.emptyHistory}>No movement recorded yet.</Text>
          </Card>
        ) : (
          history.map(entry => (
            <View key={entry.id} style={styles.historyRow}>
              <View style={styles.historyBody}>
                <Text style={styles.historyType}>
                  {TYPE_LABELS[entry.type] ?? entry.type}
                </Text>
                <Text style={styles.historyMeta}>{formatDateTime(entry.createdAt)}</Text>
              </View>
              <View style={styles.historyRight}>
                <Text
                  style={[
                    styles.historyDelta,
                    {color: entry.quantity < 0 ? colors.danger : colors.success},
                  ]}>
                  {entry.quantity > 0 ? `+${entry.quantity}` : entry.quantity}
                </Text>
                <Text style={styles.historyAfter}>→ {entry.quantityAfter}</Text>
              </View>
            </View>
          ))
        )}

        {product.lifecycle === 'ACTIVE' ? (
          <Button
            title="Mark inactive"
            variant="ghost"
            fullWidth
            onPress={confirmDeactivate}
            style={styles.deactivate}
          />
        ) : (
          <Button
            title="Reactivate product"
            variant="ghost"
            fullWidth
            style={styles.deactivate}
            onPress={() => {
              void products
                .reactivate(product.id)
                .then(() => reload())
                .catch(caught => Alert.alert('Could not update', toUserMessage(caught)));
            }}
          />
        )}
      </ScrollView>
    </Screen>
  );
}

function Detail({label, value}: {label: string; value: string | null}) {
  if (!value) {
    return null;
  }
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  hero: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    height: 220,
    marginBottom: spacing.lg,
    width: '100%',
  },
  name: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  barcode: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    letterSpacing: 1,
    marginTop: spacing.xs,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  inactiveTag: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    fontWeight: '800',
  },
  stockCard: {
    marginTop: spacing.lg,
  },
  stockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stockRight: {
    alignItems: 'flex-end',
  },
  stockLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  stockValue: {
    color: colors.text,
    fontSize: fontSize.xxl,
    fontWeight: '800',
  },
  minimum: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  sell: {
    marginTop: spacing.lg,
  },
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  action: {
    flex: 1,
  },
  detailsCard: {
    marginTop: spacing.xl,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  detailRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  detailValue: {
    color: colors.text,
    flexShrink: 1,
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'right',
  },
  description: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    lineHeight: 22,
    marginTop: spacing.md,
  },
  historyHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  historyRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  historyBody: {
    flex: 1,
  },
  historyType: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  historyMeta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  historyRight: {
    alignItems: 'flex-end',
  },
  historyDelta: {
    fontSize: fontSize.md,
    fontWeight: '800',
  },
  historyAfter: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
  },
  emptyHistory: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  deactivate: {
    marginTop: spacing.xl,
  },
});
