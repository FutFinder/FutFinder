import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Search as SearchIcon } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';

function fmtHora(iso) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

function MarkerPill({ m, selected, onPress }) {
  const cupos = m.cupos_disponibles ?? 0;
  const label = cupos === 0 ? 'Lleno' : `Falta ${cupos}`;
  return (
    <Marker
      coordinate={{ latitude: m.latitud, longitude: m.longitud }}
      onPress={onPress}
      anchor={{ x: 0.5, y: 1 }}
    >
      <View style={[styles.pill, selected && styles.pillSelected]}>
        <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
          {label} · {fmtHora(m.hora)}
        </Text>
        <View style={[styles.pillTip, selected && styles.pillTipSelected]} />
      </View>
    </Marker>
  );
}

/**
 * Mapa con marcadores Airbnb-like (Falta N · HH:MM).
 *
 * Props:
 *   initialRegion: { latitude, longitude, latitudeDelta, longitudeDelta }
 *   matches: array de partidos con lat/lng
 *   selectedId: id del marker seleccionado (opcional)
 *   onSelectMarker(match)
 *   onRegionChange(region): se llama cuando el usuario detiene el gesto
 *   onSearchHere(): se llama al tocar el botón "Buscar en esta zona"
 *   showSearchHere: bool — controla la visibilidad del botón
 *   onTouchStart / onTouchEnd: opcional, para que el padre desactive scroll
 */
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
}) {
  const mapRef = useRef(null);

  return (
    <View
      style={styles.wrap}
      onStartShouldSetResponderCapture={() => false}
    >
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        onRegionChangeComplete={onRegionChange}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {matches.map((m) =>
          m.latitud != null && m.longitud != null ? (
            <MarkerPill
              key={m.id}
              m={m}
              selected={selectedId === m.id}
              onPress={() => onSelectMarker?.(m)}
            />
          ) : null
        )}
      </MapView>

      {showSearchHere && (
        <Pressable
          onPress={onSearchHere}
          style={({ pressed }) => [styles.searchHere, pressed && { opacity: 0.85 }]}
        >
          <SearchIcon color={colors.primary} size={14} />
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
    borderRadius: radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    backgroundColor: colors.surfaceAlt,
    marginBottom: 12,
  },
  map: { ...StyleSheet.absoluteFillObject },

  pill: {
    backgroundColor: colors.background,
    borderColor: colors.primary,
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    ...Platform.select({
      android: { elevation: 4 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 4,
      },
    }),
  },
  pillSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  pillTextSelected: { color: '#0E0E0D' },
  pillTip: {
    position: 'absolute',
    bottom: -5,
    left: '50%',
    marginLeft: -4,
    width: 8,
    height: 8,
    backgroundColor: colors.background,
    borderRightWidth: 1.5,
    borderBottomWidth: 1.5,
    borderColor: colors.primary,
    transform: [{ rotate: '45deg' }],
  },
  pillTipSelected: { backgroundColor: colors.primary },

  searchHere: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    ...Platform.select({
      android: { elevation: 4 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.35,
        shadowOffset: { width: 0, height: 3 },
        shadowRadius: 5,
      },
    }),
  },
  searchHereText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
