import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';

import { clubColors, clubRadius } from '../../theme/colors';
import { TEMAS_CLUB, temaClub } from '../../theme/clubThemes';

/**
 * Selector del tema de color del club: cuatro tarjetas con un círculo de
 * color, el nombre debajo, borde del propio color cuando está elegida y un
 * check dentro del círculo.
 *
 * NO HAY COLOR LIBRE. Las opciones salen de `TEMAS_CLUB`; acá no se escribe
 * ningún HEX ni se pregunta por una clave concreta. Agregar un tema quinto
 * es agregarlo en `theme/clubThemes.js` y nada más.
 *
 * El check va en la tinta del propio tema (`ink`), no en blanco: sobre el
 * amarillo un check blanco no se ve.
 *
 * @param {string} value      Clave elegida ahora mismo (previsualización).
 * @param {(clave: string) => void} onChange
 * @param {boolean} disabled  Mientras se guarda.
 */
export default function ClubThemePicker({ value, onChange, disabled = false }) {
  return (
    <View
      style={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel="Tema de color del club"
    >
      {TEMAS_CLUB.map((opcion) => {
        const escala = temaClub(opcion.value);
        const elegida = value === opcion.value;

        return (
          <Pressable
            key={opcion.value}
            onPress={() => onChange?.(opcion.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityState={{ selected: elegida, disabled }}
            accessibilityLabel={`Tema ${opcion.label}`}
            style={({ pressed }) => [
              styles.card,
              elegida && { borderColor: escala.main, backgroundColor: escala.soft },
              pressed && !disabled && { backgroundColor: escala.softStrong },
              disabled && styles.disabled,
            ]}
          >
            <View style={[styles.swatch, { backgroundColor: escala.main }]}>
              {elegida ? <Check color={escala.ink} size={18} strokeWidth={3} /> : null}
            </View>
            <Text
              style={[styles.label, elegida && { color: escala.main, fontWeight: '700' }]}
              numberOfLines={1}
            >
              {opcion.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  card: {
    flexGrow: 1,
    flexBasis: 70,
    minHeight: 88,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 6,
    borderRadius: clubRadius.md,
    borderWidth: 1.5,
    borderColor: clubColors.borderSoft,
    backgroundColor: clubColors.surfaceAlt,
  },
  disabled: { opacity: 0.5 },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: clubColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
});
