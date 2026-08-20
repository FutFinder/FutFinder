import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Search,
  MapPin,
  Star,
  SlidersHorizontal,
  Image as ImageIcon,
  Calendar,
  ShieldCheck,
} from 'lucide-react-native';

import NotificationBell from '../components/NotificationBell';
import FiltrosSheet from '../components/reservas/FiltrosSheet';
import { Card, Chip, Badge, NoticeCard } from '../components/reservas/ui';
import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { listComplejosCerca, listHorasLibresHoy } from '../services/reservas';
import { formatCLP } from '../services/reservasRules';

// Búsqueda sin distinguir tilde/mayúscula ("maipu" debe encontrar "Maipú") —
// mismo patrón que ya usa PickerSheet en el módulo Partidos.
const normalizar = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Pantalla «Reservas» (pantallas 2, 3 y 4 del handoff `Reservas.dc.html`):
 * lista de complejos + hoy con horas libres, su hoja de filtros, y la vista
 * de mapa con dos pines destacados que abren una vista previa. El mapa es
 * esquemático a propósito (igual que el prototipo): no es un `MapView` real,
 * así que no hereda el hueco pendiente de mapa real en web
 * (`docs/memoria/operacion/pendientes.md`).
 *
 * `mostrarJuegaHoy`/`mostrarAccesoComplejos` en el prototipo son props del
 * editor de diseño; acá van fijas en `true` (son las que trae el handoff
 * por defecto) hasta que exista una razón real para apagarlas.
 */
export default function ReservasScreen({ navigation }) {
  const [vista, setVista] = useState('lista');
  const [query, setQuery] = useState('');
  const [soloHoy, setSoloHoy] = useState(false);
  const [soloFutbol7, setSoloFutbol7] = useState(false);
  const [hasta30k, setHasta30k] = useState(false);
  const [filtrosOpen, setFiltrosOpen] = useState(false);
  const [comuna, setComuna] = useState('Cerca de mí');
  const [tipo, setTipo] = useState('Todas');
  const [franja, setFranja] = useState('Tarde');
  const [banner, setBanner] = useState(null);

  const [complejos, setComplejos] = useState([]);
  const [horasHoy, setHorasHoy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mapSel, setMapSel] = useState(null); // índice del pin elegido en la vista de mapa

  useEffect(() => {
    (async () => {
      const [{ data: cs }, { data: hs }] = await Promise.all([
        listComplejosCerca(),
        listHorasLibresHoy(),
      ]);
      setComplejos(cs || []);
      setHorasHoy(hs || []);
      setLoading(false);
    })();
  }, []);

  const proximamente = useCallback((mensaje) => {
    setBanner(mensaje);
    setTimeout(() => setBanner(null), 2400);
  }, []);

  const goComplejo = useCallback(
    (complejoId) => navigation.navigate('ComplejoDetail', { complejoId }),
    [navigation]
  );

  // Los dos pines destacados del mapa (pantalla 4 del handoff) muestran
  // complejos reales, no datos aparte: A es el más cercano, B el segundo.
  const mapPins = useMemo(() => [complejos[0], complejos[1]].filter(Boolean), [complejos]);
  const mapCard = mapSel != null ? mapPins[mapSel] : null;

  const complejosFiltrados = useMemo(() => {
    const q = normalizar(query);
    return complejos.filter((c) => {
      if (q && !normalizar(c.nombre).includes(q)) return false;
      if (soloFutbol7 && !c.tipos.includes('Fútbol 7')) return false;
      if (hasta30k && c.desde > 30000) return false;
      if (soloHoy && !c.proximaHoraLibre) return false;
      return true;
    });
  }, [complejos, query, soloFutbol7, hasta30k, soloHoy]);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Reservas</Text>
          <NotificationBell />
        </View>

        <Text style={styles.h1}>Reserva una cancha</Text>

        <Pressable
          onPress={() => proximamente('Muy pronto vas a poder cambiar tu ubicación habitual.')}
          style={styles.locationRow}
        >
          <MapPin color={C.green} size={15} strokeWidth={2} />
          <Text style={styles.locationText}>Ñuñoa, Santiago</Text>
          <Text style={styles.locationChange}>cambiar</Text>
        </Pressable>

        <View style={styles.searchRow}>
          <Search color={C.textMuted} size={17} strokeWidth={2} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar complejo o cancha…"
            placeholderTextColor={C.textMuted}
            style={styles.searchInput}
          />
        </View>

        <View style={styles.chipsRow}>
          <Chip label="Hoy · 20:00" active={soloHoy} onPress={() => setSoloHoy((v) => !v)} />
          <Chip label="Fútbol 7" active={soloFutbol7} onPress={() => setSoloFutbol7((v) => !v)} />
          <Chip label="Hasta $30.000" active={hasta30k} onPress={() => setHasta30k((v) => !v)} />
          <Chip
            label="Filtros"
            icon={SlidersHorizontal}
            active={false}
            onPress={() => setFiltrosOpen(true)}
          />
        </View>

        <View style={styles.segmented}>
          <Pressable
            onPress={() => setVista('lista')}
            style={[styles.segmentBtn, vista === 'lista' && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentLabel, vista === 'lista' && styles.segmentLabelActive]}>Lista</Text>
          </Pressable>
          <Pressable
            onPress={() => setVista('mapa')}
            style={[styles.segmentBtn, vista === 'mapa' && styles.segmentBtnActive]}
          >
            <Text style={[styles.segmentLabel, vista === 'mapa' && styles.segmentLabelActive]}>Mapa</Text>
          </Pressable>
        </View>

        {banner ? (
          <View style={styles.bannerWrap}>
            <NoticeCard tone="info">{banner}</NoticeCard>
          </View>
        ) : null}

        {vista === 'mapa' ? (
          <View style={styles.mapWrap}>
            <View style={styles.mapArt}>
              <View style={styles.mapStreetH} />
              <View style={styles.mapStreetV} />
              <View style={styles.mapUserDot} />

              {mapPins.map((c, i) => {
                const on = mapSel === i;
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => setMapSel(i)}
                    style={[
                      styles.mapPin,
                      i === 0 ? styles.mapPinA : styles.mapPinB,
                      on && styles.mapPinOn,
                    ]}
                  >
                    <View style={styles.mapPinIcon}>
                      <MapPin color={C.green} size={i === 0 ? 18 : 17} strokeWidth={1.9} />
                    </View>
                    <View>
                      <Text style={[styles.mapPinPrecio, i !== 0 && { fontSize: 13.5 }]}>
                        {formatCLP(c.desde)}
                      </Text>
                      <Text style={styles.mapPinMeta}>★ {c.rating} · {c.proximaHoraLibre}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {mapCard ? (
              <View style={styles.mapPreview}>
                <View style={styles.mapPreviewPhoto}>
                  <ImageIcon color={C.textMuted} size={20} strokeWidth={1.6} />
                  <View style={styles.mapPreviewRating}>
                    <Text style={styles.mapPreviewRatingText}>★ {mapCard.rating}</Text>
                  </View>
                </View>
                <View style={styles.mapPreviewBody}>
                  <Pressable onPress={() => goComplejo(mapCard.id)} style={styles.mapPreviewTitleRow}>
                    <Text style={styles.mapPreviewNombre} numberOfLines={1}>{mapCard.nombre}</Text>
                    <ShieldCheck color={C.green} size={15} strokeWidth={2.1} />
                    <Text style={styles.mapPreviewPrecioBig}>{formatCLP(mapCard.desde)}</Text>
                  </Pressable>
                  <Text style={styles.mapPreviewMeta} numberOfLines={1}>
                    {mapCard.sector} · {mapCard.distanciaKm} km · {mapCard.tipos.join(' y ')}
                  </Text>
                  <View style={styles.mapPreviewTags}>
                    {mapCard.servicios.slice(0, 3).map((s) => (
                      <Badge key={s} label={s} tone="neutral" />
                    ))}
                  </View>
                  {mapCard.proximaHoraLibre ? (
                    <>
                      <Text style={styles.mapPreviewLabel}>HOY, ÚLTIMAS HORAS LIBRES</Text>
                      <View style={styles.mapPreviewHoraChip}>
                        <Text style={styles.mapPreviewHoraChipText}>{mapCard.proximaHoraLibre}</Text>
                      </View>
                    </>
                  ) : null}
                  <Pressable
                    onPress={() => goComplejo(mapCard.id)}
                    style={({ pressed }) => [styles.mapPreviewCta, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.mapPreviewCtaText}>Ver disponibilidad</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.mapEmptyCard}>
                <MapPin color={C.green} size={18} strokeWidth={1.9} />
                <Text style={styles.mapEmptyText}>
                  Toca un complejo del mapa para ver sus fotos, servicios y horas libres antes de entrar.
                </Text>
              </View>
            )}
          </View>
        ) : (
          <>
            {horasHoy.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionLabel}>JUEGA HOY · HORAS LIBRES</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.horasScroll}>
                  {horasHoy.map((h) => (
                    <Card key={h.id} style={styles.horaCard}>
                      <View style={styles.horaTopRow}>
                        <Text style={styles.horaTime}>{h.hora}</Text>
                        <Text style={styles.horaHoy}>· hoy</Text>
                      </View>
                      <Text style={styles.horaNombre} numberOfLines={1}>{h.nombre}</Text>
                      <Text style={styles.horaMeta} numberOfLines={1}>{h.meta}</Text>
                      <View style={styles.horaBottomRow}>
                        <Text style={styles.horaPrecio}>{formatCLP(h.precio)}</Text>
                        <Pressable
                          onPress={() => goComplejo(h.complejoId)}
                          style={({ pressed }) => [styles.horaReservarBtn, pressed && { opacity: 0.85 }]}
                        >
                          <Text style={styles.horaReservarText}>Reservar</Text>
                        </Pressable>
                      </View>
                    </Card>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>COMPLEJOS CERCA DE TI</Text>
              </View>

              {loading ? (
                <Text style={styles.loadingText}>Buscando complejos…</Text>
              ) : complejosFiltrados.length === 0 ? (
                <Text style={styles.loadingText}>Ningún complejo calza con estos filtros.</Text>
              ) : (
                <View style={{ gap: 11 }}>
                  {complejosFiltrados.map((c) => (
                    <ComplejoCard key={c.id} complejo={c} onPress={() => goComplejo(c.id)} />
                  ))}
                </View>
              )}
            </View>

            <Pressable
              onPress={() => proximamente('Muy pronto vas a poder ver todas tus reservas desde aquí.')}
              style={styles.misReservasRow}
            >
              <Calendar color={C.green} size={17} strokeWidth={2} />
              <Text style={styles.misReservasText}>3 próximas · 1 desafío de club</Text>
            </Pressable>

            <NoticeCard tone="info" icon={ImageIcon}>
              ¿Administras un complejo? Recibe reservas en FutFinder.
            </NoticeCard>
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      <FiltrosSheet
        visible={filtrosOpen}
        onClose={() => setFiltrosOpen(false)}
        comuna={comuna}
        onComuna={setComuna}
        tipo={tipo}
        onTipo={setTipo}
        franja={franja}
        onFranja={setFranja}
        onLimpiar={() => {
          setComuna('Cerca de mí');
          setTipo('Todas');
          setFranja('Tarde');
        }}
        resultCount={complejosFiltrados.length}
      />
    </SafeAreaView>
  );
}

function ComplejoCard({ complejo, onPress }) {
  return (
    <Card padded={false} onPress={onPress} radius={R.hero}>
      <View style={styles.photoPlaceholder}>
        <ImageIcon color={C.textMuted} size={22} strokeWidth={1.6} />
        <Badge label={`Desde ${formatCLP(complejo.desde)}`} tone="neutral" />
      </View>
      <View style={styles.complejoBody}>
        <View style={styles.complejoTopRow}>
          <View style={styles.ratingRow}>
            <Star color={C.amber} size={13} strokeWidth={0} fill={C.amber} />
            <Text style={styles.ratingText}>{complejo.rating}</Text>
          </View>
          <Text style={styles.distText}>{complejo.distanciaKm} km</Text>
        </View>
        <Text style={styles.complejoNombre}>{complejo.nombre}</Text>
        <Text style={styles.complejoSector}>{complejo.sector}</Text>
        <View style={styles.tiposRow}>
          {complejo.tipos.map((t) => (
            <Badge key={t} label={t} tone="neutral" />
          ))}
        </View>
        {complejo.proximaHoraLibre ? (
          <Text style={styles.proximaHora}>próxima {complejo.proximaHoraLibre}</Text>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingTop: 4 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  headerTitle: { fontFamily: F.extraBold, fontSize: 19, color: C.textPrimary },
  h1: { fontFamily: F.extraBold, fontSize: 25, color: C.textPrimary, marginTop: 4, letterSpacing: -0.4 },

  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  locationText: { fontFamily: F.bold, fontSize: 13.5, color: C.textPrimary },
  locationChange: { fontFamily: F.semiBold, fontSize: 13, color: C.textSecondary, marginLeft: 4 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    borderRadius: R.row,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 14,
    marginTop: 14,
  },
  searchInput: { flex: 1, fontFamily: F.medium, fontSize: 14, color: C.textPrimary, padding: 0 },

  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },

  segmented: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.border,
    padding: 3,
    marginTop: 16,
  },
  segmentBtn: { flex: 1, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: R.row - 3 },
  segmentBtnActive: { backgroundColor: C.surfaceAlt },
  segmentLabel: { fontFamily: F.bold, fontSize: 13, color: C.textSecondary },
  segmentLabelActive: { color: C.textPrimary },

  bannerWrap: { marginTop: 14 },

  mapWrap: { marginTop: 16 },
  mapArt: {
    height: 260,
    borderRadius: 24,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: '#0B0E0B',
    overflow: 'hidden',
  },
  mapStreetH: {
    position: 'absolute', left: -20, top: 100, width: 430, height: 10,
    backgroundColor: '#101510', transform: [{ rotate: '-8deg' }],
  },
  mapStreetV: {
    position: 'absolute', left: 90, top: -20, width: 10, height: 300,
    backgroundColor: '#101510', transform: [{ rotate: '6deg' }],
  },
  mapUserDot: {
    position: 'absolute', left: 46, top: 170, width: 12, height: 12, borderRadius: 999,
    backgroundColor: '#7FA9FF', shadowColor: '#7FA9FF', shadowOpacity: 0.5, shadowRadius: 10, elevation: 3,
  },
  mapPin: {
    position: 'absolute',
    flexDirection: 'row', alignItems: 'center', gap: 8,
    height: 42, paddingHorizontal: 10, borderRadius: 999, backgroundColor: C.green,
    shadowColor: C.green, shadowOpacity: 0.35, shadowRadius: 12, elevation: 4,
  },
  mapPinA: { left: 16, top: 54 },
  mapPinB: { left: 150, top: 150, height: 40 },
  mapPinOn: { borderWidth: 2, borderColor: C.textPrimary },
  mapPinIcon: {
    width: 26, height: 26, borderRadius: 999, backgroundColor: C.textOnGreen,
    alignItems: 'center', justifyContent: 'center',
  },
  mapPinPrecio: { fontFamily: F.extraBold, fontSize: 14, color: C.textOnGreen },
  mapPinMeta: { fontFamily: F.bold, fontSize: 9.5, color: 'rgba(6,19,10,0.66)', marginTop: 2 },

  mapPreview: {
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden',
  },
  mapPreviewPhoto: {
    height: 110, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center',
  },
  mapPreviewRating: {
    position: 'absolute', left: 12, top: 12, height: 24, paddingHorizontal: 9, borderRadius: 999,
    backgroundColor: 'rgba(8,10,8,0.82)', borderWidth: 1, borderColor: C.border, justifyContent: 'center',
  },
  mapPreviewRatingText: { fontFamily: F.bold, fontSize: 11, color: C.textPrimary },
  mapPreviewBody: { padding: 14 },
  mapPreviewTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  mapPreviewNombre: { flex: 1, fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  mapPreviewPrecioBig: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  mapPreviewMeta: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 5 },
  mapPreviewTags: { flexDirection: 'row', gap: 6, marginTop: 11, flexWrap: 'wrap' },
  mapPreviewLabel: { fontFamily: F.bold, fontSize: 10, letterSpacing: 1.4, color: C.textSecondary, marginTop: 14, marginBottom: 9 },
  mapPreviewHoraChip: {
    height: 42, borderRadius: 13, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  mapPreviewHoraChipText: { fontFamily: F.extraBold, fontSize: 13.5, color: C.textOnGreen },
  mapPreviewCta: {
    height: 46, borderRadius: 15, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center', marginTop: 12,
  },
  mapPreviewCtaText: { fontFamily: F.extraBold, fontSize: 13.5, color: C.textOnGreen },

  mapEmptyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  mapEmptyText: { flex: 1, fontFamily: F.medium, fontSize: 12.5, lineHeight: 18, color: C.textSecondary },

  section: { marginTop: 24 },
  sectionHeader: { marginBottom: 12 },
  sectionLabel: { fontFamily: F.bold, fontSize: 10.5, letterSpacing: 1.5, color: C.textSecondary },
  loadingText: { fontFamily: F.medium, fontSize: 13, color: C.textMuted },

  horasScroll: { gap: 10, paddingRight: 4 },
  horaCard: { width: 196 },
  horaTopRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  horaTime: { fontFamily: F.extraBold, fontSize: 15, color: C.green },
  horaHoy: { fontFamily: F.semiBold, fontSize: 12, color: C.textSecondary },
  horaNombre: { fontFamily: F.bold, fontSize: 14.5, color: C.textPrimary, marginTop: 10, letterSpacing: -0.1 },
  horaMeta: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 3 },
  horaBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  horaPrecio: { fontFamily: F.extraBold, fontSize: 13.5, color: C.textPrimary },
  horaReservarBtn: {
    height: 34, paddingHorizontal: 14, borderRadius: 12,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  horaReservarText: { fontFamily: F.extraBold, fontSize: 12.5, color: C.green },

  photoPlaceholder: {
    height: 130,
    backgroundColor: C.surfaceAlt,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  complejoBody: { padding: 16 },
  complejoTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { fontFamily: F.bold, fontSize: 12.5, color: C.textPrimary },
  distText: { fontFamily: F.medium, fontSize: 12, color: C.textMuted },
  complejoNombre: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary, marginTop: 6 },
  complejoSector: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, marginTop: 2 },
  tiposRow: { flexDirection: 'row', gap: 6, marginTop: 10 },
  proximaHora: { fontFamily: F.semiBold, fontSize: 12, color: C.textMuted, marginTop: 10 },

  misReservasRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 22,
    paddingVertical: 6,
  },
  misReservasText: { fontFamily: F.bold, fontSize: 13.5, color: C.textPrimary },
});
