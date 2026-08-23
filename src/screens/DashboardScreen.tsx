import {useNavigation} from '@react-navigation/native';
import React, {useCallback} from 'react';
import {Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {ErrorState, LoadingState} from '@/components/EmptyState';
import {Screen} from '@/components/Screen';
import {StatusBadge} from '@/components/StatusBadge';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import {useAsyncData} from '@/hooks/useAsyncData';
import type {TabScreenProps} from '@/navigation/types';
import {StatsRepository} from '@/repositories/StatsRepository';
import type {DashboardStats, Product} from '@/types';
import {formatCurrency, formatNumber} from '@/utils/format';

const stats = new StatsRepository();

interface DashboardData {
  stats: DashboardStats;
  lowStock: Product[];
}

export function DashboardScreen() {
  const navigation = useNavigation<TabScreenProps<'Dashboard'>['navigation']>();

  const load = useCallback(async (): Promise<DashboardData> => {
    const [summary, lowStock] = await Promise.all([
      stats.dashboard(),
      stats.lowStockProducts(6),
    ]);
    return {stats: summary, lowStock};
  }, []);

  const {data, loading, error, refreshing, reload} = useAsyncData(load);

  if (loading && !data) {
    return (
      <Screen>
        <LoadingState label="Reading your inventory…" />
      </Screen>
    );
  }

  if (error && !data) {
    return (
      <Screen>
        <ErrorState message={error} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const summary = data?.stats;

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />
        }>
        <Button
          title="Scan a barcode"
          size="lg"
          fullWidth
          onPress={() => navigation.navigate('Scanner', {mode: 'lookup'})}
        />
        <Text style={styles.scanHint}>Scan → sell in a few taps</Text>

        <View style={styles.grid}>
          <Metric label="Sold today" value={formatNumber(summary?.todayItemsSold ?? 0)} />
          <Metric
            label="Revenue today"
            value={formatCurrency(summary?.todayRevenue ?? 0)}
            tone="success"
          />
          <Metric label="Products" value={formatNumber(summary?.totalProducts ?? 0)} />
          <Metric label="Units in stock" value={formatNumber(summary?.totalUnits ?? 0)} />
          <Metric
            label="Low stock"
            value={formatNumber(summary?.lowStockCount ?? 0)}
            tone={summary?.lowStockCount ? 'warning' : undefined}
          />
          <Metric
            label="Sold out"
            value={formatNumber(summary?.soldOutCount ?? 0)}
            tone={summary?.soldOutCount ? 'danger' : undefined}
          />
        </View>

        <Card style={styles.valueCard}>
          <Text style={styles.sectionTitle}>Inventory value</Text>
          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>At cost</Text>
            <Text style={styles.valueAmount}>
              {formatCurrency(summary?.inventoryValueAtCost ?? 0)}
            </Text>
          </View>
          <View style={styles.valueRow}>
            <Text style={styles.valueLabel}>At retail</Text>
            <Text style={styles.valueAmount}>
              {formatCurrency(summary?.inventoryValueAtRetail ?? 0)}
            </Text>
          </View>
        </Card>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Needs restocking</Text>
          <Pressable onPress={() => navigation.navigate('Products')}>
            <Text style={styles.link}>See all</Text>
          </Pressable>
        </View>

        {data && data.lowStock.length > 0 ? (
          data.lowStock.map(product => (
            <Pressable
              key={product.id}
              onPress={() => navigation.navigate('ProductDetail', {productId: product.id})}
              style={({pressed}) => [styles.lowRow, pressed && styles.pressed]}>
              <View style={styles.lowBody}>
                <Text style={styles.lowName} numberOfLines={1}>
                  {product.name}
                </Text>
                <Text style={styles.lowMeta}>
                  {product.currentQuantity} left · minimum {product.minimumStock}
                </Text>
              </View>
              <StatusBadge status={product.status} small />
            </Pressable>
          ))
        ) : (
          <Card>
            <Text style={styles.allGood}>Every product is above its minimum stock level.</Text>
          </Card>
        )}

        <Button
          title="Add a product"
          variant="ghost"
          fullWidth
          onPress={() => navigation.navigate('ProductForm', {})}
          style={styles.addButton}
        />
      </ScrollView>
    </Screen>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'warning' | 'danger';
}) {
  const color =
    tone === 'success'
      ? colors.success
      : tone === 'warning'
        ? colors.warning
        : tone === 'danger'
          ? colors.danger
          : colors.text;
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, {color}]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  scanHint: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  metric: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: '30%',
    padding: spacing.md,
  },
  metricValue: {
    fontSize: fontSize.xl,
    fontWeight: '800',
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: fontSize.xs,
    fontWeight: '700',
    marginTop: 2,
    textTransform: 'uppercase',
  },
  valueCard: {
    marginTop: spacing.lg,
  },
  valueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  valueLabel: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  valueAmount: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.xl,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  link: {
    color: colors.primary,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  lowRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
  },
  pressed: {
    opacity: 0.75,
  },
  lowBody: {
    flex: 1,
  },
  lowName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  lowMeta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  allGood: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  addButton: {
    marginTop: spacing.xl,
  },
});
