import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  MapPin,
  Clock,
  Users,
  DollarSign,
  BarChart3,
  Search as SearchIcon,
  ArrowDownUp,
  Zap,
  Lightbulb,
  User as UserIcon,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Banner from '../components/Banner';
import { colors, radius } from '../theme/colors';
import { listOpenMatches, applyFilters, joinMatch } from '../services/matches';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { getCurrentLocation } from '../services/location';
import { isSupabaseConfigured } from '../services/supabase';
import { notify } from '../utils/notify';
import { REGIONES, getComunasOfRegion } from '../data/regiones-chile';

// Opciones cíclicas para cada filtro
const KM_OPTS = [
  { label: 'Cualquier dist.', value: null },
  { label: '5 km', value: 5 },
  { label: '10 km', value: 10 },
  { label: '20 km', value: 20 },
];
const TIME_OPTS = [
  { label: 'Cualquier día', value: 'todos' },
  { label: 'Hoy', value: 'hoy' },
  { label: 'Mañana', value: 'manana' },
  { label: 'Fin de semana', value: 'finde' },
];
const NIVEL_OPTS = [
  { label: 'Todos los niveles', value: null },
  { label: 'Recreativo', value: 'recreativo' },
  { label: 'Intermedio', value: 'intermedio' },
  { label: 'Competitivo', value: 'competitivo' },
];
const PRECIO_OPTS = [
  { label: 'Cualquier precio', value: null },
  { label: 'Gratis', value: { min: 0, max: 0 } },
  { label: '$0 – $3.000', value: { min: 0, max: 3000 } },
  { label: '$3k – $5k', value: { min: 3000, max: 5000 } },
  { label: '$5k – $8k', value: { min: 5000, max: 8000 } },
  { label: '$8k+', value: { min: 8000, max: 999999 } },
];

function formatHora(iso) {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const isTomorrow =
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    if (sameDay) return `Hoy ${hh}:${mm}`;
    if (isTomorrow) return `Mañana ${hh}:${mm}`;
    return d.toLocaleDateString('es-CL', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    }) + ` ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function nivelLabel(n) {
  return ({ recreativo: 'Recreativo', intermedio: 'Intermedio', competitivo: 'Competitivo' })[n] || n;
}

export default function SearchScreen({ navigation }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [userCoords, setUserCoords] = useState(null);
  const [busyMatchId, setBusyMatchId] = useState(null);
  const [banner, setBanner] = useState(null);

  // Estado de filtros (índices en cada arreglo OPTS)
  const [text, setText] = useState('');
  const [kmIdx, setKmIdx] = useState(0);
  const [timeIdx, setTimeIdx] = useState(0);
  const [nivelIdx, setNivelIdx] = useState(0);
  const [precioIdx, setPrecioIdx] = useState(0);
  // Región y comuna: string | null (null = "todas")
  const [regionSel, setRegionSel] = useState(null);
  const [comunaSel, setComunaSel] = useState(null);
  // Cuál picker está expandido: 'region' | 'comuna' | null
  const [pickerOpen, setPickerOpen] = useState(null);

  const comunasOfRegion = regionSel ? getComunasOfRegion(regionSel) : [];

  // Cargar partidos + ubicación
  const load = useCallback(async () => {
    const [{ data }, loc] = await Promise.all([
      listOpenMatches({ limit: 50 }),
      getCurrentLocation(),
    ]);
    setMatches(data || []);
    if (loc?.ok) setUserCoords({ lat: loc.latitude, lng: loc.longitude });
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  // Filtros aplicados → memoizado
  const filtered = useMemo(() => {
    const filters = {
      text,
      region: regionSel,
      comuna: comunaSel,
      maxKm: KM_OPTS[kmIdx].value,
      timeWindow: TIME_OPTS[timeIdx].value,
      niveles: NIVEL_OPTS[nivelIdx].value ? [NIVEL_OPTS[nivelIdx].value] : [],
      precioMin: PRECIO_OPTS[precioIdx].value?.min ?? 0,
      precioMax: PRECIO_OPTS[precioIdx].value?.max ?? 999999,
    };
    const list = applyFilters(matches, filters, userCoords);
    // Ordenar por distancia si tenemos GPS, si no por hora
    return [...list].sort((a, b) => {
      if (userCoords && a._distanciaKm != null && b._distanciaKm != null) {
        return a._distanciaKm - b._distanciaKm;
      }
      return new Date(a.hora) - new Date(b.hora);
    });
  }, [matches, text, regionSel, comunaSel, kmIdx, timeIdx, nivelIdx, precioIdx, userCoords]);

  const showBanner = (type, title, message) => {
    setBanner({ type, title, message });
    notify(title, message);
    if (type === 'success') setTimeout(() => setBanner(null), 6000);
  };

  const handleJoin = async (matchId) => {
    if (busyMatchId) return;
    setBusyMatchId(matchId);
    try {
      const result = await joinMatch(matchId);
      if (!result?.ok) {
        showBanner('error', 'No pudimos inscribirte', result?.reason || 'Intenta de nuevo');
        return;
      }
      if (result.already) {
        showBanner('info', 'Ya estabas inscrito', 'Tu cupo en este partido sigue activo.');
      } else {
        showBanner(
          'success',
          '¡Te inscribiste al partido!',
          'Aprieta "Confirmar GPS" cuando estés en la cancha.'
        );
      }
      await load();
    } catch (e) {
      showBanner('error', 'Error al inscribirte', e?.message || String(e));
    } finally {
      setBusyMatchId(null);
    }
  };

  const handleConfirmGPS = async (matchId) => {
    if (busyMatchId) return;
    setBusyMatchId(matchId);
    try {
      const result = await confirmAttendanceWithGPS(matchId);
      if (result?.ok) {
        showBanner(
          'success',
          '✅ Asistencia confirmada',
          result.distance
            ? `Estás a ${Math.round(result.distance)} m. +1 a tu Trust Score.`
            : 'Tu asistencia quedó registrada.'
        );
        await load();
      } else {
        showBanner('error', 'No pude confirmar', result?.reason || 'Intenta de nuevo');
      }
    } catch (e) {
      showBanner('error', 'Error al confirmar GPS', e?.message || String(e));
    } finally {
      setBusyMatchId(null);
    }
  };

  // Sugerencias de horarios alternativos (próximos 7 días, agrupados por día)
  const suggestions = useMemo(() => {
    if (filtered.length > 0) return null;
    const now = Date.now();
    const buckets = new Map();
    for (const m of matches) {
      const d = new Date(m.hora);
      if (d.getTime() <= now) continue;
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    return Array.from(buckets.entries())
      .slice(0, 3)
      .map(([key, count]) => {
        const d = new Date(key);
        return {
          label: d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit' }),
          count,
        };
      });
  }, [filtered, matches]);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          >
            <ArrowLeft color={colors.textPrimary} size={22} />
          </Pressable>
          <Logo size={26} />
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* Search bar */}
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <SearchIcon color={colors.textMuted} size={18} />
              <TextInput
                style={styles.searchInput}
                placeholder="Buscar por comuna, cancha o nombre…"
                placeholderTextColor={colors.textMuted}
                value={text}
                onChangeText={setText}
                returnKeyType="search"
              />
            </View>
          </View>

          {/* Banner de feedback */}
          {banner && (
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          )}

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            <FilterChip
              icon={MapPin}
              label={regionSel ? truncate(regionSel, 18) : 'Región'}
              active={!!regionSel}
              onPress={() =>
                setPickerOpen(pickerOpen === 'region' ? null : 'region')
              }
            />
            {regionSel && (
              <FilterChip
                icon={MapPin}
                label={comunaSel || 'Comuna'}
                active={!!comunaSel}
                onPress={() =>
                  setPickerOpen(pickerOpen === 'comuna' ? null : 'comuna')
                }
              />
            )}
            <FilterChip
              icon={MapPin}
              label={KM_OPTS[kmIdx].label}
              active={KM_OPTS[kmIdx].value !== null}
              onPress={() => setKmIdx((kmIdx + 1) % KM_OPTS.length)}
            />
            <FilterChip
              icon={Clock}
              label={TIME_OPTS[timeIdx].label}
              active={TIME_OPTS[timeIdx].value !== 'todos'}
              onPress={() => setTimeIdx((timeIdx + 1) % TIME_OPTS.length)}
            />
            <FilterChip
              icon={BarChart3}
              label={NIVEL_OPTS[nivelIdx].label}
              active={NIVEL_OPTS[nivelIdx].value !== null}
              onPress={() => setNivelIdx((nivelIdx + 1) % NIVEL_OPTS.length)}
            />
            <FilterChip
              icon={DollarSign}
              label={PRECIO_OPTS[precioIdx].label}
              active={PRECIO_OPTS[precioIdx].value !== null}
              onPress={() => setPrecioIdx((precioIdx + 1) % PRECIO_OPTS.length)}
            />
          </ScrollView>

          {/* Panel expandible de Región */}
          {pickerOpen === 'region' && (
            <View style={styles.picker}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>Selecciona una región</Text>
                {regionSel && (
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      setRegionSel(null);
                      setComunaSel(null);
                      setPickerOpen(null);
                    }}
                  >
                    <Text style={styles.clearLink}>Limpiar</Text>
                  </Pressable>
                )}
              </View>
              <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
                {REGIONES.map((r) => (
                  <Pressable
                    key={r.nombre}
                    onPress={() => {
                      setRegionSel(r.nombre);
                      setComunaSel(null); // reset comuna cuando cambia región
                      setPickerOpen(null);
                    }}
                    style={[
                      styles.pickerOption,
                      r.nombre === regionSel && styles.pickerOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        r.nombre === regionSel && styles.pickerOptionTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {r.nombre} ({r.codigo})
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Panel expandible de Comuna (solo si hay región) */}
          {pickerOpen === 'comuna' && regionSel && (
            <View style={styles.picker}>
              <View style={styles.pickerHeader}>
                <Text style={styles.pickerTitle}>
                  Comunas de {regionSel.replace('Región ', '')}
                </Text>
                {comunaSel && (
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      setComunaSel(null);
                      setPickerOpen(null);
                    }}
                  >
                    <Text style={styles.clearLink}>Limpiar</Text>
                  </Pressable>
                )}
              </View>
              <ScrollView style={{ maxHeight: 280 }} nestedScrollEnabled>
                {comunasOfRegion.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => {
                      setComunaSel(c);
                      setPickerOpen(null);
                    }}
                    style={[
                      styles.pickerOption,
                      c === comunaSel && styles.pickerOptionActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        c === comunaSel && styles.pickerOptionTextActive,
                      ]}
                    >
                      {c}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Status row */}
          <View style={styles.statusRow}>
            <Text style={styles.statusLeft}>
              {loading
                ? 'Buscando…'
                : `${filtered.length} ${filtered.length === 1 ? 'partido' : 'partidos'} encontrados`}
            </Text>
            <View style={styles.sortRow}>
              <ArrowDownUp color={colors.textMuted} size={12} />
              <Text style={styles.sortText}>
                {userCoords ? 'Más cercanos' : 'Próximos en hora'}
              </Text>
            </View>
          </View>

          {/* Lista */}
          {filtered.map((m, idx) => {
            // Marcar como espontáneo si empieza en menos de 60 min y precio = 0
            const startsInMin = (new Date(m.hora) - Date.now()) / 60000;
            const isSpontaneous = startsInMin >= 0 && startsInMin < 60 && m.precio_cuota === 0;
            const isBusy = busyMatchId === m.id;

            return (
              <View
                key={m.id}
                style={[
                  styles.matchCard,
                  isSpontaneous && styles.matchCardSpontaneous,
                ]}
              >
                {isSpontaneous && (
                  <View style={styles.spontaneousTag}>
                    <Zap color={colors.primary} size={14} />
                    <Text style={styles.spontaneousText}>
                      Partido espontáneo cerca de ti
                    </Text>
                  </View>
                )}

                <View style={styles.matchTopRow}>
                  <Text style={styles.matchTitle} numberOfLines={1}>
                    {m.titulo}
                  </Text>
                  {m._distanciaKm != null && (
                    <View style={styles.distanceBadge}>
                      <Text style={styles.distanceText}>
                        {m._distanciaKm < 1
                          ? `${Math.round(m._distanciaKm * 1000)} m`
                          : `${m._distanciaKm.toFixed(1)} km`}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.matchVenueRow}>
                  <MapPin color={colors.primary} size={13} />
                  <Text style={styles.matchVenue}>
                    {m.cancha_nombre} · {m.comuna}
                  </Text>
                </View>

                <View style={styles.metaRow}>
                  <View style={styles.metaItem}>
                    <Clock color={colors.textSecondary} size={13} />
                    <Text style={styles.metaText}>{formatHora(m.hora)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Users color={colors.textSecondary} size={13} />
                    <Text style={styles.metaText}>
                      {m.cupos_disponibles}/{m.cupos_totales} cupos
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <DollarSign color={colors.textSecondary} size={13} />
                    <Text style={styles.metaText}>
                      {m.precio_cuota === 0
                        ? 'Gratis'
                        : `$${m.precio_cuota.toLocaleString('es-CL')}`}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <BarChart3 color={colors.textSecondary} size={13} />
                    <Text style={[styles.metaText, styles[`nivel_${m.nivel}`]]}>
                      {nivelLabel(m.nivel)}
                    </Text>
                  </View>
                </View>

                <View style={styles.divider} />

                <View style={styles.actionsRow}>
                  <View style={styles.organizer}>
                    <View style={styles.orgAvatar}>
                      <UserIcon color={colors.textMuted} size={14} />
                    </View>
                    <View>
                      <Text style={styles.orgName}>Organizador</Text>
                      <Text style={styles.orgRating}>Confiable ✓</Text>
                    </View>
                  </View>
                  <View style={{ flex: 1 }} />
                  <Pressable
                    onPress={() => handleConfirmGPS(m.id)}
                    disabled={isBusy}
                    style={({ pressed }) => [
                      styles.gpsBtn,
                      pressed && { opacity: 0.7 },
                      isBusy && { opacity: 0.5 },
                    ]}
                  >
                    <MapPin color={colors.primary} size={13} />
                    <Text style={styles.gpsLabel}>GPS</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleJoin(m.id)}
                    disabled={isBusy || m.cupos_disponibles === 0}
                    style={({ pressed }) => [
                      styles.joinBtn,
                      pressed && { opacity: 0.85 },
                      (isBusy || m.cupos_disponibles === 0) && { opacity: 0.5 },
                    ]}
                  >
                    <Text style={styles.joinLabel}>
                      {m.cupos_disponibles === 0 ? 'Lleno' : 'Unirme'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          {/* Empty state + sugerencias */}
          {!loading && filtered.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyTitle}>No encontramos partidos</Text>
              <Text style={styles.emptyText}>
                Prueba ajustar los filtros, ampliar la distancia o publicar el tuyo.
              </Text>

              {suggestions && suggestions.length > 0 && (
                <View style={styles.suggestBox}>
                  <View style={styles.suggestHeader}>
                    <Lightbulb color={colors.primary} size={16} />
                    <Text style={styles.suggestTitle}>
                      ¿No encuentras horario? Te sugerimos
                    </Text>
                  </View>
                  <View style={styles.suggestRow}>
                    {suggestions.map((s, i) => (
                      <View key={i} style={styles.suggestChip}>
                        <Text style={styles.suggestChipDay}>{s.label}</Text>
                        <Text style={styles.suggestChipCount}>
                          {s.count} {s.count === 1 ? 'partido' : 'partidos'}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <Pressable
                onPress={() => navigation.navigate('CreateMatch')}
                style={({ pressed }) => [
                  styles.publishBtn,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.publishLabel}>+ Publicar mi partido</Text>
              </Pressable>
            </View>
          )}

          {!isSupabaseConfigured && (
            <Text style={styles.demoNotice}>
              ⚠️ Modo demo — los partidos arriba son de ejemplo.
            </Text>
          )}

          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ---- Helpers ----
function truncate(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ---- Subcomponentes ----

function FilterChip({ icon: Icon, label, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        active && styles.chipActive,
        pressed && { opacity: 0.75 },
      ]}
    >
      <Icon
        color={active ? colors.primary : colors.textSecondary}
        size={14}
      />
      <Text
        style={[styles.chipLabel, active && styles.chipLabelActive]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },

  searchRow: { marginBottom: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    height: 50,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    ...({ outlineStyle: 'none' }),
  },

  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 8,
    paddingRight: 20,
  },
  picker: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    overflow: 'hidden',
  },
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  pickerTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  clearLink: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  pickerOption: {
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  pickerOptionActive: {
    backgroundColor: colors.primarySoft,
  },
  pickerOptionText: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  pickerOptionTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  chipLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  chipLabelActive: {
    color: colors.primary,
    fontWeight: '700',
  },

  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 12,
  },
  statusLeft: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sortText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },

  matchCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  matchCardSpontaneous: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  spontaneousTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  spontaneousText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  matchTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 4,
  },
  matchTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  distanceBadge: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  distanceText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
  },
  matchVenueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 10,
  },
  matchVenue: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 10,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '500',
  },
  nivel_recreativo: { color: colors.primary },
  nivel_intermedio: { color: '#F2A03D' },
  nivel_competitivo: { color: '#E5484D' },

  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  organizer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  orgAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orgName: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  orgRating: {
    color: colors.textMuted,
    fontSize: 11,
  },
  gpsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  gpsLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  joinBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  joinLabel: {
    color: '#0E0E0D',
    fontSize: 13,
    fontWeight: '800',
  },

  emptyBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 22,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 18,
    lineHeight: 18,
  },
  suggestBox: {
    width: '100%',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 16,
  },
  suggestHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  suggestTitle: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  suggestRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestChip: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    minWidth: 90,
  },
  suggestChipDay: {
    color: colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  suggestChipCount: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  publishBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  publishLabel: {
    color: '#0E0E0D',
    fontSize: 14,
    fontWeight: '800',
  },
  demoNotice: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 16,
  },
});
