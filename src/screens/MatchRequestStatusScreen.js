import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AlertCircle,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquareOff,
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
  SectionLabel,
  StatusButton,
  SurfaceButton,
} from '../components/partidos/ui';
import { LoadingList, ErrorState } from '../components/partidos/StateViews';
import { formatFechaLarga } from '../components/partidos/DateTimeSheets';
import { cancelMyJoinRequest, getMatchAttendees } from '../services/matches';
import { getCurrentUser } from '../services/auth';
import { useOnline } from '../services/connectivity';
import { goBackOrPartidos } from '../utils/navigation';
import { cuotaLabel } from '../services/matchRules';

/**
 * «Mi solicitud» (variante 4b del handoff).
 *
 * Estado real de una solicitud con aprobación manual: quién la revisa, en qué
 * paso va y la opción de retirarla. El chat sigue cerrado hasta que el cupo
 * esté confirmado, y así se dice explícitamente.
 */
export default function MatchRequestStatusScreen({ route, navigation }) {
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
  const organizer = useMemo(() => attendees.find((a) => a.is_organizer) || null, [attendees]);
  const pending = mine?.estado === 'pendiente';
  const accepted = !!mine && mine.estado !== 'pendiente' && mine.estado !== 'cancelado';

  const cancel = async () => {
    if (busy || !online) return;
    setBusy(true);
    const res = await cancelMyJoinRequest(matchId);
    setBusy(false);
    if (!res?.ok) {
      setFeedback({ tone: 'error', title: 'No pudimos cancelar la solicitud', text: res?.error?.message || '' });
      return;
    }
    goBackOrPartidos(navigation);
  };

  if (loading) {
    return (
      <Shell onBack={() => goBackOrPartidos(navigation)} title="Mi solicitud">
        <LoadingList count={2} />
      </Shell>
    );
  }
  if (!match) {
    return (
      <Shell onBack={() => goBackOrPartidos(navigation)} title="Mi solicitud">
        <ErrorState onRetry={load} detail={loadError?.message} />
      </Shell>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <IconButton icon={ArrowLeft} onPress={() => goBackOrPartidos(navigation)} tone="surface" accessibilityLabel="Volver" />
          <Text style={styles.topTitle}>Mi solicitud</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {feedback ? (
            <Callout
              tone="danger"
              icon={AlertCircle}
              title={feedback.title}
              text={feedback.text}
              onPress={() => setFeedback(null)}
              style={{ marginBottom: 14 }}
            />
          ) : null}

          {/* Encabezado del estado */}
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 14 }}>
            <View style={[styles.bigIcon, accepted ? styles.bigIconOk : styles.bigIconPending]}>
              {accepted ? (
                <CheckCircle2 color={P.green} size={28} strokeWidth={2} />
              ) : (
                <Clock color={P.gold} size={28} strokeWidth={2} />
              )}
            </View>
            <Text style={styles.bigTitle}>
              {accepted ? 'Solicitud aceptada' : pending ? 'Solicitud pendiente' : 'Sin solicitud activa'}
            </Text>
            <Text style={styles.bigText}>
              {accepted
                ? 'El organizador te aceptó: tu cupo está confirmado y el chat quedó abierto.'
                : pending
                ? 'El organizador revisará tu solicitud. Te avisamos en cuanto responda.'
                : 'Esta solicitud ya no existe. Puede que la hayas cancelado o que el organizador la respondiera.'}
            </Text>
          </View>

          {/* Partido */}
          <Card style={{ padding: 14, gap: 11 }}>
            <Text style={styles.matchTitle}>{match.titulo}</Text>
            <Row icon={Calendar}>
              {capitalize(formatFechaLarga(match.hora))} · {timeOf(match.hora)}
            </Row>
            <Row icon={MapPin}>{[match.cancha_nombre, match.comuna].filter(Boolean).join(' · ')}</Row>
            <Divider />
            <View style={styles.rowBetween}>
              <Text style={styles.metaLabel}>Cuota por jugador</Text>
              <Text style={styles.metaValue}>{cuotaLabel(match.precio_cuota)}</Text>
            </View>
            {organizer ? (
              <>
                <Divider />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Avatar url={organizer.foto_url} name={organizer.username} size={32} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.orgName} numberOfLines={1}>
                      @{organizer.username}
                    </Text>
                    <Text style={styles.orgSub}>
                      Organizador · TS {organizer.trust_score ?? 'N.A.'}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => navigation.navigate('UserProfile', { userId: organizer.user_id })}
                    style={({ pressed }) => [styles.smallBtn, pressed && { opacity: 0.8 }]}
                  >
                    <Text style={styles.smallBtnText}>Ver perfil</Text>
                  </Pressable>
                </View>
              </>
            ) : null}
          </Card>

          {/* Timeline */}
          <View style={{ gap: 9, marginTop: 16 }}>
            <SectionLabel>Estado</SectionLabel>
            <Card style={{ padding: 15 }}>
              <Step
                done
                title="Solicitud enviada"
                sub={mine?.inscrito_at ? whenLabel(mine.inscrito_at) : 'Enviada'}
              />
              <Step
                active={pending}
                done={accepted}
                tone={accepted ? 'green' : 'gold'}
                title={accepted ? 'Revisada por el organizador' : 'En revisión del organizador'}
                sub={accepted ? 'Te aceptó en el partido' : 'Tu cupo aún no está reservado'}
              />
              <Step
                done={accepted}
                last
                title="Respuesta"
                sub={accepted ? 'Cupo confirmado' : 'Te llega una notificación'}
              />
            </Card>
          </View>

          {!accepted ? (
            <View style={{ marginTop: 14 }}>
              <Note tone="card" icon={MessageSquareOff}>
                El chat del partido se abre solo cuando tu cupo esté confirmado. Así el grupo queda
                entre quienes van a jugar.
              </Note>
            </View>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: 14 + Math.max(insets.bottom, 8) }]}>
          {accepted ? (
            <View style={{ gap: 9 }}>
              <SurfaceButton
                label="Ver mi cupo"
                onPress={() => navigation.replace('MatchSpot', { matchId })}
                height={52}
              />
            </View>
          ) : pending ? (
            <View style={{ gap: 9 }}>
              <StatusButton label="Solicitud pendiente" tone="gold" />
              <GhostButton
                label="Cancelar solicitud"
                tone="danger"
                onPress={cancel}
                height={46}
                disabled={busy || !online}
              />
              <Note>Cancelar una solicitud no afecta tu Trust Score.</Note>
            </View>
          ) : (
            <GhostButton label="Volver al partido" onPress={() => goBackOrPartidos(navigation)} height={50} />
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function Shell({ onBack, title, children }) {
  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <IconButton icon={ArrowLeft} onPress={onBack} tone="surface" accessibilityLabel="Volver" />
          <Text style={styles.topTitle}>{title}</Text>
        </View>
        <View style={{ paddingHorizontal: 16 }}>{children}</View>
      </SafeAreaView>
    </View>
  );
}

function Step({ title, sub, done, active, tone = 'green', last }) {
  const color = done ? P.green : active ? (tone === 'gold' ? P.gold : P.green) : P.grip;
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={{ alignItems: 'center' }}>
        <View style={[styles.dot, { borderColor: color, backgroundColor: done ? 'rgba(90,224,106,0.18)' : 'transparent' }]}>
          {done || active ? <View style={[styles.dotInner, { backgroundColor: color }]} /> : null}
        </View>
        {!last ? <View style={styles.line} /> : null}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 16 }}>
        <Text style={[styles.stepTitle, { color: done || active ? (active && tone === 'gold' ? P.gold : P.text) : P.textGhost }]}>
          {title}
        </Text>
        <Text style={styles.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

function Row({ icon: Icon, children }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
      <Icon color={P.textMuted} size={15} strokeWidth={2} />
      <Text style={{ flex: 1, fontSize: 12.5, fontWeight: '600', color: P.textSoft }}>{children}</Text>
    </View>
  );
}

function whenLabel(iso) {
  try {
    const d = new Date(iso);
    const today = new Date();
    const same =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const hhmm = d.toTimeString().slice(0, 5);
    return same
      ? `Hoy ${hhmm}`
      : `${d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })} ${hhmm}`;
  } catch {
    return '';
  }
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
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  bigIconPending: { backgroundColor: 'rgba(240,200,90,0.10)', borderColor: P.goldBorder },
  bigIconOk: { backgroundColor: 'rgba(90,224,106,0.13)', borderColor: P.greenBorder },
  bigTitle: { fontSize: 22, fontWeight: '800', color: P.text, letterSpacing: -0.4, textAlign: 'center' },
  bigText: { fontSize: 13, lineHeight: 20, color: P.textMuted, textAlign: 'center' },

  matchTitle: { fontSize: 16, fontWeight: '800', color: P.text },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaLabel: { fontSize: 12, color: P.textMuted },
  metaValue: { fontSize: 14, fontWeight: '800', color: P.green },
  orgName: { fontSize: 12.5, fontWeight: '700', color: P.text },
  orgSub: { fontSize: 11, color: P.textFaint, marginTop: 1 },
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

  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotInner: { width: 7, height: 7, borderRadius: 4 },
  line: { width: 1.5, flex: 1, minHeight: 26, backgroundColor: P.track },
  stepTitle: { fontSize: 12.5, fontWeight: '700' },
  stepSub: { fontSize: 11, color: P.textFaint, marginTop: 1 },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    backgroundColor: P.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: P.hairline,
  },
});
