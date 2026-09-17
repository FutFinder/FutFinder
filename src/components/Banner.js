import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CheckCircle2, AlertCircle, X, Info } from 'lucide-react-native';
import { paleta as C, radios as R, fuentes as F } from '../theme/colors';

/**
 * Banner inline para mostrar feedback al usuario.
 * Tipos: 'success' | 'error' | 'info'
 * Usar arriba en una pantalla, controlado por estado.
 */
export default function Banner({ type = 'info', title, message, onClose }) {
  const palette = {
    success: {
      bg: C.greenSoft,
      border: C.green,
      icon: <CheckCircle2 color={C.green} size={18} />,
      titleColor: C.green,
    },
    error: {
      bg: C.redSoft,
      border: C.red,
      icon: <AlertCircle color={C.red} size={18} />,
      titleColor: C.red,
    },
    info: {
      bg: C.surfaceAlt,
      border: C.borderSoft,
      icon: <Info color={C.textSecondary} size={18} />,
      titleColor: C.textPrimary,
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
          <X color={C.textSecondary} size={16} />
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
    borderRadius: R.row,
    borderWidth: 1,
    marginBottom: 12,
  },
  iconWrap: { paddingTop: 2 },
  content: { flex: 1 },
  title: { fontSize: 13, fontFamily: F.bold },
  message: { color: C.textPrimary, fontSize: 13, lineHeight: 18, marginTop: 2 },
  close: { padding: 2 },
});
