import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Platform,
} from 'react-native';
import { MapPin, Search as SearchIcon } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';

/**
 * Buscador de lugares con autocompletado.
 *
 * Proveedor:
 *   - Si está definido EXPO_PUBLIC_MAPBOX_TOKEN → usa Mapbox Search Box API
 *     (la nueva, mucho mejor cobertura de POIs/negocios pequeños).
 *   - Si no, cae a Nominatim (OpenStreetMap) como respaldo gratuito.
 *
 * Search Box API:
 *   - "suggest" devuelve nombres sin coords (cuenta como búsquedas en sesión).
 *   - Al elegir, "retrieve" entrega coords + dirección.
 *   - El session_token agrupa todo en una sola sesión de facturación
 *     (50.000 sesiones/mes gratis).
 */

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
const USE_MAPBOX = Boolean(MAPBOX_TOKEN);

function newSessionToken() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function suggestMapbox(q, proximity, sessionToken) {
  const params = [
    `access_token=${MAPBOX_TOKEN}`,
    `session_token=${sessionToken}`,
    'country=cl',
    'language=es',
    'limit=6',
    'types=poi,address,place,locality,neighborhood,street',
  ];
  if (proximity?.lng != null && proximity?.lat != null) {
    params.push(`proximity=${proximity.lng},${proximity.lat}`);
  }
  const url =
    `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(q)}&` +
    params.join('&');
  const resp = await fetch(url);
  const data = await resp.json();
  return (data?.suggestions || []).map((s) => ({
    id: s.mapbox_id,
    label:
      [s.name, s.place_formatted || s.full_address]
        .filter(Boolean)
        .join(' · ') || s.name,
    name: s.name,
    placeFormatted: s.place_formatted || s.full_address || '',
    provider: 'mapbox',
  }));
}

async function retrieveMapbox(mapboxId, sessionToken) {
  const url =
    `https://api.mapbox.com/search/searchbox/v1/retrieve/${encodeURIComponent(mapboxId)}?` +
    `access_token=${MAPBOX_TOKEN}&session_token=${sessionToken}`;
  const resp = await fetch(url);
  const data = await resp.json();
  const f = data?.features?.[0];
  if (!f) return null;
  const p = f.properties || {};
  const ctx = p.context || {};
  return {
    lat: f.geometry?.coordinates?.[1],
    lng: f.geometry?.coordinates?.[0],
    address: p.full_address || p.place_formatted || p.name,
    comunaRaw:
      ctx.place?.name ||
      ctx.locality?.name ||
      ctx.neighborhood?.name ||
      null,
    regionRaw: ctx.region?.name || null,
  };
}

async function searchNominatim(q) {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    `q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=6&countrycodes=cl&accept-language=es`;
  const resp = await fetch(url, { headers: { 'Accept-Language': 'es' } });
  const data = await resp.json();
  return (Array.isArray(data) ? data : []).map((item) => {
    const a = item.address || {};
    return {
      id: String(item.place_id || ''),
      label: item.display_name,
      provider: 'osm',
      // Coords y datos ya disponibles (Nominatim devuelve todo en un solo request)
      _direct: {
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon),
        address: item.display_name,
        comunaRaw:
          a.city ||
          a.town ||
          a.village ||
          a.suburb ||
          a.municipality ||
          a.county ||
          null,
        regionRaw: a.state || a.region || null,
      },
    };
  });
}

export default function LocationAutocomplete({
  value,
  onChangeText,
  onSelect,
  placeholder,
  proximity,
}) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const sessionToken = useRef(newSessionToken());

  // Limpia el timer al desmontar
  useEffect(() => () => timer.current && clearTimeout(timer.current), []);

  const handleChange = (text) => {
    onChangeText?.(text);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    if (!text || text.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => doSearch(text.trim()), 350);
  };

  const doSearch = async (q) => {
    setLoading(true);
    try {
      let items = [];
      if (USE_MAPBOX) {
        items = await suggestMapbox(q, proximity, sessionToken.current);
        if (items.length === 0) {
          // Fallback: si Mapbox no encuentra, probamos OSM
          items = await searchNominatim(q);
        }
      } else {
        items = await searchNominatim(q);
      }
      setResults(items);
    } catch (e) {
      console.warn('[FutFinder] location search:', e?.message || e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const pick = async (item) => {
    setLoading(true);
    try {
      let payload;
      if (item.provider === 'mapbox') {
        payload = await retrieveMapbox(item.id, sessionToken.current);
        // Renovamos el session token tras una selección exitosa
        sessionToken.current = newSessionToken();
      } else if (item._direct) {
        payload = item._direct;
      }
      if (payload) {
        onSelect?.({
          lat: payload.lat,
          lng: payload.lng,
          address: payload.address,
          comunaRaw: payload.comunaRaw,
          regionRaw: payload.regionRaw,
        });
        onChangeText?.(payload.address);
      }
    } catch (e) {
      console.warn('[FutFinder] location pick:', e?.message || e);
    } finally {
      setLoading(false);
      setResults([]);
      setOpen(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <SearchIcon color={colors.textMuted} size={16} />
        <TextInput
          style={styles.input}
          placeholder={placeholder || 'Busca por nombre, dirección o sector…'}
          placeholderTextColor={colors.textMuted}
          value={value}
          onChangeText={handleChange}
          onFocus={() => results.length > 0 && setOpen(true)}
        />
        {loading && <ActivityIndicator color={colors.primary} size="small" />}
      </View>

      {open && results.length > 0 && (
        <View style={styles.dropdown}>
          {results.map((item, i) => (
            <Pressable
              key={item.id || String(i)}
              onPress={() => pick(item)}
              style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
            >
              <MapPin color={colors.primary} size={14} style={{ marginTop: 2 }} />
              <Text style={styles.optionText} numberOfLines={2}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {open && !loading && results.length === 0 && (value || '').trim().length >= 3 && (
        <Text style={styles.noResults}>
          Sin sugerencias. Prueba con la dirección (ej. "Av. Las Condes 12000")
          o el sector.{' '}
          <Text style={{ opacity: 0.6 }}>
            ({USE_MAPBOX ? 'Mapbox activo' : 'sin token Mapbox'})
          </Text>
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative', zIndex: 30 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    ...Platform.select({ web: { outlineStyle: 'none' } }),
  },
  dropdown: {
    marginTop: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  option: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  optionText: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  noResults: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 8,
    lineHeight: 15,
  },
});
