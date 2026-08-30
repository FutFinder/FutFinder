import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, Easing } from 'react-native';

import { clubSuperficies } from '../../theme/colors';

/**
 * La portada mientras carga.
 *
 * REPRODUCE LA SILUETA REAL, no un spinner centrado. Un `ActivityIndicator`
 * no dice nada de lo que viene y hace que el contenido «salte» al llegar;
 * este esqueleto reserva el sitio de cada bloque, así que la pantalla se
 * rellena en vez de reconstruirse.
 *
 * El desfase de 100 ms por bloque hace que el latido recorra la pantalla en
 * vez de parpadear entera de golpe, que se lee como un fallo.
 *
 * Sin color de tema: mientras carga todavía no se sabe cuál es el club
 * activo, y estrenar un color para cambiarlo un segundo después es peor que
 * no tenerlo.
 */
export default function SkeletonHome() {
  return (
    <View style={styles.pantalla} accessibilityLabel="Cargando tu club">
      <Bloque indice={0} style={styles.titulo} />

      <View style={styles.grupo}>
        <Bloque indice={1} style={styles.tarea} />
        <Bloque indice={2} style={styles.tarea} />
        <Bloque indice={3} style={styles.tarea} />
      </View>

      <Bloque indice={4} style={styles.destacada} />

      <View style={styles.grilla}>
        <Bloque indice={5} style={styles.tile} />
        <Bloque indice={6} style={styles.tile} />
        <Bloque indice={7} style={styles.tile} />
      </View>
    </View>
  );
}

const DURACION = 1400;
const DESFASE = 100;

function Bloque({ indice, style }) {
  const opacidad = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    // El desfase va FUERA del bucle. Dentro, se volvía a aplicar en cada
    // vuelta: el ciclo de cada bloque duraba 1400 + indice*100 ms y la onda
    // se desarmaba a los pocos segundos, latiendo cada uno por su cuenta.
    const bucle = Animated.sequence([
      Animated.delay(indice * DESFASE),
      Animated.loop(
        Animated.sequence([
          Animated.timing(opacidad, {
            toValue: 0.75,
            duration: DURACION / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacidad, {
            toValue: 0.35,
            duration: DURACION / 2,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ),
    ]);
    bucle.start();
    return () => bucle.stop();
  }, [indice, opacidad]);

  return <Animated.View style={[styles.bloque, style, { opacity: opacidad }]} />;
}

const styles = StyleSheet.create({
  pantalla: { paddingHorizontal: 16, paddingTop: 8, gap: 22 },
  bloque: { backgroundColor: clubSuperficies.card, borderRadius: 14 },
  titulo: { width: '45%', height: 30, borderRadius: 10 },
  grupo: { gap: 9 },
  tarea: { height: 64, borderRadius: 17 },
  destacada: { height: 250, borderRadius: 22 },
  grilla: { flexDirection: 'row', gap: 9 },
  tile: { flex: 1, height: 86, borderRadius: 17 },
});
