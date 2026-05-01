import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react-native';
import { colors, radius } from '../theme/colors';

/**
 * Banner inline para mostrar feedback al usuario.
 * Tipos: 'success' | 'error' | 'info'
 * Usar arriba en una pantalla, controlado por estado.
 */
export default function Banner({ type = 'info', title, message, onClose }) {
  const palette = {
    success: {
      bg: colors.primarySoft,
      border: colors.primary,
      icon: <CheckCircle2 color={colors.primary} size={18} />,
      titleColor: colors.primary,
    },
    error: {
      bg: colors.errorSoft,
      border: colors.error,
      icon: <AlertCircle color={colors.error} size={18} />,
      titleColor: colors.error,
    },
    info: {
      bg: colors.surfaceAlt,
      border: colors.borderSoft,
      icon: <Info color={colors.textSecondary} size={18} />,
      titleColor: colors.textPrimary,
    },
  }[type];

  return (
    <View
      style={[
        styles.box,
        { backgroundColor: palette.bg, borderColor: palette.border },
      ]}
    >
      <View style={styles.iconWrap}>{palette.icon}</View>
      <View style={styles.content}>
        {title ? (
          <Text style={[styles.title, { color: palette.titleColor }]}>
            {title}
          </Text>
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={8} style={styles.close}>
          <X color={colors.textSecondary} size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    marginBottom: 12,
  },
  iconWrap: { paddingTop: 2 },
  content: { flex: 1 },
  title: { fontSize: 13, fontWeight: '700' },
  message: { color: colors.textPrimary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  close: { padding: 2 },
});
