import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Swords, Search } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';

/**
 * Fila de acción principal: botón verde grande + botón cuadrado de búsqueda.
 *
 * `label` cambia según el contexto (crear desafío / desafiar a este club /
 * solicitar unirme), pero la composición visual es siempre la de la referencia.
 * Si llega `icon` se usa ese en lugar de las espadas.
 */
export default function CreateChallengeButton({
  label = 'Crear desafío',
  onPress,
  onSearch,
  icon,
  disabled = false,
  accessibilityLabel,
  searchAccessibilityLabel = 'Buscar clubes rivales',
}) {
  return (
    <View style={styles.row}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || label}
        style={({ pressed }) => [
          styles.primary,
          disabled && styles.disabled,
          pressed && !disabled && styles.primaryPressed,
        ]}
      >
        {icon || <Swords color={clubColors.greenInk} size={20} strokeWidth={2.2} />}
        <Text style={styles.primaryLabel}>{label}</Text>
      </Pressable>

      <Pressable
        onPress={onSearch}
        accessibilityRole="button"
        accessibilityLabel={searchAccessibilityLabel}
        style={({ pressed }) => [styles.searchBtn, pressed && styles.searchPressed]}
      >
        <Search color={clubColors.textPrimary} size={20} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: clubSizes.gutter,
    paddingTop: 14,
  },
  primary: {
    flex: 1,
    height: clubSizes.actionBtn,
    borderRadius: clubRadius.xl,
    backgroundColor: clubColors.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    // Resplandor verde sutil (iOS) + elevación (Android).
    shadowColor: clubColors.green,
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  primaryPressed: { backgroundColor: clubColors.greenDark },
  disabled: { opacity: 0.45 },
  primaryLabel: {
    color: clubColors.greenInk,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  searchBtn: {
    width: clubSizes.actionBtn,
    height: clubSizes.actionBtn,
    borderRadius: clubRadius.xl,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPressed: { backgroundColor: clubColors.chipStrong },
});
