import React from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {colors, fontSize, radius, spacing} from '@/constants/theme';

interface Props {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  /** Omit for unbounded (stock-in); pass current stock for selling. */
  max?: number;
  label?: string;
}

/**
 * Big touch targets on purpose: the sell flow is the one thing shopkeepers do
 * hundreds of times a day, and the spec budgets under 10 seconds for it.
 */
export function QuantityStepper({value, onChange, min = 1, max, label}: Props) {
  const clamp = (next: number) => {
    if (Number.isNaN(next)) {
      return min;
    }
    const upper = max === undefined ? next : Math.min(next, max);
    return Math.max(min, upper);
  };

  const canDecrease = value > min;
  const canIncrease = max === undefined || value < max;

  return (
    <View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease quantity"
          onPress={() => onChange(clamp(value - 1))}
          disabled={!canDecrease}
          style={({pressed}) => [
            styles.step,
            !canDecrease && styles.stepDisabled,
            pressed && styles.stepPressed,
          ]}>
          <Text style={styles.stepText}>−</Text>
        </Pressable>

        <TextInput
          style={styles.input}
          value={String(value)}
          keyboardType="number-pad"
          selectTextOnFocus
          onChangeText={text => {
            const digits = text.replace(/[^0-9]/g, '');
            onChange(clamp(digits === '' ? min : parseInt(digits, 10)));
          }}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase quantity"
          onPress={() => onChange(clamp(value + 1))}
          disabled={!canIncrease}
          style={({pressed}) => [
            styles.step,
            !canIncrease && styles.stepDisabled,
            pressed && styles.stepPressed,
          ]}>
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
      {max !== undefined ? <Text style={styles.max}>Maximum available: {max}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  step: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  stepPressed: {
    opacity: 0.7,
  },
  stepDisabled: {
    backgroundColor: colors.surfaceAlt,
  },
  stepText: {
    color: colors.primary,
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 34,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: fontSize.xxl,
    fontWeight: '700',
    height: 64,
    textAlign: 'center',
  },
  max: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
