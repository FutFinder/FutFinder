import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';

import { paleta as C, fuentes as F, radios as R } from '../../theme/colors';
import { NIVELES_CLUB } from '../../utils/nivelClub';
import { Barras } from './NivelChip';

/**
 * Selector del nivel del club, para «Crear club» y «Editar club»
 * (migración 199). Es opcional: volver a tocar el elegido lo quita, y
 * `conSinNivel` agrega la fila explícita «Sin nivel», que es la que ofrece
 * Editar para que quitarlo no dependa de adivinar ese gesto.
 *
 * La fila elegida se marca con el verde de la app y no con el tema del club:
 * es un control del formulario, no la identidad del club.
 */
export default function NivelSelector({ value, onChange, disabled = false, conSinNivel = false }) {
  return (
    <View style={styles.lista} accessibilityRole="radiogroup">
      {NIVELES_CLUB.map((n) => (
        <Fila
          key={n.value}
          activa={value === n.value}
          disabled={disabled}
          onPress={() => onChange(value === n.value ? null : n.value)}
          titulo={n.label}
          desc={n.desc}
          barras={n.barras}
        />
      ))}
      {conSinNivel ? (
        <Fila
          activa={!value}
          disabled={disabled}
          onPress={() => onChange(null)}
          titulo="Sin nivel"
          desc="No se muestra ningún nivel en el club."
          barras={0}
        />
      ) : null}
    </View>
  );
}

function Fila({ activa, disabled, onPress, titulo, desc, barras }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: activa, disabled }}
      accessibilityLabel={`${titulo}. ${desc}`}
      style={({ pressed }) => [
        styles.fila,
        activa && styles.filaActiva,
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={styles.barras}>
        <Barras barras={barras} elite={false} />
      </View>
      <View style={styles.textos}>
        <Text style={styles.titulo}>{titulo}</Text>
        <Text style={styles.desc}>{desc}</Text>
      </View>
      {activa ? <Check color={C.green} size={18} strokeWidth={2.6} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lista: { gap: 8 },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
  },
  filaActiva: { borderColor: C.green, backgroundColor: C.selectedBg },
  barras: { width: 22, alignItems: 'center' },
  textos: { flex: 1, minWidth: 0 },
  titulo: { color: C.textPrimary, fontSize: 15, fontFamily: F.bold },
  desc: { color: C.textSecondary, fontSize: 12.5, marginTop: 2 },
});
