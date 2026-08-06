import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Linking, Platform } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquare,
  Navigation,
} from 'lucide-react-native';

import { partidos as P, partidosRadius as R } from '../theme/colors';
import {
  Avatar,
  Callout,
  Card,
  Divider,
  GhostButton,
  IconButton,
  Note,
  PrimaryButton,
  SectionLabel,
  SurfaceButton,
  Tag,
} from '../components/partidos/ui';
import Sheet from '../components/partidos/Sheet';
import { LoadingList, ErrorState } from '../components/partidos/StateViews';
import { formatFechaLarga } from '../components/partidos/DateTimeSheets';
import { getMatchAttendees, leaveMatchPenalized } from '../services/matches';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { getCurrentUser } from '../services/auth';
import { useOnline } from '../services/connectivity';
import {
  GPS_RADIUS_METERS,
  cuotaLabel,
  hasFinished,
  hasStarted,
  isPenaltyFree,
  leavePenaltyFor,
  leaveRuleText,
  timeUntilLabel,
} from '../services/matchRules';

/**
 * «Mi cupo» (variante 4c del handoff).
 *
 * Lo que el jugador confirmado necesita el día del partido: dónde es, cuánto
 * llevar, con quién juega, cómo llegar, el chat y la salida con su regla de
 * Trust Score explicada antes de tocar nada.
 */
export default function MatchSpotScreen({ route, navigation }) {
  const matchId = route?.params?.matchId;
  const insets = useSafeAreaInsets();
  const online = useOnline();

  const [match, setMatch] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [myId, setMyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [sheet, setSheet] = useState(null);

  const load = useCallback(async () => {
    const [res, user] = await Promise.all([
      getMatchAttendees(matchId).catch((e) => ({ data: [], match: null, error: e })),
      getCurrentUser(),
    ]);
    setMatch(res.match || null);
    setAttendees(res.data || []);
    setMyId(user?.id || null);
    setLoadError(res.match ? null : res.error || { message: 'No encontramos este partido.' });
    setLoading(false);
  }, [matchId]);

  useEffect(() => {
    load();
    return navigation.addListener('focus', load);
  }, [load, navigation]);

  const mine = useMemo(() => attendees.find((a) => a.user_id === myId) || null, [attendees, myId]);
  const squad = useMemo(
    () => attendees.filter((a) => a.estado !== 'pendiente' && a.estado !== 'cancelado'),
    [attendees]
  );
  const libres = match?.cupos_disponibles ?? 0;
  const gpsPending =
    mine?.estado === 'inscrito' && hasStarted(match) && !hasFinished(match);

  const leave = async () => {
    if (busy || !online) return;
    setBusy(true);
    const res = await leaveMatchPenalized(matchId);
    setBusy(false);
    if (!res?.ok) {
      setFeedback({ tone: 'error', title: 'No pudimos sacarte del partido', text: res?.reason || res?.error?.message || '' });
      return;
    }
    setSheet(null);
    navigation.goBack();
  };

  const confirmGps = async () => {
    if (busy || !online) return;
    setBusy(true);
    const res = await confirmAttendanceWithGPS(matchId);
    setBusy(false);
    if (!res?.ok) {
      setFeedback({ tone: 'error', title: 'No pudimos confirmar tu asistencia', text: res?.reason || '' });
      return;
    }
    setFeedback({
      tone: 'success',
      title: 'Asistencia confirmada',
      text: res.distance ? `Estás a ${Math.round(res.distance)} m de la cancha.` : '',
    });
    load();
  };

  const openDirections = () => {
    if (match?.latitud == null) return;
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?daddr=${match.latitud},${match.longitud}`
        : `https://www.google.com/maps/dir/?api=1&destination=${match.latitud},${match.longitud}`;
    Linking.openURL(url).catch(() => {});
  };

  const openChat = () =>
    navigation.navigate('ChatThread', {
      threadKey: 'match:' + matchId,
      title: match?.titulo || 'Partido',
      subtitle: [match?.cancha_nombre, match?.comuna].filter(Boolean).join(' · '),
    });

  if (loading) {
    return (
      <Shell onBack={() => navigation.goBack()}>
        <LoadingList count={2} />
      </Shell>
    );
  }
  if (!match) {
    return (
      <Shell onBack={() => navigation.goBack()}>
        <ErrorState onRetry={load} detail={loadError?.message} />
      </Shell>
    );
  }

  const canceled = match.estado === 'cancelado';
  const finished = hasFinished(match);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} tone="surface" accessibilityLabel="Volver" />
          <Text style={styles.topTitle}>Mi cupo</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {feedback ? (
            <Callout
              tone={feedback.tone === 'success' ? 'green' : 'danger'}
              icon={feedback.tone === 'success' ? CheckCircle2 : AlertCircle}
              title={feedback.title}
              text={feedback.text}
              onPress={() => setFeedback(null)}
              style={{ marginBottom: 14 }}
            />
          ) : null}

          {canceled ? (
            <Callout
              tone="danger"
              icon={AlertCircle}
              title="El organizador canceló el partido"
              text={
                match.motivo_cancelacion
                  ? `Motivo: ${match.motivo_cancelacion}`
                  : 'Ya no se juega. El chat quedó en solo lectura.'
              }
              style={{ marginBottom: 14 }}
            />
          ) : null}

          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 14 }}>
            <View style={styles.bigIcon}>
              <CheckCircle2 color={P.green} size={28} strokeWidth={2} />
            </View>
            <Text style={styles.bigTitle}>{finished ? 'Partido jugado' : 'Cupo confirmado'}</Text>
            <Text style={styles.bigText}>
              {finished
                ? 'Este partido ya terminó. El organizador registrará la asistencia.'
                : match.recordatorio_1h !== false
                ? 'Estás en la lista. Te recordamos el partido una hora antes.'
                : 'Estás en la lista. Anota la hora: este partido no envía recordatorio.'}
            </Text>
          </View>

          {/* Datos del partido */}
          <Card style={{ padding: 14, gap: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.matchTitle, { flex: 1 }]} numberOfLines={2}>
                {match.titulo}
              </Text>
              <Tag
                label={mine?.estado === 'confirmado_gps' ? 'Asistencia OK' : 'Confirmado'}
                tone="green"
              />
            </View>
            <Row icon={Calendar} strong>
              {capitalize(formatFechaLarga(match.hora))} · {timeOf(match.hora)}
            </Row>
            <Row icon={MapPin}>
              {[match.cancha_nombre, match.direccion || match.comuna].filter(Boolean).join(', ')}
            </Row>
            {!finished ? (
              <Row icon={Clock}>Falta {timeUntilLabel(match.hora)}</Row>
            ) : null}
            <Divider />
            <View style={styles.rowBetween}>
              <Text style={styles.metaLabel}>
                {Number(match.precio_cuota) === 0 ? 'Cuota' : 'Lleva en efectivo'}
              </Text>
              <Text style={styles.metaValue}>{cuotaLabel(match.precio_cuota)}</Text>
            </View>
          </Card>

          {/* Equipo */}
          <View style={{ gap: 9, marginTop: 16 }}>
            <SectionLabel right={`${squad.length} de ${match.cupos_totales}`}>
              Tu equipo para este partido
            </SectionLabel>
            <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flexDirection: 'row' }}>
                {squad.slice(0, 5).map((a, i) => (
                  <View key={a.user_id} style={{ marginLeft: i === 0 ? 0 : -9 }}>
                    <Avatar
                      url={a.foto_url}
                      name={a.user_id === myId ? 'TÚ' : a.username}
                      size={30}
                      ring
                    />
                  </View>
                ))}
                {libres > 0 ? (
                  <View style={[styles.ghostAvatar, { marginLeft: squad.length ? -9 : 0 }]}>
                    <Text style={styles.ghostAvatarText}>+{libres}</Text>
                  </View>
                ) : null}
              </View>
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={() => navigation.navigate('MatchDetail', { matchId })}
                hitSlop={8}
              >
                <Text style={styles.link}>Ver partido</Text>
              </Pressable>
            </Card>
          </View>

          {gpsPending ? (
            <View style={{ gap: 9, marginTop: 16 }}>
              <SectionLabel>Estás en la cancha</SectionLabel>
              <PrimaryButton
                label="Confirmar mi asistencia con GPS"
                icon={MapPin}
                onPress={confirmGps}
                loading={busy}
                height={50}
              />
              <Note>
                Validamos que estés a menos de {GPS_RADIUS_METERS} m de la cancha. Confirmar suma a
                tu Trust Score.
              </Note>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: 14 + Math.max(insets.bottom, 8) }]}>
          <PrimaryButton
            label="Abrir chat del partido"
            icon={MessageSquare}
            onPress={openChat}
            height={52}
          />
          {!finished && !canceled ? (
            <>
              <View style={{ flexDirection: 'row', gap: 9 }}>
                <SurfaceButton
                  label="Cómo llegar"
                  icon={Navigation}
                  onPress={openDirections}
                  height={46}
                  style={{ flex: 1 }}
                  disabled={match.latitud == null}
                />
                <GhostButton
                  label="Salir del partido"
                  tone="danger"
                  onPress={() => setSheet('leave')}
                  height={46}
                  style={{ flex: 1 }}
                />
              </View>
              <Note>{leaveRuleText(match.hora)}</Note>
            </>
          ) : null}
        </View>
      </SafeAreaView>

      <Sheet
        visible={sheet === 'leave'}
        onClose={() => setSheet(null)}
        title="¿Salir de este partido?"
        subtitle={`${match.titulo} · falta ${timeUntilLabel(match.hora)}`}
        footer={
          <View style={{ flex: 1, gap: 9 }}>
            <GhostButton
              label={`Salir del partido (−${leavePenaltyFor(match.hora)} pts)`}
              tone="danger"
              onPress={leave}
              height={52}
              disabled={busy || !online}
            />
            <Pressable onPress={() => setSheet(null)} style={{ height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={styles.sheetBack}>Me quedo en el partido</Text>
            </Pressable>
          </View>
        }
      >
        <Card style={{ gap: 10 }} radius={16}>
          <SectionLabel>Qué va a pasar</SectionLabel>
          <Bullet
            tone={isPenaltyFree(match.hora) ? 'gold' : 'danger'}
            text={`Tu Trust Score baja ${leavePenaltyFor(match.hora)} ${leavePenaltyFor(match.hora) === 1 ? 'punto' : 'puntos'}`}
          />
          <Bullet text="Tu cupo se libera y vuelve a aparecer en Partidos" />
          <Bullet text="Avisamos al grupo y al primero de la lista de espera" />
          <Bullet text="Pierdes el acceso al chat del partido" />
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

function Shell({ onBack, children }) {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <IconButton icon={ArrowLeft} onPress={onBack} tone="surface" accessibilityLabel="Volver" />
          <Text style={styles.topTitle}>Mi cupo</Text>
        </View>
        <View style={{ paddingHorizontal: 16 }}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

function Row({ icon: Icon, children, strong }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Icon color={strong ? P.green : P.textMuted} size={15} strokeWidth={2} />
      <Text
        style={{
          flex: 1,
          fontSize: strong ? 13 : 12.5,
          fontWeight: strong ? '700' : '500',
          color: strong ? P.text : P.textDim,
        }}
      >
        {children}
      </Text>
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
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  topTitle: { fontSize: 15, fontWeight: '700', color: P.text },

  bigIcon: {
    width: 66,
    height: 66,
    borderRadius: 22,
    backgroundColor: 'rgba(90,224,106,0.13)',
    borderWidth: 1,
    borderColor: P.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigTitle: { fontSize: 22, fontWeight: '800', color: P.text, letterSpacing: -0.4 },
  bigText: { fontSize: 13, lineHeight: 20, color: P.textMuted, textAlign: 'center' },

  matchTitle: { fontSize: 16, fontWeight: '800', color: P.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaLabel: { fontSize: 12, color: P.textMuted },
  metaValue: { fontSize: 15, fontWeight: '800', color: P.green },
  link: { fontSize: 12, fontWeight: '700', color: P.green },

  ghostAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: P.chipAlt,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: P.dashed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostAvatarText: { fontSize: 10, fontWeight: '700', color: P.textGhost },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 9,
    backgroundColor: P.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: P.hairline,
  },
  sheetBack: { fontSize: 13.5, fontWeight: '700', color: P.textMuted },
});
