import {useNavigation, useRoute} from '@react-navigation/native';
import React, {useCallback, useState} from 'react';
import {Alert, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {ErrorState, LoadingState} from '@/components/EmptyState';
import {Field} from '@/components/Field';
import {QuantityStepper} from '@/components/QuantityStepper';
import {Screen} from '@/components/Screen';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import {useAsyncData} from '@/hooks/useAsyncData';
import type {RootScreenProps} from '@/navigation/types';
import {ProductRepository} from '@/repositories/ProductRepository';
import {inventoryService} from '@/services/InventoryService';
import type {Product} from '@/types';
import {toUserMessage} from '@/utils/errors';

const products = new ProductRepository();

type Mode = 'COUNT' | 'RETURN' | 'DAMAGE';

const MODES: Array<{key: Mode; label: string; help: string}> = [
  {key: 'COUNT', label: 'Stock count', help: 'Set the stock to the number you counted on the shelf.'},
  {key: 'RETURN', label: 'Return', help: 'A customer brought units back — stock goes up.'},
  {key: 'DAMAGE', label: 'Damage', help: 'Units written off as damaged — stock goes down.'},
];

export function StockAdjustScreen() {
  const navigation = useNavigation<RootScreenProps<'StockAdjust'>['navigation']>();
  const {productId} = useRoute<RootScreenProps<'StockAdjust'>['route']>().params;

  const [mode, setMode] = useState<Mode>('COUNT');
  const [quantity, setQuantity] = useState(0);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [primed, setPrimed] = useState(false);

  const load = useCallback(() => products.requireById(productId), [productId]);
  const {data: product, loading, error, reload} = useAsyncData<Product>(load, [productId]);

  // The counted figure starts at the current stock so the common case (a count
  // that matches) is a single tap away.
  if (product && !primed) {
    setPrimed(true);
    setQuantity(product.currentQuantity);
  }

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

  const projected =
    mode === 'COUNT'
      ? quantity
      : mode === 'RETURN'
        ? product.currentQuantity + quantity
        : product.currentQuantity - quantity;

  const invalid = projected < 0;

  const switchMode = (next: Mode) => {
    setMode(next);
    setQuantity(next === 'COUNT' ? product.currentQuantity : 1);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const note = notes.trim() || undefined;
      const result =
        mode === 'COUNT'
          ? await inventoryService.adjustTo(product.id, quantity, note)
          : mode === 'RETURN'
            ? await inventoryService.recordReturn(product.id, quantity, note)
            : await inventoryService.recordDamage(product.id, quantity, note);

      Alert.alert('Stock updated', `${product.name} is now at ${result.quantityAfter} units.`, [
        {text: 'Done', onPress: () => navigation.goBack()},
      ]);
    } catch (caught) {
      Alert.alert('Could not update stock', toUserMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  const active = MODES.find(option => option.key === mode);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.current}>Currently {product.currentQuantity} in stock</Text>
        </Card>

        <View style={styles.modes}>
          {MODES.map(option => {
            const selected = option.key === mode;
            return (
              <Pressable
                key={option.key}
                onPress={() => switchMode(option.key)}
                style={[styles.mode, selected && styles.modeActive]}>
                <Text style={[styles.modeLabel, selected && styles.modeLabelActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.help}>{active?.help}</Text>

        <View style={styles.stepper}>
          <QuantityStepper
            label={mode === 'COUNT' ? 'Counted quantity' : 'Units'}
            value={quantity}
            onChange={setQuantity}
            min={mode === 'COUNT' ? 0 : 1}
            max={mode === 'DAMAGE' ? product.currentQuantity : undefined}
          />
        </View>

        <Text style={[styles.projected, invalid && styles.projectedInvalid]}>
          {invalid
            ? 'Stock cannot go below zero.'
            : `New stock level: ${projected}`}
        </Text>

        <Field
          label="Reason"
          value={notes}
          onChangeText={setNotes}
          placeholder="Why is the stock changing?"
          style={styles.notes}
        />
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Save adjustment"
          size="lg"
          fullWidth
          disabled={invalid}
          loading={submitting}
          onPress={() => void submit()}
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
  current: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    marginTop: spacing.xs,
  },
  modes: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  mode: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    flex: 1,
    paddingVertical: spacing.md,
  },
  modeActive: {
    backgroundColor: colors.primary,
  },
  modeLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '700',
  },
  modeLabelActive: {
    color: colors.white,
  },
  help: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
  },
  stepper: {
    marginTop: spacing.xl,
  },
  projected: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  projectedInvalid: {
    color: colors.danger,
  },
  notes: {
    marginTop: spacing.xl,
  },
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.lg,
  },
});
