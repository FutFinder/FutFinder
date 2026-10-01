import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Search as SearchIcon } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F, alfa } from '../theme/colors';
import {
  boundsDesdeRegion,
  regionDesdeMapa,
  etiquetaDelPartido,
  fmtHora,
} from '../utils/regionMapa';

/**
 * El mapa de la pestaña Buscar, en web.
 *
 * ANTES ESTE ARCHIVO DEVOLVÍA `null`, y eso no era «web se queda con la
 * lista»: el botón «Ver en el mapa» de `PartidosScreen` se dibuja sin
 * ninguna guarda de plataforma, así que en el navegador abría una vista
 * VACÍA. Era un botón muerto, no una decisión de alcance.
 *
 * POR QUÉ MAPBOX. `react-native-maps` no funciona en web. Mapbox ya es
 * parte del producto —`LocationAutocomplete` usa su Search Box API con el
 * mismo `EXPO_PUBLIC_MAPBOX_TOKEN`— así que no entra un proveedor nuevo
 * ni una cuenta nueva. **Ojo con el costo:** Mapbox cobra por carga de
 * mapa, y esto es una carga cada vez que alguien abre la pestaña en el
 * navegador. El autocompletado cobra por sesión de búsqueda, que es otra
 * cosa.
 *
 * SE CARGA DESDE EL CDN Y SÓLO CUANDO HACE FALTA, no como dependencia:
 * Mapbox GL pesa unos 200 KB comprimidos y el 100 % de las personas que
 * no abren el mapa no tendría por qué pagarlos en el bundle. La etiqueta
 * se inyecta una vez y queda cacheada por el navegador.
 *
 * FALLA HACIA LA LISTA, NUNCA HACIA UNA CAJA ROTA. Sin token, sin red o
 * con el script caído, el componente devuelve `null` —exactamente lo que
 * hacía antes— y la pantalla conserva su lista y sus filtros. Un mapa que
 * no carga no puede ser peor que no tener mapa.
 *
 * El contrato de props es el MISMO de `MatchMap.native.js`, para que
 * `PartidosScreen` y `MatchPreviewSheet` no sepan en qué plataforma están.
 */

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const ESTILO = 'mapbox://styles/mapbox/dark-v11';
const VERSION = 'v3.6.0';

let promesaDeCarga = null;

/**
 * Trae Mapbox GL una sola vez. Las llamadas siguientes reutilizan la
 * misma promesa: dos mapas en pantalla no pueden inyectar dos scripts.
 */
function cargarMapbox() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve(null);
  }
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);
  if (promesaDeCarga) return promesaDeCarga;

  promesaDeCarga = new Promise((resolve) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://api.mapbox.com/mapbox-gl-js/${VERSION}/mapbox-gl.css`;
    document.head.appendChild(css);

    const js = document.createElement('script');
    js.src = `https://api.mapbox.com/mapbox-gl-js/${VERSION}/mapbox-gl.js`;
    js.async = true;
    js.onload = () => resolve(window.mapboxgl || null);
    js.onerror = () => {
      // No se reintenta ni se avisa en pantalla: la lista sigue ahí y es
      // lo que la persona vino a hacer.
      console.warn('[FutFinder] no se pudo cargar el mapa; se queda la lista');
      promesaDeCarga = null;
      resolve(null);
    };
    document.head.appendChild(js);
  });
  return promesaDeCarga;
}

/** La chapita de un partido, como elemento del DOM. */
function crearChapita(texto, seleccionada) {
  const el = document.createElement('div');
  el.textContent = texto;
  el.style.cssText = [
    'font-family:' + (F?.semi || 'inherit'),
    'font-size:11px',
    'line-height:1',
    'padding:6px 9px',
    'border-radius:999px',
    'white-space:nowrap',
    'cursor:pointer',
    'transform:translateY(-6px)',
    `background:${seleccionada ? C.green : C.surface}`,
    `color:${seleccionada ? C.textOnGreen : C.textPrimary}`,
    `border:1px solid ${seleccionada ? C.green : C.border}`,
    'box-shadow:0 2px 8px rgba(0,0,0,.45)',
  ].join(';');
  return el;
}

/** El punto de «tú estás aquí». */
function crearPuntoPropio() {
  const el = document.createElement('div');
  el.style.cssText = [
    'width:14px', 'height:14px', 'border-radius:999px',
    `background:${C.green}`, `border:2px solid ${C.bg}`,
    `box-shadow:0 0 0 4px ${alfa(C.green, 0.25)}`,
  ].join(';');
  return el;
}

export default function MatchMap({
  initialRegion,
  matches = [],
  selectedId,
  onSelectMarker,
  onRegionChange,
  onSearchHere,
  showSearchHere = false,
  onTouchStart,
  onTouchEnd,
  userCoords,
}) {
  const contenedor = useRef(null);
  const mapa = useRef(null);
  const marcadores = useRef(new Map());
  const puntoPropio = useRef(null);
  const [listo, setListo] = useState(false);
  const [hayMapa, setHayMapa] = useState(Boolean(TOKEN));

  // Las props viven en una ref para que los listeners del mapa —que se
  // registran una sola vez— siempre vean la versión actual sin tener que
  // recrear el mapa en cada render.
  const props = useRef({ onRegionChange, onSelectMarker, onTouchStart, onTouchEnd });
  props.current = { onRegionChange, onSelectMarker, onTouchStart, onTouchEnd };

  useEffect(() => {
    if (!TOKEN) return undefined;
    let vivo = true;

    cargarMapbox().then((mapboxgl) => {
      if (!vivo || !mapboxgl || !contenedor.current || mapa.current) {
        if (vivo && !mapboxgl) setHayMapa(false);
        return;
      }
      mapboxgl.accessToken = TOKEN;
      const m = new mapboxgl.Map({
        container: contenedor.current,
        style: ESTILO,
        center: [initialRegion?.longitude ?? -70.6483, initialRegion?.latitude ?? -33.4569],
        zoom: 12,
        attributionControl: true,
      });
      mapa.current = m;

      const bounds = boundsDesdeRegion(initialRegion);
      if (bounds) m.fitBounds(bounds, { animate: false, padding: 10 });

      m.on('load', () => { if (vivo) setListo(true); });
      m.on('dragstart', () => props.current.onTouchStart?.());
      m.on('dragend', () => props.current.onTouchEnd?.());
      m.on('moveend', () => {
        const b = m.getBounds();
        const region = regionDesdeMapa({
          centro: m.getCenter(),
          bounds: [[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]],
        });
        if (region) props.current.onRegionChange?.(region);
      });
    });

    // Las refs se copian ANTES de devolver la limpieza: para cuando ésta
    // corra, `marcadores.current` puede apuntar a otra cosa.
    const vivos = marcadores.current;
    return () => {
      vivo = false;
      vivos.forEach((mk) => mk.marcador.remove());
      vivos.clear();
      puntoPropio.current?.remove();
      puntoPropio.current = null;
      mapa.current?.remove();
      mapa.current = null;
    };
    // El mapa se crea UNA vez. La región inicial sólo lo encuadra al
    // nacer; moverlo después es cosa de quien lo arrastra.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Los marcadores se sincronizan por id: se agregan los nuevos, se
  // quitan los que ya no están y se redibuja el que cambia de selección.
  // Recrearlos todos en cada render haría parpadear el mapa entero.
  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo || !window.mapboxgl) return;

    const vistos = new Set();
    for (const partido of matches) {
      if (partido?.latitud == null || partido?.longitud == null) continue;
      vistos.add(partido.id);
      const seleccionado = selectedId === partido.id;
      const previo = marcadores.current.get(partido.id);
      if (previo && previo.seleccionado === seleccionado) continue;
      previo?.marcador.remove();

      const el = crearChapita(etiquetaDelPartido(partido, fmtHora), seleccionado);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        props.current.onSelectMarker?.(partido);
      });
      const marcador = new window.mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([partido.longitud, partido.latitud])
        .addTo(m);
      marcadores.current.set(partido.id, { marcador, seleccionado });
    }
    for (const [id, mk] of marcadores.current) {
      if (!vistos.has(id)) { mk.marcador.remove(); marcadores.current.delete(id); }
    }
  }, [matches, selectedId, listo]);

  useEffect(() => {
    const m = mapa.current;
    if (!m || !listo || !window.mapboxgl) return;
    puntoPropio.current?.remove();
    puntoPropio.current = null;
    const lat = Number(userCoords?.lat);
    const lng = Number(userCoords?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    puntoPropio.current = new window.mapboxgl.Marker({ element: crearPuntoPropio() })
      .setLngLat([lng, lat])
      .addTo(m);
  }, [userCoords, listo]);

  // Sin token o sin script: exactamente lo que había antes.
  if (!hayMapa) return null;

  return (
    <View style={styles.wrap}>
      <View ref={contenedor} style={styles.map} />
      {showSearchHere && (
        <Pressable
          onPress={onSearchHere}
          style={({ pressed }) => [styles.searchHere, pressed && { opacity: 0.85 }]}
        >
          <SearchIcon color={C.green} size={13} />
          <Text style={styles.searchHereText}>Buscar en esta zona</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 320,
    borderRadius: R.lg,
    overflow: 'hidden',
    backgroundColor: C.surface,
  },
  map: { width: '100%', height: '100%' },
  searchHere: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchHereText: { color: C.textPrimary, fontSize: 12, fontFamily: F.semi },
});
