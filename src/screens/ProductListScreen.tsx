import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {Button} from '@/components/Button';
import {EmptyState, ErrorState} from '@/components/EmptyState';
import {ProductListItem} from '@/components/ProductListItem';
import {Screen} from '@/components/Screen';
import {LIST} from '@/constants/config';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import type {TabScreenProps} from '@/navigation/types';
import {ProductRepository} from '@/repositories/ProductRepository';
import type {Product, StockStatus} from '@/types';
import {toUserMessage} from '@/utils/errors';

const products = new ProductRepository();

type StatusFilter = StockStatus | 'ALL';

const STATUS_FILTERS: Array<{key: StatusFilter; label: string}> = [
  {key: 'ALL', label: 'All'},
  {key: 'IN_STOCK', label: 'In stock'},
  {key: 'LOW_STOCK', label: 'Low'},
  {key: 'SOLD_OUT', label: 'Sold out'},
];

export function ProductListScreen() {
  const navigation = useNavigation<TabScreenProps<'Products'>['navigation']>();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [includeInactive, setIncludeInactive] = useState(false);

  const [items, setItems] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rejects results from a superseded query, which otherwise flicker in when
  // the user types faster than SQLite answers.
  const queryId = useRef(0);

  // Typing a barcode should not fire one query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchPage = useCallback(
    async (offset: number) => {
      const id = ++queryId.current;
      if (offset === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const page = await products.list(
          {
            search: debouncedSearch || undefined,
            status: status === 'ALL' ? null : status,
            includeInactive,
          },
          LIST.pageSize,
          offset,
        );
        if (id !== queryId.current) {
          return;
        }
        setItems(previous => (offset === 0 ? page.items : [...previous, ...page.items]));
        setTotal(page.total);
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
    [debouncedSearch, status, includeInactive],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchPage(0);
    }, [fetchPage]),
  );

  const openProduct = useCallback(
    (product: Product) => navigation.navigate('ProductDetail', {productId: product.id}),
    [navigation],
  );

  return (
    <Screen padded={false}>
      <View style={styles.toolbar}>
        <View style={styles.searchRow}>
          <TextInput
            style={styles.search}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, SKU or barcode"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan a barcode"
            onPress={() => navigation.navigate('Scanner', {mode: 'lookup'})}
            style={styles.scanButton}>
            <Text style={styles.scanGlyph}>▥</Text>
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}>
          {STATUS_FILTERS.map(option => {
            const active = status === option.key;
            return (
              <Pressable
                key={option.key}
                onPress={() => setStatus(option.key)}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => setIncludeInactive(previous => !previous)}
            style={[styles.chip, includeInactive && styles.chipActive]}>
            <Text style={[styles.chipLabel, includeInactive && styles.chipLabelActive]}>
              Include inactive
            </Text>
          </Pressable>
        </ScrollView>

        <Text style={styles.count}>
          {loading ? 'Loading…' : `${total} product${total === 1 ? '' : 's'}`}
        </Text>
      </View>

      {error ? (
        <ErrorState message={error} onRetry={() => void fetchPage(0)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.id}
          renderItem={({item}) => <ProductListItem product={item} onPress={openProduct} />}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshing={loading}
          onRefresh={() => void fetchPage(0)}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (hasMore && !loadingMore && !loading) {
              void fetchPage(items.length);
            }
          }}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.primary} style={styles.footer} />
            ) : null
          }
          ListEmptyComponent={
            loading ? null : (
              <EmptyState
                title={debouncedSearch ? 'No matches' : 'No products yet'}
                message={
                  debouncedSearch
                    ? 'Nothing matches that search. Try a different term, or add it as a new product.'
                    : 'Add your first product to start tracking stock.'
                }
                actionLabel="Add a product"
                onAction={() =>
                  navigation.navigate('ProductForm', {
                    barcode: debouncedSearch || undefined,
                  })
                }
              />
            )
          }
        />
      )}

      <View style={styles.fabRow}>
        <Button
          title="+ Add product"
          fullWidth
          size="lg"
          onPress={() => navigation.navigate('ProductForm', {})}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  searchRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  search: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    color: colors.text,
    flex: 1,
    fontSize: fontSize.md,
    height: 46,
    paddingHorizontal: spacing.md,
  },
  scanButton: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  scanGlyph: {
    color: colors.white,
    fontSize: 20,
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
  count: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
  },
  list: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  footer: {
    paddingVertical: spacing.lg,
  },
  fabRow: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.md,
  },
});
