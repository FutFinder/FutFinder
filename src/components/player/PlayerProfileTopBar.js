import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MapPin, ArrowLeft, Share2, Pencil, Settings, MoreVertical } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';
import NotificationBell from '../NotificationBell';

/**
 * Barra superior del perfil.
 *
 * Perfil propio  → pin + "Mi perfil" · compartir · Editar · configuración
 * Perfil ajeno   → volver · @username · compartir · menú (reportar)
 *
 * Los botones miden 44 px, así que ya cumplen el mínimo táctil sin hitSlop.
 */
export default function PlayerProfileTopBar({
  isOwnProfile,
  title,
  onBack,
  onShare,
  onEdit,
  onSettings,
  onMore,
}) {
  return (
    <View style={styles.bar}>
      {isOwnProfile ? (
        <>
          <View style={styles.titleWrap}>
            <MapPin color={dsColors.green} size={20} strokeWidth={1.8} />
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <NotificationBell />
        </>
      ) : (
        <>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          >
            <ArrowLeft color={dsColors.textPrimary} size={18} strokeWidth={2.2} />
          </Pressable>
          <Text style={[styles.title, styles.titleOther]} numberOfLines={1}>
            {title}
          </Text>
        </>
      )}

      <Pressable
        onPress={onShare}
        accessibilityRole="button"
        accessibilityLabel={isOwnProfile ? 'Compartir mi perfil' : `Compartir el perfil de ${title}`}
        style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
      >
        <Share2 color={dsColors.textPrimary} size={17} strokeWidth={2} />
      </Pressable>

      {isOwnProfile ? (
        <>
          {/* Sin sesión activa no hay nada que editar ni configurar. */}
          {onEdit && (
            <Pressable
              onPress={onEdit}
              accessibilityRole="button"
              accessibilityLabel="Editar mi perfil"
              style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
            >
              <Pencil color={dsColors.textPrimary} size={15} strokeWidth={2} />
              <Text style={styles.editLabel}>Editar</Text>
            </Pressable>
          )}
          {onSettings && (
            <Pressable
              onPress={onSettings}
              accessibilityRole="button"
              accessibilityLabel="Configuración"
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            >
              <Settings color={dsColors.textPrimary} size={17} strokeWidth={1.9} />
            </Pressable>
          )}
        </>
      ) : (
        <Pressable
          onPress={onMore}
          accessibilityRole="button"
          accessibilityLabel="Más opciones"
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
        >
          <MoreVertical color={dsColors.textPrimary} size={17} strokeWidth={2} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: dsSizes.gutter,
    paddingTop: 4,
    paddingBottom: 12,
  },
  titleWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: {
    color: dsColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  titleOther: { flex: 1, minWidth: 0, fontSize: 16 },
  iconBtn: {
    width: dsSizes.tapBtn,
    height: dsSizes.tapBtn,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: dsColors.border,
    backgroundColor: dsColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { backgroundColor: dsColors.chipStrong },
  editBtn: {
    height: dsSizes.tapBtn,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: dsColors.border,
    backgroundColor: dsColors.chip,
  },
  editLabel: { color: dsColors.textPrimary, fontSize: 13, fontWeight: '600' },
});
