import React, { useRef, useState } from 'react';
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
 * Buscador de lugares con autocompletado, usando Nominatim (OpenStreetMap).
 * Gratis, sin API key, funciona en web, Expo Go y nativo.
 *
 * Props:
 *   value: string (texto del input)
 *   onChangeText(text): actualiza el texto
 *   onSelect({ lat, lng, address, comunaRaw, regionRaw }): al elegir un lugar
 *   placeholder?: string
 */

const ENDPOINT = 'https://nominatim.openstreetmap.org/search';

export default function LocationAutocomplete({
  value,
  onChangeText,
  onSelect,
  placeholder,
}) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const handleChange = (text) => {
    onChangeText?.(text);
    setOpen(true);
    if (timer.current) clearTimeout(timer.current);
    if (!text || text.trim().length < 3) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => search(text.trim()), 450);
  };

  const search = async (q) => {
    setLoading(true);
    try {
      const url =
        `${ENDPOINT}?q=${encodeURIComponent(q)}` +
        `&format=jsonv2&addressdetails=1&limit=6&countrycodes=cl&accept-language=es`;
      const resp = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      const data = await resp.json();
      setResults(Array.isArray(data) ? data : []);
    } catch (e) {
      console.warn('[FutFinder] location search:', e?.message || e);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const pick = (item) => {
    const a = item.address || {};
    onSelect?.({
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
      address: item.display_name,
      comunaRaw:
        a.city || a.town || a.village || a.suburb || a.municipality || a.county || null,
      regionRaw: a.state || a.region || null,
    });
    onChangeText?.(item.display_name);
    setResults([]);
    setOpen(false);
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.inputRow}>
        <SearchIcon color={colors.textMuted} size={16} />
        <TextInput
          style={styles.input}
          placeholder={placeholder || 'Busca el complejo o la dirección…'}
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
              key={String(item.place_id || i)}
              onPress={() => pick(item)}
              style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
            >
              <MapPin color={colors.primary} size={14} style={{ marginTop: 2 }} />
              <Text style={styles.optionText} numberOfLines={2}>
                {item.display_name}
              </Text>
            </Pressable>
          ))}
        </View>
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
});
