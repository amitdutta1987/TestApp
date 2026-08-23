import {useFocusEffect, useNavigation} from '@react-navigation/native';
import React, {useCallback, useMemo, useRef, useState} from 'react';
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
import {LIST} from '@/constants/config';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import type {TabScreenProps} from '@/navigation/types';
import {SalesRepository, type SaleItemWithSale} from '@/repositories/SalesRepository';
import {toUserMessage} from '@/utils/errors';
import {formatCurrency, formatDateTime, formatNumber} from '@/utils/format';
import {SALES_PERIOD_LABELS, rangeForPeriod, type SalesPeriod} from '@/utils/date';

const sales = new SalesRepository();

const PERIODS = Object.keys(SALES_PERIOD_LABELS) as Array<Exclude<SalesPeriod, 'CUSTOM'>>;

export function SalesScreen() {
  const navigation = useNavigation<TabScreenProps<'Sales'>['navigation']>();

  const [period, setPeriod] = useState<Exclude<SalesPeriod, 'CUSTOM'>>('TODAY');
  const [items, setItems] = useState<SaleItemWithSale[]>([]);
  const [summary, setSummary] = useState({itemsSold: 0, revenue: 0});
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryId = useRef(0);
  const range = useMemo(() => rangeForPeriod(period), [period]);

  const fetchPage = useCallback(
    async (offset: number) => {
      const id = ++queryId.current;
      if (offset === 0) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }
      try {
        const page = await sales.listSaleItems(range, LIST.pageSize, offset);
        // "All time" has no range to summarise, so it is derived from the page total.
        const totals = range
          ? await sales.summaryForRange(range)
          : page.items.reduce(
              (accumulator, item) => ({
                itemsSold: accumulator.itemsSold + item.quantity,
                revenue: accumulator.revenue + item.totalPrice,
              }),
              {itemsSold: 0, revenue: 0},
            );

        if (id !== queryId.current) {
          return;
        }
        setItems(previous => (offset === 0 ? page.items : [...previous, ...page.items]));
        setTotal(page.total);
        setHasMore(page.hasMore);
        if (offset === 0 || range) {
          setSummary(totals);
        }
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
    [range],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchPage(0);
    }, [fetchPage]),
  );

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}>
          {PERIODS.map(key => {
            const active = key === period;
            return (
              <Pressable
                key={key}
                onPress={() => setPeriod(key)}
                style={[styles.chip, active && styles.chipActive]}>
                <Text style={[styles.chipLabel, active && styles.chipLabelActive]}>
                  {SALES_PERIOD_LABELS[key]}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.summary}>
          <View>
            <Text style={styles.summaryLabel}>Items sold</Text>
            <Text style={styles.summaryValue}>{formatNumber(summary.itemsSold)}</Text>
          </View>
          <View style={styles.summaryRight}>
            <Text style={styles.summaryLabel}>Revenue</Text>
            <Text style={[styles.summaryValue, styles.revenue]}>
              {formatCurrency(summary.revenue)}
            </Text>
          </View>
        </View>
        {!range ? (
          <Text style={styles.allTimeNote}>
            All-time totals reflect the {items.length} of {total} lines loaded so far.
          </Text>
        ) : null}
      </View>

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
              onPress={() => navigation.navigate('SaleDetail', {saleId: item.saleId})}
              style={({pressed}) => [styles.row, pressed && styles.pressed]}>
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.productName}
                </Text>
                <Text style={styles.rowMeta}>
                  {item.saleNumber} · {formatDateTime(item.createdAt)}
                </Text>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.rowTotal}>{formatCurrency(item.totalPrice)}</Text>
                <Text style={styles.rowQty}>
                  {item.quantity} × {formatCurrency(item.unitPrice)}
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
                title="No sales in this period"
                message="Scan a product and tap SELL to record your first sale."
                actionLabel="Scan a barcode"
                onAction={() => navigation.navigate('Scanner', {mode: 'lookup'})}
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
    paddingTop: spacing.md,
  },
  chips: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
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
  summary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.md,
  },
  summaryRight: {
    alignItems: 'flex-end',
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  summaryValue: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  revenue: {
    color: colors.success,
  },
  allTimeNote: {
    color: colors.textFaint,
    fontSize: fontSize.xs,
    paddingBottom: spacing.md,
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
  rowName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  rowMeta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  rowTotal: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  rowQty: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  footer: {
    paddingVertical: spacing.lg,
  },
});
