import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Swords, Search } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';
import { temaClub } from '../../theme/clubThemes';

/**
 * Fila de acción principal: botón grande del color del club + botón cuadrado
 * de búsqueda.
 *
 * `label` cambia según el contexto (crear desafío / desafiar a este club /
 * solicitar unirme), pero la composición visual es siempre la de la referencia.
 * Si llega `icon` se usa ese en lugar de las espadas; para que el icono
 * contraste en cualquier tema, la función `icon` recibe el color de tinta.
 *
 * El botón cuadrado de la lupa queda neutro a propósito: es navegación, no
 * identidad del club.
 */
export default function CreateChallengeButton({
  label = 'Crear desafío',
  onPress,
  onSearch,
  icon,
  disabled = false,
  accessibilityLabel,
  searchAccessibilityLabel = 'Buscar clubes rivales',
  tema = temaClub(),
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
          { backgroundColor: tema.main, shadowColor: tema.main },
          disabled && styles.disabled,
          pressed && !disabled && { backgroundColor: tema.pressed },
        ]}
      >
        {(typeof icon === 'function' ? icon(tema.ink) : icon) || (
          <Swords color={tema.ink} size={20} strokeWidth={2.2} />
        )}
        <Text style={[styles.primaryLabel, { color: tema.ink }]}>{label}</Text>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    // Resplandor discreto del color del club (iOS) + elevación (Android).
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  disabled: { opacity: 0.45 },
  primaryLabel: {
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
