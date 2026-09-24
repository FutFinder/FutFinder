import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock,
  ListChecks,
  MessageSquare,
  Pencil,
  Share2,
  UserMinus,
  UserX,
  X,
} from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  fuentes as F,
  alfa,
} from '../theme/colors';
import {
  Avatar,
  Callout,
  Card,
  GhostButton,
  IconButton,
  Input,
  Note,
  PrimaryButton,
  ProgressBar,
  SectionLabel,
  SurfaceButton,
  Tag,
} from '../components/partidos/ui';
import Sheet from '../components/partidos/Sheet';
import TrueScoreChip from '../components/TrueScoreChip';
import ShareSheet from '../components/partidos/ShareSheet';
import { InlineEmpty, LoadingList, ErrorState } from '../components/partidos/StateViews';
import { formatFechaCorta } from '../components/partidos/DateTimeSheets';
import {
  approveJoinRequest,
  cancelMatchWithReason,
  getMatchAttendees,
  getMatchRequests,
  getWaitlist,
  rejectJoinRequest,
  saveMatchAttendance,
} from '../services/matches';
import { getCurrentUser } from '../services/auth';
import {
  agresionesDelPartido,
  confirmarAgresion,
  expulsarJugador,
  getCostoSalida,
  useTrueScoreAjustes,
} from '../services/trueScore';
import {
  marcasCompletas,
  plazoAsistenciaAbierto,
  textoCostoCancelacion,
} from '../utils/trueScore';
import { suscribirseANomina } from '../services/clubRoster';
import { useOnline } from '../services/connectivity';
import { goBackOrPartidos } from '../utils/navigation';
import {
  ATTENDANCE_WINDOW_HOURS,
  attendanceOpen,
  cancelPenaltyFor,
  hasFinished,
  isPenaltyFree,
  timeUntilLabel,
} from '../services/matchRules';

// Motivos de cancelación (migración 134): lluvia y cierre de cancha son
// neutros para todos, incluido el organizador.
const TIPOS_CANCELACION = [
  { value: 'lluvia', label: 'Lluvia' },
  { value: 'cierre_cancha', label: 'Cierre de cancha' },
  { value: 'otro', label: 'Otro motivo' },
];

const TABS = [
  { key: 'solicitudes', label: 'Solicitudes' },
  { key: 'confirmados', label: 'Confirmados' },
  { key: 'asistencia', label: 'Asistencia' },
];

/**
 * «Gestionar mi partido» (sección 5 del handoff).
 *
 * Estado compartido real: aceptar una solicitud descuenta un cupo, mueve al
 * jugador a confirmados y actualiza el detalle. La pantalla nunca deja aceptar
 * más jugadores que cupos disponibles — el botón se bloquea y explica por qué,
 * además del control que hace la RPC en Postgres.
 */
export default function ManageMatchScreen({ route, navigation }) {
  const matchId = route?.params?.matchId;
  const insets = useSafeAreaInsets();
  const online = useOnline();
  // Con TrueScore (flag `truescore_fase1`) cambian la asistencia, la
  // cancelación y aparece la expulsión. Apagado, la pantalla es la de siempre.
  const ajustes = useTrueScoreAjustes();
  const ts = !!ajustes.fase1;

  const [tab, setTab] = useState(route?.params?.tab || 'solicitudes');
  const [match, setMatch] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [requests, setRequests] = useState([]);
  const [waitlist, setWaitlist] = useState([]);
  const [myId, setMyId] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [sheet, setSheet] = useState(route?.params?.action === 'cancelar' ? 'cancelar' : null);

  // Asistencia: { [userId]: 'presente' | 'ausente' }, o con TrueScore
  // { [userId]: 'asistio' | 'tarde' | 'no_fue' }.
  const [marks, setMarks] = useState({});
  const [tipoCancelacion, setTipoCancelacion] = useState('otro');
  const [costoCancelacion, setCostoCancelacion] = useState(null);
  const [expulsando, setExpulsando] = useState(null);
  // Fair play (fase 3): agresiones físicas que reportaron los jugadores.
  const [agresiones, setAgresiones] = useState([]);
  const [agresionSel, setAgresionSel] = useState(null);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [reason, setReason] = useState('');
  const [canceling, setCanceling] = useState(false);
  // Si la RPC preexistente `cancel_match` borra la fila en vez de dejarla como
  // 'cancelado', el partido deja de existir. Guardamos el resultado para
  // mostrar un cierre claro en vez del error genérico de «no encontramos».
  const [canceledGone, setCanceledGone] = useState(false);

  const load = useCallback(async () => {
    const [attRes, reqRes, wlRes, user] = await Promise.all([
      getMatchAttendees(matchId).catch((e) => ({ data: [], match: null, error: e })),
      getMatchRequests(matchId).catch(() => ({ data: [] })),
      getWaitlist(matchId).catch(() => ({ data: [] })),
      getCurrentUser(),
    ]);
    setMyId(user?.id || null);
    setMatch(attRes.match || null);
    setAttendees(attRes.data || []);
    setRequests(reqRes.data || []);
    setWaitlist(wlRes.data || []);
    setLoadError(attRes.match ? null : attRes.error || { message: 'No encontramos este partido.' });

    // Precargamos la asistencia ya registrada para no perder lo guardado.
    const pre = {};
    (attRes.data || []).forEach((a) => {
      if (a.asistencia) pre[a.user_id] = a.asistencia;
      else if (a.estado === 'confirmado_gps') pre[a.user_id] = 'presente';
      else if (a.estado === 'no_asistio') pre[a.user_id] = 'ausente';
    });
    setMarks((prev) => ({ ...pre, ...prev }));

    setLoading(false);
    setRefreshing(false);
  }, [matchId]);

  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);
  // La inscripción puede cambiar desde otra sesión: el organizador aprueba o
  // rechaza, alguien se sale, se libera un cupo. `suscribirseANomina` escucha
  // `attendees` de este partido y mantiene un sondeo corto de respaldo, así
  // que la pantalla se entera sola en vez de quedarse pendiente hasta que el
  // usuario la recargue a mano.
  useEffect(() => {
    if (!matchId) return undefined;
    return suscribirseANomina(matchId, load);
  }, [matchId, load]);

  const confirmed = useMemo(
    () => attendees.filter((a) => a.estado !== 'pendiente' && a.estado !== 'cancelado'),
    [attendees]
  );
  const isOrganizer = !!(match && myId && match.id_organizador === myId);
  // Ver la nota de MatchDetailScreen: `cupos_totales` son las plazas ofrecidas
  // a otros jugadores; el plantel (`confirmed`) incluye al organizador.
  const total = match?.cupos_totales ?? 0;
  const libres = match?.cupos_disponibles ?? 0;
  const tomados = Math.max(0, total - libres);
  const full = libres <= 0;

  const say = (tone, title, text = '') => {
    setFeedback({ tone, title, text });
    if (tone === 'success') setTimeout(() => setFeedback(null), 4500);
  };

  const accept = async (playerId) => {
    if (busyId || !online) return;
    if (full) {
      say(
        'error',
        'Sin cupos libres',
        'Para aceptar a alguien más, libera un cupo o aumenta el total desde «Editar partido».'
      );
      return;
    }
    setBusyId(playerId);
    const res = await approveJoinRequest(matchId, playerId);
    if (!res?.ok) {
      setBusyId(null);
      say('error', 'No pudimos aceptar la solicitud', res?.reason || res?.error?.message || '');
      return;
    }
    say('success', 'Jugador aceptado', 'Se sumó al plantel, se descontó el cupo y le avisamos.');
    // `busyId` sigue puesto hasta que `load()` trae los cupos reales: si se
    // soltara antes, con exactamente 1 cupo libre y dos solicitudes
    // pendientes, «Aceptar» en la OTRA solicitud quedaba habilitado durante
    // ese instante — leyendo el cupo viejo — y el organizador veía un
    // «no pudimos aceptar» confuso justo después de un éxito.
    await load();
    setBusyId(null);
  };

  const reject = async (playerId) => {
    if (busyId || !online) return;
    setBusyId(playerId);
    const res = await rejectJoinRequest(matchId, playerId);
    setBusyId(null);
    if (!res?.ok) {
      say('error', 'No pudimos rechazar la solicitud', res?.error?.message || '');
      return;
    }
    say('info', 'Solicitud rechazada', 'Le avisamos al jugador.');
    await load();
  };

  const markedCount = Object.keys(marks).filter((k) =>
    confirmed.some((c) => c.user_id === k)
  ).length;

  // ── TrueScore ─────────────────────────────────────────────────
  // La nómina a confirmar no incluye al organizador, y la marca vieja que
  // precarga el GPS ('presente') se muestra como «Asistió» sugerido.
  const nominaTS = useMemo(() => confirmed.filter((a) => !a.is_organizer), [confirmed]);
  const marcaDe = (id) => marcaTrueScore(marks[id]);
  const marcasTS = useMemo(() => {
    const out = {};
    nominaTS.forEach((a) => {
      const m = marcaTrueScore(marks[a.user_id]);
      if (m) out[a.user_id] = m;
    });
    return out;
  }, [nominaTS, marks]);
  const estadoMarcas = marcasCompletas(nominaTS, marcasTS);
  const asistenciaConfirmada = !!match?.asistencia_confirmada_at;
  const asistenciaVencida = !!match?.asistencia_vencida_at;
  const plazoTS = Number(ajustes.confirmacion_plazo_horas) || 24;
  const plazoAbiertoTS = plazoAsistenciaAbierto(match, plazoTS);

  // El costo de cancelar lo calcula el servidor con el motivo elegido.
  useEffect(() => {
    if (!ts || sheet !== 'cancelar' || !matchId) return undefined;
    let vivo = true;
    setCostoCancelacion(null);
    getCostoSalida(matchId, tipoCancelacion).then((c) => vivo && setCostoCancelacion(c));
    return () => {
      vivo = false;
    };
  }, [ts, sheet, matchId, tipoCancelacion]);

  const saveAttendance = async () => {
    if (savingAttendance || markedCount === 0) return;
    setSavingAttendance(true);
    const res = await saveMatchAttendance(matchId, marks);
    setSavingAttendance(false);
    if (!res?.ok) {
      say('error', 'No pudimos guardar la asistencia', res?.reason || res?.error?.message || '');
      return;
    }
    say(
      'success',
      'Asistencia guardada',
      'El Trust Score de cada jugador se actualizó según lo que marcaste.'
    );
    await load();
  };

  // Con TrueScore se confirma UNA vez y a toda la nómina: el botón abre una
  // confirmación, y esto la envía.
  const confirmarAsistenciaTS = async () => {
    if (savingAttendance || !estadoMarcas.completas) return;
    setSavingAttendance(true);
    const res = await saveMatchAttendance(matchId, marcasTS);
    setSavingAttendance(false);
    setSheet(null);
    if (!res?.ok) {
      say('error', 'No pudimos confirmar la asistencia', res?.reason || res?.error?.message || '');
      return;
    }
    say(
      'success',
      res.already ? 'La asistencia ya estaba confirmada' : 'Asistencia confirmada',
      res.already
        ? 'No se aplicó nada dos veces.'
        : 'El TrueScore de cada jugador se actualizó según lo que marcaste.' +
            (Number(res.bono) > 0 ? ` Ganaste +${res.bono} por confirmar a tiempo.` : '')
    );
    await load();
  };

  const fairplayActivo = !!(ajustes.fase1 && ajustes.fase3);
  const cargarAgresiones = useCallback(async () => {
    if (!fairplayActivo || !matchId) return;
    setAgresiones(await agresionesDelPartido(matchId));
  }, [fairplayActivo, matchId]);
  useEffect(() => {
    cargarAgresiones();
  }, [cargarAgresiones]);

  const confirmarAgresionAhora = async () => {
    const a = agresionSel;
    if (!a || busyId) return;
    setBusyId(a.reported_id);
    const res = await confirmarAgresion(a.reporte_id);
    setBusyId(null);
    setSheet(null);
    setAgresionSel(null);
    if (!res?.ok) {
      say('error', 'No pudimos confirmar la agresión', res?.reason || '');
      return;
    }
    say('info', 'Agresión confirmada', `El fair play de @${a.usuario} bajó y su cuenta quedó en revisión.`);
    await cargarAgresiones();
  };

  const expulsarAhora = async () => {
    const jugador = expulsando;
    if (!jugador || busyId) return;
    setBusyId(jugador.user_id);
    const res = await expulsarJugador(matchId, jugador.user_id);
    setBusyId(null);
    setSheet(null);
    setExpulsando(null);
    if (!res?.ok) {
      say('error', 'No pudimos sacar al jugador', res?.reason || '');
      return;
    }
    say('info', `Sacaste a @${jugador.username}`, 'Le avisamos. Su TrueScore no cambia y no podrá volver a este partido.');
    await load();
  };

  const cancelMatchNow = async () => {
    if (canceling) return;
    setCanceling(true);
    const res = await cancelMatchWithReason(matchId, reason.trim() || null, ts ? tipoCancelacion : null);
    setCanceling(false);
    if (!res?.ok) {
      say('error', 'No pudimos cancelar el partido', res?.reason || res?.error?.message || '');
      return;
    }
    setSheet(null);
    const aviso =
      confirmed.length === 1
        ? 'Avisamos al jugador confirmado y a quienes tenían solicitud.'
        : `Avisamos a los ${confirmed.length} confirmados y a quienes tenían solicitud.`;
    if (res.survived === false) {
      // El registro no quedó en el historial: cerramos con un mensaje honesto.
      setCanceledGone(true);
      return;
    }
    say('success', 'Partido cancelado', aviso);
    await load();
  };

  const openChat = () =>
    navigation.navigate('ChatThread', {
      threadKey: 'match:' + matchId,
      title: match?.titulo || 'Partido',
      subtitle: [match?.cancha_nombre, match?.comuna].filter(Boolean).join(' · '),
    });

  // ------------------------------------------------------------- render

  if (loading) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TopBar onBack={() => goBackOrPartidos(navigation)} title="Gestionar partido" />
          <View style={{ paddingHorizontal: 16 }}>
            <LoadingList count={2} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (canceledGone) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TopBar onBack={() => navigation.navigate('Main', { screen: 'SearchTab' })} title="Partido cancelado" />
          <View style={{ paddingHorizontal: 16, paddingTop: 20, gap: 14 }}>
            <Callout
              tone="danger"
              icon={Ban}
              title="Ya no se juega"
              text="Avisamos a los jugadores confirmados y a quienes tenían una solicitud pendiente. El partido ya no aparece en Partidos."
            />
            <Note>
              En esta base de datos `cancel_match` elimina el registro, así que el partido no
              queda en tu historial. Para conservarlo como «cancelado» —con su chat y su
              motivo— hay que aplicar la migración 34 en Supabase.
            </Note>
            <PrimaryButton
              label="Volver a Partidos"
              onPress={() => navigation.navigate('Main', { screen: 'SearchTab' })}
              height={52}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!match || !isOrganizer) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TopBar onBack={() => goBackOrPartidos(navigation)} title="Gestionar partido" />
          {match && !isOrganizer ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
              <Callout
                tone="danger"
                icon={Ban}
                title="Solo el organizador puede gestionar este partido"
                text="Si crees que es un error, revisa que estés con la cuenta correcta."
              />
              <GhostButton
                label="Volver al partido"
                onPress={() => goBackOrPartidos(navigation)}
                height={48}
                style={{ marginTop: 14 }}
              />
            </View>
          ) : (
            <ErrorState
              onRetry={() => {
                setLoading(true);
                load();
              }}
              detail={loadError?.message}
            />
          )}
        </SafeAreaView>
      </View>
    );
  }

  const canceled = match.estado === 'cancelado';
  const finished = hasFinished(match);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <TopBar
          onBack={() => goBackOrPartidos(navigation)}
          title="Gestionar partido"
          subtitle={`${match.titulo} · ${formatFechaCorta(match.hora)} ${timeOf(match.hora)}`}
        />

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={C.green}
            />
          }
        >
          {feedback ? (
            <Callout
              tone={feedback.tone === 'success' ? 'green' : feedback.tone === 'info' ? 'neutral' : 'danger'}
              icon={feedback.tone === 'success' ? CheckCircle2 : AlertCircle}
              title={feedback.title}
              text={feedback.text}
              onPress={() => setFeedback(null)}
              style={{ marginBottom: 12 }}
            />
          ) : null}

          {canceled ? (
            <Callout
              tone="danger"
              icon={Ban}
              title="Este partido está cancelado"
              text={
                match.motivo_cancelacion
                  ? `Motivo que ven los jugadores: ${match.motivo_cancelacion}`
                  : 'Ya no aparece en Partidos y el chat quedó en solo lectura.'
              }
              style={{ marginBottom: 12 }}
            />
          ) : null}

          {/* Resumen */}
          <View style={styles.summary}>
            <SummaryCell value={libres} label="CUPOS LIBRES" tone="green" />
            <View style={styles.summaryDivider} />
            <SummaryCell value={confirmed.length} label="EN EL PLANTEL" />
            <View style={styles.summaryDivider} />
            <SummaryCell value={requests.length} label="SOLICITUDES" tone="gold" />
          </View>

          {/* Acciones rápidas */}
          <View style={styles.quickGrid}>
            <SurfaceButton label="Chat del partido" icon={MessageSquare} onPress={openChat} style={styles.quickBtn} />
            <SurfaceButton label="Compartir" icon={Share2} onPress={() => setSheet('share')} style={styles.quickBtn} />
            <SurfaceButton
              label="Editar partido"
              icon={Pencil}
              onPress={() => navigation.navigate('EditMatch', { matchId })}
              style={styles.quickBtn}
              disabled={canceled}
            />
            <SurfaceButton
              label="Asistencia"
              icon={ListChecks}
              onPress={() => setTab('asistencia')}
              style={styles.quickBtn}
              disabled={canceled}
            />
          </View>

          {/* Tabs */}
          <View style={styles.tabs}>
            {TABS.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => setTab(t.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === t.key }}
                style={({ pressed }) => [
                  styles.tab,
                  tab === t.key ? styles.tabOn : styles.tabOff,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[styles.tabText, tab === t.key && styles.tabTextOn]}>
                  {t.label}
                  {t.key === 'solicitudes' && requests.length > 0 ? ` · ${requests.length}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* ---------------- SOLICITUDES ---------------- */}
          {tab === 'solicitudes' ? (
            <View style={{ gap: 10 }}>
              {full && requests.length > 0 ? (
                <Callout
                  tone="gold"
                  icon={AlertCircle}
                  title="Sin cupos libres"
                  text="Para aceptar a alguien más, libera un cupo o aumenta el total desde «Editar partido»."
                />
              ) : null}

              {requests.length === 0 ? (
                <InlineEmpty
                  icon={ClipboardList}
                  title="No hay solicitudes por revisar"
                  text="Cuando alguien pida un cupo aparecerá aquí. Comparte el partido para que llegue a más jugadores."
                  action="Compartir partido"
                  onAction={() => setSheet('share')}
                />
              ) : (
                <>
                  <SectionLabel right={full ? 'Sin cupos' : `${libres} ${libres === 1 ? 'cupo libre' : 'cupos libres'}`}>
                    Por revisar
                  </SectionLabel>
                  {requests.map((r) => (
                    <Card key={r.user_id} style={{ gap: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                        <Avatar url={r.foto_url} name={r.username} size={42} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.playerName} numberOfLines={1}>
                            @{r.username}
                          </Text>
                          <View style={styles.metaRow}>
                            <Text style={styles.metaText}>
                              {posLabel(r.posicion_preferida) || 'Sin posición'}
                            </Text>
                            <View style={styles.metaDot} />
                            <TrueScoreChip score={r.trust_score} conNivel />
                          </View>
                          <Text style={styles.historyText}>
                            {r.partidos_jugados > 0
                              ? `${r.partidos_jugados} ${r.partidos_jugados === 1 ? 'partido jugado' : 'partidos jugados'} · ${r.asistencias_confirmadas} confirmados con GPS`
                              : 'Sin historial todavía'}
                            {r.edad ? ` · ${r.edad} años` : ''}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => navigation.navigate('UserProfile', { userId: r.user_id })}
                          style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.8 }]}
                        >
                          <Text style={styles.smallBtnText}>Perfil</Text>
                        </Pressable>
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <GhostButton
                          label="Rechazar"
                          icon={X}
                          tone="danger"
                          height={42}
                          style={{ flex: 1 }}
                          disabled={busyId === r.user_id || !online || canceled}
                          onPress={() => reject(r.user_id)}
                        />
                        <PrimaryButton
                          label="Aceptar"
                          icon={Check}
                          height={42}
                          style={{ flex: 1.3 }}
                          loading={busyId === r.user_id}
                          disabled={full || !online || canceled}
                          onPress={() => accept(r.user_id)}
                        />
                      </View>
                      {full ? (
                        <Note>No puedes aceptar: no quedan cupos disponibles.</Note>
                      ) : null}
                    </Card>
                  ))}
                </>
              )}

              {waitlist.length > 0 ? (
                <View style={{ gap: 9, marginTop: 6 }}>
                  <SectionLabel right={`${waitlist.length} en espera`}>Lista de espera</SectionLabel>
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
                        </Text>
                        {w.prioridad ? <Tag label="Prioridad" tone="green" /> : null}
                        <TrueScoreChip score={w.trust_score} />
                      </View>
                    ))}
                  </Card>
                  <Note>
                    {ajustes.fase2
                      ? 'Cuando se libera un cupo avisamos automáticamente al primero de la lista; los jugadores «Muy confiable» tienen prioridad. No hace falta que lo aceptes a mano.'
                      : 'Cuando se libera un cupo avisamos automáticamente al primero de la lista. No hace falta que lo aceptes a mano.'}
                  </Note>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* ---------------- CONFIRMADOS ---------------- */}
          {tab === 'confirmados' ? (
            <View style={{ gap: 10 }}>
              <Card style={{ gap: 9 }} radius={16}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text style={styles.planLabel}>Plantel del partido</Text>
                  <Text style={styles.planValue}>
                    {libres > 0 ? `${libres} ${libres === 1 ? 'cupo libre' : 'cupos libres'}` : 'Completo'}
                  </Text>
                </View>
                <ProgressBar ratio={total ? tomados / total : 0} height={7} />
                <Text style={styles.metaText}>
                  {confirmed.length} {confirmed.length === 1 ? 'jugador' : 'jugadores'} ·{' '}
                  {tomados} de {total} cupos tomados
                  {requests.length > 0 ? ` · ${requests.length} en revisión` : ''}
                </Text>
              </Card>

              {confirmed.length === 0 ? (
                <InlineEmpty
                  title="Todavía no hay jugadores confirmados"
                  text="Comparte el partido para que se sumen. Tú también cuentas como organizador."
                  action="Compartir partido"
                  onAction={() => setSheet('share')}
                />
              ) : (
                <Card style={{ paddingVertical: 4, paddingHorizontal: 13 }}>
                  {confirmed.map((a, i) => (
                    <View
                      key={a.user_id}
                      style={[styles.playerRow, i === confirmed.length - 1 && { borderBottomWidth: 0 }]}
                    >
                      <Avatar url={a.foto_url} name={a.username} size={38} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.playerName} numberOfLines={1}>
                          @{a.username}
                          {a.is_organizer ? ' · organizador' : ''}
                        </Text>
                        <View style={styles.metaRow}>
                          <Text style={styles.metaText}>
                            {posLabel(a.posicion_preferida) || 'Sin posición'}
                          </Text>
                          <TrueScoreChip score={a.trust_score} />
                        </View>
                      </View>
                      {a.asistencia === 'tarde' ? <Tag label="Llegó tarde" tone="gold" /> : null}
                      {a.estado === 'confirmado_gps' && a.asistencia !== 'tarde' ? <Tag label="Asistió" tone="green" /> : null}
                      {a.estado === 'no_asistio' ? <Tag label="No asistió" tone="danger" /> : null}
                      {ts && !a.is_organizer && !canceled && !finished ? (
                        <Pressable
                          onPress={() => {
                            setExpulsando(a);
                            setSheet('expulsar');
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={`Sacar a ${a.username} del partido`}
                          hitSlop={6}
                          disabled={!online || busyId === a.user_id}
                          style={({ pressed }) => [styles.iconSquare, pressed && { opacity: 0.8 }]}
                        >
                          <UserMinus color={C.red} size={14} strokeWidth={2.4} />
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() =>
                          a.user_id !== myId && navigation.navigate('UserProfile', { userId: a.user_id })
                        }
                        hitSlop={8}
                        style={({ pressed }) => [styles.iconSquare, pressed && { opacity: 0.8 }]}
                      >
                        <Text style={styles.iconSquareText}>›</Text>
                      </Pressable>
                    </View>
                  ))}
                </Card>
              )}

              {fairplayActivo && agresiones.length > 0 ? (
                <View style={{ gap: 9 }}>
                  <SectionLabel>Agresiones físicas reportadas</SectionLabel>
                  <Card style={{ paddingVertical: 4, paddingHorizontal: 13 }}>
                    {agresiones.map((g, i) => (
                      <View
                        key={g.reported_id}
                        style={[styles.playerRow, i === agresiones.length - 1 && { borderBottomWidth: 0 }]}
                      >
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.playerName} numberOfLines={1}>
                            @{g.usuario}
                          </Text>
                          <Text style={styles.metaText}>
                            {g.reportes === 1 ? '1 reporte' : `${g.reportes} reportes`}
                          </Text>
                        </View>
                        {g.confirmada ? (
                          <Tag label="Confirmada" tone="danger" />
                        ) : (
                          <GhostButton
                            label="La vi"
                            tone="danger"
                            height={36}
                            disabled={!online || busyId === g.reported_id}
                            onPress={() => {
                              setAgresionSel(g);
                              setSheet('agresion');
                            }}
                          />
                        )}
                      </View>
                    ))}
                  </Card>
                  <Note>
                    Confirma solo lo que viste. Una agresión confirmada le resta fair play al jugador
                    y deja su cuenta en revisión.
                  </Note>
                </View>
              ) : null}

              <Note>
                Solo tú, como organizador, ves esta vista y las acciones administrativas de cada
                jugador.
              </Note>
              <SurfaceButton label="Escribir al grupo" icon={MessageSquare} onPress={openChat} height={50} />
            </View>
          ) : null}

          {/* ---------------- ASISTENCIA (TrueScore) ---------------- */}
          {tab === 'asistencia' && ts ? (
            <View style={{ gap: 10 }}>
              {asistenciaConfirmada ? (
                <Callout
                  tone="green"
                  icon={CheckCircle2}
                  title="Asistencia confirmada"
                  text="Ya confirmaste la asistencia de este partido. Si hubo un error, el jugador puede reclamar."
                />
              ) : asistenciaVencida ? (
                <Callout
                  tone="gold"
                  icon={AlertCircle}
                  title="Se venció el plazo para confirmar"
                  text={`Pasaron ${plazoTS} h sin confirmar: el partido quedó neutro para los jugadores y tu TrueScore bajó.`}
                />
              ) : !finished ? (
                <Callout
                  tone="neutral"
                  icon={ListChecks}
                  title="La asistencia se confirma después del partido"
                  text={`Cuando termine tendrás ${plazoTS} h para marcar a cada jugador. Si no lo haces, el partido queda neutro para ellos y tu TrueScore baja.`}
                />
              ) : !plazoAbiertoTS ? (
                <Callout
                  tone="gold"
                  icon={AlertCircle}
                  title="Se cerró el plazo para confirmar"
                  text={`El plazo era de ${plazoTS} h después del partido.`}
                />
              ) : (
                <Callout
                  tone="green"
                  icon={ListChecks}
                  title="Marca a cada jugador"
                  text={`Asistió, llegó tarde (más de ${ajustes.tarde_minutos ?? 10} min) o no fue. Se confirma una sola vez y cambia el TrueScore de cada uno.${ajustes.fase2 ? ' Mientras antes confirmes, más suma tu propio TrueScore.' : ''}`}
                />
              )}

              {nominaTS.length === 0 ? (
                <InlineEmpty
                  title="No hubo jugadores en la nómina"
                  text="Sin jugadores no hay asistencia que confirmar."
                />
              ) : (
                <>
                  <Card style={{ gap: 9 }} radius={16}>
                    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <Text style={styles.planLabel}>Marcados</Text>
                      <Text style={styles.planValue}>
                        {nominaTS.length - estadoMarcas.faltan} de {nominaTS.length}
                      </Text>
                    </View>
                    <ProgressBar
                      ratio={(nominaTS.length - estadoMarcas.faltan) / nominaTS.length}
                      height={7}
                    />
                  </Card>
                  <Card style={{ paddingVertical: 4, paddingHorizontal: 13 }}>
                    {nominaTS.map((a, i) => {
                      const mark = marcaDe(a.user_id);
                      const bloqueado = asistenciaConfirmada || asistenciaVencida || !plazoAbiertoTS;
                      return (
                        <View
                          key={a.user_id}
                          style={[styles.playerRow, i === nominaTS.length - 1 && { borderBottomWidth: 0 }]}
                        >
                          <Avatar url={a.foto_url} name={a.username} size={36} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.playerName} numberOfLines={1}>
                              @{a.username}
                            </Text>
                            <Text style={styles.metaText}>
                              {a.estado === 'confirmado_gps' && !a.asistencia
                                ? 'Confirmó con GPS'
                                : 'Sin confirmar por GPS'}
                            </Text>
                          </View>
                          {[
                            { v: 'asistio', icon: Check, label: 'Asistió', on: styles.markBtnOn, fgOn: C.greenInk, fg: C.green },
                            { v: 'tarde', icon: Clock, label: 'Llegó tarde', on: styles.markBtnLate, fgOn: C.textOnRed, fg: C.amber },
                            { v: 'no_fue', icon: UserX, label: 'No fue', on: styles.markBtnOff, fgOn: C.textOnRed, fg: C.red },
                          ].map((b) => {
                            const Icon = b.icon;
                            const activo = mark === b.v;
                            return (
                              <Pressable
                                key={b.v}
                                onPress={() => !bloqueado && setMarks((m) => ({ ...m, [a.user_id]: b.v }))}
                                disabled={bloqueado}
                                accessibilityRole="button"
                                accessibilityState={{ selected: activo, disabled: bloqueado }}
                                accessibilityLabel={`${b.label}: ${a.username}`}
                                style={({ pressed }) => [
                                  styles.markBtn,
                                  activo && b.on,
                                  bloqueado && !activo && { opacity: 0.4 },
                                  pressed && { opacity: 0.8 },
                                ]}
                              >
                                <Icon color={activo ? b.fgOn : b.fg} size={15} strokeWidth={2.6} />
                              </Pressable>
                            );
                          })}
                        </View>
                      );
                    })}
                  </Card>
                </>
              )}

              {!asistenciaConfirmada && !asistenciaVencida && finished && plazoAbiertoTS && nominaTS.length > 0 ? (
                <>
                  <PrimaryButton
                    label="Confirmar asistencia"
                    onPress={() => setSheet('confirmarAsistencia')}
                    disabled={!estadoMarcas.completas || !online || canceled}
                    height={52}
                  />
                  {!estadoMarcas.completas ? (
                    <Note>
                      {estadoMarcas.faltan === 1
                        ? 'Falta marcar a 1 jugador.'
                        : `Faltan ${estadoMarcas.faltan} jugadores por marcar.`}
                    </Note>
                  ) : null}
                </>
              ) : null}
              <GhostButton label="Volver" onPress={() => goBackOrPartidos(navigation)} height={46} />
            </View>
          ) : null}

          {/* ---------------- ASISTENCIA ---------------- */}
          {tab === 'asistencia' && !ts ? (
            <View style={{ gap: 10 }}>
              {!finished ? (
                <Callout
                  tone="neutral"
                  icon={ListChecks}
                  title="La asistencia se registra después del partido"
                  text={`Podrás marcar quién asistió cuando termine (falta ${timeUntilLabel(match.hora)} para que empiece). Tendrás ${ATTENDANCE_WINDOW_HOURS} h de plazo.`}
                />
              ) : !attendanceOpen(match) ? (
                <Callout
                  tone="gold"
                  icon={AlertCircle}
                  title="Se cerró el plazo de asistencia"
                  text={`El plazo era de ${ATTENDANCE_WINDOW_HOURS} h después del partido. Lo que ya estaba registrado se mantiene.`}
                />
              ) : (
                <Callout
                  tone="green"
                  icon={ListChecks}
                  title="Marca quién asistió"
                  text="Esto alimenta el Trust Score real de cada jugador, así que solo marca lo que viste en la cancha."
                />
              )}

              <Card style={{ gap: 9 }} radius={16}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <Text style={styles.planLabel}>Marcados</Text>
                  <Text style={styles.planValue}>
                    {markedCount} de {confirmed.length}
                  </Text>
                </View>
                <ProgressBar ratio={confirmed.length ? markedCount / confirmed.length : 0} height={7} />
              </Card>

              {confirmed.length === 0 ? (
                <InlineEmpty
                  title="No hubo jugadores confirmados"
                  text="Sin plantel confirmado no hay asistencia que registrar."
                />
              ) : (
                <Card style={{ paddingVertical: 4, paddingHorizontal: 13 }}>
                  {confirmed.map((a, i) => {
                    const mark = marks[a.user_id];
                    return (
                      <View
                        key={a.user_id}
                        style={[styles.playerRow, i === confirmed.length - 1 && { borderBottomWidth: 0 }]}
                      >
                        <Avatar url={a.foto_url} name={a.username} size={36} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.playerName} numberOfLines={1}>
                            @{a.username}
                          </Text>
                          <Text style={styles.metaText}>
                            {a.estado === 'confirmado_gps' ? 'Confirmó con GPS' : 'Sin confirmar por GPS'}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => setMarks((m) => ({ ...m, [a.user_id]: 'presente' }))}
                          accessibilityRole="button"
                          accessibilityLabel={`Marcar presente a ${a.username}`}
                          style={({ pressed }) => [
                            styles.markBtn,
                            mark === 'presente' && styles.markBtnOn,
                            pressed && { opacity: 0.8 },
                          ]}
                        >
                          <Check color={mark === 'presente' ? C.greenInk : C.green} size={15} strokeWidth={2.8} />
                        </Pressable>
                        <Pressable
                          onPress={() => setMarks((m) => ({ ...m, [a.user_id]: 'ausente' }))}
                          accessibilityRole="button"
                          accessibilityLabel={`Marcar ausente a ${a.username}`}
                          style={({ pressed }) => [
                            styles.markBtn,
                            mark === 'ausente' && styles.markBtnOff,
                            pressed && { opacity: 0.8 },
                          ]}
                        >
                          <UserX color={mark === 'ausente' ? '#2B0F11' : C.red} size={15} strokeWidth={2.4} />
                        </Pressable>
                      </View>
                    );
                  })}
                </Card>
              )}

              <PrimaryButton
                label="Guardar asistencia"
                onPress={saveAttendance}
                loading={savingAttendance}
                disabled={markedCount === 0 || !online || !attendanceOpen(match) || canceled}
                height={52}
              />
              {markedCount === 0 ? (
                <Note>Marca al menos un jugador para poder guardar.</Note>
              ) : null}
              <GhostButton label="Terminar después" onPress={() => goBackOrPartidos(navigation)} height={46} />
            </View>
          ) : null}
        </ScrollView>

        {/* Pie fijo */}
        {!canceled && !finished ? (
          <View style={[styles.footer, { paddingBottom: 14 + Math.max(insets.bottom, 8) }]}>
            <Pressable
              onPress={() => setSheet('cancelar')}
              accessibilityRole="button"
              style={({ pressed }) => [{ height: 44, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.cancelLink}>Cancelar partido</Text>
            </Pressable>
          </View>
        ) : null}
      </SafeAreaView>

      <ShareSheet visible={sheet === 'share'} onClose={() => setSheet(null)} match={match} />

      {/* Cancelación destructiva */}
      <Sheet
        visible={sheet === 'cancelar'}
        onClose={() => setSheet(null)}
        title="¿Cancelar este partido?"
        subtitle={`${match.titulo} · ${formatFechaCorta(match.hora)} ${timeOf(match.hora)}`}
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <GhostButton
              label={
                ts
                  ? costoCancelacion?.ok && Number(costoCancelacion.puntos) > 0
                    ? `Sí, cancelar el partido (−${costoCancelacion.puntos} pts)`
                    : 'Sí, cancelar el partido'
                  : `Sí, cancelar el partido (−${cancelPenaltyFor(match.hora)} pts)`
              }
              tone="danger"
              onPress={cancelMatchNow}
              height={52}
              disabled={canceling || !online}
            />
            <Pressable onPress={() => setSheet(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.sheetBack}>Mantener el partido</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ gap: 10 }} radius={16}>
          <SectionLabel>Qué va a pasar</SectionLabel>
          <Bullet tone="danger" text="El partido deja de aparecer en Partidos" />
          <Bullet
            tone="gold"
            text={
              (confirmed.length === 1
                ? 'Avisamos al jugador confirmado'
                : `Avisamos a los ${confirmed.length} jugadores confirmados`) +
              (requests.length === 0
                ? ''
                : requests.length === 1
                ? ' y a la solicitud pendiente'
                : ` y a las ${requests.length} solicitudes pendientes`)
            }
          />
          <Bullet text="El chat del partido queda en solo lectura" />
          {ts ? (
            <Bullet
              text={
                textoCostoCancelacion(costoCancelacion, tipoCancelacion) ||
                'Calculando lo que cuesta cancelar ahora…'
              }
            />
          ) : (
            <Bullet
              text={`Tu Trust Score baja ${cancelPenaltyFor(match.hora)} puntos${isPenaltyFree(match.hora) ? '' : ' — estás cancelando con poca antelación'}`}
            />
          )}
          <Bullet text="El partido no se borra: queda en el historial como cancelado" />
        </Card>

        {ts ? (
          <View style={{ gap: 7, marginTop: 14 }}>
            <SectionLabel>¿Por qué se cancela?</SectionLabel>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {TIPOS_CANCELACION.map((t) => (
                <Pressable
                  key={t.value}
                  onPress={() => setTipoCancelacion(t.value)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: tipoCancelacion === t.value }}
                  style={({ pressed }) => [
                    styles.tab,
                    tipoCancelacion === t.value ? styles.tabOn : styles.tabOff,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.tabText, tipoCancelacion === t.value && styles.tabTextOn]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ gap: 7, marginTop: 14 }}>
          <SectionLabel>Motivo · opcional, lo ven los jugadores</SectionLabel>
          <Input
            value={reason}
            onChangeText={setReason}
            placeholder="Ej: se inundó la cancha, la reprogramamos para el sábado"
            multiline
            maxLength={200}
          />
          <Note>{reason.length}/200 · Un motivo claro evita que el grupo quede con dudas.</Note>
        </View>
      </Sheet>

      {/* Expulsión (TrueScore) */}
      <Sheet
        visible={sheet === 'expulsar' && !!expulsando}
        onClose={() => {
          setSheet(null);
          setExpulsando(null);
        }}
        title={expulsando ? `¿Sacar a @${expulsando.username}?` : ''}
        subtitle={match.titulo}
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <GhostButton
              label="Sí, sacarlo del partido"
              tone="danger"
              onPress={expulsarAhora}
              height={52}
              disabled={!!busyId || !online}
            />
            <Pressable
              onPress={() => {
                setSheet(null);
                setExpulsando(null);
              }}
              style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={styles.sheetBack}>Mantenerlo</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ gap: 10 }} radius={16}>
          <Bullet tone="danger" text="Sale de la nómina y no puede volver a este partido" />
          <Bullet text="Su TrueScore no cambia: sacar a alguien no le resta puntos" />
          <Bullet tone="gold" text="Se libera su cupo y avisamos a la lista de espera" />
        </Card>
      </Sheet>

      {/* Confirmar una agresión física (fair play) */}
      <Sheet
        visible={sheet === 'agresion' && !!agresionSel}
        onClose={() => {
          setSheet(null);
          setAgresionSel(null);
        }}
        title={agresionSel ? `¿Confirmas la agresión de @${agresionSel.usuario}?` : ''}
        subtitle={match.titulo}
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <GhostButton
              label="Sí, la vi"
              tone="danger"
              onPress={confirmarAgresionAhora}
              height={52}
              disabled={!!busyId || !online}
            />
            <Pressable
              onPress={() => {
                setSheet(null);
                setAgresionSel(null);
              }}
              style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={styles.sheetBack}>No la vi</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ gap: 10 }} radius={16}>
          <Bullet tone="danger" text="Su fair play baja y su cuenta queda marcada para revisión" />
          <Bullet text="No cambia su TrueScore" />
          <Bullet tone="gold" text="Confirma solo si lo viste tú: no se puede deshacer" />
        </Card>
      </Sheet>

      {/* Confirmar asistencia (TrueScore), una sola vez */}
      <Sheet
        visible={sheet === 'confirmarAsistencia'}
        onClose={() => setSheet(null)}
        title="¿Confirmar la asistencia?"
        subtitle="Se confirma una sola vez"
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <PrimaryButton
              label="Sí, confirmar"
              onPress={confirmarAsistenciaTS}
              loading={savingAttendance}
              disabled={!estadoMarcas.completas || !online}
              height={52}
            />
            <Pressable onPress={() => setSheet(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.sheetBack}>Revisar de nuevo</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ gap: 10 }} radius={16}>
          <Bullet
            text={`${nominaTS.filter((a) => marcasTS[a.user_id] === 'asistio').length} asistieron · ${nominaTS.filter((a) => marcasTS[a.user_id] === 'tarde').length} llegaron tarde · ${nominaTS.filter((a) => marcasTS[a.user_id] === 'no_fue').length} no fueron`}
          />
          <Bullet tone="gold" text="Después no se puede cambiar. Si te equivocas, el jugador puede reclamar." />
        </Card>
      </Sheet>
    </View>
  );
}

// ------------------------------------------------------------ auxiliares

function TopBar({ onBack, title, subtitle }) {
  return (
    <View style={styles.topBar}>
      <IconButton icon={ArrowLeft} onPress={onBack} tone="surface" accessibilityLabel="Volver" />
      <View style={{ flex: 1 }}>
        <Text style={styles.topTitle}>{title}</Text>
        {subtitle ? (
          <Text style={styles.topSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function SummaryCell({ value, label, tone }) {
  const color = tone === 'green' ? C.green : tone === 'gold' ? C.gold : C.textPrimary;
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 20, fontFamily: F.extraBold, color, lineHeight: 22 }}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function Bullet({ text, tone }) {
  const color = tone === 'danger' ? C.red : tone === 'gold' ? C.gold : C.textSecondary;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginTop: 6 }} />
      <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: C.textSoft }}>{text}</Text>
    </View>
  );
}

// La marca vieja ('presente'/'ausente', o la que precarga el GPS) leída como
// marca de TrueScore.
function marcaTrueScore(m) {
  if (m === 'presente') return 'asistio';
  if (m === 'ausente') return 'no_fue';
  return m || null;
}

function posLabel(pos) {
  if (!pos) return null;
  const arr = Array.isArray(pos) ? pos : [pos];
  const map = {
    arquero: 'Arquero',
    defensa: 'Defensa',
    lateral: 'Lateral',
    volante: 'Volante',
    medio: 'Mediocampista',
    delantero: 'Delantero',
    sin_definir: null,
  };
  const names = arr.map((p) => map[p]).filter(Boolean);
  return names.length ? names.join(' · ') : null;
}

function timeOf(iso) {
  try {
    return new Date(iso).toTimeString().slice(0, 5);
  } catch {
    return '';
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 26 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  topTitle: { fontSize: 15, fontFamily: F.bold, color: C.textPrimary },
  topSub: { fontSize: 11.5, fontFamily: F.medium, color: C.textFaint, marginTop: 1 },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.hairline,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  summaryDivider: { width: 1, height: 34, backgroundColor: C.hairline },
  summaryLabel: { fontSize: 10, fontFamily: F.semiBold, color: C.textFaint, letterSpacing: 0.5, marginTop: 3 },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  quickBtn: { width: '48.4%' },

  tabs: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  tab: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: alfa(C.green, 0.14), borderWidth: 1, borderColor: C.greenBorder },
  tabOff: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.hairline },
  tabText: { fontSize: 12.5, fontFamily: F.semiBold, color: C.textSecondary },
  tabTextOn: { color: C.green, fontFamily: F.bold },

  playerName: { fontSize: 13.5, fontFamily: F.bold, color: C.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  metaText: { fontSize: 11.5, fontFamily: F.medium, color: C.textFaint },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#434A44' },
  historyText: { fontSize: 10.5, color: C.textGhost, marginTop: 2 },

  smallBtn: {
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 9,
    backgroundColor: C.chip,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { fontSize: 11.5, fontFamily: F.bold, color: C.textStrong },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  iconSquare: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSquareText: { fontSize: 17, fontFamily: F.bold, color: C.textSecondary, lineHeight: 19 },

  markBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: C.chip,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markBtnOn: { backgroundColor: C.green, borderColor: C.green },
  markBtnLate: { backgroundColor: C.amber, borderColor: C.amber },
  markBtnOff: { backgroundColor: C.red, borderColor: C.red },

  planLabel: { fontSize: 12, fontFamily: F.semiBold, color: C.textSecondary },
  planValue: { fontSize: 12.5, fontFamily: F.bold, color: C.green },

  wlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  wlPos: { width: 20, fontSize: 12, fontFamily: F.bold, color: C.textGhost },
  wlName: { flex: 1, fontSize: 12.5, fontFamily: F.semiBold, color: C.textStrong },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: C.hairline,
  },
  cancelLink: { fontSize: 13.5, fontFamily: F.bold, color: C.red },
  sheetBack: { fontSize: 13.5, fontFamily: F.bold, color: C.textSecondary },
});
