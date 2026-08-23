import React, {memo} from 'react';
import {Image, Pressable, StyleSheet, Text, View} from 'react-native';
import {colors, fontSize, radius, spacing} from '@/constants/theme';
import {toDisplayUri} from '@/services/ImageStorageService';
import type {Product} from '@/types';
import {formatBarcodeForDisplay} from '@/utils/barcode';
import {formatCurrency} from '@/utils/format';
import {StatusBadge} from './StatusBadge';

interface Props {
  product: Product;
  onPress: (product: Product) => void;
}

/**
 * Rendered thousands of times in a virtualised list, so it is memoised and the
 * thumbnail — not the full-size photo — is what gets decoded.
 */
function ProductListItemBase({product, onPress}: Props) {
  const thumb = toDisplayUri(
    product.primaryImage ? thumbnailCandidate(product.primaryImage) : null,
  );
  return (
    <Pressable
      onPress={() => onPress(product)}
      accessibilityRole="button"
      style={({pressed}) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.thumbWrap}>
        {thumb ? (
          <Image source={{uri: thumb}} style={styles.thumb} resizeMode="cover" />
        ) : (
          <Text style={styles.thumbFallback}>{product.name.slice(0, 1).toUpperCase()}</Text>
        )}
      </View>

      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>
          {product.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatBarcodeForDisplay(product.barcode)}
          {product.category ? ` · ${product.category}` : ''}
        </Text>
        <View style={styles.badgeRow}>
          <StatusBadge status={product.status} small />
          {product.lifecycle === 'INACTIVE' ? (
            <Text style={styles.inactive}>INACTIVE</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.right}>
        <Text style={styles.price}>{formatCurrency(product.sellingPrice)}</Text>
        <Text style={styles.qty}>{product.currentQuantity} in stock</Text>
      </View>
    </Pressable>
  );
}

/** Mirrors thumbPathFor without importing it, keeping this component sync. */
function thumbnailCandidate(relativePath: string): string {
  const fileName = relativePath.split('/').pop() ?? relativePath;
  return `product-images/thumbs/${fileName}`;
}

export const ProductListItem = memo(ProductListItemBase);

const styles = StyleSheet.create({
  row: {
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
  thumbWrap: {
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    height: 56,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 56,
  },
  thumb: {
    height: '100%',
    width: '100%',
  },
  thumbFallback: {
    color: colors.textFaint,
    fontSize: fontSize.xl,
    fontWeight: '700',
  },
  body: {
    flex: 1,
  },
  name: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  meta: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  badgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  inactive: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '800',
  },
  right: {
    alignItems: 'flex-end',
  },
  price: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  qty: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
});
