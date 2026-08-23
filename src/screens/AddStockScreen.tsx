import {useNavigation, useRoute} from '@react-navigation/native';
import React, {useCallback, useState} from 'react';
import {Alert, ScrollView, StyleSheet, Text, View} from 'react-native';
import {Button} from '@/components/Button';
import {Card} from '@/components/Card';
import {ErrorState, LoadingState} from '@/components/EmptyState';
import {Field} from '@/components/Field';
import {QuantityStepper} from '@/components/QuantityStepper';
import {Screen} from '@/components/Screen';
import {colors, fontSize, spacing} from '@/constants/theme';
import {useAsyncData} from '@/hooks/useAsyncData';
import type {RootScreenProps} from '@/navigation/types';
import {ProductRepository} from '@/repositories/ProductRepository';
import {inventoryService} from '@/services/InventoryService';
import type {Product} from '@/types';
import {toUserMessage} from '@/utils/errors';

const products = new ProductRepository();

export function AddStockScreen() {
  const navigation = useNavigation<RootScreenProps<'AddStock'>['navigation']>();
  const {productId} = useRoute<RootScreenProps<'AddStock'>['route']>().params;

  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
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

  const submit = async () => {
    setSubmitting(true);
    try {
      const result = await inventoryService.addStock(
        product.id,
        quantity,
        notes.trim() || undefined,
      );
      Alert.alert(
        'Stock added',
        `${product.name} is now at ${result.quantityAfter} units.`,
        [{text: 'Done', onPress: () => navigation.goBack()}],
      );
    } catch (caught) {
      Alert.alert('Could not add stock', toUserMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={styles.name}>{product.name}</Text>
          <Text style={styles.current}>Currently {product.currentQuantity} in stock</Text>
        </Card>

        <View style={styles.stepper}>
          <QuantityStepper
            label="Units received"
            value={quantity}
            onChange={setQuantity}
            min={1}
          />
        </View>

        <Text style={styles.after}>
          New stock level: {product.currentQuantity + quantity}
        </Text>

        <Field
          label="Note"
          value={notes}
          onChangeText={setNotes}
          placeholder="Supplier, invoice number…"
          hint="Saved with the stock movement so the history explains itself."
          style={styles.notes}
        />
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title="Add stock"
          size="lg"
          fullWidth
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
  stepper: {
    marginTop: spacing.xl,
  },
  after: {
    color: colors.success,
    fontSize: fontSize.md,
    fontWeight: '700',
    marginTop: spacing.lg,
    textAlign: 'center',
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
