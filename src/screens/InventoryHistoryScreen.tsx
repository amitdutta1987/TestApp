import {useFocusEffect, useNavigation, useRoute} from '@react-navigation/native';
import React, {useCallback, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {EmptyState, ErrorState} from '@/components/EmptyState';
import {Screen} from '@/components/Screen';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import type {RootScreenProps} from '@/navigation/types';
import {InventoryRepository} from '@/repositories/InventoryRepository';
import type {InventoryTransactionType, InventoryTransactionWithProduct} from '@/types';
import {toUserMessage} from '@/utils/errors';
import {formatDateTime} from '@/utils/format';

const inventory = new InventoryRepository();
const PAGE = 40;

type TypeFilter = InventoryTransactionType | 'ALL';

const FILTERS: Array<{key: TypeFilter; label: string}> = [
  {key: 'ALL', label: 'All'},
  {key: 'SALE', label: 'Sales'},
  {key: 'STOCK_IN', label: 'Stock in'},
  {key: 'RETURN', label: 'Returns'},
  {key: 'DAMAGE', label: 'Damage'},
  {key: 'STOCK_ADJUSTMENT', label: 'Adjustments'},
  {key: 'INITIAL_STOCK', label: 'Opening'},
];

const TYPE_LABELS: Record<InventoryTransactionType, string> = {
  INITIAL_STOCK: 'Opening stock',
  STOCK_IN: 'Stock in',
  SALE: 'Sale',
  RETURN: 'Return',
  DAMAGE: 'Damage',
  STOCK_ADJUSTMENT: 'Adjustment',
};

export function InventoryHistoryScreen() {
  const navigation = useNavigation<RootScreenProps<'InventoryHistory'>['navigation']>();
  const productId = useRoute<RootScreenProps<'InventoryHistory'>['route']>().params?.productId;

  const [filter, setFilter] = useState<TypeFilter>('ALL');
  const [items, setItems] = useState<InventoryTransactionWithProduct[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryId = useRef(0);

  const fetchPage = useCallback(
    async (offset: number) => {
      const id = ++queryId.current;
      if (offset === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        // listForProduct returns plain transactions; the shared row renderer
        // wants the product name too, so the single-product case fills it in.
        const page = productId
          ? await inventory.listForProduct(productId, PAGE, offset).then(result => ({
              ...result,
              items: result.items.map(entry => ({
                ...entry,
                productName: '',
                barcode: '',
              })) as InventoryTransactionWithProduct[],
            }))
          : await inventory.listAll(
              {type: filter === 'ALL' ? null : filter},
              PAGE,
              offset,
            );

        if (id !== queryId.current) {
          return;
        }
        setItems(previous => (offset === 0 ? page.items : [...previous, ...page.items]));
        setHasMore(page.hasMore);
        setError(null);
      } catch (caught) {
        if (id === queryId.current) {
          setError(toUserMessage(caught));
        }
      } finally {
        if (id === queryId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filter, productId],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchPage(0);
    }, [fetchPage]),
  );

  return (
    <Screen padded={false}>
      {!productId ? (
        <View style={styles.header}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}>
            {FILTERS.map(option => {
              const active = option.key === filter;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => setFilter(option.key)}
                  style={[styles.chip, active && styles.chipActive]}>
                  <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={() => void fetchPage(0)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={() => void fetchPage(0)}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore && !loadingMore && !loading) {
              void fetchPage(items.length);
            }
          }}
          renderItem={({item}) => (
            <Pressable
              onPress={() =>
                navigation.navigate('ProductDetail', {productId: item.productId})
              }
              style={({pressed}) => [styles.row, pressed && styles.pressed]}>
              <View style={styles.rowBody}>
                <Text style={styles.rowType}>{TYPE_LABELS[item.type] ?? item.type}</Text>
                {item.productName ? (
                  <Text style={styles.rowProduct} numberOfLines={1}>
                    {item.productName}
                  </Text>
                ) : null}
                <Text style={styles.rowMeta}>{formatDateTime(item.createdAt)}</Text>
                {item.notes ? (
                  <Text style={styles.rowNotes} numberOfLines={1}>
                    {item.notes}
                  </Text>
                ) : null}
              </View>
              <View style={styles.rowRight}>
                <Text
                  style={[
                    styles.delta,
                    {color: item.quantity < 0 ? colors.danger : colors.success},
                  ]}>
                  {item.quantity > 0 ? `+${item.quantity}` : item.quantity}
                </Text>
                <Text style={styles.balance}>
                  {item.quantityBefore} → {item.quantityAfter}
                </Text>
              </View>
            </Pressable>
          )}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.primary} style={styles.footer} />
            ) : null
          }
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                title="No stock movement yet"
                message="Every sale, restock and adjustment will be listed here."
              />
            )
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.lg,
  },
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  chipLabelActive: {
    color: colors.white,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.75,
  },
  rowBody: {
    flex: 1,
  },
  rowType: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  rowProduct: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  rowMeta: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  rowNotes: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    fontStyle: 'italic',
    marginTop: 2,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  delta: {
    fontSize: fontSize.lg,
    fontWeight: '800',
  },
  balance: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  footer: {
    paddingVertical: spacing.lg,
  },
});
