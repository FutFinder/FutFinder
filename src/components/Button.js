import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';

/**
 * Botón corporativo de FutFinder
 * Variants: 'primary' (verde sólido), 'secondary' (borde verde), 'ghost' (transparente)
 */
export default function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  icon = null,
  style,
}) {
  const isPrimary = variant === 'primary';
  const isSecondary = variant === 'secondary';
  const isGhost = variant === 'ghost';

  const containerStyle = [
    styles.base,
    isPrimary && styles.primary,
    isSecondary && styles.secondary,
    isGhost && styles.ghost,
    disabled && styles.disabled,
    style,
  ];

  const textStyle = [
    styles.label,
    isPrimary && styles.labelPrimary,
    isSecondary && styles.labelSecondary,
    isGhost && styles.labelGhost,
  ];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        ...containerStyle,
        pressed && !disabled && { opacity: 0.85, transform: [{ scale: 0.99 }] },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isPrimary ? '#000' : C.green} />
      ) : (
        <View style={styles.row}>
          {icon}
          <Text style={textStyle}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    // 54 de alto y radio de CTA primario: los mismos que el `Button` del kit
    // (`components/reservas/ui.js`), para que los dos botones que conviven
    // mientras dure la migración no se vean como dos botones distintos.
    height: 54,
    borderRadius: R.ctaPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  primary: {
    backgroundColor: C.green,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: C.border,
  },
  ghost: {
    backgroundColor: 'transparent',
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 16,
    fontFamily: F.bold,
  },
  labelPrimary: {
    color: '#0E0E0D',
  },
  labelSecondary: {
    color: C.textPrimary,
  },
  labelGhost: {
    color: C.green,
  },
});
