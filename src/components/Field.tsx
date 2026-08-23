import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import {colors, fontSize, radius, spacing} from '@/constants/theme';

interface Props {
  label: string;
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  error?: string | null;
  hint?: string | null;
  required?: boolean;
  multiline?: boolean;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  editable?: boolean;
  style?: StyleProp<ViewStyle>;
  right?: React.ReactNode;
  maxLength?: number;
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  error,
  hint,
  required = false,
  multiline = false,
  autoCapitalize = 'sentences',
  editable = true,
  style,
  right,
  maxLength,
}: Props) {
  return (
    <View style={[styles.wrapper, style]}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            multiline && styles.multiline,
            !!error && styles.inputError,
            !editable && styles.inputDisabled,
            !!right && styles.inputWithRight,
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          multiline={multiline}
          editable={editable}
          maxLength={maxLength}
        />
        {right}
      </View>
      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginBottom: spacing.lg,
  },
  label: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    fontWeight: '700',
    marginBottom: spacing.xs,
  },
  required: {
    color: colors.danger,
  },
  inputRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    flex: 1,
    fontSize: fontSize.md,
    minHeight: 46,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputWithRight: {
    flexShrink: 1,
  },
  multiline: {
    minHeight: 92,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputDisabled: {
    backgroundColor: colors.surfaceAlt,
    color: colors.textMuted,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
  hint: {
    color: colors.textFaint,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
});
