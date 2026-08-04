import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowLeft, Share2, Pencil } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';
import ClubPlanBadge from './ClubPlanBadge';

/**
 * Barra superior del detalle de club:
 * volver · título · compartir · Editar (solo admin) · insignia de plan.
 *
 * Los botones cuadrados miden 40 px pero llevan hitSlop de 8 para cumplir
 * el mínimo táctil de 44 × 44.
 */
export default function ClubHeaderBar({
  title,
  esPremium,
  puedeEditar,
  onBack,
  onShare,
  onEdit,
  onPlan,
}) {
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={onBack}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Volver"
        style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
      >
        <ArrowLeft color={clubColors.textPrimary} size={18} strokeWidth={2.2} />
      </Pressable>

      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>

      <Pressable
        onPress={onShare}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Compartir club"
        style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
      >
        <Share2 color={clubColors.textPrimary} size={17} strokeWidth={2} />
      </Pressable>

      {puedeEditar && (
        <Pressable
          onPress={onEdit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Editar club"
          style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
        >
          <Pencil color={clubColors.textPrimary} size={15} strokeWidth={2} />
          <Text style={styles.editLabel}>Editar</Text>
        </Pressable>
      )}

      <ClubPlanBadge esPremium={esPremium} onPress={onPlan} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: clubSizes.gutter,
    paddingTop: 4,
    paddingBottom: 12,
  },
  iconBtn: {
    width: clubSizes.iconBtn,
    height: clubSizes.iconBtn,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: clubColors.chipStrong },
  title: {
    flex: 1,
    minWidth: 0,
    color: clubColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  editBtn: {
    height: clubSizes.iconBtn,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
  },
  editLabel: {
    color: clubColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
});
