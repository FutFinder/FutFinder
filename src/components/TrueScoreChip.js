import React from 'react';
import { View, Text } from 'react-native';

import { paleta as C, radios as R, fuentes as F, alfa } from '../theme/colors';
import { useTrueScoreAjustes } from '../services/trueScore';
import { nivelTrueScore } from '../utils/trueScore';

// El servidor dice el color por nombre; el tono sale de la única paleta.
const TONO = {
  verde: C.green,
  amarillo: C.amber,
  rojo: C.red,
};

/**
 * El TrueScore de un jugador con el color de su nivel (spec §1.4): lo ve el
 * organizador en solicitudes, lista de espera y nómina, y cualquiera en la
 * lista de jugadores del partido.
 *
 * Con TrueScore apagado se ve como siempre: «TS 80» en verde, sin nivel.
 * `conNivel` agrega el nombre («Confiable») cuando hay espacio.
 */
export default function TrueScoreChip({ score, conNivel = false, style }) {
  const ajustes = useTrueScoreAjustes();
  const nivel = ajustes.fase1 ? nivelTrueScore(score, ajustes.niveles) : null;
  const color = nivel ? TONO[nivel.color] || C.textSecondary : C.green;
  const texto = score == null ? 'TS N.A.' : `TS ${score}`;

  if (!nivel) {
    return <Text style={[{ fontSize: 11.5, fontFamily: F.bold, color }, style]}>{texto}</Text>;
  }

  return (
    <View
      accessibilityLabel={`TrueScore ${score}, ${nivel.nombre}`}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          gap: 5,
          paddingHorizontal: 7,
          paddingVertical: 2,
          borderRadius: R.chip,
          backgroundColor: alfa(color, 0.14),
        },
        style,
      ]}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
      <Text style={{ fontSize: 11.5, fontFamily: F.bold, color }}>
        {texto}
        {conNivel ? ` · ${nivel.nombre}` : ''}
      </Text>
    </View>
  );
}
