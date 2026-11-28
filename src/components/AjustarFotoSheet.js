import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Image, StyleSheet, PanResponder, Platform } from 'react-native';
import { Minus, Plus, RotateCcw } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import { Sheet, Button, IconButton } from './reservas/ui';
import {
  ZOOM_MAXIMO, ajusteInicial, ajusteConZoom, ajusteTrasArrastre, dibujoEnCaja,
  recorteDeAjuste, zoomPorPellizco,
} from '../utils/ajusteFoto';
import { recortarFoto } from '../services/storage';

/**
 * Sólo en la web se ajusta con esta hoja. En la app nativa el selector del
 * sistema ya recorta con zoom (`allowsEditing` de `pickImage`) y pasarla otra
 * vez por acá sería ajustar dos veces la misma foto.
 */
export const AJUSTE_PROPIO = Platform.OS === 'web';

/** Cuánto agranda o achica cada toque de los botones. */
const PASO = 1.25;

/** Un botón de la hoja que se apaga cuando no hace nada (ya está al mínimo, al máximo…). */
function Control({ icon, onPress, apagado, accessibilityLabel }) {
  return (
    <IconButton
      icon={icon}
      onPress={apagado ? undefined : onPress}
      accessibilityLabel={accessibilityLabel}
      style={apagado ? { opacity: 0.35 } : null}
    />
  );
}

const distancia = (a, b) => Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);

/**
 * Ajustar una foto antes de subirla: arrastrarla para moverla, pellizcarla o
 * usar − y + para achicarla o agrandarla.
 *
 * EL RECUADRO ES EL RESULTADO. Lo que queda dentro es exactamente lo que se
 * sube: el dibujo sale de `dibujoEnCaja`, que usa el mismo recorte que se le
 * pasa a `expo-image-manipulator` (ver `utils/ajusteFoto.js` y su prueba).
 *
 * `proporcion` es 1 para el logo y la foto de perfil, 16/9 para los banners;
 * `redonda` dibuja el recuadro en círculo para la foto de perfil, que se
 * muestra así. Al confirmar recorta la foto y devuelve el asset nuevo por
 * `onListo`; la subida la sigue haciendo la pantalla como antes.
 */
export default function AjustarFotoSheet({
  visible, asset, proporcion = 1, redonda = false, titulo = 'Ajusta la foto',
  maxDimension = 1600, onCancelar, onListo,
}) {
  const ancho = asset?.width || 0;
  const alto = asset?.height || 0;
  const [ajuste, setAjuste] = useState(() => ajusteInicial(ancho, alto));
  const [anchoCaja, setAnchoCaja] = useState(0);
  const [procesando, setProcesando] = useState(false);

  // Cada foto nueva empieza sin ajustar.
  useEffect(() => {
    setAjuste(ajusteInicial(ancho, alto));
    setProcesando(false);
  }, [asset?.uri, ancho, alto]);

  // El PanResponder se arma una sola vez: lee el estado por referencias.
  const datos = useRef({});
  datos.current = { ajuste, anchoCaja, ancho, alto, proporcion };
  const gesto = useRef({ base: null, dx: 0, dy: 0, distancia: 0, zoom: 1 });

  const arrastre = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      gesto.current = { base: datos.current.ajuste, dx: 0, dy: 0, distancia: 0, zoom: datos.current.ajuste.zoom };
    },
    onPanResponderMove: (evt, g) => {
      const d = datos.current;
      const toques = evt.nativeEvent.touches || [];
      if (toques.length >= 2) {
        // Pellizco: el zoom sigue la distancia entre los dedos.
        const ahora = distancia(toques[0], toques[1]);
        if (!gesto.current.distancia) {
          gesto.current = { ...gesto.current, base: d.ajuste, distancia: ahora, zoom: d.ajuste.zoom };
          return;
        }
        const z = zoomPorPellizco(gesto.current.zoom, gesto.current.distancia, ahora);
        setAjuste(ajusteConZoom(gesto.current.base, z, d.ancho, d.alto, d.proporcion));
        return;
      }
      if (gesto.current.distancia) {
        // Se levantó un dedo: el arrastre sigue desde donde quedó el pellizco.
        gesto.current = { base: d.ajuste, dx: g.dx, dy: g.dy, distancia: 0, zoom: d.ajuste.zoom };
      }
      setAjuste(ajusteTrasArrastre(
        gesto.current.base, g.dx - gesto.current.dx, g.dy - gesto.current.dy,
        d.anchoCaja, d.ancho, d.alto, d.proporcion,
      ));
    },
  }), []);

  // En el navegador del teléfono, sin esto el pellizco agranda la página
  // entera y el arrastre la desplaza en vez de mover la foto.
  const cajaRef = useRef(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || !cajaRef.current?.style) return;
    cajaRef.current.style.touchAction = 'none';
    cajaRef.current.style.cursor = 'grab';
  }, [visible, asset?.uri]);

  const zoom = (factor) => setAjuste((a) => ajusteConZoom(a, a.zoom * factor, ancho, alto, proporcion));
  const dib = dibujoEnCaja(ancho, alto, proporcion, ajuste);
  const tocado = ajuste.zoom > 1.001
    || Math.abs(ajuste.cx - ancho / 2) > 0.5 || Math.abs(ajuste.cy - alto / 2) > 0.5;

  const confirmar = async () => {
    setProcesando(true);
    const recorte = recorteDeAjuste(ancho, alto, proporcion, ajuste);
    const lista = recorte ? await recortarFoto(asset, recorte, { maxDimension }) : asset;
    setProcesando(false);
    onListo(lista);
  };

  return (
    <Sheet visible={visible} onClose={onCancelar} title={titulo}>
      <Text style={styles.ayuda}>
        Arrastra la foto para moverla y usa − y + (o pellizca) para agrandarla o achicarla. Lo
        que queda dentro del recuadro es lo que se va a ver.
      </Text>

      <View
        ref={cajaRef}
        style={[
          styles.caja,
          { aspectRatio: proporcion },
          proporcion === 1 && styles.cajaCuadrada,
          redonda && styles.cajaRedonda,
        ]}
        onLayout={(e) => setAnchoCaja(e.nativeEvent.layout.width)}
        accessibilityLabel="Vista previa de la foto ajustada"
        {...arrastre.panHandlers}
      >
        {asset?.uri ? (
          <Image
            source={{ uri: asset.uri }}
            style={{ position: 'absolute', left: dib.x, top: dib.y, width: dib.ancho, height: dib.alto }}
            resizeMode="stretch"
            draggable={false}
          />
        ) : null}
      </View>

      <View style={styles.controles}>
        <Control
          icon={Minus}
          onPress={() => zoom(1 / PASO)}
          apagado={ajuste.zoom <= 1.001}
          accessibilityLabel="Achicar la foto"
        />
        <View style={styles.barra} accessibilityLabel={`Zoom ${Math.round(ajuste.zoom * 100)} %`}>
          <View style={[styles.barraLlena, { width: `${((ajuste.zoom - 1) / (ZOOM_MAXIMO - 1)) * 100}%` }]} />
        </View>
        <Control
          icon={Plus}
          onPress={() => zoom(PASO)}
          apagado={ajuste.zoom >= ZOOM_MAXIMO - 0.001}
          accessibilityLabel="Agrandar la foto"
        />
        <Control
          icon={RotateCcw}
          onPress={() => setAjuste(ajusteInicial(ancho, alto))}
          apagado={!tocado}
          accessibilityLabel="Volver a la foto sin ajustar"
        />
      </View>

      <Button label="Usar esta foto" loading={procesando} onPress={confirmar} style={{ marginTop: 14 }} />
      <Button
        label="Elegir otra"
        variant="secondary"
        disabled={procesando}
        onPress={onCancelar}
        style={{ marginTop: 9 }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  ayuda: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  caja: {
    width: '100%', marginTop: 14, overflow: 'hidden',
    borderRadius: R.cardSm, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.green,
  },
  cajaCuadrada: { width: '70%', alignSelf: 'center' },
  cajaRedonda: { borderRadius: 9999 },
  controles: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  barra: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.border, overflow: 'hidden' },
  barraLlena: { height: '100%', backgroundColor: C.green },
});
