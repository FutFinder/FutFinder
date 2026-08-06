import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Info,
  ListChecks,
  LogOut,
  MapPin,
  MessageSquare,
  Navigation,
  Search as SearchIcon,
  Settings2,
  Share2,
  ShieldCheck,
  Star,
  Trophy,
  Users,
} from 'lucide-react-native';

import { partidos as P, partidosRadius as R } from '../theme/colors';
import {
  Avatar,
  Callout,
  Card,
  CheckRow,
  DetailRow,
  Divider,
  GhostButton,
  IconButton,
  Note,
  PrimaryButton,
  ProgressBar,
  SectionLabel,
  StatCell,
  StatusButton,
  SurfaceButton,
  Tag,
} from '../components/partidos/ui';
import Sheet from '../components/partidos/Sheet';
import ShareSheet from '../components/partidos/ShareSheet';
import { LoadingDetail, ErrorState, OfflineNotice } from '../components/partidos/StateViews';
import { formatFechaLarga } from '../components/partidos/DateTimeSheets';
import { fmtKm } from '../components/partidos/PartidoCard';
import {
  cancelMyJoinRequest,
  countMatchesWithoutMinTrust,
  getMatchAttendees,
  getScheduleConflict,
  getWaitlist,
  joinMatch,
  joinWaitlist,
  leaveMatchPenalized,
  leaveWaitlist,
  requestJoinMatch,
  swapMatch,
  cancelMatchAndJoin,
} from '../services/matches';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { getCurrentUser } from '../services/auth';
import { getMyProfile, getMyAccountStatus } from '../services/profile';
import {
  cacheRead,
  cacheWrite,
  isNetworkError,
  markOffline,
  markOnline,
  useOnline,
} from '../services/connectivity';
import {
  ATTENDANCE_WINDOW_HOURS,
  GPS_RADIUS_METERS,
  WAITLIST_CONFIRM_MINUTES,
  cuotaLabel,
  edadLabel,
  estadoLabel,
  getBlockReason,
  getCtaState,
  hasFinished,
  hasStarted,
  isPenaltyFree,
  leavePenaltyFor,
  leaveRuleText,
  modalidadLabel,
  nivelLabel,
  timeUntilLabel,
  trustLabel,
} from '../services/matchRules';
import { haversineKm } from '../services/matches';
import { getCurrentLocation } from '../services/location';

/**
 * Detalle del partido (sección 2 del handoff).
 *
 * Toda la pantalla se deriva del estado real: el CTA sticky, los bloqueos, la
 * lista de espera y el acceso al chat salen de `matchRules`, así que nunca hay
 * un botón activo que el backend vaya a rechazar después.
 */
export default function MatchDetailScreen({ route, navigation }) {
  const matchId = route?.params?.matchId;
  const insets = useSafeAreaInsets();
  const online = useOnline();

  const [match, setMatch] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [myId, setMyId] = useState(null);
  const [myProfile, setMyProfile] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [openWithoutTrust, setOpenWithoutTrust] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [fromCache, setFromCache] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null); // { tone, title, text }
  const [sheet, setSheet] = useState(null); // 'join' | 'leave' | 'share' | 'waitlist'
  const [checks, setChecks] = useState({ llegar: false, cuota: false, aviso: false });
  const [userCoords, setUserCoords] = useState(null);

  const cacheKey = `partidos/detail/${matchId}`;

  const load = useCallback(async () => {
    const [attRes, user, profile, status, conf, wl, loc] = await Promise.all([
      getMatchAttendees(matchId).catch((e) => ({ data: [], match: null, error: e })),
      getCurrentUser(),
      getMyProfile().catch(() => null),
      getMyAccountStatus().catch(() => null),
      getScheduleConflict(matchId).catch(() => ({ conflict: false })),
      getWaitlist(matchId).catch(() => ({ data: [] })),
      getCurrentLocation(),
    ]);

    setMyId(user?.id || null);
    // `getMyProfile()` devuelve el perfil plano; le sumamos el estado de cuenta
    // para que `getBlockReason` tenga todo en un solo objeto.
    setMyProfile({
      ...(profile || {}),
      suspended: status?.suspended || false,
      suspended_until: status?.suspended_until || null,
    });
    setConflict(conf?.conflict ? conf : null);
    setWaitlist(wl?.data || []);
    if (loc?.ok) setUserCoords({ lat: loc.latitude, lng: loc.longitude });

    if (attRes.error || !attRes.match) {
      const net = isNetworkError(attRes.error);
      if (net) markOffline();
      const cached = await cacheRead(cacheKey);
      if (cached?.value) {
        setMatch(cached.value.match);
        setAttendees(cached.value.attendees || []);
        setFromCache(cached.at);
        setLoadError(net ? null : attRes.error || { message: 'No encontramos este partido.' });
      } else {
        setMatch(null);
        setLoadError(attRes.error || { message: 'Este partido no existe o fue eliminado.' });
      }
    } else {
      markOnline();
      setMatch(attRes.match);
      setAttendees(attRes.data || []);
      setFromCache(null);
      setLoadError(null);
      cacheWrite(cacheKey, { match: attRes.match, attendees: attRes.data || [] });
    }

    setLoading(false);
    setRefreshing(false);
  }, [matchId, cacheKey]);

  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  // Alternativa honesta para el bloqueo por Trust Score.
  useEffect(() => {
    if (!match) return;
    if ((match.min_trust_score ?? 0) <= 0) return;
    countMatchesWithoutMinTrust({ region: match.region }).then(setOpenWithoutTrust);
  }, [match?.id, match?.min_trust_score]);

  // --------------------------------------------------------- derivados

  const myAttendee = useMemo(
    () => attendees.find((a) => a.user_id === myId) || null,
    [attendees, myId]
  );
  const myWaitlist = useMemo(
    () => waitlist.find((w) => w.user_id === myId) || null,
    [waitlist, myId]
  );
  const confirmed = useMemo(
    () => attendees.filter((a) => a.estado !== 'pendiente' && a.estado !== 'cancelado'),
    [attendees]
  );
  const pendingRequests = useMemo(
    () => attendees.filter((a) => a.estado === 'pendiente'),
    [attendees]
  );
  const organizer = useMemo(
    () => attendees.find((a) => a.is_organizer) || null,
    [attendees]
  );

  const isOrganizer = !!(match && myId && match.id_organizador === myId);
  const ctx = { match, myId, myProfile, myAttendee, myWaitlist, conflict, online };
  const cta = match ? getCtaState(ctx) : null;
  const block = match ? getBlockReason(ctx) : null;

  const distanceKm =
    userCoords && match?.latitud != null
      ? haversineKm(userCoords, { lat: Number(match.latitud), lng: Number(match.longitud) })
      : null;

  const total = match?.cupos_totales ?? 0;
  const libres = match?.cupos_disponibles ?? 0;
  const ocupados = Math.max(0, total - libres);
  const iAmConfirmedGps = myAttendee?.estado === 'confirmado_gps';
  const canRate = iAmConfirmedGps && hasFinished(match);
  const canConfirmGps =
    !!myAttendee &&
    myAttendee.estado === 'inscrito' &&
    hasStarted(match) &&
    !hasFinished(match);
  const chatOpen = isOrganizer || (!!myAttendee && myAttendee.estado !== 'pendiente');

  // ----------------------------------------------------------- acciones

  const say = (tone, title, text = '') => {
    setFeedback({ tone, title, text });
    if (tone === 'success') setTimeout(() => setFeedback(null), 5000);
  };

  const guard = async (fn) => {
    if (busy) return;
    if (!online) {
      say('error', 'Sin conexión', 'Esta acción necesita red. Vuelve a intentarlo al reconectar.');
      return;
    }
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const doJoin = () =>
    guard(async () => {
      const res = await joinMatch(matchId);
      if (!res?.ok) {
        say('error', 'No pudimos confirmar tu cupo', res?.reason || 'Intenta de nuevo.');
        return;
      }
      setSheet(null);
      setChecks({ llegar: false, cuota: false, aviso: false });
      say('success', 'Cupo confirmado', 'Ya estás en la lista. El chat del partido quedó habilitado.');
      await load();
    });

  const doRequest = () =>
    guard(async () => {
      const res = await requestJoinMatch(matchId);
      if (!res?.ok) {
        say('error', 'No pudimos enviar tu solicitud', res?.reason || 'Intenta de nuevo.');
        return;
      }
      say('success', 'Solicitud enviada', 'El organizador la revisará y te avisamos.');
      await load();
      navigation.navigate('MatchRequestStatus', { matchId });
    });

  const doCancelRequest = () =>
    guard(async () => {
      const res = await cancelMyJoinRequest(matchId);
      if (!res?.ok) {
        say('error', 'No pudimos cancelar la solicitud', res?.error?.message || '');
        return;
      }
      say('success', 'Solicitud cancelada', 'Puedes volver a pedir cupo si te decides.');
      await load();
    });

  const doJoinWaitlist = () =>
    guard(async () => {
      const res = await joinWaitlist(matchId);
      if (!res?.ok) {
        say('error', 'No pudimos anotarte en la lista', res?.reason || 'Intenta de nuevo.');
        return;
      }
      say(
        'success',
        `Estás en la lista de espera · N° ${res.posicion}`,
        `Si se libera un cupo te avisamos y tienes ${WAITLIST_CONFIRM_MINUTES} min para confirmar.`
      );
      await load();
    });

  const doLeaveWaitlist = () =>
    guard(async () => {
      const res = await leaveWaitlist(matchId);
      if (!res?.ok) {
        say('error', 'No pudimos sacarte de la lista', res?.error?.message || '');
        return;
      }
      say('success', 'Saliste de la lista de espera', 'Esto no afecta tu Trust Score.');
      await load();
    });

  const doLeave = () =>
    guard(async () => {
      const res = await leaveMatchPenalized(matchId);
      if (!res?.ok) {
        say('error', 'No pudimos sacarte del partido', res?.reason || res?.error?.message || '');
        return;
      }
      setSheet(null);
      const pts = res.penalty ?? leavePenaltyFor(match.hora);
      say(
        'success',
        'Saliste del partido',
        pts > 0
          ? `Se liberó tu cupo y avisamos al grupo. Tu Trust Score bajó ${pts} puntos.`
          : 'Se liberó tu cupo y avisamos al grupo. Sin efecto en tu Trust Score.'
      );
      await load();
    });

  const doSwap = () =>
    guard(async () => {
      if (!conflict) return;
      const res = isOrganizerOf(conflict)
        ? await cancelMatchAndJoin(conflict.matchId, matchId)
        : await swapMatch(conflict.matchId, matchId);
      if (!res?.ok) {
        say('error', 'No pudimos cambiarte de partido', res?.reason || res?.error?.message || '');
        return;
      }
      say(
        'success',
        res.pending ? 'Solicitud enviada' : 'Te cambiaste de partido',
        res.pending
          ? 'Saliste del anterior. El organizador debe aceptarte.'
          : 'Saliste del anterior y entraste a este.'
      );
      await load();
    });

  const doConfirmGps = () =>
    guard(async () => {
      const res = await confirmAttendanceWithGPS(matchId);
      if (!res?.ok) {
        say('error', 'No pudimos confirmar tu asistencia', res?.reason || '');
        return;
      }
      say(
        'success',
        'Asistencia confirmada',
        res.distance
          ? `Estás a ${Math.round(res.distance)} m de la cancha. Suma a tu Trust Score.`
          : 'Tu asistencia quedó registrada.'
      );
      await load();
    });

  const openDirections = () => {
    const lat = match?.latitud;
    const lng = match?.longitud;
    if (lat == null || lng == null) return;
    const label = encodeURIComponent(match.cancha_nombre || 'Cancha');
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${lat},${lng}&q=${label}`
        : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
    Linking.openURL(url).catch(() => {});
  };

  const openChat = () => {
    if (!chatOpen) return;
    navigation.navigate('ChatThread', {
      threadKey: 'match:' + matchId,
      title: match?.titulo || 'Partido',
      subtitle: [match?.cancha_nombre, match?.comuna].filter(Boolean).join(' · '),
    });
  };

  const isOrganizerOf = (c) => !!c?.isOrganizer;

  const onCta = () => {
    switch (cta?.kind) {
      case 'gestionar':
        navigation.navigate('ManageMatch', { matchId });
        break;
      case 'unirme':
        if (conflict) {
          doSwap();
          return;
        }
        setSheet('join');
        break;
      case 'solicitar':
        if (conflict) {
          doSwap();
          return;
        }
        doRequest();
        break;
      case 'espera':
        setSheet('waitlist');
        break;
      case 'en_espera':
        doLeaveWaitlist();
        break;
      case 'pendiente':
        navigation.navigate('MatchRequestStatus', { matchId });
        break;
      case 'confirmado':
        navigation.navigate('MatchSpot', { matchId });
        break;
      default:
        break;
    }
  };

  // ------------------------------------------------------------- render

  if (loading) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <View style={styles.topBar}>
            <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
          </View>
          <LoadingDetail />
        </SafeAreaView>
      </View>
    );
  }

  if (!match) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <View style={styles.topBar}>
            <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
          </View>
          <ErrorState
            onRetry={() => {
              setLoading(true);
              load();
            }}
            detail={loadError?.message}
          />
        </SafeAreaView>
      </View>
    );
  }

  const estado = estadoLabel(match);
  const modalidad = modalidadLabel(match);
  const closed = ['cancelado', 'finalizado'].includes(match.estado) || hasFinished(match);
  const heroColors = closed || libres <= 0 ? P.heroNeutral : P.hero;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={P.green}
          />
        }
      >
        {/* ---------------- Hero ---------------- */}
        <LinearGradient colors={heroColors} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}>
          <SafeAreaView edges={['top']}>
            <View style={styles.heroBar}>
              <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <IconButton icon={Share2} onPress={() => setSheet('share')} accessibilityLabel="Compartir" />
                {isOrganizer ? (
                  <IconButton
                    icon={Settings2}
                    onPress={() => navigation.navigate('ManageMatch', { matchId })}
                    accessibilityLabel="Gestionar partido"
                  />
                ) : null}
              </View>
            </View>

            <View style={styles.heroBody}>
              <View style={styles.badgeRow}>
                {modalidad ? <Tag label={modalidad} tone="green" /> : null}
                {match.nivel ? <Tag label={nivelLabel(match.nivel)} tone="solid" /> : null}
                <View style={{ flex: 1 }} />
                <Tag
                  label={isOrganizer ? 'Organizas tú' : estado.label}
                  tone={
                    isOrganizer
                      ? 'solid'
                      : estado.tone === 'green'
                      ? 'green'
                      : estado.tone === 'gold'
                      ? 'gold'
                      : estado.tone === 'danger'
                      ? 'danger'
                      : 'solid'
                  }
                />
              </View>

              <Text style={styles.heroTitle}>{match.titulo}</Text>

              <View style={styles.heroRow}>
                <Calendar color={closed ? P.textMuted : P.green} size={15} strokeWidth={2} />
                <Text style={styles.heroWhen}>
                  {capitalize(formatFechaLarga(match.hora))} · {timeOf(match.hora)}
                </Text>
              </View>
              <View style={styles.heroRow}>
                <MapPin color={P.textMuted} size={15} strokeWidth={2} />
                <Text style={styles.heroPlace} numberOfLines={2}>
                  {[match.cancha_nombre, match.comuna].filter(Boolean).join(' · ')}
                  {distanceKm != null ? ` · ${fmtKm(distanceKm)}` : ''}
                </Text>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={styles.body}>
          {/* Sin conexión */}
          {fromCache && !online ? <OfflineNotice at={fromCache} onRetry={load} /> : null}

          {/* Feedback de acciones */}
          {feedback ? (
            <Callout
              tone={feedback.tone === 'success' ? 'green' : 'danger'}
              icon={feedback.tone === 'success' ? CheckCircle2 : AlertCircle}
              title={feedback.title}
              text={feedback.text}
              onPress={() => setFeedback(null)}
            />
          ) : null}

          {/* Organizador: solicitudes por revisar */}
          {isOrganizer && pendingRequests.length > 0 ? (
            <Callout
              tone="green"
              icon={ListChecks}
              title={`${pendingRequests.length} ${pendingRequests.length === 1 ? 'solicitud' : 'solicitudes'} por revisar`}
              text="Toca para aceptar o rechazar jugadores"
              onPress={() => navigation.navigate('ManageMatch', { matchId, tab: 'solicitudes' })}
            />
          ) : null}

          {/* Cancelado: motivo visible */}
          {match.estado === 'cancelado' ? (
            <Callout
              tone="danger"
              icon={AlertCircle}
              title="El organizador canceló este partido"
              text={
                match.motivo_cancelacion
                  ? `Motivo: ${match.motivo_cancelacion}`
                  : 'No dejó un motivo. El chat quedó en solo lectura.'
              }
            />
          ) : null}

          {/* Aprobación manual */}
          {match.aprobacion === 'manual' && !isOrganizer && !myAttendee && match.estado === 'abierto' ? (
            <Callout
              tone="gold"
              icon={ShieldCheck}
              title="El organizador revisa cada solicitud"
              text={`Tu cupo no queda reservado hasta que ${organizer?.username ? '@' + organizer.username : 'el organizador'} lo acepte. Te avisamos por notificación.`}
            />
          ) : null}

          {/* Completo */}
          {libres <= 0 && match.estado === 'abierto' && !myAttendee && !isOrganizer ? (
            <Callout
              tone="neutral"
              icon={Users}
              title={`Los ${total} cupos están tomados`}
              text={`Puedes entrar a la lista de espera: si alguien libera su cupo, te avisamos y tienes ${WAITLIST_CONFIRM_MINUTES} min para confirmar.`}
            />
          ) : null}

          {/* Choque de horario */}
          {conflict && !myAttendee && !isOrganizer ? (
            <Callout
              tone="gold"
              icon={Clock}
              title="Ya tienes un partido a esta hora"
              text={`Estás en «${conflict.titulo}». Si te unes acá, salimos de ese primero.`}
            />
          ) : null}

          {/* Celdas de resumen */}
          <View style={styles.stats}>
            <StatCell
              value={libres <= 0 ? '0' : String(libres)}
              label="CUPOS"
              highlight={libres > 0 && !closed}
            />
            <StatCell value={cuotaLabel(match.precio_cuota)} label="CUOTA" />
            <StatCell value={`${match.duracion_min ?? 90}'`} label="DURACIÓN" />
            <StatCell
              value={trustLabel(match)}
              label="TRUST"
              small={(match.min_trust_score ?? 0) === 0}
              highlight={(match.min_trust_score ?? 0) > 0}
            />
          </View>

          {/* Ubicación */}
          <Section label="Ubicación">
            <Card padded={false} style={{ overflow: 'hidden' }}>
              <View style={{ padding: 13, gap: 8 }}>
                <View>
                  <Text style={styles.cardTitle}>{match.cancha_nombre}</Text>
                  {match.direccion ? (
                    <Text style={styles.cardSub}>{match.direccion}</Text>
                  ) : (
                    <Text style={styles.cardSub}>
                      {[match.comuna, match.region].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                </View>
                {distanceKm != null ? (
                  <View style={styles.metaRow}>
                    <Text style={styles.metaText}>A {fmtKm(distanceKm)} de ti</Text>
                    <View style={styles.metaDot} />
                    <Text style={styles.metaText}>{match.comuna}</Text>
                  </View>
                ) : null}
                <SurfaceButton
                  label="Cómo llegar"
                  icon={Navigation}
                  onPress={openDirections}
                  height={44}
                  disabled={match.latitud == null}
                />
                {match.latitud == null ? (
                  <Note>Este partido no tiene coordenadas guardadas, así que no podemos abrir el mapa.</Note>
                ) : null}
              </View>
            </Card>
          </Section>

          {/* Detalles */}
          <Section label="Detalles del partido">
            <Card style={{ paddingVertical: 4, paddingHorizontal: 13 }}>
              {modalidad ? <DetailRow label="Modalidad" value={modalidad} /> : null}
              <DetailRow
                label="Nivel"
                value={nivelLabel(match.nivel) || 'Sin definir'}
              />
              <DetailRow label="Duración" value={`${match.duracion_min ?? 90} min`} />
              <DetailRow
                label="Inscripción"
                value={match.aprobacion === 'manual' ? 'Manual' : 'Inmediata'}
                tone={match.aprobacion === 'manual' ? 'gold' : 'green'}
              />
              {(match.min_trust_score ?? 0) > 0 ? (
                <DetailRow label="Trust Score mínimo" value={trustLabel(match)} />
              ) : null}
              <DetailRow label="Rango de edad" value={edadLabel(match)} />
              <DetailRow
                label="Cuota"
                value={
                  Number(match.precio_cuota) === 0
                    ? 'Gratis'
                    : `${cuotaLabel(match.precio_cuota)} por jugador`
                }
                last
              />
            </Card>
            <Note>
              La cuota se acuerda y paga directamente con el organizador. FutFinder no procesa
              pagos.
            </Note>
          </Section>

          {/* Organizador */}
          {organizer ? (
            <Section label="Organizador">
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                <Avatar url={organizer.foto_url} name={organizer.username} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.orgName} numberOfLines={1}>
                    @{organizer.username}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.tsText}>
                      TS {organizer.trust_score ?? 'N.A.'}
                    </Text>
                    {organizer.comuna ? (
                      <>
                        <View style={styles.metaDot} />
                        <Text style={styles.metaText}>{organizer.comuna}</Text>
                      </>
                    ) : null}
                  </View>
                </View>
                <Pressable
                  onPress={() =>
                    organizer.user_id !== myId &&
                    navigation.navigate('UserProfile', { userId: organizer.user_id })
                  }
                  style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.smallBtnText}>Ver perfil</Text>
                </Pressable>
                {chatOpen ? (
                  <Pressable
                    onPress={openChat}
                    accessibilityLabel="Escribir al organizador"
                    style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.8 }]}
                  >
                    <MessageSquare color={P.green} size={16} strokeWidth={2} />
                  </Pressable>
                ) : null}
              </Card>
              {!chatOpen ? (
                <Note>
                  El chat del partido se abre cuando tu cupo esté confirmado. Así el grupo queda
                  solo entre quienes van a jugar.
                </Note>
              ) : null}
            </Section>
          ) : null}

          {/* Jugadores */}
          <Section
            label="Jugadores"
            right={`${ocupados} de ${total} confirmados`}
          >
            <Card style={{ gap: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ flexDirection: 'row' }}>
                  {confirmed.slice(0, 5).map((a, i) => (
                    <View key={a.user_id} style={{ marginLeft: i === 0 ? 0 : -9 }}>
                      <Avatar url={a.foto_url} name={a.username} size={32} ring />
                    </View>
                  ))}
                  {libres > 0 ? (
                    <View style={[styles.ghostAvatar, { marginLeft: confirmed.length ? -9 : 0 }]}>
                      <Text style={styles.ghostAvatarText}>+{libres}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flex: 1 }} />
                {chatOpen || isOrganizer ? (
                  <Pressable
                    onPress={() => navigation.navigate('ManageMatch', { matchId, tab: 'confirmados' })}
                    hitSlop={8}
                  >
                    <Text style={styles.link}>Ver jugadores</Text>
                  </Pressable>
                ) : null}
              </View>
              <ProgressBar ratio={total ? ocupados / total : 0} />
              <Text style={styles.metaText}>
                {libres > 0
                  ? `Quedan ${libres} ${libres === 1 ? 'cupo' : 'cupos'} por completar`
                  : 'Plantel completo'}
                {pendingRequests.length > 0 && (isOrganizer || match.aprobacion === 'manual')
                  ? ` · ${pendingRequests.length} ${pendingRequests.length === 1 ? 'solicitud' : 'solicitudes'} en revisión`
                  : ''}
              </Text>
            </Card>
          </Section>

          {/* Lista de espera */}
          {waitlist.length > 0 ? (
            <Section label="Lista de espera" right={`${waitlist.length} en espera`}>
              <Card style={{ paddingVertical: 4, paddingHorizontal: 13 }}>
                {waitlist.map((w, i) => (
                  <View
                    key={w.id}
                    style={[styles.wlRow, i === waitlist.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <Text style={styles.wlPos}>{w.posicion}</Text>
                    <Avatar url={w.foto_url} name={w.username} size={28} />
                    <Text style={styles.wlName} numberOfLines={1}>
                      @{w.username}
                      {w.user_id === myId ? ' · tú' : ''}
                    </Text>
                    <Text style={styles.tsText}>TS {w.trust_score ?? 'N.A.'}</Text>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}

          {/* Requisitos */}
          <Section label="Requisitos">
            <Card style={{ gap: 10 }}>
              <Requisito
                ok
                text={
                  (match.min_trust_score ?? 0) > 0
                    ? `Trust Score ${match.min_trust_score} o más`
                    : 'Sin Trust Score mínimo — cualquiera puede unirse'
                }
              />
              <Requisito
                ok
                text={
                  match.edad_min != null || match.edad_max != null
                    ? `Jugadores de ${edadLabel(match).toLowerCase()}`
                    : 'Sin restricción de edad'
                }
              />
              {match.pedir_asistencia !== false ? (
                <Requisito ok text="Confirmación de asistencia al finalizar" />
              ) : null}
              <Requisito
                text={`Confirmar en cancha con GPS (radio de ${GPS_RADIUS_METERS} m)`}
              />
              <Requisito text={leaveRuleText(match.hora)} />
            </Card>
          </Section>

          {/* Descripción */}
          {match.descripcion ? (
            <Section label="Descripción">
              <Card>
                <Text style={styles.desc}>{match.descripcion}</Text>
              </Card>
            </Section>
          ) : null}

          {/* Bloqueo explícito */}
          {block && !block.soft && block.code !== 'organizador' && block.code !== 'ya_confirmado' ? (
            <Section label="Por qué no puedes unirte">
              <View style={styles.blockCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <View style={styles.blockIcon}>
                    <AlertCircle color={P.coral} size={18} strokeWidth={2} />
                  </View>
                  <Text style={styles.blockTitle}>{block.title}</Text>
                </View>
                <Text style={styles.blockText}>{block.detail}</Text>

                {block.trust ? (
                  <View style={styles.trustBox}>
                    <View style={styles.trustRow}>
                      <Text style={styles.trustLabel}>Tu Trust Score</Text>
                      <Text style={styles.trustValue}>
                        {block.trust.actual} / {block.trust.requerido}
                      </Text>
                    </View>
                    <View style={styles.trustTrack}>
                      <LinearGradient
                        colors={[P.coral, P.gold]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={{
                          height: '100%',
                          width: `${Math.min(100, (block.trust.actual / block.trust.requerido) * 100)}%`,
                        }}
                      />
                    </View>
                    <Text style={styles.trustHint}>
                      Sube tu Trust Score jugando partidos y confirmando asistencia con GPS.
                    </Text>
                  </View>
                ) : null}
              </View>

              {block.code === 'trust_bajo' ? (
                <View style={{ gap: 9, marginTop: 10 }}>
                  <AltRow
                    icon={SearchIcon}
                    title="Ver partidos sin mínimo"
                    sub={
                      openWithoutTrust == null
                        ? 'Buscamos partidos que acepten a cualquiera'
                        : `${openWithoutTrust} ${openWithoutTrust === 1 ? 'partido acepta' : 'partidos aceptan'} a cualquiera`
                    }
                    onPress={() => navigation.navigate('Main', { screen: 'SearchTab' })}
                  />
                  <AltRow
                    icon={Trophy}
                    title="Publicar tu propio partido"
                    sub="Organizar también suma Trust Score"
                    onPress={() => navigation.navigate('CreateMatch')}
                  />
                </View>
              ) : null}

              {block.code === 'restringido' ? (
                <View style={{ marginTop: 10 }}>
                  <AltRow
                    icon={Info}
                    title="Ver el motivo de la restricción"
                    sub="Historial de tu Trust Score"
                    onPress={() => navigation.navigate('TrustScoreHistory')}
                  />
                </View>
              ) : null}
            </Section>
          ) : null}

          {/* Post-partido */}
          {canConfirmGps ? (
            <Section label="Estás en la cancha">
              <PrimaryButton
                label="Confirmar mi asistencia con GPS"
                icon={MapPin}
                onPress={doConfirmGps}
                loading={busy}
                height={50}
              />
              <Note>
                Validamos que estés a menos de {GPS_RADIUS_METERS} m de la cancha. Confirmar suma a
                tu Trust Score.
              </Note>
            </Section>
          ) : null}

          {canRate ? (
            <Section label="Después del partido">
              <SurfaceButton
                label="Calificar a los jugadores"
                icon={Star}
                onPress={() => navigation.navigate('RateMatch', { matchId })}
                height={48}
              />
            </Section>
          ) : null}

          {isOrganizer && hasFinished(match) && match.estado !== 'cancelado' ? (
            <Section label="Asistencia">
              <SurfaceButton
                label="Registrar quién asistió"
                icon={ListChecks}
                onPress={() => navigation.navigate('ManageMatch', { matchId, tab: 'asistencia' })}
                height={48}
              />
              <Note>
                Tienes hasta {ATTENDANCE_WINDOW_HOURS} h después del partido para registrarla.
              </Note>
            </Section>
          ) : null}
        </View>
      </ScrollView>

      {/* ---------------- CTA sticky ---------------- */}
      <View style={[styles.footer, { paddingBottom: 14 + Math.max(insets.bottom, 8) }]}>
        {cta?.kind === 'confirmado' ? (
          <View style={{ gap: 9 }}>
            <View style={styles.confirmedBox}>
              <View style={styles.confirmedIcon}>
                <CheckCircle2 color={P.green} size={18} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.confirmedTitle}>Cupo confirmado</Text>
                <Text style={styles.confirmedText}>
                  Ya estás en la lista.
                  {libres > 0 ? ` Quedan ${libres} ${libres === 1 ? 'cupo' : 'cupos'}.` : ' Plantel completo.'}
                </Text>
              </View>
              <Pressable onPress={() => navigation.navigate('MatchSpot', { matchId })} hitSlop={8}>
                <ChevronRight color={P.green} size={18} />
              </Pressable>
            </View>
            {!closed ? (
              <View style={{ flexDirection: 'row', gap: 9 }}>
                <SurfaceButton
                  label="Chat del partido"
                  icon={MessageSquare}
                  onPress={openChat}
                  height={46}
                  style={{ flex: 1 }}
                />
                <GhostButton
                  label="Salir del partido"
                  tone="danger"
                  onPress={() => setSheet('leave')}
                  height={46}
                  style={{ flex: 1 }}
                />
              </View>
            ) : null}
            <Note>{leaveRuleText(match.hora)}</Note>
          </View>
        ) : cta?.kind === 'pendiente' ? (
          <View style={{ gap: 9 }}>
            <StatusButton label="Solicitud pendiente" tone="gold" />
            <View style={{ flexDirection: 'row', gap: 9 }}>
              <SurfaceButton
                label="Ver estado"
                onPress={() => navigation.navigate('MatchRequestStatus', { matchId })}
                height={46}
                style={{ flex: 1 }}
              />
              <GhostButton
                label="Cancelar solicitud"
                tone="danger"
                onPress={doCancelRequest}
                height={46}
                style={{ flex: 1 }}
                disabled={busy || !online}
              />
            </View>
            <Note>El chat se abre solo cuando tu cupo esté confirmado.</Note>
          </View>
        ) : cta?.kind === 'en_espera' ? (
          <View style={{ gap: 9 }}>
            <StatusButton label={cta.label} tone="gold" />
            <GhostButton
              label="Salir de la lista de espera"
              onPress={doLeaveWaitlist}
              height={46}
              disabled={busy || !online}
            />
            <Note>{cta.hint}</Note>
          </View>
        ) : cta?.kind === 'bloqueado' ? (
          <View style={{ gap: 9 }}>
            <StatusButton label={cta.label} tone="muted" icon={AlertCircle} />
            <GhostButton
              label="Buscar otros partidos"
              onPress={() => navigation.navigate('Main', { screen: 'SearchTab' })}
              height={46}
            />
          </View>
        ) : cta?.kind === 'gestionar' ? (
          <View style={{ gap: 9 }}>
            <PrimaryButton
              label="Gestionar partido"
              icon={Settings2}
              onPress={onCta}
              height={52}
              disabled={cta.disabled}
            />
            {match.estado !== 'cancelado' && !hasFinished(match) ? (
              <GhostButton
                label="Cancelar partido"
                tone="danger"
                onPress={() => navigation.navigate('ManageMatch', { matchId, action: 'cancelar' })}
                height={46}
              />
            ) : null}
          </View>
        ) : cta?.kind === 'espera' ? (
          <View style={{ gap: 9 }}>
            <StatusButton label="Partido completo" tone="muted" />
            <GhostButton
              label="Entrar a la lista de espera"
              icon={Users}
              onPress={onCta}
              height={48}
              disabled={busy || !online}
            />
            <Note>
              Serías el número {waitlist.length + 1}. Puedes salir cuando quieras, sin efecto en tu
              Trust Score.
            </Note>
          </View>
        ) : (
          <View style={{ gap: 9 }}>
            <PrimaryButton
              label={conflict ? 'Cambiarme a este partido' : cta?.label}
              onPress={onCta}
              loading={busy}
              disabled={cta?.disabled}
              height={52}
            />
            <Note>{conflict ? `Saldrás de «${conflict.titulo}» antes de entrar acá.` : cta?.hint}</Note>
          </View>
        )}
      </View>

      {/* ---------------- Hojas ---------------- */}
      <ShareSheet
        visible={sheet === 'share'}
        onClose={() => setSheet(null)}
        match={match}
        onShareInApp={() =>
          navigation.navigate('ChatThread', {
            threadKey: 'match:' + matchId,
            title: match.titulo,
          })
        }
      />

      {/* Confirmación de inscripción inmediata */}
      <Sheet
        visible={sheet === 'join'}
        onClose={() => setSheet(null)}
        title="Confirmar tu cupo"
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <PrimaryButton
              label="Confirmar mi cupo"
              onPress={doJoin}
              loading={busy}
              disabled={!checks.llegar || !checks.cuota || !checks.aviso}
              height={52}
            />
            <Pressable onPress={() => setSheet(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.sheetBack}>Volver al partido</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ padding: 14, gap: 10 }}>
          <Text style={styles.sheetTitle}>{match.titulo}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <Calendar color={P.green} size={15} strokeWidth={2} />
            <Text style={styles.sheetWhen}>
              {capitalize(formatFechaLarga(match.hora))} · {timeOf(match.hora)} · {match.duracion_min ?? 90} min
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <MapPin color={P.textMuted} size={15} strokeWidth={2} />
            <Text style={styles.sheetPlace}>
              {[match.cancha_nombre, match.comuna].filter(Boolean).join(' · ')}
              {distanceKm != null ? ` · ${fmtKm(distanceKm)}` : ''}
            </Text>
          </View>
          <Divider />
          <DetailRow label="Cuota por jugador" value={cuotaLabel(match.precio_cuota)} tone="green" last />
          <Note>
            {Number(match.precio_cuota) === 0
              ? 'Este partido es gratis. Si hay gastos, el organizador los avisa en el chat.'
              : 'Se paga en la cancha, directamente al organizador. FutFinder no procesa el pago.'}
          </Note>
        </Card>

        <View style={{ gap: 8, marginTop: 14 }}>
          <SectionLabel>Antes de confirmar</SectionLabel>
          <CheckRow
            label={`Puedo llegar a las ${timeOf(match.hora)} a ${match.comuna}`}
            checked={checks.llegar}
            onPress={() => setChecks((c) => ({ ...c, llegar: !c.llegar }))}
          />
          <CheckRow
            label={
              Number(match.precio_cuota) === 0
                ? 'Entendí que este partido es gratis'
                : `Llevo los ${cuotaLabel(match.precio_cuota)} de la cuota`
            }
            checked={checks.cuota}
            onPress={() => setChecks((c) => ({ ...c, cuota: !c.cuota }))}
          />
          <CheckRow
            label="Si no puedo ir, aviso con anticipación"
            checked={checks.aviso}
            onPress={() => setChecks((c) => ({ ...c, aviso: !c.aviso }))}
          />
        </View>

        <View style={{ marginTop: 14 }}>
          <Note tone="card" icon={CheckCircle2}>
            Este partido acepta jugadores al instante: tu cupo queda tomado en cuanto confirmes.
            {' '}
            {leaveRuleText(match.hora)}
          </Note>
        </View>
      </Sheet>

      {/* Confirmación de lista de espera */}
      <Sheet
        visible={sheet === 'waitlist'}
        onClose={() => setSheet(null)}
        title="Entrar a la lista de espera"
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <PrimaryButton
              label={`Anotarme como número ${waitlist.length + 1}`}
              onPress={() => {
                setSheet(null);
                doJoinWaitlist();
              }}
              loading={busy}
              height={52}
            />
            <Pressable onPress={() => setSheet(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.sheetBack}>Volver al partido</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ gap: 10 }}>
          <Text style={styles.sheetTitle}>{match.titulo}</Text>
          <Text style={styles.sheetPlace}>
            {capitalize(formatFechaLarga(match.hora))} · {timeOf(match.hora)}
          </Text>
          <Divider />
          <Requisito ok text={`Si se libera un cupo avisamos al primero de la lista`} />
          <Requisito ok text={`Tienes ${WAITLIST_CONFIRM_MINUTES} min para confirmar cuando te toque`} />
          <Requisito ok text="Salir de la lista no afecta tu Trust Score" />
          <Requisito text="Si te aceptan en otro partido a esta hora, te sacamos de esta lista" />
        </Card>
      </Sheet>

      {/* Salir del partido */}
      <Sheet
        visible={sheet === 'leave'}
        onClose={() => setSheet(null)}
        title="¿Salir de este partido?"
        subtitle={`${match.titulo} · falta ${timeUntilLabel(match.hora)}`}
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <GhostButton
              label={
                isPenaltyFree(match.hora)
                  ? `Salir del partido (−${leavePenaltyFor(match.hora)} pts)`
                  : `Salir igual (−${leavePenaltyFor(match.hora)} pts)`
              }
              tone="danger"
              onPress={doLeave}
              height={52}
              disabled={busy || !online}
            />
            <Pressable onPress={() => setSheet(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.sheetBack}>Me quedo en el partido</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ gap: 10 }}>
          <SectionLabel>Qué va a pasar</SectionLabel>
          <Requisito
            tone="danger"
            text={`Tu Trust Score baja ${leavePenaltyFor(match.hora)} ${leavePenaltyFor(match.hora) === 1 ? 'punto' : 'puntos'}`}
          />
          <Requisito tone="gold" text="Tu cupo se libera y vuelve a aparecer en Partidos" />
          <Requisito text="Avisamos a los jugadores confirmados y al primero de la lista de espera" />
          <Requisito text="Pierdes el acceso al chat del partido" />
        </Card>
        <View style={{ marginTop: 12 }}>
          <Note tone="card" icon={Clock}>
            {leaveRuleText(match.hora)}
          </Note>
        </View>
      </Sheet>
    </View>
  );
}

// ------------------------------------------------------------ auxiliares

function Section({ label, right, children }) {
  return (
    <View style={{ gap: 9, marginTop: 16 }}>
      <SectionLabel right={right}>{label}</SectionLabel>
      {children}
    </View>
  );
}

function Requisito({ text, ok, tone }) {
  const color = tone === 'danger' ? P.coral : tone === 'gold' ? P.gold : ok ? P.green : P.textMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
      {ok ? (
        <Check color={color} size={15} strokeWidth={2.6} style={{ marginTop: 2 }} />
      ) : (
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginTop: 6 }} />
      )}
      <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 18.5, color: P.textStrong }}>{text}</Text>
    </View>
  );
}

function AltRow({ icon: Icon, title, sub, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.altRow, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.altIcon}>
        <Icon color={P.green} size={16} strokeWidth={2} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.altTitle}>{title}</Text>
        <Text style={styles.altSub}>{sub}</Text>
      </View>
      <ChevronRight color={P.textMuted} size={17} />
    </Pressable>
  );
}

function timeOf(iso) {
  try {
    return new Date(iso).toTimeString().slice(0, 5);
  } catch {
    return '';
  }
}

function capitalize(s) {
  return s ? String(s)[0].toUpperCase() + String(s).slice(1) : s;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: P.bg },
  topBar: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 },

  heroBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
  },
  heroBody: { paddingHorizontal: 18, paddingBottom: 18, gap: 10 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroTitle: { fontSize: 25, lineHeight: 29, fontWeight: '800', color: P.text, letterSpacing: -0.7 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroWhen: { flex: 1, fontSize: 14, fontWeight: '700', color: P.text },
  heroPlace: { flex: 1, fontSize: 13, fontWeight: '500', color: P.textDim },

  body: { paddingHorizontal: 16, paddingTop: 14, gap: 10 },
  stats: { flexDirection: 'row', gap: 7, marginTop: 4 },

  cardTitle: { fontSize: 14, fontWeight: '700', color: P.text },
  cardSub: { fontSize: 12, color: P.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 11.5, fontWeight: '600', color: P.textFaint },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#434A44' },
  tsText: { fontSize: 11.5, fontWeight: '700', color: P.green },
  link: { fontSize: 12, fontWeight: '700', color: P.green },
  desc: { fontSize: 13, lineHeight: 21, color: P.textDim },

  orgName: { fontSize: 14, fontWeight: '700', color: P.text },
  smallBtn: {
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: P.chip,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { fontSize: 12, fontWeight: '700', color: P.textStrong },
  chatBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: P.greenSoft,
    borderWidth: 1,
    borderColor: P.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  ghostAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: P.chipAlt,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: P.dashed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostAvatarText: { fontSize: 10.5, fontWeight: '700', color: P.textGhost },

  wlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: P.divider,
  },
  wlPos: { width: 20, fontSize: 12, fontWeight: '700', color: P.textGhost },
  wlName: { flex: 1, fontSize: 12.5, fontWeight: '600', color: P.textStrong },

  blockCard: {
    backgroundColor: 'rgba(232,115,123,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(232,115,123,0.30)',
    borderRadius: R.card,
    padding: 15,
    gap: 11,
  },
  blockIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(232,115,123,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockTitle: { flex: 1, fontSize: 14.5, fontWeight: '700', color: P.coral },
  blockText: { fontSize: 12.5, lineHeight: 19, color: P.textSoft },
  trustBox: { backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 12, padding: 12, gap: 8 },
  trustRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trustLabel: { fontSize: 11.5, fontWeight: '600', color: P.textMuted },
  trustValue: { fontSize: 12.5, fontWeight: '700', color: P.text },
  trustTrack: { height: 6, borderRadius: 3, backgroundColor: P.chip, overflow: 'hidden' },
  trustHint: { fontSize: 11, lineHeight: 16, color: P.textFaint },

  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.hairline,
    borderRadius: 16,
    padding: 13,
  },
  altIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: P.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  altTitle: { fontSize: 13, fontWeight: '700', color: P.text },
  altSub: { fontSize: 11.5, color: P.textFaint, marginTop: 1 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: P.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: P.hairline,
  },
  confirmedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
    borderRadius: R.input,
    backgroundColor: 'rgba(90,224,106,0.11)',
    borderWidth: 1,
    borderColor: P.greenBorder,
  },
  confirmedIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: 'rgba(90,224,106,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmedTitle: { fontSize: 13.5, fontWeight: '700', color: P.green },
  confirmedText: { fontSize: 11.5, color: P.textMuted, marginTop: 1 },

  sheetTitle: { fontSize: 17, fontWeight: '800', color: P.text, letterSpacing: -0.3 },
  sheetWhen: { flex: 1, fontSize: 13, fontWeight: '700', color: P.text },
  sheetPlace: { flex: 1, fontSize: 12.5, fontWeight: '500', color: P.textDim },
  sheetBack: { fontSize: 13.5, fontWeight: '700', color: P.textMuted },
});
