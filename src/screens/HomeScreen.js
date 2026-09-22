import React, { useState, useCallback } from 'react';
import { View, ScrollView, RefreshControl, Text, Pressable, Modal, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Search, Plus, Star, TrendingUp } from 'lucide-react-native';

import TacticalHeader from '../components/home/TacticalHeader';
import MyClubCard from '../components/home/MyClubCard';
import TrustScoreCard from '../components/home/TrustScoreCard';
import MatchCard from '../components/home/MatchCard';
import EmptyMatchesCard from '../components/home/EmptyMatchesCard';
import SectionHeader from '../components/home/SectionHeader';
import Banner from '../components/Banner';
import MatchPreviewSheet from '../components/MatchPreviewSheet';

import {
  paleta as C,
  radios as R,
  fuentes as F,
  alfa,
} from '../theme/colors';
import { notify } from '../utils/notify';
import {
  listOpenMatches,
  joinMatch,
  requestJoinMatch,
  deleteMatch,
  applyFilters,
  listPartidosDeMisClubes,
} from '../services/matches';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { getCurrentProfile, getCurrentUser } from '../services/auth';
import { supabase, isSupabaseConfigured } from '../services/supabase';
import { getMyClub, getMyClubIds } from '../services/clubs';
import { getMisPermisosEnClub } from '../services/clubPermissions';
import ClubMatchCard from '../components/partidos/ClubMatchCard';
import { seleccionInicio } from '../services/clubMatchRules';
import useConfirmacion from '../components/useConfirmacion';

function greetingFor(d = new Date()) {
  const h = d.getHours();
  if (h < 6) return 'Buenas noches';
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function HomeScreen({ navigation }) {
  // `window.confirm` no abre nada en web: diálogo propio de la app.
  const { confirmar, dialogo } = useConfirmacion();
  const [matches, setMatches] = useState([]);
  const [profile, setProfile] = useState(null);
  const [myUserId, setMyUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyMatchId, setBusyMatchId] = useState(null);
  const [previewMatchId, setPreviewMatchId] = useState(null);
  const [myClubData, setMyClubData] = useState(undefined);
  // «Crear partido de club» con el permiso `pubChallenge`/`answerChallenge`
  // delegado (migración 119, Permisos de club), no sólo con `rol === 'admin'`
  // — antes un jugador con el permiso concedido no veía el botón acá, aunque
  // ClubDetailScreen/ClubChallengesScreen ya lo dejaran desafiar igual.
  const [puedeCrearPartidoDelegado, setPuedeCrearPartidoDelegado] = useState(false);
  const [nextMatch, setNextMatch] = useState(null);
  // Los partidos de MIS clubes, pedidos club por club a la base. No salen de
  // la tanda general de `listOpenMatches()`: esa trae los N partidos abiertos
  // más próximos de toda la app, así que con la app llena los partidos ajenos
  // se comían la ventana y el de tu club desaparecía de Inicio sin decir por
  // qué; y como pide sólo `'abierto'`, el partido se esfumaba también al
  // llenarse la nómina, justo cuando el club terminaba de armarse.
  const [partidosDeClub, setPartidosDeClub] = useState([]);
  const [misClubIds, setMisClubIds] = useState([]);
  const [banner, setBanner] = useState(null);
  // Id del club para el que se está por crear un partido — abre la hoja
  // «Buscar rival» / «Desafío abierto»; `null` la mantiene cerrada.
  const [crearPartidoClubId, setCrearPartidoClubId] = useState(null);

  const showBanner = useCallback((type, title, message = '') => {
    setBanner({ type, title, message });
    notify(title, message);
    if (type === 'success') setTimeout(() => setBanner(null), 6000);
  }, []);

  const load = useCallback(async () => {
    const [{ data: list }, prof, user, clubResult, misClubes] = await Promise.all([
      listOpenMatches({ limit: 20 }),
      getCurrentProfile(),
      getCurrentUser(),
      getMyClub(),
      getMyClubIds().catch(() => ({ data: [] })),
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

    const clubIds = misClubes?.data || [];
    setMisClubIds(clubIds);
    setMatches(filtered.map((m) => ({ ...m, _joined: joinedIds.has(m.id) })));
    setProfile(prof);
    setMyUserId(userId);
    setMyClubData(clubResult?.data ?? null);

    const miClub = clubResult?.data;
    if (miClub && miClub.miRol !== 'admin' && miClub.club?.id) {
      const { data: permisos } = await getMisPermisosEnClub(miClub.club.id).catch(() => ({ data: null }));
      setPuedeCrearPartidoDelegado(!!(permisos?.permisos?.pubChallenge || permisos?.permisos?.answerChallenge));
    } else {
      setPuedeCrearPartidoDelegado(false);
    }

    // Después del resto: necesita los ids de mis clubes, y nada de lo de
    // arriba necesita esperarla.
    const { data: deClub } = await listPartidosDeMisClubes(clubIds).catch(() => ({ data: [] }));
    setPartidosDeClub(deClub || []);

    setLoading(false);
    setRefreshing(false);
  }, []);

  // Al volver a Inicio, no sólo al montarlo. El navegador de pestañas deja
  // esta pantalla montada, así que un partido de club publicado durante la
  // sesión no aparecía hasta recargar la app entera: se veía en Buscar y no
  // en Inicio, que es exactamente lo que se reportó.
  useFocusEffect(useCallback(() => { load(); }, [load]));

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

  const handleDelete = (matchId) => {
    // `window.confirm` no abre nada en web: eliminar no hacía nada.
    confirmar('¿Eliminar este partido?', 'No se puede deshacer.',
      () => borrarPartido(matchId), { confirmar: 'Eliminar' });
  };

  const borrarPartido = async (matchId) => {
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
        puedeCrearPartido: myClubData.miRol === 'admin' || puedeCrearPartidoDelegado,
      }
    : null;

  /**
   * «ADMIN · 2 CLUBES». El número estuvo escrito a mano —siempre «1 CLUB»—
   * desde que se dibujó la cabecera, así que a quien administra dos clubes
   * leía en su propia portada que administra uno. La cuenta real ya venía
   * cargada en `misClubIds`; lo único que faltaba era usarla.
   *
   * El `|| 1` es para el instante entre que `getMyClub()` responde y
   * `getMyClubIds()` todavía no: si administra un club, administra al menos
   * uno, y «ADMIN · 0 CLUBES» sería peor que esperar.
   */
  const clubRoleLabel =
    club?.role === 'admin'
      ? `ADMIN · ${misClubIds.length || 1} ${(misClubIds.length || 1) === 1 ? 'CLUB' : 'CLUBES'}`
      : undefined;

  const summary = matches.length
    ? `${matches.length} ${matches.length === 1 ? 'partido cerca de ti' : 'partidos cerca de ti'}`
    : 'Sin partidos cerca';

  const tierLabel =
    trustScore >= 90 ? 'ÉLITE' : trustScore >= 70 ? 'SÓLIDO' : 'EN PRUEBA';

  const quickActions = [
    { label: 'Buscar partido', hint: 'Filtros avanzados', onPress: () => navigation.navigate('Main', { screen: 'SearchTab' }) },
    { label: '¿Te falta un jugador?', hint: '¡Encuentra al jugador que necesitas!', onPress: () => navigation.navigate('CreateMatch') },
    { label: 'Mi historial',   hint: 'Trust Score y reseñas', onPress: () => navigation.navigate('TrustScoreHistory') },
    { label: 'Explorar clubes', hint: 'Únete a un equipo', onPress: () => navigation.navigate('Main', { screen: 'ClubsTab' }) },
  ];

  // Los destacados y la lista se deciden a la vez: los partidos que suben a
  // «Tu club juega» son los que hay que quitar de «Partidos cerca de ti», o
  // saldrían dos veces en la misma pantalla.
  const { destacados: partidosDeMiClub, resto: partidosCerca } = seleccionInicio(
    partidosDeClub,
    matches,
    misClubIds
  );

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
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: C.bg }}>
        <ScrollView
          style={{ backgroundColor: C.bg }}
          contentContainerStyle={{ paddingBottom: 120 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={C.green}
              colors={[C.green]}
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
            clubRoleLabel={clubRoleLabel}
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
            {/* Va primero a propósito: si mi club juega, es lo más importante
                que tengo en pantalla y quien abre la app tiene que enterarse
                sin desplazarse. Sin partido de club, la sección no se dibuja
                — no hay estado vacío que ocupe sitio por nada.

                EL PRIMERO VA EN TARJETA COMPLETA. La compacta de antes lo
                dejaba pesando menos que un partido cualquiera de la fila de
                abajo, que es al revés de lo que tiene que pasar. Los
                siguientes sí van compactos: son agenda, no la noticia. */}
            {partidosDeMiClub.length ? (
              <View>
                <SectionHeader
                  title="Tu club juega"
                  actionLabel={partidosDeMiClub.length > 1 ? 'Ver agenda' : undefined}
                  onAction={() =>
                    navigation.navigate('Main', { screen: 'ClubsTab' })
                  }
                />
                <View className="gap-2.5">
                  {partidosDeMiClub.map((p, i) => (
                    <ClubMatchCard
                      key={p.id}
                      match={p}
                      misClubIds={misClubIds}
                      variant={i === 0 ? 'completa' : 'compacta'}
                      onPress={() => navigation.navigate('MatchDetail', { matchId: p.id })}
                    />
                  ))}
                </View>
              </View>
            ) : null}

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
                  onCreateMatch={(id) => setCrearPartidoClubId(id)}
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
              {partidosCerca.length ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ marginHorizontal: -18 }}
                  contentContainerStyle={{ paddingHorizontal: 18, gap: 12, paddingBottom: 6 }}
                >
                  {partidosCerca.map(renderMatch)}
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

      {/* Hoja: crear partido de club — «Buscar rival» (1 a 1) o «Desafío
          abierto» (tablero, migración 112). Vivía en ClubDetailScreen; se
          movió acá porque «Ver club» dejó de ofrecer crear un desafío. */}
      <Modal
        visible={!!crearPartidoClubId}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setCrearPartidoClubId(null)}
      >
        <Pressable style={sheetStyles.backdrop} onPress={() => setCrearPartidoClubId(null)}>
          <Pressable style={sheetStyles.sheet} onPress={() => {}}>
            <View style={sheetStyles.handle} />
            <Text style={sheetStyles.title}>Crear partido de club</Text>
            <Text style={sheetStyles.subtitle}>Elige cómo quieres encontrar rival</Text>

            <Pressable
              onPress={() => {
                const id = crearPartidoClubId;
                setCrearPartidoClubId(null);
                navigation.navigate('ExploreClubs', { modoRival: true, retadorClubId: id });
              }}
              accessibilityRole="button"
              accessibilityLabel="Buscar rival"
              style={({ pressed }) => [sheetStyles.primary, pressed && { opacity: 0.85 }]}
            >
              <Text style={sheetStyles.primaryText}>Buscar rival</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                const id = crearPartidoClubId;
                setCrearPartidoClubId(null);
                navigation.navigate('ClubChallenges', { clubId: id, abrirPublicar: true });
              }}
              accessibilityRole="button"
              accessibilityLabel="Desafío abierto"
              style={({ pressed }) => [sheetStyles.secondary, pressed && { opacity: 0.7 }]}
            >
              <Text style={sheetStyles.secondaryText}>Desafío abierto</Text>
              <Text style={sheetStyles.secondaryHint}>Publícalo en el tablero, sin elegir rival todavía</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {dialogo}
    </View>
  );
}

const sheetStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 30,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 3,
    backgroundColor: alfa(C.tinta, 0.2),
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: { color: C.textPrimary, fontSize: 18, fontFamily: F.extraBold, letterSpacing: -0.3 },
  subtitle: { color: C.textSecondary, fontSize: 12.5, marginTop: 4 },
  primary: {
    height: 52,
    marginTop: 14,
    borderRadius: R.iconBtn,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: C.greenInk, fontSize: 15, fontFamily: F.extraBold },
  secondary: {
    height: 'auto',
    paddingVertical: 12,
    marginTop: 8,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: C.textPrimary, fontSize: 15, fontFamily: F.bold },
  secondaryHint: { color: C.textMuted, fontSize: 11, marginTop: 3, textAlign: 'center' },
});
