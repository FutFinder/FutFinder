import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, Check, Info } from 'lucide-react-native';

import { partidos as P, partidosRadius as R } from '../theme/colors';
import {
  duracionDeAviso, quitarAviso, suscribirseAAvisos,
} from '../utils/avisos';

/**
 * Dónde se pintan los avisos de `notify()`.
 *
 * VA ARRIBA Y NO ABAJO. Abajo compite con la barra de pestañas y con el
 * teclado, que es justo lo que está abierto cuando algo falla al escribir o
 * al enviar. Arriba siempre hay lugar.
 *
 * SE PUEDE TOCAR PARA CERRAR. Un error que dura seis segundos estorba si ya
 * lo leíste, y uno que se va solo antes de que levantes la vista no sirve de
 * nada: las dos salidas tienen que existir.
 *
 * Se monta UNA vez, en la raíz de la app, por fuera del navegador: así un
 * aviso sobrevive a un cambio de pantalla —el error de una acción que
 * navega se leería a medias si muriera con la pantalla que lo lanzó.
 */
export default function AvisosHost() {
  const [avisos, setAvisos] = useState([]);
  const insets = useSafeAreaInsets();

  useEffect(() => suscribirseAAvisos(setAvisos), []);

  // Cada aviso se va solo cuando le toca. El temporizador vive acá y no en
  // la cola para que un aviso no empiece a consumir su tiempo antes de que
  // exista alguien que lo muestre.
  useEffect(() => {
    if (avisos.length === 0) return undefined;
    const relojes = avisos.map((a) =>
      setTimeout(() => quitarAviso(a.id), duracionDeAviso(a.tono)));
    return () => relojes.forEach(clearTimeout);
  }, [avisos]);

  if (avisos.length === 0) return null;

  return (
    <View style={[styles.capa, { top: insets.top + 8 }]} pointerEvents="box-none">
      {avisos.map((a) => {
        const Icono = a.tono === 'error' ? AlertTriangle : a.tono === 'exito' ? Check : Info;
        const color = a.tono === 'error' ? P.coral : a.tono === 'exito' ? P.green : P.textSoft;
        return (
          <Pressable
            key={a.id}
            onPress={() => quitarAviso(a.id)}
            accessibilityRole="alert"
            accessibilityLabel={a.mensaje ? `${a.titulo}. ${a.mensaje}` : a.titulo}
            style={({ pressed }) => [styles.aviso, pressed && { opacity: 0.85 }]}
          >
            <Icono color={color} size={17} strokeWidth={2.2} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.titulo, { color }]}>{a.titulo}</Text>
              {a.mensaje ? <Text style={styles.mensaje}>{a.mensaje}</Text> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  capa: {
    position: 'absolute',
    left: 12,
    right: 12,
    gap: 8,
    zIndex: 9999,
    alignItems: 'center',
  },
  aviso: {
    width: '100%',
    maxWidth: 420,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: R.card,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.borderStrong,
    // La sombra es lo que lo despega de la pantalla que hay debajo: sin
    // ella, encima de una tarjeta oscura parece parte de la lista.
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  titulo: { fontSize: 14, fontWeight: '800', letterSpacing: -0.2 },
  mensaje: { color: P.textDim, fontSize: 12.5, lineHeight: 17.5, marginTop: 3 },
});
