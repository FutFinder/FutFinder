import React from 'react';
import { View, Text, Image, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Plus, Images } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';

const COLUMNS = 3;
const GAP = 8;
/** Fotos visibles en la muestra inicial (+1 celda "Añadir" = 6 celdas). */
export const VISIBLE_PHOTOS = 5;

/**
 * Galería del jugador: cuadrícula de 3 columnas, celda "Añadir" primero
 * (solo en el perfil propio) y hasta 5 fotos cuadradas.
 *
 * El lado de la celda se calcula desde el ancho real de la ventana, así que
 * nunca desborda ni en teléfonos pequeños ni en grandes.
 *
 * Sin fotos reales NO se inventan placeholders: en el perfil propio se muestra
 * un bloque que explica que la galería ya está disponible, y en un perfil
 * ajeno un estado vacío neutro.
 */
export default function PlayerPhotoGallery({
  photos = [],
  isOwnProfile,
  onAdd,
  onOpenPhoto,
}) {
  const { width } = useWindowDimensions();
  const size = Math.floor((width - dsSizes.gutter * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  const visibles = photos.slice(0, VISIBLE_PHOTOS);
  const restantes = photos.length - VISIBLE_PHOTOS;
  const vacia = photos.length === 0;

  return (
    <View style={styles.grid}>
      {isOwnProfile && (
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Añadir una foto a mi galería"
          style={({ pressed }) => [
            styles.cell,
            styles.addCell,
            { width: size, height: size },
            pressed && { backgroundColor: 'rgba(90, 224, 106, 0.15)' },
          ]}
        >
          <Plus color={dsColors.green} size={20} strokeWidth={2.4} />
          <Text style={styles.addLabel}>Añadir</Text>
        </Pressable>
      )}

      {visibles.map((foto, idx) => {
        const esUltima = idx === visibles.length - 1;
        return (
          <Pressable
            key={foto.id}
            onPress={() => onOpenPhoto?.(idx)}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Foto ${idx + 1} de ${photos.length} de la galería`}
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

      {vacia && (
        <View
          style={[
            styles.cell,
            styles.empty,
            { height: size, width: isOwnProfile ? size * 2 + GAP : '100%' },
          ]}
        >
          {isOwnProfile ? (
            <>
              <Text style={styles.emptyTitle}>Sube fotos desde hoy</Text>
              <Text style={styles.emptySub}>
                No necesitas partidos ni evaluaciones para usar tu galería.
              </Text>
            </>
          ) : (
            <>
              <Images color={dsColors.textMuted} size={18} strokeWidth={2} />
              <Text style={styles.emptyTitle}>Sin fotos públicas</Text>
            </>
          )}
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
    paddingHorizontal: dsSizes.gutter,
  },
  cell: { borderRadius: dsRadius.lg, overflow: 'hidden' },
  addCell: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(90, 224, 106, 0.4)',
    backgroundColor: 'rgba(90, 224, 106, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  addLabel: { color: dsColors.green, fontSize: 11, fontWeight: '700' },
  img: { width: '100%', height: '100%' },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: { color: dsColors.textPrimary, fontSize: 18, fontWeight: '800' },
  empty: {
    backgroundColor: dsColors.surface,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 14,
    gap: 4,
  },
  emptyTitle: {
    color: dsColors.textPrimary,
    fontSize: 13.5,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySub: {
    color: dsColors.textMuted,
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
  },
});
