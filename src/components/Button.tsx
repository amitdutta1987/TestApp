import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import {colors, fontSize, radius, spacing} from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Props {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

const BACKGROUNDS: Record<ButtonVariant, string> = {
  primary: colors.primary,
  secondary: colors.surfaceAlt,
  danger: colors.danger,
  ghost: 'transparent',
  success: colors.success,
};

const FOREGROUNDS: Record<ButtonVariant, string> = {
  primary: colors.white,
  secondary: colors.text,
  danger: colors.white,
  ghost: colors.primary,
  success: colors.white,
};

const HEIGHTS: Record<ButtonSize, number> = {sm: 36, md: 46, lg: 56};

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
}: Props) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: inactive, busy: loading}}
      onPress={onPress}
      disabled={inactive}
      style={({pressed}) => [
        styles.base,
        {
          backgroundColor: BACKGROUNDS[variant],
          height: HEIGHTS[size],
          opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
        },
        variant === 'ghost' && styles.ghost,
        fullWidth && styles.fullWidth,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={FOREGROUNDS[variant]} />
      ) : (
        <Text
          style={[
            styles.label,
            {color: FOREGROUNDS[variant], fontSize: size === 'lg' ? fontSize.lg : fontSize.md},
          ]}
          numberOfLines={1}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  ghost: {
    borderColor: colors.border,
    borderWidth: 1,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  label: {
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
