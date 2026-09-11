import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable, PanResponder } from 'react-native';

import { reservas as C, reservasRadius as R, reservasFonts as F } from '../../theme/colors';
import { Sheet, Button } from './ui';
import {
  POSICIONES, PROPORCION_PORTADA, encuadreEnCaja, nombreDePosicion,
  posicionTrasArrastre, queSobra, recorridoDeArrastre,
} from '../../utils/encuadre';

/**
 * Elegir qué parte de la foto se queda.
 *
 * POR QUÉ EXISTE. Las fotos del recinto se muestran en cajas horizontales y
 * nadie saca fotos horizontales: una cámara de teléfono da 4:3 acostada o 3:4
 * parada. En 16:9, una foto parada conserva el 42 % de su alto — y ese 42 % lo
 * elegía el programa por el medio, así que una cancha fotografiada de pie
 * terminaba siendo una franja de gradas.
 *
 * SE ARRASTRA LA FOTO, Y LOS TRES BOTONES SON ATAJOS. Primero esto ofrecía
 * solo arriba/centro/abajo; sirve para salir del paso pero no para dejar algo
 * bien encuadrado, y encuadrar es justamente lo que se está haciendo acá. El
 * recorte tiene un único grado de libertad —el rectángulo siempre ocupa todo
 * el ancho y tiene la proporción de destino— así que «personalizar» es mover
 * un número entre 0 y 1, y el arrastre y los botones escriben en el mismo.
 *
 * LA VISTA PREVIA NO ES UNA APROXIMACIÓN. Sale de `encuadreEnCaja`, que hace
 * la misma cuenta que el recorte real pero en porcentajes, y hay una prueba
 * que compara las dos sobre posiciones sueltas, no solo sobre los atajos: si
 * se separan, la persona encuadra una cosa y se guarda otra.
 *
 * LO ÚNICO QUE SE MIDE ES PARA EL ARRASTRE. El dibujo va en porcentajes y no
 * necesita medición —medirlo dentro de un modal a veces no llegaba nunca y la
 * hoja quedaba vacía— pero el gesto viene en píxeles y hay que traducirlo. Si
 * la medición todavía no llegó, el recorrido es 0, el arrastre no hace nada y
 * los atajos siguen funcionando.
 */
export default function EncuadreSheet({ visible, asset, onCancelar, onConfirmar, guardando }) {
  const [posicion, setPosicion] = useState(0.5);
  const [caja, setCaja] = useState({ ancho: 0, alto: 0 });

  // El PanResponder se arma una sola vez, así que no puede leer el estado
  // directamente: leería el de la primera vuelta. Estas referencias son lo que
  // mira durante el gesto.
  const posRef = useRef(0.5);
  const inicioRef = useRef(0.5);
  const datosRef = useRef({ asset: null, caja: { ancho: 0, alto: 0 } });
  datosRef.current = { asset, caja };

  const sobra = queSobra(asset?.width, asset?.height, PROPORCION_PORTADA);
  const orientacion = sobra || 'vertical';

  const mover = (posicionNueva) => {
    posRef.current = posicionNueva;
    setPosicion(posicionNueva);
  };

  const arrastre = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { inicioRef.current = posRef.current; },
    onPanResponderMove: (_evt, gesto) => {
      const { asset: a, caja: k } = datosRef.current;
      const eje = queSobra(a?.width, a?.height, PROPORCION_PORTADA);
      if (!eje) return;
      const ladoCaja = eje === 'vertical' ? k.alto : k.ancho;
      const recorrido = recorridoDeArrastre(a?.width, a?.height, PROPORCION_PORTADA, ladoCaja);
      const desplazamiento = eje === 'vertical' ? gesto.dy : gesto.dx;
      const nueva = posicionTrasArrastre(inicioRef.current, desplazamiento, recorrido);
      posRef.current = nueva;
      setPosicion(nueva);
    },
  }), []);

  const enc = encuadreEnCaja(asset?.width, asset?.height, PROPORCION_PORTADA, posicion);

  return (
    <Sheet visible={visible} onClose={onCancelar} title="¿Qué parte se ve?">
      <Text style={styles.ayuda}>
        {sobra === 'horizontal'
          ? 'La foto es más ancha que el espacio. Arrástrala de lado para acomodarla: esto es exactamente lo que va a ver el jugador.'
          : 'La foto es más alta que el espacio. Arrástrala para acomodarla: esto es exactamente lo que va a ver el jugador.'}
      </Text>

      <View
        style={styles.caja}
        onLayout={(e) => setCaja({
          ancho: e.nativeEvent.layout.width,
          alto: e.nativeEvent.layout.height,
        })}
        {...arrastre.panHandlers}
      >
        {asset?.uri ? (
          <Image
            source={{ uri: asset.uri }}
            style={{ position: 'absolute', left: enc.x, top: enc.y, width: enc.ancho, height: enc.alto }}
            resizeMode="cover"
            accessibilityLabel="Vista previa del encuadre"
          />
        ) : null}
      </View>

      <View style={styles.opciones}>
        {POSICIONES.map((op) => {
          // Se marca solo si la posición cae justo en el atajo. Después de
          // arrastrar no queda ninguno encendido, que es la verdad.
          const on = Math.abs(posicion - op.valor) < 0.001;
          return (
            <Pressable
              key={op.clave}
              onPress={() => mover(op.valor)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.opcion, on && styles.opcionOn, pressed && { opacity: 0.9 }]}
            >
              <Text style={[styles.opcionTexto, on && styles.opcionTextoOn]}>
                {nombreDePosicion(op.clave, orientacion)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button
        label="Usar esta foto"
        loading={guardando}
        onPress={() => onConfirmar(posicion)}
        style={{ marginTop: 14 }}
      />
      <Button
        label="Elegir otra"
        variant="secondary"
        disabled={guardando}
        onPress={onCancelar}
        style={{ marginTop: 9 }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  ayuda: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  caja: {
    width: '100%', aspectRatio: PROPORCION_PORTADA, marginTop: 14,
    borderRadius: R.cardSm, overflow: 'hidden',
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  opciones: { flexDirection: 'row', gap: 8, marginTop: 12 },
  opcion: {
    flex: 1, paddingVertical: 10, alignItems: 'center',
    borderRadius: R.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  opcionOn: { borderColor: C.green, backgroundColor: C.selectedBg },
  opcionTexto: { fontFamily: F.semiBold, fontSize: 12.5, color: C.textSecondary },
  opcionTextoOn: { color: C.green, fontFamily: F.bold },
});
