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
import { goBackOrPartidos } from '../utils/navigation';
import { getCostoSalida, useTrueScoreAjustes } from '../services/trueScore';
import { TEXTO_REGLA_SALIDA_TS, textoCostoSalida } from '../utils/trueScore';
import {
  GPS_RADIUS_METERS,
  cuotaLabel,
  estadoDeMiCupo,
  hasFinished,
  isPenaltyFree,
  leavePenaltyFor,
  leaveRuleText,
  timeUntilLabel,
  textoConfirmacionGps,
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
  // Con TrueScore el costo de salirse lo calcula el servidor.
  const ts = !!useTrueScoreAjustes().fase1;
  const [costoSalida, setCostoSalida] = useState(null);
  useEffect(() => {
    if (!ts || sheet !== 'leave' || !matchId) return undefined;
    let vivo = true;
    setCostoSalida(null);
    getCostoSalida(matchId).then((c) => vivo && setCostoSalida(c));
    return () => {
      vivo = false;
    };
  }, [ts, sheet, matchId]);

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

  // Un reloj propio: la ventana del GPS se abre media hora antes de empezar y
  // la pantalla puede llevar rato abierta.
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  // Quién es en este partido: sin esto la pantalla saludaba con «Cupo
  // confirmado» a cualquiera que abriera la dirección.
  const miCupo = useMemo(() => estadoDeMiCupo({ match, mine, ahora }), [match, mine, ahora]);
  const gpsPending = !!miCupo?.puedeConfirmarGps;

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
    goBackOrPartidos(navigation);
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
    const dicho = textoConfirmacionGps(res);
    setFeedback({ tone: 'success', title: dicho.titulo, text: dicho.detalle });
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
      <Shell onBack={() => goBackOrPartidos(navigation)}>
        <LoadingList count={2} />
      </Shell>
    );
  }
  if (!match) {
    return (
      <Shell onBack={() => goBackOrPartidos(navigation)}>
        <ErrorState onRetry={load} detail={loadError?.message} />
      </Shell>
    );
  }

  const canceled = match.estado === 'cancelado';
  const finished = hasFinished(match);
  const sinCupo = miCupo?.code === 'sin_cupo' || miCupo?.code === 'pendiente';

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.topBar}>
          <IconButton icon={ArrowLeft} onPress={() => goBackOrPartidos(navigation)} tone="surface" accessibilityLabel="Volver" />
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

          {canceled && !sinCupo ? (
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
            <View style={[styles.bigIcon, sinCupo && styles.bigIconMuted]}>
              {sinCupo ? (
                <AlertCircle color={C.textSecondary} size={28} strokeWidth={2} />
              ) : (
                <CheckCircle2 color={C.green} size={28} strokeWidth={2} />
              )}
            </View>
            <Text style={styles.bigTitle}>{miCupo?.titulo}</Text>
            <Text style={styles.bigText}>{miCupo?.texto}</Text>
            {sinCupo ? (
              <SurfaceButton
                label="Ver el partido"
                onPress={() => navigation.navigate('MatchDetail', { matchId })}
                height={46}
              />
            ) : null}
          </View>

          {/* Datos del partido */}
          <Card style={{ padding: 14, gap: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.matchTitle, { flex: 1 }]} numberOfLines={2}>
                {match.titulo}
              </Text>
              {sinCupo ? null : (
                <Tag
                  label={mine?.estado === 'confirmado_gps' ? 'Asistencia OK' : 'Confirmado'}
                  tone="green"
                />
              )}
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
            <SectionLabel right={`${squad.length} en el plantel`}>
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
          {miCupo?.puedeChat ? (
            <PrimaryButton
              label="Abrir chat del partido"
              icon={MessageSquare}
              onPress={openChat}
              height={52}
            />
          ) : null}
          {miCupo?.puedeSalir ? (
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
              <Note>{ts ? TEXTO_REGLA_SALIDA_TS : leaveRuleText(match.hora)}</Note>
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
              label={
                ts
                  ? costoSalida?.ok
                    ? `Salir del partido (−${costoSalida.puntos} pts)`
                    : 'Salir del partido'
                  : `Salir del partido (−${leavePenaltyFor(match.hora)} pts)`
              }
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
            tone={ts || !isPenaltyFree(match.hora) ? 'danger' : 'gold'}
            text={
              ts
                ? textoCostoSalida(costoSalida) || 'Calculando lo que te cuesta salir ahora…'
                : `Tu Trust Score baja ${leavePenaltyFor(match.hora)} ${leavePenaltyFor(match.hora) === 1 ? 'punto' : 'puntos'}`
            }
          />
          <Bullet text="Tu cupo se libera y vuelve a aparecer en Partidos" />
          <Bullet text="Avisamos al grupo y al primero de la lista de espera" />
          <Bullet text="Pierdes el acceso al chat del partido" />
        </Card>
        <View style={{ marginTop: 12 }}>
          <Note tone="card" icon={Clock}>
            {ts ? TEXTO_REGLA_SALIDA_TS : leaveRuleText(match.hora)}
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
      <Icon color={strong ? C.green : C.textSecondary} size={15} strokeWidth={2} />
      <Text
        style={{
          flex: 1,
          fontSize: strong ? 13 : 12.5,
          fontFamily: strong ? F.bold : F.medium,
          color: strong ? C.textPrimary : C.textDim,
        }}
      >
        {children}
      </Text>
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
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 24 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  topTitle: { fontSize: 15, fontFamily: F.bold, color: C.textPrimary },

  bigIcon: {
    width: 66,
    height: 66,
    borderRadius: 22,
    backgroundColor: alfa(C.green, 0.13),
    borderWidth: 1,
    borderColor: C.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigIconMuted: {
    backgroundColor: alfa(C.tinta, 0.05),
    borderColor: alfa(C.tinta, 0.10),
  },
  bigTitle: { fontSize: 22, fontFamily: F.extraBold, color: C.textPrimary, letterSpacing: -0.4 },
  bigText: { fontSize: 13, lineHeight: 20, color: C.textSecondary, textAlign: 'center' },

  matchTitle: { fontSize: 16, fontFamily: F.extraBold, color: C.textPrimary },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  metaLabel: { fontSize: 12, color: C.textSecondary },
  metaValue: { fontSize: 15, fontFamily: F.extraBold, color: C.green },
  link: { fontSize: 12, fontFamily: F.bold, color: C.green },

  ghostAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: C.chipAlt,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: C.dashed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostAvatarText: { fontSize: 10, fontFamily: F.bold, color: C.textGhost },

  footer: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 9,
    backgroundColor: C.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: C.hairline,
  },
  sheetBack: { fontSize: 13.5, fontFamily: F.bold, color: C.textSecondary },
});
