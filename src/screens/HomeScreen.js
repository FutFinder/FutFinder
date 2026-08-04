import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MapPin,
  Clock,
  Users,
  ShieldCheck,
  Edit3,
  Trash2,
  Shield,
  ChevronRight,
  Swords,
  Search,
  Plus,
  Star,
  TrendingUp,
  Trophy,
} from 'lucide-react-native';
import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import MatchPreviewSheet from '../components/MatchPreviewSheet';
import { notify } from '../utils/notify';
import {
  listOpenMatches,
  joinMatch,
  requestJoinMatch,
  deleteMatch,
  applyFilters,
} from '../services/matches';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { getCurrentProfile, getCurrentUser } from '../services/auth';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { getMyClub } from '../services/clubs';

// ─── helpers ──────────────────────────────────────────────────────────────────

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
    return (
      d.toLocaleDateString('es-CL', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
      }) + ` · ${hh}:${mm}`
    );
  } catch {
    return iso;
  }
}

function nivelLabel(n) {
  return (
    { recreativo: 'Recreativo', intermedio: 'Intermedio', competitivo: 'Competitivo' }[n] || n
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
}

function getTier(score) {
  if (score >= 80) return { label: 'ÉLITE', color: colors.primary };
  if (score >= 50) return { label: 'SÓLIDO', color: '#E8B84B' };
  return { label: 'EN PRUEBA', color: colors.textMuted };
}

// ─── sub-components ───────────────────────────────────────────────────────────

function TacticalHeader({ name, comuna, verified, clubRoleLabel }) {
  return (
    <View style={s.headerBox}>
      <View style={{ flex: 1 }}>
        <Text style={s.greeting}>{getGreeting()},</Text>
        <Text style={s.name}>{name}</Text>
        {(comuna || clubRoleLabel) ? (
          <Text style={s.headerSub}>
            {[comuna, clubRoleLabel].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
      {verified && (
        <View style={s.verifiedBadge}>
          <ShieldCheck color="#0E0E0D" size={13} strokeWidth={2.5} />
          <Text style={s.verifiedText}>VERIFICADO</Text>
        </View>
      )}
    </View>
  );
}

function TrustScoreCard({ score, matchesPlayed, reports, onPress }) {
  const tier = getTier(score);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.trustCard, pressed && { opacity: 0.9 }]}
    >
      <View style={s.trustLeft}>
        <Text style={s.trustLabel}>Tu Trust Score</Text>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: 4 }}>
          <Text style={s.trustValue}>{score}</Text>
          <Text style={s.trustMax}>/100</Text>
        </View>
        <Text style={s.trustSub}>{matchesPlayed} partidos jugados</Text>
        {reports > 0 && (
          <Text style={[s.trustSub, { color: colors.error, marginTop: 2 }]}>
            {reports} reporte{reports > 1 ? 's' : ''}
          </Text>
        )}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 8 }}>
        <View style={[s.tierBadge, { backgroundColor: tier.color + '22', borderColor: tier.color }]}>
          <Text style={[s.tierText, { color: tier.color }]}>{tier.label}</Text>
        </View>
        <ChevronRight color={colors.textMuted} size={16} />
      </View>
    </Pressable>
  );
}

function MyClubCard({ club, myRol, totalMiembros, onPress, onCreateMatch }) {
  return (
    <View style={s.myClubCard}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [s.myClubMain, pressed && { opacity: 0.9 }]}
      >
        {club.foto_url ? (
          <Image source={{ uri: club.foto_url }} style={s.clubLogo} />
        ) : (
          <View style={s.clubLogoPlaceholder}>
            <Shield color={colors.primary} size={20} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={s.clubName} numberOfLines={1}>{club.nombre}</Text>
          <Text style={s.clubMeta}>
            {totalMiembros} miembros · {myRol === 'admin' ? 'Admin' : 'Miembro'}
          </Text>
        </View>
        <ChevronRight color={colors.textMuted} size={16} />
      </Pressable>
      {myRol === 'admin' && (
        <Pressable
          onPress={onCreateMatch}
          style={({ pressed }) => [s.clubCreateMatchBtn, pressed && { opacity: 0.85 }]}
        >
          <Plus color="#0E0E0D" size={14} strokeWidth={2.5} />
          <Text style={s.clubCreateMatchText}>Crear partido de club</Text>
        </Pressable>
      )}
    </View>
  );
}

function SectionHeader({ title, action, onAction }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      {action && (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={s.sectionLink}>{action}</Text>
        </Pressable>
      )}
    </View>
  );
}

function EmptyMatchesCard({ onCreateMatch }) {
  return (
    <View style={s.emptyCard}>
      <Trophy color={colors.textMuted} size={32} strokeWidth={1.5} />
      <Text style={s.emptyTitle}>Sin partidos cerca</Text>
      <Text style={s.emptyText}>
        No hay partidos disponibles en tu zona.{'\n'}¡Crea el primero!
      </Text>
      <Pressable
        onPress={onCreateMatch}
        style={({ pressed }) => [s.emptyBtn, pressed && { opacity: 0.85 }]}
      >
        <Plus color="#0E0E0D" size={15} />
        <Text style={s.emptyBtnText}>Crear partido</Text>
      </Pressable>
    </View>
  );
}

function MatchCard({ match: m, myUserId, busyMatchId, onPress, onJoin, onConfirmGPS, onEdit, onDelete }) {
  const cuposLeft = m.cupos_disponibles ?? 0;
  const isBusy = busyMatchId === m.id;
  const isMine = myUserId && m.id_organizador === myUserId;

  return (
    <Pressable
      onPress={() => onPress(m.id)}
      style={({ pressed }) => [
        s.matchCard,
        m.club_local_id && s.clubMatchCard,
        pressed && { opacity: 0.93 },
      ]}
    >
      {m.club_local_id && (
        <View style={s.clubMatchBadge}>
          <Swords color="#0E0E0D" size={11} strokeWidth={2.6} />
          <Text style={s.clubMatchBadgeText}>PARTIDO DE CLUBES</Text>
        </View>
      )}

      <View style={s.mcTopRow}>
        <Text style={s.mcTitle} numberOfLines={2}>{m.titulo}</Text>
        {isMine ? (
          <View style={s.organizerTag}>
            <Text style={s.organizerTagText}>TÚ</Text>
          </View>
        ) : (
          <View style={s.priceTag}>
            <Text style={s.priceText}>
              {m.precio_cuota === 0 ? 'Gratis' : `$${m.precio_cuota.toLocaleString('es-CL')}`}
            </Text>
          </View>
        )}
      </View>

      <Text style={s.mcVenue} numberOfLines={1}>{m.cancha_nombre} · {m.comuna}</Text>

      <View style={s.mcMetaRow}>
        <View style={s.metaChip}>
          <Clock color={colors.primary} size={11} />
          <Text style={s.metaChipText}>{formatHora(m.hora)}</Text>
        </View>
        <View style={s.metaChip}>
          <Users color={colors.primary} size={11} />
          <Text style={s.metaChipText}>{cuposLeft} cupos</Text>
        </View>
      </View>

      <Text style={s.levelText}>{nivelLabel(m.nivel || 'recreativo')}</Text>

      <View style={s.mcActions}>
        {isMine ? (
          <>
            <Pressable
              onPress={() => onEdit(m.id)}
              disabled={isBusy}
              style={({ pressed }) => [s.editBtn, pressed && { opacity: 0.7 }, isBusy && { opacity: 0.5 }]}
            >
              <Edit3 color={colors.primary} size={12} />
              <Text style={s.editLabel}>Editar</Text>
            </Pressable>
            <Pressable
              onPress={() => onDelete(m.id)}
              disabled={isBusy}
              style={({ pressed }) => [s.deleteBtn, pressed && { opacity: 0.7 }, isBusy && { opacity: 0.5 }]}
            >
              <Trash2 color={colors.error} size={13} />
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => onConfirmGPS(m.id)}
              disabled={isBusy}
              style={({ pressed }) => [s.gpsBtn, pressed && { opacity: 0.7 }, isBusy && { opacity: 0.5 }]}
            >
              <MapPin color={colors.primary} size={12} />
              <Text style={s.gpsLabel}>GPS</Text>
            </Pressable>
            <Pressable
              onPress={() => onJoin(m.id)}
              disabled={isBusy || cuposLeft === 0}
              style={({ pressed }) => [
                s.joinBtn,
                pressed && { opacity: 0.85 },
                (isBusy || cuposLeft === 0) && { opacity: 0.5 },
              ]}
            >
              <Text style={s.joinLabel}>
                {cuposLeft === 0 ? 'Lleno' : m.aprobacion === 'manual' ? 'Solicitar' : 'Unirme'}
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </Pressable>
  );
}

// ─── main screen ──────────────────────────────────────────────────────────────

export default function HomeScreen({ navigation }) {
  const [matches, setMatches] = useState([]);
  const [profile, setProfile] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState(null);
  const [previewMatchId, setPreviewMatchId] = useState(null);
  const [myClubData, setMyClubData] = useState(undefined);
  const [nextMatch, setNextMatch] = useState(null);
  const [banner, setBanner] = useState(null);

  const showBanner = useCallback((type, title, message = '') => {
    setBanner({ type, title, message });
    notify(title, message);
    if (type === 'success') setTimeout(() => setBanner(null), 6000);
  }, []);

  const load = useCallback(async () => {
    const [{ data: list }, prof, user, clubResult] = await Promise.all([
      listOpenMatches({ limit: 20 }),
      getCurrentProfile(),
      getCurrentUser(),
      getMyClub(),
    ]);
    const userId = user?.id || null;
    const userCoords = prof?.latitud ? { lat: prof.latitud, lng: prof.longitud } : null;
    const radiusKm = prof?.search_radius_km ?? 10;
    const filtered = userCoords
      ? applyFilters(list || [], { maxKm: radiusKm }, userCoords)
      : list || [];

    setMatches(filtered);
    setProfile(prof);
    setMyUserId(userId);
    setMyClubData(clubResult?.data ?? null);

    if (userId && isSupabaseConfigured) {
      try {
        const now = new Date().toISOString();
        const { data: attRows } = await supabase
          .from('attendees')
          .select('match_id')
          .eq('user_id', userId)
          .in('estado', ['inscrito', 'confirmado_gps']);
        const matchIds = (attRows || []).map((r) => r.match_id);
        if (matchIds.length > 0) {
          const { data: upcoming } = await supabase
            .from('matches')
            .select('id, titulo, hora, cancha_nombre, comuna')
            .in('id', matchIds)
            .gt('hora', now)
            .neq('estado', 'cancelado')
            .order('hora', { ascending: true })
            .limit(1)
            .maybeSingle();
          setNextMatch(upcoming || null);
        } else {
          setNextMatch(null);
        }
      } catch {
        setNextMatch(null);
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  const handleJoin = async (matchId) => {
    if (busyMatchId === matchId) return;
    setBanner(null);
    setBusyMatchId(matchId);
    const match = matches.find((m) => m.id === matchId);
    const manual = match?.aprobacion === 'manual';
    try {
      const result = manual ? await requestJoinMatch(matchId) : await joinMatch(matchId);
      if (!result?.ok) {
        showBanner('error', manual ? 'No pudimos enviar tu solicitud' : 'No pudimos inscribirte', result?.reason || result?.error?.message || 'Inténtalo de nuevo');
        return;
      }
      if (manual) {
        showBanner('success', 'Solicitud enviada', 'El anfitrión decidirá si te acepta.');
      } else if (result.already) {
        showBanner('info', 'Ya estabas inscrito', 'Tu cupo sigue activo.');
      } else {
        showBanner('success', '¡Te inscribiste!', 'Confirma GPS cuando estés en la cancha.');
      }
      await load();
    } catch (e) {
      showBanner('error', 'Error inesperado', e?.message || String(e));
    } finally {
      setBusyMatchId(null);
    }
  };

  const handleEdit = (matchId) => navigation.navigate('CreateMatch', { matchId });

  const handleDelete = async (matchId) => {
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('¿Eliminar este partido? Los inscritos perderán acceso al chat.')
        : true;
    if (!ok) return;
    setBusyMatchId(matchId);
    const { error } = await deleteMatch(matchId);
    setBusyMatchId(null);
    if (error) {
      showBanner('error', 'No pudimos eliminarlo', error.message || 'Intenta de nuevo');
      return;
    }
    showBanner('success', 'Partido eliminado', 'Ya no aparece en el feed.');
    load();
  };

  const handleConfirmGPS = async (matchId) => {
    if (busyMatchId === matchId) return;
    setBanner(null);
    setBusyMatchId(matchId);
    try {
      const result = await confirmAttendanceWithGPS(matchId);
      if (result?.ok) {
        showBanner(
          'success',
          '✅ Asistencia confirmada',
          result.distance
            ? `Estás a ${Math.round(result.distance)} m de la cancha. +1 a tu Trust Score.`
            : 'Tu asistencia quedó registrada.',
        );
        await load();
      } else {
        showBanner('error', 'No pude confirmar tu asistencia', result?.reason || 'Intenta de nuevo');
      }
    } catch (e) {
      showBanner('error', 'Error inesperado al confirmar GPS', e?.message || String(e));
    } finally {
      setBusyMatchId(null);
    }
  };

  const trustScore = profile?.trust_score ?? 100;
  const partidosJugados = profile?.partidos_jugados ?? 0;
  const reports = profile?.reportes ?? 0;
  const username = profile?.username || 'jugador';
  const verified = trustScore >= 70;

  const quickActions = [
    {
      label: 'Buscar partido',
      hint: 'Filtros avanzados',
      Icon: Search,
      onPress: () => navigation.navigate('Main', { screen: 'SearchTab' }),
    },
    {
      label: 'Crear partido',
      hint: 'Organiza uno nuevo',
      Icon: Plus,
      onPress: () => navigation.navigate('CreateMatch'),
    },
    {
      label: 'Mi historial',
      hint: 'Trust Score y reseñas',
      Icon: Star,
      onPress: () => navigation.navigate('TrustScoreHistory'),
    },
    {
      label: 'Explorar clubes',
      hint: 'Únete a un equipo',
      Icon: TrendingUp,
      onPress: () => navigation.navigate('Main', { screen: 'ClubsTab' }),
    },
  ];

  return (
    <View style={s.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={s.scroll}
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
          {/* ── tactical header ── */}
          <TacticalHeader
            name={username}
            comuna={profile?.comuna}
            verified={verified}
            clubRoleLabel={
              myClubData?.miRol === 'admin'
                ? 'Admin de club'
                : myClubData
                ? 'Miembro de club'
                : null
            }
          />

          {banner && (
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          )}

          {/* ── próximo partido ── */}
          {nextMatch && (
            <View style={s.nextCard}>
              <View style={s.nextLeft}>
                <Text style={s.nextLabel}>PRÓXIMO PARTIDO</Text>
                <Text style={s.nextTitle} numberOfLines={1}>{nextMatch.titulo}</Text>
                <View style={s.nextMeta}>
                  <Clock color={colors.primary} size={11} />
                  <Text style={s.nextMetaText}>{formatHora(nextMatch.hora)}</Text>
                  <MapPin color={colors.textMuted} size={11} />
                  <Text style={s.nextMetaText} numberOfLines={1}>
                    {nextMatch.cancha_nombre}{nextMatch.comuna ? ` · ${nextMatch.comuna}` : ''}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => navigation.navigate('MatchDetail', { matchId: nextMatch.id })}
                style={({ pressed }) => [s.nextBtn, pressed && { opacity: 0.8 }]}
              >
                <Text style={s.nextBtnText}>Ver</Text>
                <ChevronRight color="#0E0E0D" size={13} strokeWidth={2.5} />
              </Pressable>
            </View>
          )}

          {/* ── trust score card ── */}
          <TrustScoreCard
            score={trustScore}
            matchesPlayed={partidosJugados}
            reports={reports}
            onPress={() => navigation.navigate('TrustScoreHistory')}
          />

          {/* ── sección club ── */}
          {myClubData === null ? (
            <View style={s.clubPromoCard}>
              <View style={s.clubPromoIcon}>
                <Shield color={colors.primary} size={22} strokeWidth={2} />
              </View>
              <Text style={s.clubPromoTitle}>Encuentra tu equipo</Text>
              <Text style={s.clubPromoSub}>Únete a un club o crea el tuyo propio</Text>
              <View style={s.clubPromoBtns}>
                <Pressable
                  onPress={() => navigation.navigate('CreateClub')}
                  style={({ pressed }) => [s.clubPromoBtn, pressed && { opacity: 0.85 }]}
                >
                  <Text style={s.clubPromoBtnText}>Crear club</Text>
                </Pressable>
                <Pressable
                  onPress={() => navigation.navigate('Main', { screen: 'ClubsTab' })}
                  style={({ pressed }) => [s.clubPromoBtnOutline, pressed && { opacity: 0.85 }]}
                >
                  <Text style={s.clubPromoBtnOutlineText}>Buscar club</Text>
                </Pressable>
              </View>
            </View>
          ) : myClubData ? (
            <MyClubCard
              club={myClubData.club}
              myRol={myClubData.miRol}
              totalMiembros={myClubData.totalMiembros}
              onPress={() => navigation.navigate('ClubDetail', { clubId: myClubData.club.id })}
              onCreateMatch={() =>
                navigation.navigate('CreateMatch', { clubId: myClubData.club.id })
              }
            />
          ) : null}

          {/* ── partidos cercanos ── */}
          <SectionHeader
            title={loading ? 'Cargando partidos…' : `${matches.length} partidos cerca`}
            action={matches.length > 0 ? 'Ver todos' : null}
            onAction={() => navigation.navigate('Main', { screen: 'SearchTab' })}
          />

          {matches.length === 0 && !loading ? (
            <EmptyMatchesCard onCreateMatch={() => navigation.navigate('CreateMatch')} />
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.matchesRow}
              decelerationRate="fast"
              snapToInterval={264}
              snapToAlignment="start"
            >
              {matches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  myUserId={myUserId}
                  busyMatchId={busyMatchId}
                  onPress={(id) => setPreviewMatchId(id)}
                  onJoin={handleJoin}
                  onConfirmGPS={handleConfirmGPS}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))}
            </ScrollView>
          )}

          {/* ── acciones rápidas ── */}
          <SectionHeader title="Acciones rápidas" />
          <View style={s.quickGrid}>
            {quickActions.map((qa) => (
              <Pressable
                key={qa.label}
                onPress={qa.onPress}
                style={({ pressed }) => [s.quickPill, pressed && { opacity: 0.8 }]}
              >
                <View style={s.quickIcon}>
                  <qa.Icon color={colors.primary} size={16} />
                </View>
                <Text style={s.quickLabel}>{qa.label}</Text>
                <Text style={s.quickHint}>{qa.hint}</Text>
              </Pressable>
            ))}
          </View>

          {!isSupabaseConfigured && (
            <Text style={s.demoNotice}>
              ⚠️ Modo demo — los partidos son de ejemplo. Configura Supabase para datos reales.
            </Text>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>

      <MatchPreviewSheet
        matchId={previewMatchId}
        myUserId={myUserId}
        busyMatchId={busyMatchId}
        onClose={() => setPreviewMatchId(null)}
        onJoin={handleJoin}
        onNavigateToDetail={(id) => navigation.navigate('MatchDetail', { matchId: id })}
      />
    </View>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const CARD_W = 252;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: 24 },

  // ── tactical header
  headerBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  greeting: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  name: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 2,
  },
  headerSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    marginTop: 4,
  },
  verifiedText: {
    color: '#0E0E0D',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  // ── próximo partido
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 14,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.primary + '55',
  },
  nextLeft: { flex: 1, marginRight: 10 },
  nextLabel: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  nextTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  nextMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  nextMetaText: { color: colors.textSecondary, fontSize: 11 },
  nextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  nextBtnText: { color: '#0E0E0D', fontSize: 12, fontWeight: '800' },

  // ── trust score card
  trustCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: 16,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.primary + '55',
  },
  trustLeft: {},
  trustLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  trustValue: { color: colors.textPrimary, fontSize: 30, fontWeight: '800', lineHeight: 34 },
  trustMax: { color: colors.textMuted, fontSize: 16, fontWeight: '600' },
  trustSub: { color: colors.textMuted, fontSize: 11, marginTop: 4 },
  tierBadge: {
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  tierText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },

  // ── club promo (sin club)
  clubPromoCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 18,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
  },
  clubPromoIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  clubPromoTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  clubPromoSub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 14,
  },
  clubPromoBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  clubPromoBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
  },
  clubPromoBtnText: { color: '#0E0E0D', fontSize: 13, fontWeight: '800' },
  clubPromoBtnOutline: {
    flex: 1,
    borderRadius: radius.md,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  clubPromoBtnOutlineText: { color: colors.primary, fontSize: 13, fontWeight: '800' },

  // ── my club card (tiene club)
  myClubCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    marginHorizontal: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
  },
  myClubMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  clubLogo: { width: 44, height: 44, borderRadius: 22 },
  clubLogoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubName: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  clubMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  clubCreateMatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    paddingVertical: 11,
  },
  clubCreateMatchText: { color: '#0E0E0D', fontSize: 13, fontWeight: '800' },

  // ── section header
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 8,
    marginBottom: 12,
  },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700' },
  sectionLink: { color: colors.primary, fontSize: 13, fontWeight: '600' },

  // ── matches horizontal scroll
  matchesRow: {
    paddingLeft: 20,
    paddingRight: 8,
    gap: 12,
    marginBottom: 8,
  },

  // ── match card
  matchCard: {
    width: CARD_W,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  clubMatchCard: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    backgroundColor: colors.primarySoft,
  },
  clubMatchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 8,
  },
  clubMatchBadgeText: {
    color: '#0E0E0D',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  mcTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
    gap: 6,
  },
  mcTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    lineHeight: 20,
  },
  mcVenue: { color: colors.textSecondary, fontSize: 12, marginBottom: 10 },
  mcMetaRow: { flexDirection: 'row', gap: 8, marginBottom: 8, flexWrap: 'wrap' },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.background,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  metaChipText: { color: colors.textPrimary, fontSize: 11, fontWeight: '500' },
  levelText: { color: colors.textMuted, fontSize: 11, fontWeight: '500', marginBottom: 12 },
  mcActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  priceTag: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  priceText: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  organizerTag: {
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  organizerTagText: { color: '#0E0E0D', fontSize: 9, fontWeight: '800', letterSpacing: 0.4 },

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
    flex: 1,
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  joinLabel: { color: '#0E0E0D', fontSize: 12, fontWeight: '800' },
  editBtn: {
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
  editLabel: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── empty matches card
  emptyCard: {
    marginHorizontal: 20,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    gap: 8,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 8 },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    marginTop: 8,
  },
  emptyBtnText: { color: '#0E0E0D', fontSize: 13, fontWeight: '800' },

  // ── quick actions grid
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 8,
  },
  quickPill: {
    width: '47%',
    flexGrow: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    gap: 6,
  },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  quickHint: { color: colors.textMuted, fontSize: 11 },

  // ── misc
  demoNotice: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginHorizontal: 24,
    marginTop: 18,
    lineHeight: 16,
  },
});
