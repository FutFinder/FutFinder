import React, { useCallback, useState } from 'react';
import { Modal, Pressable, Text, StyleSheet } from 'react-native';

import {
  paleta as C,
  radios as R,
  fuentes as F,
} from '../theme/colors';

/**
 * Confirmar algo, con un diálogo de la app.
 *
 * REEMPLAZA A `window.confirm`, QUE EN WEB NO ABRE NADA. Tres pantallas
 * tenían su propia copia de un `confirmAction` que en `Platform.OS === 'web'`
 * llamaba a `window.confirm` — y el navegador lo descarta: devuelve `false`
 * en un milisegundo sin mostrar ningún cuadro. El resultado era que
 * **cerrar sesión no hacía nada, en silencio**, y lo mismo eliminar la
 * cuenta, borrar una foto del club o expulsar a un integrante.
 *
 * En silencio es lo peor de todo: el botón responde al toque, no aparece
 * ningún error, y la persona concluye que la app está rota sin saber qué
 * mirar. Se descubrió probando cerrar sesión en el navegador.
 *
 * `Alert.alert` de React Native tampoco sirve en web (no hace nada ahí), así
 * que la única salida que funciona en los tres lados es un Modal propio —
 * que además se ve como la app y no como el navegador.
 *
 * LA ACCIÓN DESTRUCTIVA NUNCA ES LA QUE SE APRIETA SIN QUERER: «Cancelar»
 * está abajo y sin color, y tocar fuera del cuadro cierra sin hacer nada.
 */
export default function useConfirmacion() {
  const [pendiente, setPendiente] = useState(null);

  const confirmar = useCallback((titulo, mensaje, alConfirmar, opciones = {}) => {
    setPendiente({ titulo, mensaje, alConfirmar, ...opciones });
  }, []);

  const cerrar = useCallback(() => setPendiente(null), []);

  const aceptar = useCallback(() => {
    const accion = pendiente?.alConfirmar;
    // Se cierra ANTES de ejecutar: si la acción navega a otra pantalla —como
    // cerrar sesión— el diálogo se quedaría montado encima de la nueva.
    setPendiente(null);
    if (accion) accion();
  }, [pendiente]);

  const dialogo = (
    <Modal
      visible={!!pendiente}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={cerrar}
    >
      <Pressable style={styles.fondo} onPress={cerrar}>
        <Pressable style={styles.caja} onPress={() => {}}>
          <Text style={styles.titulo}>{pendiente?.titulo}</Text>
          {pendiente?.mensaje ? <Text style={styles.texto}>{pendiente.mensaje}</Text> : null}

          <Pressable
            onPress={aceptar}
            accessibilityRole="button"
            accessibilityLabel={pendiente?.confirmar || 'Confirmar'}
            style={({ pressed }) => [styles.confirmar, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.confirmarTexto}>{pendiente?.confirmar || 'Confirmar'}</Text>
          </Pressable>

          <Pressable
            onPress={cerrar}
            accessibilityRole="button"
            accessibilityLabel="Cancelar"
            style={({ pressed }) => [styles.cancelar, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.cancelarTexto}>Cancelar</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );

  return { confirmar, dialogo };
}

const styles = StyleSheet.create({
  fondo: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  caja: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: C.surface,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.border,
    padding: 20,
  },
  titulo: { color: C.textPrimary, fontSize: 17, fontFamily: F.extraBold },
  texto: { color: C.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6 },
  confirmar: {
    marginTop: 18,
    height: 46,
    borderRadius: R.row,
    backgroundColor: C.loss,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmarTexto: { color: '#FFFFFF', fontSize: 15, fontFamily: F.extraBold },
  cancelar: { marginTop: 10, height: 44, alignItems: 'center', justifyContent: 'center' },
  cancelarTexto: { color: C.textSecondary, fontSize: 14, fontFamily: F.bold },
});
