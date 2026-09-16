import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ArrowLeft, Share2, Pencil } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasSizes as S,
  reservasFonts as F,
} from '../../theme/colors';
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
        <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
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
        <Share2 color={C.textPrimary} size={17} strokeWidth={2} />
      </Pressable>

      {puedeEditar && (
        <Pressable
          onPress={onEdit}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Editar club"
          style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
        >
          <Pencil color={C.textPrimary} size={15} strokeWidth={2} />
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
    paddingHorizontal: S.screenPadding,
    paddingTop: 4,
    paddingBottom: 12,
  },
  iconBtn: {
    width: S.iconBtn,
    height: S.iconBtn,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: C.chipStrong },
  title: {
    flex: 1,
    minWidth: 0,
    color: C.textPrimary,
    fontSize: 17,
    fontFamily: F.bold,
    letterSpacing: -0.2,
  },
  editBtn: {
    height: S.iconBtn,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
  },
  editLabel: {
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.semiBold,
  },
});
