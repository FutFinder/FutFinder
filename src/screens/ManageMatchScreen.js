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
  ListChecks,
  MessageSquare,
  Pencil,
  Share2,
  UserX,
  X,
} from 'lucide-react-native';

import { partidos as P, partidosRadius as R } from '../theme/colors';
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
import { useOnline } from '../services/connectivity';
import {
  ATTENDANCE_WINDOW_HOURS,
  attendanceOpen,
  cancelPenaltyFor,
  hasFinished,
  isPenaltyFree,
  timeUntilLabel,
} from '../services/matchRules';

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

  // Asistencia: { [userId]: 'presente' | 'ausente' }
  const [marks, setMarks] = useState({});
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [reason, setReason] = useState('');
  const [canceling, setCanceling] = useState(false);

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
      if (a.estado === 'confirmado_gps') pre[a.user_id] = 'presente';
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

  const confirmed = useMemo(
    () => attendees.filter((a) => a.estado !== 'pendiente' && a.estado !== 'cancelado'),
    [attendees]
  );
  const isOrganizer = !!(match && myId && match.id_organizador === myId);
  const total = match?.cupos_totales ?? 0;
  const libres = match?.cupos_disponibles ?? 0;
  const ocupados = Math.max(0, total - libres);
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
    setBusyId(null);
    if (!res?.ok) {
      say('error', 'No pudimos aceptar la solicitud', res?.reason || res?.error?.message || '');
      return;
    }
    say('success', 'Jugador aceptado', 'Se sumó al plantel, se descontó el cupo y le avisamos.');
    await load();
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

  const cancelMatchNow = async () => {
    if (canceling) return;
    setCanceling(true);
    const res = await cancelMatchWithReason(matchId, reason.trim() || null);
    setCanceling(false);
    if (!res?.ok) {
      say('error', 'No pudimos cancelar el partido', res?.reason || res?.error?.message || '');
      return;
    }
    setSheet(null);
    say(
      'success',
      'Partido cancelado',
      `Avisamos a los ${confirmed.length} confirmados y a quienes tenían solicitud.`
    );
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
          <TopBar onBack={() => navigation.goBack()} title="Gestionar partido" />
          <View style={{ paddingHorizontal: 16 }}>
            <LoadingList count={2} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!match || !isOrganizer) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <TopBar onBack={() => navigation.goBack()} title="Gestionar partido" />
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
                onPress={() => navigation.goBack()}
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
          onBack={() => navigation.goBack()}
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
              tintColor={P.green}
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
            <SummaryCell value={confirmed.length} label="CONFIRMADOS" />
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
                            <Text style={styles.tsText}>TS {r.trust_score ?? 'N.A.'}</Text>
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
                        <Text style={styles.tsText}>TS {w.trust_score ?? 'N.A.'}</Text>
                      </View>
                    ))}
                  </Card>
                  <Note>
                    Cuando se libera un cupo avisamos automáticamente al primero de la lista. No
                    hace falta que lo aceptes a mano.
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
                <ProgressBar ratio={total ? ocupados / total : 0} height={7} />
                <Text style={styles.metaText}>
                  {ocupados} de {total} confirmados
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
                        <Text style={styles.metaText}>
                          {posLabel(a.posicion_preferida) || 'Sin posición'}
                          {a.trust_score != null ? ` · TS ${a.trust_score}` : ''}
                        </Text>
                      </View>
                      {a.estado === 'confirmado_gps' ? <Tag label="Asistió" tone="green" /> : null}
                      {a.estado === 'no_asistio' ? <Tag label="No asistió" tone="danger" /> : null}
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

              <Note>
                Solo tú, como organizador, ves esta vista y las acciones administrativas de cada
                jugador.
              </Note>
              <SurfaceButton label="Escribir al grupo" icon={MessageSquare} onPress={openChat} height={50} />
            </View>
          ) : null}

          {/* ---------------- ASISTENCIA ---------------- */}
          {tab === 'asistencia' ? (
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
                          <Check color={mark === 'presente' ? P.greenInk : P.green} size={15} strokeWidth={2.8} />
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
                          <UserX color={mark === 'ausente' ? '#2B0F11' : P.coral} size={15} strokeWidth={2.4} />
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
              <GhostButton label="Terminar después" onPress={() => navigation.goBack()} height={46} />
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
              label={`Sí, cancelar el partido (−${cancelPenaltyFor(match.hora)} pts)`}
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
            text={`Avisamos a los ${confirmed.length} ${confirmed.length === 1 ? 'jugador confirmado' : 'jugadores confirmados'}${requests.length ? ` y a las ${requests.length} solicitudes pendientes` : ''}`}
          />
          <Bullet text="El chat del partido queda en solo lectura" />
          <Bullet
            text={`Tu Trust Score baja ${cancelPenaltyFor(match.hora)} puntos${isPenaltyFree(match.hora) ? '' : ' — estás cancelando con poca antelación'}`}
          />
          <Bullet text="El partido no se borra: queda en el historial como cancelado" />
        </Card>

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
  const color = tone === 'green' ? P.green : tone === 'gold' ? P.gold : P.text;
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 20, fontWeight: '800', color, lineHeight: 22 }}>{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function Bullet({ text, tone }) {
  const color = tone === 'danger' ? P.coral : tone === 'gold' ? P.gold : P.textMuted;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginTop: 6 }} />
      <Text style={{ flex: 1, fontSize: 12, lineHeight: 18, color: P.textSoft }}>{text}</Text>
    </View>
  );
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
  root: { flex: 1, backgroundColor: P.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 26 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  topTitle: { fontSize: 15, fontWeight: '700', color: P.text },
  topSub: { fontSize: 11.5, fontWeight: '500', color: P.textFaint, marginTop: 1 },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.hairline,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 6,
    marginBottom: 12,
  },
  summaryDivider: { width: 1, height: 34, backgroundColor: P.hairline },
  summaryLabel: { fontSize: 10, fontWeight: '600', color: P.textFaint, letterSpacing: 0.5, marginTop: 3 },

  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 14 },
  quickBtn: { width: '48.4%' },

  tabs: { flexDirection: 'row', gap: 6, marginBottom: 14 },
  tab: { flex: 1, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: 'rgba(90,224,106,0.14)', borderWidth: 1, borderColor: P.greenBorder },
  tabOff: { backgroundColor: P.surface, borderWidth: 1, borderColor: P.hairline },
  tabText: { fontSize: 12.5, fontWeight: '600', color: P.textMuted },
  tabTextOn: { color: P.green, fontWeight: '700' },

  playerName: { fontSize: 13.5, fontWeight: '700', color: P.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3 },
  metaText: { fontSize: 11.5, fontWeight: '500', color: P.textFaint },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#434A44' },
  tsText: { fontSize: 11.5, fontWeight: '700', color: P.green },
  historyText: { fontSize: 10.5, color: P.textGhost, marginTop: 2 },

  smallBtn: {
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 9,
    backgroundColor: P.chip,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallBtnText: { fontSize: 11.5, fontWeight: '700', color: P.textStrong },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: P.divider,
  },
  iconSquare: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: P.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSquareText: { fontSize: 17, fontWeight: '700', color: P.textMuted, lineHeight: 19 },

  markBtn: {
    width: 38,
    height: 38,
    borderRadius: 11,
    backgroundColor: P.chip,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markBtnOn: { backgroundColor: P.green, borderColor: P.green },
  markBtnOff: { backgroundColor: P.coral, borderColor: P.coral },

  planLabel: { fontSize: 12, fontWeight: '600', color: P.textMuted },
  planValue: { fontSize: 12.5, fontWeight: '700', color: P.green },

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

  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: P.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: P.hairline,
  },
  cancelLink: { fontSize: 13.5, fontWeight: '700', color: P.coral },
  sheetBack: { fontSize: 13.5, fontWeight: '700', color: P.textMuted },
});
