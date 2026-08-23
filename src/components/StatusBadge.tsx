import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {fontSize, radius, spacing, statusColors} from '@/constants/theme';
import type {StockStatus} from '@/types';

export function StatusBadge({status, small = false}: {status: StockStatus; small?: boolean}) {
  const tone = statusColors[status];
  return (
    <View style={[styles.badge, {backgroundColor: tone.bg}, small && styles.small]}>
      <Text style={[styles.label, {color: tone.fg}, small && styles.smallLabel]}>{tone.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  small: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  smallLabel: {
    fontSize: 10,
  },
});
