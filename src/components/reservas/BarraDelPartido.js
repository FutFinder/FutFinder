import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Swords, X, Clock } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../../theme/colors';
import { MODALIDADES } from '../../services/matchRules';
import { leerIntencion, olvidarIntencion, intencionCaducada } from '../../utils/intencionDeReserva';

/**
 * «Para: SixSiete vs Club prueba · Fútbol 7» (diseño «Clubes (preservas)»,
 * láminas 2 y 9).
 *
 * Mientras se reserva desde el chat de un desafío, TODO el flujo de Reservas
 * lleva el partido a la vista, con una forma clara de soltarlo. Una intención
 * invisible que cambia lo que se crea sería justo la magia que hace
 * desconfiar de una app cuando hay plata de por medio.
 *
 * Si la intención caducó (media hora), lo dice una vez —«soltamos el partido
 * de esta reserva»— en vez de que la barra desaparezca sin explicación.
 */
export default function BarraDelPartido({ navigation, onCambio }) {
  const [intencion, setIntencion] = useState(() => leerIntencion());
  const [caducada, setCaducada] = useState(null);

  useFocusEffect(
    useCallback(() => {
      const viva = leerIntencion();
      setIntencion(viva);
      if (!viva) setCaducada(intencionCaducada());
    }, [])
  );

  const soltar = () => {
    olvidarIntencion();
    setIntencion(null);
    setCaducada(null);
    onCambio?.(null);
  };

  if (caducada) {
    const hilo = caducada.challengeId ? `challenge:${caducada.challengeId}` : caducada.matchId ? `match:${caducada.matchId}` : null;
    return (
      <View style={[styles.barra, styles.barraAviso]}>
        <Clock color={C.amber} size={15} strokeWidth={2.2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.avisoTitulo}>Pasaron 30 minutos: soltamos el partido de esta reserva</Text>
          <Text style={styles.avisoTexto}>
            Para que quede ligada al partido, vuelve al chat y empieza de nuevo. O sigue con una reserva normal.
          </Text>
          <View style={styles.avisoBotones}>
            {hilo ? (
              <Pressable
                onPress={() => {
                  setCaducada(null);
                  navigation?.navigate('ChatThread', { threadKey: hilo, title: caducada.titulo || 'Desafío' });
                }}
                accessibilityRole="button"
                style={({ pressed }) => [styles.avisoBoton, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.avisoBotonTexto}>Volver al chat del desafío</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => setCaducada(null)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.avisoBoton, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.avisoBotonTexto}>Seguir sin partido</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  if (!intencion) return null;

  const modalidad = MODALIDADES.find((m) => m.value === intencion.modalidad)?.label;
  const texto = [intencion.titulo || 'Tu partido de clubes', modalidad].filter(Boolean).join(' · ');

  return (
    <View style={styles.barra} accessibilityLabel={`Reservando para ${texto}`}>
      <Swords color={C.green} size={15} strokeWidth={2.2} />
      <Text style={styles.texto} numberOfLines={1}>
        <Text style={styles.para}>{intencion.modo === 'elegir' ? 'Eligiendo para: ' : 'Para: '}</Text>
        {texto}
      </Text>
      <Pressable
        onPress={soltar}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Soltar el partido y reservar sin él"
        style={({ pressed }) => [styles.soltar, pressed && { opacity: 0.7 }]}
      >
        <X color={C.textSecondary} size={15} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  barra: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: R.chip,
    borderWidth: 1,
    borderColor: C.greenBorderStrong,
    backgroundColor: C.greenSoft,
  },
  texto: { flex: 1, color: C.textPrimary, fontSize: 13, fontFamily: F.bold },
  para: { color: C.green, fontFamily: F.extraBold },
  soltar: { width: 26, height: 26, alignItems: 'center', justifyContent: 'center' },
  barraAviso: { alignItems: 'flex-start', borderColor: C.amberSoft, backgroundColor: C.surface },
  avisoTitulo: { color: C.textPrimary, fontSize: 13, fontFamily: F.extraBold },
  avisoTexto: { color: C.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 2 },
  avisoBotones: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  avisoBoton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: R.chip,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
  },
  avisoBotonTexto: { color: C.textPrimary, fontSize: 12.5, fontFamily: F.bold },
});
