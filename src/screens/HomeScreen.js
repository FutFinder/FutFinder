import React, { useEffect, useState, useCallback } from 'react';
import { View, ScrollView, RefreshControl, Text, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Search, Plus, Star, TrendingUp } from 'lucide-react-native';

import TacticalHeader from '../components/home/TacticalHeader';
import MyClubCard from '../components/home/MyClubCard';
import TrustScoreCard from '../components/home/TrustScoreCard';
import MatchCard from '../components/home/MatchCard';
import EmptyMatchesCard from '../components/home/EmptyMatchesCard';
import SectionHeader from '../components/home/SectionHeader';
import Banner from '../components/Banner';
import MatchPreviewSheet from '../components/MatchPreviewSheet';

import { tactical } from '../theme/colors';
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

function greetingFor(d = new Date()) {
  const h = d.getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

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

    let joinedIds = new Set();
    if (userId && isSupabaseConfigured) {
      try {
        const now = new Date().toISOString();
        const { data: attRows } = await supabase
          .from('attendees')
          .select('id_partido')
          .eq('id_jugador', userId)
          .in('estado', ['inscrito', 'confirmado_gps']);
        const matchIds = (attRows || []).map((r) => r.id_partido);
        joinedIds = new Set(matchIds);
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

    setMatches(filtered.map((m) => ({ ...m, _joined: joinedIds.has(m.id) })));
    setProfile(prof);
    setMyUserId(userId);
    setMyClubData(clubResult?.data ?? null);
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

  const handleDelete = async (matchId) => {
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('¿Eliminar este partido?')
        : true;
    if (!ok) return;
    setBusyMatchId(matchId);
    const { error } = await deleteMatch(matchId);
    setBusyMatchId(null);
    if (error) { showBanner('error', 'No pudimos eliminarlo', error.message); return; }
    showBanner('success', 'Partido eliminado');
    load();
  };

  const handleConfirmGPS = async (matchId) => {
    if (busyMatchId === matchId) return;
    setBanner(null);
    setBusyMatchId(matchId);
    try {
      const result = await confirmAttendanceWithGPS(matchId);
      if (result?.ok) {
        showBanner('success', '✅ Asistencia confirmada', result.distance ? `${Math.round(result.distance)} m de la cancha. +1 Trust Score.` : 'Registrada.');
        await load();
      } else {
        showBanner('error', 'No pude confirmar tu asistencia', result?.reason || 'Intenta de nuevo');
      }
    } catch (e) {
      showBanner('error', 'Error al confirmar GPS', e?.message || String(e));
    } finally {
      setBusyMatchId(null);
    }
  };

  // ── computed props para el diseño ──────────────────────────────────────────

  const trustScore = profile?.trust_score ?? 100;
  const partidosJugados = profile?.partidos_jugados ?? 0;
  const reports = profile?.reportes ?? 0;
  const username = profile?.username || 'jugador';
  const verified = trustScore >= 70;

  // Mapea myClubData al shape que esperan los sub-componentes
  const club = myClubData
    ? {
        id: myClubData.club.id,
        nombre: myClubData.club.nombre,
        foto_url: myClubData.club.foto_url,
        role: myClubData.miRol,           // 'admin' | 'member'
        totalMiembros: myClubData.totalMiembros,
        modalidad: myClubData.club.modalidad,
      }
    : null;

  const summary = matches.length
    ? `${matches.length} ${matches.length === 1 ? 'partido cerca de ti' : 'partidos cerca de ti'}`
    : 'Sin partidos cerca';

  const tierLabel =
    trustScore >= 90 ? 'ÉLITE' : trustScore >= 70 ? 'SÓLIDO' : 'EN PRUEBA';

  const quickActions = [
    { label: 'Buscar partido', hint: 'Filtros avanzados', onPress: () => navigation.navigate('Main', { screen: 'SearchTab' }) },
    { label: 'Crear partido',  hint: 'Organiza uno nuevo', onPress: () => navigation.navigate('CreateMatch') },
    { label: 'Mi historial',   hint: 'Trust Score y reseñas', onPress: () => navigation.navigate('TrustScoreHistory') },
    { label: 'Explorar clubes', hint: 'Únete a un equipo', onPress: () => navigation.navigate('Main', { screen: 'ClubsTab' }) },
  ];

  const renderMatch = useCallback(
    (m) => (
      <MatchCard
        key={m.id}
        match={m}
        onJoin={handleJoin}
        onPress={(id) => setPreviewMatchId(id)}
      />
    ),
    [handleJoin],
  );

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: tactical.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tactical.bg }}>
        <ScrollView
          style={{ backgroundColor: tactical.bg }}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={tactical.neon}
              colors={[tactical.neon]}
            />
          }
        >
          <TacticalHeader
            userName={username}
            comuna={profile?.comuna}
            summary={summary}
            greeting={greetingFor()}
            trustScore={trustScore}
            verified={verified}
            clubRoleLabel={club?.role === 'admin' ? 'ADMIN · 1 CLUB' : undefined}
          />

          {banner && (
            <View style={{ paddingHorizontal: 18, marginBottom: 4 }}>
              <Banner
                type={banner.type}
                title={banner.title}
                message={banner.message}
                onClose={() => setBanner(null)}
              />
            </View>
          )}

          <View className="gap-5 px-[18px] pt-[18px]">
            {club ? (
              <View>
                <SectionHeader
                  title="Mi club"
                  actionLabel="Ver club"
                  onAction={() => navigation.navigate('ClubDetail', { clubId: club.id })}
                />
                <MyClubCard
                  club={club}
                  onPressClub={() => navigation.navigate('ClubDetail', { clubId: club.id })}
                  onCreateMatch={(id) => navigation.navigate('CreateMatch', { clubId: id })}
                />
              </View>
            ) : null}

            <View>
              <SectionHeader title="Reputación" />
              <TrustScoreCard
                score={trustScore}
                matchesPlayed={partidosJugados}
                reports={reports}
                verified={verified}
                tierLabel={tierLabel}
                onPress={() => navigation.navigate('TrustScoreHistory')}
              />
            </View>

            <View>
              <SectionHeader
                title="Partidos cerca de ti"
                actionLabel="Ver todos"
                onAction={() => navigation.navigate('Main', { screen: 'SearchTab' })}
              />
              {matches.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginHorizontal: -18 }}
                  contentContainerStyle={{ paddingHorizontal: 18, gap: 12, paddingBottom: 6 }}
                >
                  {matches.map(renderMatch)}
                </ScrollView>
              ) : (
                <EmptyMatchesCard
                  comuna={profile?.comuna}
                  onCreate={() => navigation.navigate('CreateMatch', club ? { clubId: club.id } : {})}
                />
              )}
            </View>

            {quickActions.length ? (
              <View>
                <SectionHeader title="Acceso rápido" />
                <View className="flex-row flex-wrap gap-2">
                  {quickActions.map((a) => (
                    <Pressable
                      key={a.label}
                      onPress={a.onPress}
                      className="min-w-[47%] flex-1 rounded-2xl border border-white/8 bg-white/4 px-3.5 py-3 active:opacity-70"
                    >
                      <Text className="text-[14.5px] font-bold text-white">{a.label}</Text>
                      <Text className="mt-0.5 text-[12.5px] text-white/40">{a.hint}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
          </View>
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
