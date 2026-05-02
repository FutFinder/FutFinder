import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MapPin,
  Clock,
  Users,
  Search,
  LogOut,
  Plus,
  ShieldCheck,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Logo from '../components/Logo';
import Banner from '../components/Banner';
import { notify } from '../utils/notify';
import { listOpenMatches, joinMatch } from '../services/matches';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { signOut, getCurrentProfile } from '../services/auth';
import { isSupabaseConfigured } from '../services/supabase';

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
    if (sameDay) return `Hoy · ${hh}:${mm}`;
    if (isTomorrow) return `Mañana · ${hh}:${mm}`;
    return d.toLocaleDateString('es-CL', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
    }) + ` · ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function nivelLabel(n) {
  return ({ recreativo: 'Recreativo', intermedio: 'Intermedio', competitivo: 'Competitivo' })[n] || n;
}

export default function HomeScreen({ navigation }) {
  const [matches, setMatches] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState(null);
  // banner: { type: 'success'|'error'|'info', title, message } | null
  const [banner, setBanner] = useState(null);

  const showBanner = useCallback((type, title, message = '') => {
    setBanner({ type, title, message });
    notify(title, message);
    // auto-clear éxitos a los 6 segundos; los errores se quedan hasta que el user los cierre
    if (type === 'success') {
      setTimeout(() => setBanner(null), 6000);
    }
  }, []);

  const load = useCallback(async () => {
    const [{ data: list }, prof] = await Promise.all([
      listOpenMatches({ limit: 20 }),
      getCurrentProfile(),
    ]);
    setMatches(list || []);
    setProfile(prof);
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

  const handleLogout = async () => {
    await signOut();
    navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
  };

  const handleJoin = async (matchId) => {
    console.log('[FutFinder] >>> handleJoin click', { matchId, busyMatchId });
    if (busyMatchId === matchId) {
      console.log('[FutFinder] click ignorado: ya hay petición en vuelo');
      return;
    }
    setBanner(null);
    setBusyMatchId(matchId);
    try {
      const result = await joinMatch(matchId);
      console.log('[FutFinder] joinMatch result:', result);
      if (!result?.ok) {
        showBanner(
          'error',
          'No pudimos inscribirte',
          result?.reason || result?.error?.message || 'Inténtalo de nuevo'
        );
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
      console.error('[FutFinder] handleJoin EXCEPCIÓN:', e);
      showBanner(
        'error',
        'Error inesperado al inscribirte',
        e?.message || String(e)
      );
    } finally {
      setBusyMatchId(null);
    }
  };

  const handleConfirmGPS = async (matchId) => {
    console.log('[FutFinder] >>> handleConfirmGPS click', { matchId, busyMatchId });
    if (busyMatchId === matchId) {
      console.log('[FutFinder] click ignorado: ya hay petición en vuelo');
      return;
    }
    setBanner(null);
    setBusyMatchId(matchId);
    try {
      const result = await confirmAttendanceWithGPS(matchId);
      console.log('[FutFinder] confirmAttendanceWithGPS result:', result);
      if (result?.ok) {
        showBanner(
          'success',
          '✅ Asistencia confirmada',
          result.distance
            ? `Estás a ${Math.round(result.distance)} m de la cancha. +1 a tu Trust Score.`
            : 'Tu asistencia quedó registrada.'
        );
        await load();
      } else {
        showBanner(
          'error',
          'No pude confirmar tu asistencia',
          result?.reason || 'Intenta de nuevo'
        );
      }
    } catch (e) {
      console.error('[FutFinder] handleConfirmGPS EXCEPCIÓN:', e);
      showBanner(
        'error',
        'Error inesperado al confirmar GPS',
        e?.message || String(e)
      );
    } finally {
      setBusyMatchId(null);
    }
  };

  const trustScore = profile?.trust_score ?? 100;
  const partidosJugados = profile?.partidos_jugados ?? 0;
  const username = profile?.username || 'jugador';

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Logo size={28} />
          <Pressable
            onPress={handleLogout}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
            hitSlop={8}
          >
            <LogOut color={colors.textSecondary} size={20} />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          <View style={styles.greetingBox}>
            <Text style={styles.hello}>¡Hola, {username}!</Text>
            <Text style={styles.subhello}>
              {loading
                ? 'Cargando partidos…'
                : `Hay ${matches.length} partidos cerca de ti`}
            </Text>
          </View>

          {banner && (
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          )}

          <Pressable
            onPress={() => navigation.navigate('Search')}
            style={({ pressed }) => [styles.searchBar, pressed && { opacity: 0.7 }]}
          >
            <Search color={colors.textMuted} size={18} />
            <Text style={styles.searchText}>Buscar canchas o partidos…</Text>
          </Pressable>

          {/* Trust Score card */}
          <View style={styles.trustCard}>
            <View style={styles.trustLeft}>
              <Text style={styles.trustLabel}>Tu Trust Score</Text>
              <Text style={styles.trustValue}>{trustScore} / 100</Text>
              <Text style={styles.trustSub}>
                {partidosJugados} partidos jugados
              </Text>
            </View>
            <View style={styles.trustBadge}>
              <ShieldCheck color="#0E0E0D" size={14} />
              <Text style={styles.trustBadgeText}>VERIFICADO</Text>
            </View>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Partidos cerca de ti</Text>
            <Pressable hitSlop={8}>
              <Text style={styles.sectionLink}>Ver todos</Text>
            </Pressable>
          </View>

          {matches.length === 0 && !loading && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                Aún no hay partidos cargados.{'\n'}¡Sé el primero en publicar uno!
              </Text>
            </View>
          )}

          {matches.map((m) => {
            const cuposLeft = m.cupos_disponibles ?? 0;
            const cuposTotales = m.cupos_totales ?? cuposLeft;
            const isBusy = busyMatchId === m.id;
            return (
              <View key={m.id} style={styles.matchCard}>
                <View style={styles.matchTopRow}>
                  <Text style={styles.matchTitle} numberOfLines={1}>
                    {m.titulo}
                  </Text>
                  <View style={styles.priceTag}>
                    <Text style={styles.priceText}>
                      {m.precio_cuota === 0
                        ? 'Gratis'
                        : `$${m.precio_cuota.toLocaleString('es-CL')}`}
                    </Text>
                  </View>
                </View>

                <Text style={styles.matchVenue}>
                  {m.cancha_nombre} · {m.comuna}
                </Text>

                <View style={styles.matchMeta}>
                  <View style={styles.metaItem}>
                    <Clock color={colors.primary} size={14} />
                    <Text style={styles.metaText}>{formatHora(m.hora)}</Text>
                  </View>
                  <View style={styles.metaItem}>
                    <Users color={colors.primary} size={14} />
                    <Text style={styles.metaText}>
                      {cuposTotales - cuposLeft}/{cuposTotales}
                    </Text>
                  </View>
                  <View style={styles.metaItem}>
                    <MapPin color={colors.primary} size={14} />
                    <Text style={styles.metaText}>{m.comuna}</Text>
                  </View>
                </View>

                <View style={styles.actionsRow}>
                  <View style={styles.levelTag}>
                    <Text style={styles.levelText}>
                      Nivel: {nivelLabel(m.nivel || 'recreativo')}
                    </Text>
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
                    <MapPin color={colors.primary} size={14} />
                    <Text style={styles.gpsLabel}>Confirmar GPS</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => handleJoin(m.id)}
                    disabled={isBusy || cuposLeft === 0}
                    style={({ pressed }) => [
                      styles.joinBtn,
                      pressed && { opacity: 0.85 },
                      (isBusy || cuposLeft === 0) && { opacity: 0.5 },
                    ]}
                  >
                    <Text style={styles.joinLabel}>
                      {cuposLeft === 0 ? 'Lleno' : 'Unirme'}
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })}

          {!isSupabaseConfigured && (
            <Text style={styles.demoNotice}>
              ⚠️ Modo demo — los partidos arriba son de ejemplo. Configura
              Supabase para datos reales.
            </Text>
          )}

          <View style={{ height: 100 }} />
        </ScrollView>

        <Pressable
          onPress={() => navigation.navigate('CreateMatch')}
          style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
        >
          <Plus color="#0E0E0D" size={26} strokeWidth={2.5} />
        </Pressable>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  greetingBox: { marginTop: 8, marginBottom: 16 },
  hello: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  subhello: { color: colors.textSecondary, fontSize: 14, marginTop: 2 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    height: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  searchText: { color: colors.textMuted, fontSize: 14 },
  trustCard: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  trustLeft: {},
  trustLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },
  trustValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  trustSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  trustBadgeText: {
    color: '#0E0E0D',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 12,
  },
  sectionTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  sectionLink: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  emptyState: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 28,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  matchCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  matchTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  matchTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  matchVenue: { color: colors.textSecondary, fontSize: 13, marginBottom: 12 },
  matchMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 12,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { color: colors.textPrimary, fontSize: 12, fontWeight: '500' },
  priceTag: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  priceText: { color: colors.primary, fontSize: 12, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  levelTag: {
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  levelText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
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
  gpsLabel: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  joinBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.sm,
  },
  joinLabel: { color: '#0E0E0D', fontSize: 13, fontWeight: '800' },
  demoNotice: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 18,
    paddingHorizontal: 24,
    lineHeight: 16,
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
