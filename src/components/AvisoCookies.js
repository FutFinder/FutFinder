import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Cookie } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { avisoCookiesPendiente, marcarAvisoCookiesVisto } from '../utils/avisoCookies';

/**
 * Aviso de cookies de la versión web.
 *
 * Sólo en web: en el teléfono no hay cookies de navegador y lo que la app
 * guarda en el dispositivo ya lo explica la política, igual que cualquier
 * app nativa. Se monta una vez en la raíz, por fuera del navegador, para que
 * aparezca en cualquier pantalla por la que alguien entre (un enlace a un
 * partido, por ejemplo) y no sólo en Bienvenida.
 *
 * Va abajo, al revés que los avisos de `AvisosHost`: no es urgente y no debe
 * tapar el encabezado de la pantalla por la que se entró.
 */
export default function AvisoCookies({ onVerDetalle }) {
  const [visible, setVisible] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    let vivo = true;
    avisoCookiesPendiente().then((pendiente) => {
      if (vivo) setVisible(pendiente);
    });
    return () => { vivo = false; };
  }, []);

  if (!visible) return null;

  const cerrar = () => {
    setVisible(false);
    marcarAvisoCookiesVisto();
  };

  return (
    <View
      pointerEvents="box-none"
      style={[styles.capa, { paddingBottom: Math.max(insets.bottom, 16) }]}
    >
      <View style={styles.caja} accessibilityRole="alert">
        <View style={styles.fila}>
          <Cookie color={C.green} size={20} />
          <Text style={styles.texto}>
            FutFinder no usa cookies de publicidad ni de seguimiento. Guardamos en tu navegador
            solo lo necesario para mantener tu sesión y tus preferencias.
          </Text>
        </View>
        <View style={styles.botones}>
          <Pressable
            onPress={() => { cerrar(); onVerDetalle?.(); }}
            accessibilityRole="link"
            style={({ pressed }) => [styles.boton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.botonSecundario}>Ver detalle</Text>
          </Pressable>
          <Pressable
            onPress={cerrar}
            accessibilityRole="button"
            style={({ pressed }) => [styles.boton, styles.botonPrimario, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.botonPrimarioTexto}>Entendido</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capa: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  caja: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.borderSoft,
    padding: 16,
    gap: 14,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  fila: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  texto: {
    flex: 1,
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: F.medium,
  },
  botones: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  boton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
  },
  botonSecundario: { color: C.textPrimary, fontFamily: F.semiBold, fontSize: 13 },
  botonPrimario: { backgroundColor: C.green },
  botonPrimarioTexto: { color: C.textOnGreen, fontFamily: F.bold, fontSize: 13 },
});
