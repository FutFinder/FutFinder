import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Bell, BellOff, Info } from 'lucide-react-native';

import ThreadAvatar from '../components/chat/ThreadAvatar';
import PersonRow from '../components/chat/PersonRow';
import { chatColors, dsSizes } from '../theme/colors';
import {
  parseThreadKey,
  getThreadParticipants,
  isThreadMuted,
  setThreadMuted,
  getThreadAccess,
} from '../services/messages';
import { getClubById } from '../services/clubs';
import { getMatchById } from '../services/matches';
import { notify } from '../utils/notify';
import { playerLine } from '../utils/chatMeta';

const PREVIEW_COUNT = 6;

/**
 * «Detalles del chat»: identidad de la conversación, notificaciones y
 * participantes con su rol.
 *
 * Regla confirmada del producto: del chat del club NO se puede salir sin
 * abandonar el club. La única acción disponible es silenciarlo, y los avisos
 * marcados con /importante igual llegan. Por eso aquí no hay «salir del chat».
 *
 * No se muestran acciones administrativas (expulsar, cambiar rol): esas viven
 * en la pantalla del club, donde la RLS ya las controla.
 */
export default function ChatDetailsScreen({ route, navigation }) {
  const threadKey = route?.params?.threadKey;
  const paramTitle = route?.params?.title || 'Conversación';
  const fotoUrl = route?.params?.fotoUrl || null;

  const t = useMemo(() => parseThreadKey(threadKey), [threadKey]);

  const [loading, setLoading] = useState(true);
  const [participants, setParticipants] = useState([]);
  const [muted, setMuted] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  const [entity, setEntity] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [denied, setDenied] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const access = await getThreadAccess(threadKey);
      if (!alive) return;
      if (!access.canRead) {
        setDenied(access);
        setLoading(false);
        return;
      }

      const [people, mutedNow, extra] = await Promise.all([
        getThreadParticipants(threadKey),
        isThreadMuted(threadKey),
        t?.type === 'club'
          ? getClubById(t.id).then((r) => ({ kind: 'club', data: r.data }))
          : t?.type === 'match'
          ? getMatchById(t.id).then((r) => ({ kind: 'match', data: r.data }))
          : Promise.resolve(null),
      ]);
      if (!alive) return;

      setParticipants(people.data || []);
      setMuted(mutedNow);
      setEntity(extra);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [threadKey, t?.type, t?.id]);

  const toggleMute = useCallback(async () => {
    if (muteBusy) return;
    const next = !muted;
    setMuteBusy(true);
    setMuted(next);
    const { error } = await setThreadMuted(threadKey, next);
    setMuteBusy(false);
    if (error) {
      setMuted(!next);
      notify('No pudimos cambiar el silencio', error.message || 'Intenta de nuevo');
    }
  }, [muted, muteBusy, threadKey]);

  const subtitle = useMemo(() => {
    const n = participants.length;
    if (t?.type === 'club') {
      return `Chat del club · ${n} ${n === 1 ? 'jugador' : 'jugadores'}`;
    }
    if (t?.type === 'match') {
      return `Chat del partido · ${n} ${n === 1 ? 'inscrito' : 'inscritos'}`;
    }
    return 'Mensaje directo';
  }, [t?.type, participants.length]);

  const shown = expanded ? participants : participants.slice(0, PREVIEW_COUNT);

  /**
   * Etiqueta de la fila. El rol manda sobre el «TÚ» cuando el usuario es
   * admin u organizador: perder esa información sería peor que no marcar que
   * la fila es la suya, y el «· tú» va en la línea secundaria.
   */
  const roleBadge = (p) => {
    if (p.role === 'admin') return { label: 'ADMIN', accent: true };
    if (p.role === 'organizador') return { label: 'ORGANIZADOR', accent: true };
    if (p.is_me) return { label: 'TÚ' };
    return null;
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          >
            <ArrowLeft color={chatColors.textPrimary} size={22} strokeWidth={2.1} />
          </Pressable>
          <Text style={styles.headerTitle} accessibilityRole="header">
            Detalles del chat
          </Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={chatColors.green} />
          </View>
        ) : denied ? (
          <View style={styles.loading}>
            <Text style={styles.deniedTitle}>{denied.title}</Text>
            {!!denied.message && <Text style={styles.deniedText}>{denied.message}</Text>}
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {/* Identidad */}
            <LinearGradient
              colors={['rgba(90,224,106,0.14)', 'rgba(90,224,106,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 0.75, y: 1 }}
              style={styles.identity}
            >
              <ThreadAvatar
                type={t?.type}
                fotoUrl={fotoUrl || entity?.data?.foto_url}
                name={paramTitle}
                size={56}
                radius={18}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.identityTitle} numberOfLines={2}>
                  {entity?.data?.nombre || entity?.data?.titulo || paramTitle}
                </Text>
                <Text style={styles.identitySub}>{subtitle}</Text>
              </View>
            </LinearGradient>

            {/* Notificaciones */}
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}>
                {muted ? (
                  <BellOff color="rgba(255,255,255,0.75)" size={19} strokeWidth={1.8} />
                ) : (
                  <Bell color="rgba(255,255,255,0.75)" size={19} strokeWidth={1.8} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingTitle}>Notificaciones</Text>
                  <Text style={styles.settingHint}>
                    {muted
                      ? 'Silenciado hasta que lo reactives'
                      : 'Recibes aviso de los mensajes nuevos'}
                  </Text>
                </View>
              </View>
              {/* Interruptor propio en vez de <Switch>: el nativo se pinta
                  distinto en iOS, Android y web, y el diseño define un
                  tamaño y unos colores concretos. */}
              <Pressable
                onPress={toggleMute}
                disabled={muteBusy}
                accessibilityRole="switch"
                accessibilityState={{ checked: !muted, disabled: muteBusy }}
                accessibilityLabel={
                  muted ? 'Activar notificaciones' : 'Silenciar esta conversación'
                }
                hitSlop={10}
                style={({ pressed }) => [
                  styles.toggle,
                  !muted && styles.toggleOn,
                  muteBusy && { opacity: 0.5 },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <View style={[styles.knob, !muted && styles.knobOn]} />
              </Pressable>
            </View>

            {/* Participantes */}
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>
                PARTICIPANTES · {participants.length}
              </Text>
              {participants.length > PREVIEW_COUNT && (
                <Pressable
                  onPress={() => setExpanded((v) => !v)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={
                    expanded ? 'Ver menos participantes' : 'Ver todos los participantes'
                  }
                >
                  <Text style={styles.sectionAction}>
                    {expanded ? 'Ver menos' : 'Ver todos'}
                  </Text>
                </Pressable>
              )}
            </View>

            <View style={{ gap: 7 }}>
              {shown.map((p) => (
                <PersonRow
                  key={p.user_id}
                  profile={p}
                  badge={roleBadge(p)}
                  line={p.is_me ? `${playerLine(p)} · tú` : undefined}
                  highlight={p.role === 'admin' || p.role === 'organizador'}
                  onPress={
                    p.is_me
                      ? undefined
                      : () => navigation.navigate('UserProfile', { userId: p.user_id })
                  }
                />
              ))}
            </View>

            {/* Regla del chat del club */}
            {t?.type === 'club' && (
              <View style={styles.note}>
                <Info color="rgba(255,255,255,0.5)" size={17} strokeWidth={1.8} />
                <Text style={styles.noteText}>
                  No puedes salir del chat del club sin abandonar el club. Puedes
                  silenciarlo: los avisos marcados con{' '}
                  <Text style={styles.noteAccent}>/importante</Text> te seguirán llegando.
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chatColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 6,
    paddingRight: dsSizes.gutter,
    paddingTop: 4,
    paddingBottom: 10,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: chatColors.textPrimary, fontSize: 17, fontWeight: '800' },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 30 },
  deniedTitle: { color: chatColors.textPrimary, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  deniedText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },

  body: { paddingHorizontal: dsSizes.gutter, paddingBottom: 40, gap: 12 },

  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    padding: 16,
    borderRadius: 22,
    backgroundColor: chatColors.cardClub,
    borderWidth: 1,
    borderColor: chatColors.cardBorderClub,
  },
  identityTitle: { color: chatColors.textPrimary, fontSize: 18, fontWeight: '800' },
  identitySub: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12.5,
    fontWeight: '600',
  },

  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    minHeight: 64,
    borderRadius: 20,
    backgroundColor: chatColors.card,
    borderWidth: 1,
    borderColor: chatColors.cardBorder,
  },
  settingLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  toggle: {
    width: 46,
    height: 27,
    borderRadius: 14,
    padding: 3,
    backgroundColor: chatColors.sendIdle,
    borderWidth: 1,
    borderColor: chatColors.border,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: 'rgba(90,224,106,0.22)',
    borderColor: 'rgba(90,224,106,0.45)',
    alignItems: 'flex-end',
  },
  knob: {
    width: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  knobOn: { backgroundColor: chatColors.green },
  settingTitle: { color: chatColors.textPrimary, fontSize: 14, fontWeight: '700' },
  settingHint: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11.5,
    fontWeight: '500',
  },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  sectionAction: { color: chatColors.green, fontSize: 11.5, fontWeight: '800' },

  note: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
    padding: 14,
    borderRadius: 18,
    backgroundColor: chatColors.card,
    borderWidth: 1,
    borderColor: chatColors.bubbleTheirsBorder,
  },
  noteText: {
    flex: 1,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11.5,
    lineHeight: 18,
    fontWeight: '500',
  },
  noteAccent: { color: chatColors.green, fontWeight: '800' },
});
