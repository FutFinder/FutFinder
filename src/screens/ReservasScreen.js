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
 * Pantalla «Reservas» (pantallas 2 y 3 del handoff `Reservas.dc.html`):
 * lista de complejos + hoy con horas libres, y su hoja de filtros. La
 * variante «mapa» (pantalla 4) todavía no está construida — ver el aviso
 * en su lugar en vez de una pestaña muerta.
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
          <View style={styles.mapPlaceholder}>
            <MapPin color={C.textMuted} size={32} strokeWidth={1.6} />
            <Text style={styles.mapPlaceholderText}>
              La vista de mapa todavía no está construida en esta versión. Usa la lista mientras tanto.
            </Text>
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
                      <Text style={styles.horaTime}>{h.hora}</Text>
                      <Text style={styles.horaHoy}>hoy</Text>
                      <Text style={styles.horaNombre} numberOfLines={1}>{h.nombre}</Text>
                      <Text style={styles.horaMeta} numberOfLines={1}>{h.meta}</Text>
                      <Text style={styles.horaPrecio}>{formatCLP(h.precio)}</Text>
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
                    <ComplejoCard
                      key={c.id}
                      complejo={c}
                      onPress={() => proximamente('Muy pronto vas a poder ver la disponibilidad completa de este complejo.')}
                    />
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

  mapPlaceholder: {
    marginTop: 24,
    alignItems: 'center',
    gap: 10,
    paddingVertical: 60,
    paddingHorizontal: 30,
  },
  mapPlaceholderText: { fontFamily: F.medium, fontSize: 13, color: C.textMuted, textAlign: 'center', lineHeight: 19 },

  section: { marginTop: 24 },
  sectionHeader: { marginBottom: 12 },
  sectionLabel: { fontFamily: F.bold, fontSize: 10.5, letterSpacing: 1.5, color: C.textSecondary },
  loadingText: { fontFamily: F.medium, fontSize: 13, color: C.textMuted },

  horasScroll: { gap: 10, paddingRight: 4 },
  horaCard: { width: 150 },
  horaTime: { fontFamily: F.extraBold, fontSize: 18, color: C.textPrimary },
  horaHoy: { fontFamily: F.bold, fontSize: 10.5, color: C.green, marginTop: 1 },
  horaNombre: { fontFamily: F.bold, fontSize: 12.5, color: C.textPrimary, marginTop: 8 },
  horaMeta: { fontFamily: F.medium, fontSize: 11, color: C.textSecondary, marginTop: 2 },
  horaPrecio: { fontFamily: F.extraBold, fontSize: 13, color: C.green, marginTop: 8 },

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
