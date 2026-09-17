import React, { useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { Search as SearchIcon } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F, alfa } from '../theme/colors';

function fmtHora(iso) {
  try {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/**
 * Estilo dark/green minimalista para Google Maps (Android / iOS con
 * PROVIDER_GOOGLE). En iOS con Apple Maps por defecto, este JSON se ignora
 * pero `userInterfaceStyle="dark"` + `mapType="mutedStandard"` igual da una
 * estética dark sutil.
 */
const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: C.bg }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: C.bg }] },
  { elementType: 'labels.text.fill', stylers: [{ color: C.textSecondary }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'administrative.locality',
    elementType: 'labels.text.fill',
    stylers: [{ color: C.green }],
  },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'poi.park',
    elementType: 'geometry',
    stylers: [{ color: C.surface }],
  },
  {
    featureType: 'road',
    elementType: 'geometry',
    stylers: [{ color: C.surface }],
  },
  {
    featureType: 'road',
    elementType: 'geometry.stroke',
    stylers: [{ color: '#3A3936' }],
  },
  {
    featureType: 'road',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6F6E6C' }],
  },
  {
    featureType: 'road.highway',
    elementType: 'geometry',
    stylers: [{ color: '#3A3936' }],
  },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  {
    featureType: 'water',
    elementType: 'geometry',
    stylers: [{ color: '#1A1918' }],
  },
  {
    featureType: 'water',
    elementType: 'labels.text.fill',
    stylers: [{ color: '#6F6E6C' }],
  },
];

function MarkerPill({ m, selected, onPress }) {
  const total = m.cupos_totales ?? 0;
  const disponibles = m.cupos_disponibles ?? 0;
  const ocupados = Math.max(0, total - disponibles);
  const label = `${ocupados}/${total} · ${fmtHora(m.hora)}`;
  return (
    <Marker
      coordinate={{ latitude: m.latitud, longitude: m.longitud }}
      onPress={onPress}
      anchor={{ x: 0.5, y: 1 }}
      zIndex={selected ? 1000 : 100}
    >
      <View style={[styles.pill, selected && styles.pillSelected]}>
        <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
          {label}
        </Text>
        <View style={[styles.pillTip, selected && styles.pillTipSelected]} />
      </View>
    </Marker>
  );
}

// Marker propio para "tú estás aquí" — con zIndex bajo para que NUNCA
// tape las burbujas de los partidos.
function UserDotMarker({ coords }) {
  if (!coords?.lat || !coords?.lng) return null;
  return (
    <Marker
      coordinate={{ latitude: coords.lat, longitude: coords.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={1}
      tracksViewChanges={false}
    >
      <View style={styles.userDotOuter}>
        <View style={styles.userDotInner} />
      </View>
    </Marker>
  );
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
  const mapRef = useRef(null);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        onRegionChangeComplete={onRegionChange}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterest={false}
        showsTraffic={false}
        showsBuildings={false}
        toolbarEnabled={false}
        userInterfaceStyle="dark"
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        customMapStyle={DARK_MAP_STYLE}
      >
        <UserDotMarker coords={userCoords} />
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
    borderRadius: R.cardSm,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: C.borderSoft,
    backgroundColor: C.bg,
    marginBottom: 12,
  },
  map: { ...StyleSheet.absoluteFillObject },

  // Burbuja Airbnb-like, compacta y oscura
  pill: {
    backgroundColor: C.bg,
    borderColor: C.green,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 9,
    ...Platform.select({
      android: { elevation: 3 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 3,
      },
    }),
  },
  pillSelected: {
    backgroundColor: C.green,
    borderColor: C.green,
  },
  pillText: {
    color: C.green,
    fontSize: 11,
    fontFamily: F.extraBold,
    letterSpacing: 0.2,
  },
  pillTextSelected: { color: '#0E0E0D' },
  pillTip: {
    position: 'absolute',
    bottom: -4,
    left: '50%',
    marginLeft: -3,
    width: 6,
    height: 6,
    backgroundColor: C.bg,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: C.green,
    transform: [{ rotate: '45deg' }],
  },
  pillTipSelected: { backgroundColor: C.green },

  userDotOuter: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: alfa(C.green, 0.22),
    borderWidth: 1,
    borderColor: alfa(C.green, 0.45),
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDotInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.green,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },

  searchHere: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.green,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    ...Platform.select({
      android: { elevation: 4 },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowOffset: { width: 0, height: 3 },
        shadowRadius: 5,
      },
    }),
  },
  searchHereText: {
    color: C.green,
    fontSize: 11,
    fontFamily: F.extraBold,
    letterSpacing: 0.3,
  },
});
