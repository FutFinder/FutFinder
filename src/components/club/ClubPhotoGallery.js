import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Plus, Image as ImageIcon } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';
import { temaClub } from '../../theme/clubThemes';

const COLUMNS = 3;
const GAP = 8;
/** Celdas de foto visibles en la muestra inicial (+1 de "Añadir" = 6). */
export const VISIBLE_PHOTOS = 5;

/**
 * Celda "Añadir": borde discontinuo y fondo suave del color del club, + y
 * texto. Conectada al selector de imágenes existente vía `onPress`.
 */
function AddClubPhotoCard({ size, onPress, tema }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Añadir foto al club"
      style={({ pressed }) => [
        styles.cell,
        styles.addCell,
        { width: size, height: size, borderColor: tema.border, backgroundColor: tema.soft },
        pressed && { backgroundColor: tema.softStrong },
      ]}
    >
      <Plus color={tema.main} size={20} strokeWidth={2.4} />
      <Text style={[styles.addLabel, { color: tema.main }]}>Añadir</Text>
    </Pressable>
  );
}

/** Placeholder rayado, solo para validar el diseño en desarrollo. */
function PhotoPlaceholder({ size, label }) {
  return (
    <View style={[styles.cell, styles.placeholder, { width: size, height: size }]}>
      <View style={styles.placeholderStripes} pointerEvents="none">
        {Array.from({ length: 14 }).map((_, i) => (
          <View key={i} style={styles.placeholderStripe} />
        ))}
      </View>
      <Text style={styles.placeholderText}>{label}</Text>
    </View>
  );
}

/**
 * Galería del club: cuadrícula de 3 columnas con la celda "Añadir" primero
 * y hasta 5 fotos. Todas las celdas son cuadradas y del mismo tamaño,
 * calculado desde el ancho real de la ventana (nunca desborda).
 *
 * @param {Array} photos       Fotos reales [{ id, photo_url }].
 * @param {boolean} showDemo   Si true y no hay fotos reales, muestra
 *                             placeholders (solo desarrollo).
 * @param {boolean} puedeAñadir  Muestra la celda "Añadir" (admins).
 * @param {object} tema  Escala de color del club, para la celda "Añadir".
 */
export default function ClubPhotoGallery({
  photos = [],
  showDemo = false,
  puedeAñadir = true,
  onAdd,
  onOpenPhoto,
  tema = temaClub(),
}) {
  const { width } = useWindowDimensions();
  const size = Math.floor(
    (width - clubSizes.gutter * 2 - GAP * (COLUMNS - 1)) / COLUMNS
  );

  const reales = photos.slice(0, VISIBLE_PHOTOS);
  const restantes = photos.length - VISIBLE_PHOTOS;
  const usarDemo = showDemo && photos.length === 0;

  return (
    <View style={styles.grid}>
      {puedeAñadir && <AddClubPhotoCard size={size} onPress={onAdd} tema={tema} />}

      {reales.map((foto, idx) => {
        const esUltima = idx === reales.length - 1;
        return (
          <Pressable
            key={foto.id}
            onPress={() => onOpenPhoto?.(foto, idx)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Foto ${idx + 1} del club`}
            style={({ pressed }) => [
              styles.cell,
              { width: size, height: size },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Image source={{ uri: foto.photo_url }} style={styles.img} resizeMode="cover" />
            {esUltima && restantes > 0 && (
              <View style={styles.overlay}>
                <Text style={styles.overlayText}>+{restantes}</Text>
              </View>
            )}
          </Pressable>
        );
      })}

      {usarDemo &&
        Array.from({ length: VISIBLE_PHOTOS }).map((_, i) => (
          <PhotoPlaceholder key={`demo-${i}`} size={size} label={`foto ${i + 1}`} />
        ))}

      {!usarDemo && photos.length === 0 && (
        <View style={[styles.cell, styles.empty, { height: size, width: size * 2 + GAP }]}>
          <ImageIcon color={clubColors.textMuted} size={18} strokeWidth={2} />
          <Text style={styles.emptyTitle}>Aún no hay fotos</Text>
          <Text style={styles.emptySub}>Sube la primera imagen del club</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    paddingHorizontal: clubSizes.gutter,
  },
  cell: {
    borderRadius: clubRadius.lg,
    overflow: 'hidden',
  },
  addCell: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addLabel: {
    fontSize: 11,
    fontWeight: '700',
  },
  img: { width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: {
    color: clubColors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  placeholder: {
    backgroundColor: '#161A18',
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderStripes: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    gap: 6,
    transform: [{ rotate: '25deg' }, { scale: 1.8 }],
  },
  placeholderStripe: {
    width: 6,
    height: '100%',
    backgroundColor: '#1B1F1D',
  },
  placeholderText: {
    color: clubColors.textFaint,
    fontSize: 8.5,
    letterSpacing: 0.3,
  },
  empty: {
    backgroundColor: clubColors.surface,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    gap: 4,
  },
  emptyTitle: {
    color: clubColors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  emptySub: {
    color: clubColors.textMuted,
    fontSize: 11.5,
    textAlign: 'center',
  },
});
