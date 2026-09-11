import React, { useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';

import { reservas as C, reservasRadius as R, reservasFonts as F } from '../../theme/colors';
import { Sheet, Button } from './ui';
import {
  ANCLAJES, PROPORCION_PORTADA, encuadreEnCaja, nombreDeAnclaje, queSobra,
} from '../../utils/encuadre';

/**
 * Elegir qué parte de la foto se queda.
 *
 * POR QUÉ EXISTE. Las fotos del recinto se muestran en cajas horizontales y
 * nadie saca fotos horizontales: una cámara de teléfono da 4:3 acostada o 3:4
 * parada. En 16:9, una foto parada conserva el 42 % de su alto — y hasta acá
 * ese 42 % lo elegía el programa por el medio, así que una cancha fotografiada
 * desde la galería terminaba siendo una franja de gradas.
 *
 * TRES OPCIONES Y NO UN RECORTE LIBRE, a propósito. Lo único que hay que
 * decidir es con qué tercio quedarse; un recorte con gestos obliga a resolver
 * arrastres en web y en teléfono, y para esta decisión no agrega nada.
 *
 * LA VISTA PREVIA NO ES UNA APROXIMACIÓN. Sale de `encuadreEnCaja`, que hace
 * la misma cuenta que el recorte real pero en porcentajes, y hay una prueba
 * que compara las dos: si se separan, la persona elegiría una cosa y se
 * guardaría otra.
 *
 * NADA SE MIDE. La primera versión medía la caja con `onLayout` para calcular
 * desplazamientos en píxeles, y adentro de un modal esa medición a veces no
 * llegaba nunca: la vista previa quedaba vacía sin decir por qué. En
 * porcentajes la caja ya tiene su proporción fijada y no hay qué esperar.
 */
export default function EncuadreSheet({ visible, asset, onCancelar, onConfirmar, guardando }) {
  const [anclaje, setAnclaje] = useState('centro');

  // Lo que sobra decide los nombres: en una foto parada se elige entre arriba
  // y abajo; en una panorámica, entre izquierda y derecha.
  const orientacion = queSobra(asset?.width, asset?.height, PROPORCION_PORTADA) || 'vertical';
  const enc = encuadreEnCaja(asset?.width, asset?.height, PROPORCION_PORTADA, anclaje);

  return (
    <Sheet visible={visible} onClose={onCancelar} title="¿Qué parte se ve?">
      <Text style={styles.ayuda}>
        La foto se muestra horizontal, así que hay que sacarle un poco. Elige con qué parte te
        quedas: esto es exactamente lo que va a ver el jugador.
      </Text>

      <View style={styles.caja}>
        {asset?.uri ? (
          <Image
            source={{ uri: asset.uri }}
            style={{
              position: 'absolute',
              left: enc.x,
              top: enc.y,
              width: enc.ancho,
              height: enc.alto,
            }}
            resizeMode="cover"
            accessibilityLabel="Vista previa del encuadre"
          />
        ) : null}
      </View>

      <View style={styles.opciones}>
        {ANCLAJES.map((a) => {
          const on = a === anclaje;
          return (
            <Pressable
              key={a}
              onPress={() => setAnclaje(a)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.opcion, on && styles.opcionOn, pressed && { opacity: 0.9 }]}
            >
              <Text style={[styles.opcionTexto, on && styles.opcionTextoOn]}>
                {nombreDeAnclaje(a, orientacion)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button
        label="Usar esta foto"
        loading={guardando}
        onPress={() => onConfirmar(anclaje)}
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
