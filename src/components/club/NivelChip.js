import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { paleta as C, fuentes as F } from '../../theme/colors';
import { nivelDeClub } from '../../utils/nivelClub';

/**
 * Chip del nivel del club (migración 199).
 *
 * Se lee por la cantidad de barras (1 a 5) y por el texto. Tiene un color
 * propio, lavanda, que no es victoria, empate, derrota ni dorado, y que NO es
 * el tema del club: el nivel tiene que leerse igual en un club rojo que en uno
 * azul. Competitivo lleva borde y velo lavanda; Élite va relleno.
 *
 * Sin nivel —o con un valor que la app no conoce— no dibuja nada: ni un chip
 * vacío ni «Sin nivel».
 *
 * @param {string|null} nivel   Valor de `clubs.nivel`.
 * @param {boolean} [compacto]  Tamaño de las tarjetas de rival.
 */
export default function NivelChip({ nivel, compacto = false, style }) {
  const def = nivelDeClub(nivel);
  if (!def) return null;

  const esElite = def.barras === 5;
  const esCompetitivo = def.barras === 4;

  return (
    <View
      accessibilityLabel={`Nivel ${def.label}`}
      style={[
        styles.chip,
        compacto && styles.chipCompacto,
        esCompetitivo && styles.chipCompetitivo,
        esElite && styles.chipElite,
        style,
      ]}
    >
      <Barras barras={def.barras} compacto={compacto} elite={esElite} />
      <Text
        style={[styles.texto, compacto && styles.textoCompacto, esElite && styles.textoElite]}
        numberOfLines={1}
      >
        {def.label}
      </Text>
    </View>
  );
}

/** Color de las barras encendidas: del gris al lavanda a medida que sube. */
function colorEncendido(barras, elite) {
  if (elite) return C.nivelInk;
  if (barras === 1) return C.nivelBarra1;
  if (barras === 2) return C.nivelBarra2;
  if (barras === 3) return C.nivelBarra3;
  return C.nivel;
}

export function Barras({ barras, compacto = false, elite = false }) {
  const base = compacto ? 4 : 5;
  const encendido = colorEncendido(barras, elite);
  return (
    <View style={styles.barras} importantForAccessibility="no-hide-descendants">
      {[0, 1, 2, 3, 4].map((i) => (
        <View
          key={i}
          style={[
            styles.barra,
            {
              height: base + i * 2,
              backgroundColor: i < barras ? encendido : C.nivelBarraApagada,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 7,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
  },
  chipCompacto: { height: 24 },
  chipCompetitivo: { backgroundColor: C.nivelSoft, borderColor: C.nivelBorder },
  chipElite: { backgroundColor: C.nivel, borderColor: C.nivel },
  texto: { color: C.textPrimary, fontSize: 12, fontFamily: F.bold },
  textoCompacto: { fontSize: 11 },
  textoElite: { color: C.nivelInk },
  barras: { flexDirection: 'row', alignItems: 'flex-end', gap: 1.5 },
  barra: { width: 3, borderRadius: 1 },
});
