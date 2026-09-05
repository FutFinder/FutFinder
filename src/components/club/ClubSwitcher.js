import React from 'react';
import { Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Shield, Plus } from 'lucide-react-native';

import { temaClub, temaDeClub } from '../../theme/clubThemes';
import VerifiedBadge from './VerifiedBadge';

/**
 * Selector horizontal del club activo.
 *
 * NO SE ESCONDE SOLO. Con un único club no hay nada que elegir, pero esa
 * decisión la toma el llamador: un componente que a veces devuelve `null`
 * obliga a leerlo entero para saber si ocupa alto, y la portada necesita
 * saberlo para su separación entre secciones.
 *
 * CADA CHIP LLEVA SU PROPIO COLOR, no el del club activo. La lista enseña
 * clubes distintos: teñirlos todos del color del activo diría que son el
 * mismo. El acento del chip seleccionado sale de `tema`, que es el del club
 * activo y coincide con el suyo propio.
 *
 * @param {Array} clubs           `[{ club, miRol, totalMiembros }]` de `getMyClubs`.
 * @param {string} activeClubId
 * @param {object} [tema]         Escala del club activo.
 * @param {Function} onSelect     Recibe el id del club.
 * @param {Function} [onExplorar] Último chip, para buscar clubes nuevos.
 */
export default function ClubSwitcher({ clubs, activeClubId, tema, onSelect, onExplorar }) {
  const escala = tema || temaClub('green');
  const lista = (clubs || []).filter((m) => m?.club?.id);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.fila}
    >
      {lista.map(({ club }) => {
        const activo = club.id === activeClubId;
        // El chip activo se pinta con el tema del club activo; los demás con
        // el suyo, para que el escudo de cada uno sea reconocible.
        const suTema = activo ? escala : temaDeClub(club);

        return (
          <Pressable
            key={club.id}
            onPress={() => onSelect?.(club.id)}
            accessibilityRole="button"
            accessibilityState={{ selected: activo }}
            accessibilityLabel={
              activo ? `${club.nombre}, club activo` : `Cambiar a ${club.nombre}`
            }
            style={({ pressed }) => [
              styles.chip,
              activo
                ? { backgroundColor: escala.soft, borderColor: escala.border }
                : styles.chipInactivo,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Shield
              size={15}
              color={activo ? escala.main : suTema.main}
              strokeWidth={2.2}
            />
            <Text
              style={[styles.nombre, !activo && styles.nombreInactivo]}
              numberOfLines={1}
            >
              {club.nombre}
            </Text>
            {club.verificado ? <VerifiedBadge size={13} tema={suTema} /> : null}
          </Pressable>
        );
      })}

      <Pressable
        onPress={onExplorar}
        accessibilityRole="button"
        accessibilityLabel="Explorar clubes"
        style={({ pressed }) => [styles.chip, styles.chipExplorar, pressed && { opacity: 0.75 }]}
      >
        <Plus size={15} color="rgba(255, 255, 255, 0.6)" strokeWidth={2.2} />
        <Text style={[styles.nombre, styles.nombreInactivo]}>Explorar</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  chip: {
    height: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    borderRadius: 14,
    borderWidth: 1,
    maxWidth: 210,
  },
  chipInactivo: {
    backgroundColor: '#141416',
    borderColor: 'rgba(255, 255, 255, 0.09)',
  },
  chipExplorar: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  nombre: {
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  nombreInactivo: { fontWeight: '600', color: 'rgba(255, 255, 255, 0.6)' },
});
