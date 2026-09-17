import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  PanResponder,
  Dimensions,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  MapPin,
  Clock,
  Users,
  ShieldCheck,
  ArrowRight,
  Banknote,
  Trophy,
} from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../theme/colors';
import MatchMap from './MatchMap';
import { getMatchById, getMatchAttendees } from '../services/matches';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_H = Math.round(SCREEN_H * 0.88);

// ── Helpers ──────────────────────────────────────────────────────────────────

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
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
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
    { recreativo: 'Recreativo', intermedio: 'Intermedio', competitivo: 'Competitivo' }[n] || n || '—'
  );
}

function Avatar({ uri, name, size = 38 }) {
  const initial = (name || '?')[0].toUpperCase();
  return (
    <View style={[avStyles.wrap, { width: size, height: size, borderRadius: size / 2 }]}>
      {uri ? (
        <Image source={{ uri }} style={avStyles.img} />
      ) : (
        <Text style={[avStyles.initial, { fontSize: size * 0.38 }]}>{initial}</Text>
      )}
    </View>
  );
}
const avStyles = StyleSheet.create({
  wrap: { backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  img: { width: '100%', height: '100%' },
  initial: { color: C.green, fontFamily: F.extraBold },
});

function MetaRow({ icon, label, value }) {
  return (
    <View style={metaS.row}>
      <View style={metaS.iconWrap}>{icon}</View>
      <View>
        <Text style={metaS.label}>{label}</Text>
        <Text style={metaS.value}>{value}</Text>
      </View>
    </View>
  );
}
const metaS = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  iconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: C.greenSoft,
    alignItems: 'center', justifyContent: 'center',
  },
  label: { color: C.textMuted, fontSize: 11, fontFamily: F.semiBold, marginBottom: 1 },
  value: { color: C.textPrimary, fontSize: 13, fontFamily: F.bold },
});

// ── Main component ────────────────────────────────────────────────────────────

export default function MatchPreviewSheet({
  matchId,
  myUserId,
  onClose,
  onJoin,
  onNavigateToDetail,
  busyMatchId,
}) {
  const [match, setMatch] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [loading, setLoading] = useState(false);

  const slideY = useRef(new Animated.Value(SHEET_H)).current;

  // Refs to avoid stale closures inside PanResponder
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const doCloseRef = useRef(null);

  // Load data when sheet opens
  useEffect(() => {
    if (!matchId) {
      setMatch(null);
      setAttendees([]);
      return;
    }
    setLoading(true);
    setMatch(null);
    setAttendees([]);
    Promise.all([getMatchById(matchId), getMatchAttendees(matchId)])
      .then(([{ data: m }, { data: atts }]) => {
        setMatch(m || null);
        setAttendees(atts || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [matchId]);

  // Slide-up animation when matchId appears
  useEffect(() => {
    if (matchId) {
      slideY.setValue(SHEET_H);
      Animated.spring(slideY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 58,
        friction: 12,
      }).start();
    }
  }, [matchId, slideY]);

  const doClose = useCallback(() => {
    Animated.timing(slideY, {
      toValue: SHEET_H,
      duration: 260,
      useNativeDriver: true,
    }).start(() => onCloseRef.current?.());
  }, [slideY]);
  doCloseRef.current = doClose;

  // PanResponder — only mounted on the handle bar to avoid ScrollView conflicts
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) slideY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 90 || g.vy > 0.5) {
          doCloseRef.current();
        } else {
          Animated.spring(slideY, {
            toValue: 0,
            useNativeDriver: true,
            tension: 58,
            friction: 12,
          }).start();
        }
      },
    })
  ).current;

  // Derived state
  const isMine = !!(myUserId && match?.id_organizador === myUserId);
  const isAnotado = attendees.some(
    (a) => a.user_id === myUserId && ['inscrito', 'confirmado_gps'].includes(a.estado)
  );
  const isFull = (match?.cupos_disponibles ?? 1) === 0;
  const isBusy = busyMatchId === matchId;
  const organizer = attendees.find((a) => a.is_organizer);

  const handleJoinPress = () => {
    doClose();
    onJoin(matchId);
  };

  const handleDetailPress = () => {
    doClose();
    // Small delay so close animation doesn't clash with navigation
    setTimeout(() => onNavigateToDetail(matchId), 280);
  };

  if (!matchId) return null;

  return (
    <Modal
      visible={!!matchId}
      transparent
      animationType="none"
      onRequestClose={doClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        {/* Backdrop — tapping above sheet closes it */}
        <Pressable style={StyleSheet.absoluteFill} onPress={doClose} />

        {/* Sheet */}
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY: slideY }] }]}
          onStartShouldSetResponder={() => true}
        >
          {/* Draggable handle */}
          <View style={styles.handleArea} {...panResponder.panHandlers}>
            <View style={styles.handle} />
          </View>

          {/* Scrollable body */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={C.green} size="large" />
                <Text style={styles.loadingText}>Cargando partido…</Text>
              </View>
            ) : !match ? (
              <View style={styles.loadingBox}>
                <Text style={styles.loadingText}>No se pudo cargar el partido.</Text>
              </View>
            ) : (
              <>
                {/* Cover photo */}
                {match.foto_url ? (
                  <Image
                    source={{ uri: match.foto_url }}
                    style={styles.cover}
                    resizeMode="cover"
                  />
                ) : null}

                {/* Title row */}
                <View style={styles.titleRow}>
                  <Text style={styles.title} numberOfLines={3}>
                    {match.titulo}
                  </Text>
                  <Pressable
                    onPress={doClose}
                    hitSlop={12}
                    style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
                  >
                    <X color={C.textSecondary} size={18} />
                  </Pressable>
                </View>

                {/* Organizer card */}
                {organizer ? (
                  <View style={styles.organizerCard}>
                    <Avatar uri={organizer.foto_url} name={organizer.username} size={44} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.organizerName}>@{organizer.username}</Text>
                      <Text style={styles.organizerSub}>Organizador</Text>
                    </View>
                    <View style={styles.trustPill}>
                      <ShieldCheck color={C.green} size={12} />
                      <Text style={styles.trustPillText}>{organizer.trust_score}</Text>
                    </View>
                  </View>
                ) : null}

                <View style={styles.sep} />

                {/* Meta info */}
                <MetaRow
                  icon={<Clock color={C.green} size={16} />}
                  label="Fecha y hora"
                  value={formatHora(match.hora)}
                />
                <MetaRow
                  icon={<Users color={C.green} size={16} />}
                  label="Cupos disponibles"
                  value={`${match.cupos_disponibles ?? 0} de ${match.cupos_totales ?? 0} libres`}
                />
                <MetaRow
                  icon={<Trophy color={C.green} size={16} />}
                  label="Nivel"
                  value={nivelLabel(match.nivel)}
                />
                <MetaRow
                  icon={<Banknote color={C.green} size={16} />}
                  label="Precio de entrada"
                  value={
                    match.precio_cuota === 0
                      ? 'Gratis'
                      : `$${(match.precio_cuota ?? 0).toLocaleString('es-CL')}`
                  }
                />

                <View style={styles.sep} />

                {/* Location */}
                <Text style={styles.sectionLabel}>Ubicación</Text>
                <View style={styles.locationRow}>
                  <MapPin color={C.green} size={15} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text style={styles.locationVenue}>{match.cancha_nombre}</Text>
                    <Text style={styles.locationComuna}>
                      {[match.comuna, match.region].filter(Boolean).join(', ')}
                    </Text>
                    {match.direccion ? (
                      <Text style={styles.locationAddr}>{match.direccion}</Text>
                    ) : null}
                  </View>
                </View>

                {/* Mini map — native only, returns null on web via MatchMap.web.js */}
                {Platform.OS !== 'web' && match.latitud && match.longitud ? (
                  <View style={styles.miniMapWrap}>
                    <MatchMap
                      initialRegion={{
                        latitude: Number(match.latitud),
                        longitude: Number(match.longitud),
                        latitudeDelta: 0.004,
                        longitudeDelta: 0.004,
                      }}
                      matches={[
                        {
                          id: match.id,
                          latitud: Number(match.latitud),
                          longitud: Number(match.longitud),
                          titulo: match.titulo,
                        },
                      ]}
                      selectedId={match.id}
                    />
                  </View>
                ) : null}

                {/* Description */}
                {match.descripcion ? (
                  <>
                    <View style={styles.sep} />
                    <Text style={styles.sectionLabel}>Descripción</Text>
                    <Text style={styles.descripcion}>{match.descripcion}</Text>
                  </>
                ) : null}

                {/* Attendees list */}
                {attendees.length > 0 ? (
                  <>
                    <View style={styles.sep} />
                    <Text style={styles.sectionLabel}>
                      Jugadores anotados ({attendees.length})
                    </Text>
                    {attendees.map((a) => (
                      <View key={a.user_id} style={styles.playerRow}>
                        <Avatar uri={a.foto_url} name={a.username} size={36} />
                        <View style={styles.playerInfo}>
                          <Text style={styles.playerName}>
                            @{a.username}
                            {a.is_organizer ? (
                              <Text style={styles.organizerBadge}> · Org.</Text>
                            ) : null}
                          </Text>
                          <Text style={styles.playerPos}>
                            {a.posicion_preferida?.filter((p) => p !== 'sin_definir').join(', ') || 'Sin posición'}
                          </Text>
                        </View>
                        <View style={styles.playerTrustPill}>
                          <ShieldCheck color={C.green} size={10} />
                          <Text style={styles.playerTrustText}>{a.trust_score}</Text>
                        </View>
                      </View>
                    ))}
                  </>
                ) : null}

                <View style={{ height: 20 }} />
              </>
            )}
          </ScrollView>

          {/* Sticky action bar */}
          {match ? (
            <SafeAreaView edges={['bottom']} style={styles.actionsBar}>
              {!isMine ? (
                <Pressable
                  onPress={handleJoinPress}
                  disabled={isBusy || isAnotado || isFull}
                  style={({ pressed }) => [
                    styles.joinBtn,
                    isAnotado && styles.joinBtnDone,
                    isFull && !isAnotado && styles.joinBtnFull,
                    (isBusy || isAnotado || isFull) && { opacity: 0.65 },
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.joinLabel, (isAnotado || isFull) && styles.joinLabelMuted]}>
                    {isBusy
                      ? 'Procesando…'
                      : isAnotado
                      ? '✓  Ya estás anotado'
                      : isFull
                      ? 'Partido lleno'
                      : match.aprobacion === 'manual'
                      ? 'Solicitar entrada'
                      : 'Unirme al partido'}
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={handleDetailPress}
                style={({ pressed }) => [styles.detailBtn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.detailLabel}>Ver partido completo</Text>
                <ArrowRight color={C.green} size={14} />
              </Pressable>
            </SafeAreaView>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    height: SHEET_H,
    backgroundColor: C.bg,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 -12px 40px rgba(0,0,0,0.6)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.5,
        shadowOffset: { width: 0, height: -6 },
        shadowRadius: 20,
        elevation: 24,
      },
    }),
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: C.bg,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: C.border,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  loadingBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12,
  },
  loadingText: {
    color: C.textSecondary,
    fontSize: 14,
  },

  // Cover
  cover: {
    width: '100%',
    height: 180,
    borderRadius: R.cardSm,
    marginBottom: 16,
  },

  // Title
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 16,
  },
  title: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 20,
    fontFamily: F.extraBold,
    letterSpacing: -0.4,
    lineHeight: 26,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },

  // Organizer
  organizerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    borderRadius: R.row,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  organizerName: {
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: F.bold,
  },
  organizerSub: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  trustPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: C.green,
  },
  trustPillText: {
    color: C.green,
    fontSize: 12,
    fontFamily: F.extraBold,
  },

  // Separator
  sep: {
    height: 1,
    backgroundColor: C.borderSoft,
    marginVertical: 16,
  },

  // Location
  sectionLabel: {
    color: C.textSecondary,
    fontSize: 12,
    fontFamily: F.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  locationVenue: {
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: F.bold,
  },
  locationComuna: {
    color: C.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  locationAddr: {
    color: C.textMuted,
    fontSize: 12,
    marginTop: 3,
  },

  // Mini map
  miniMapWrap: {
    height: 140,
    borderRadius: R.row,
    overflow: 'hidden',
    marginBottom: 4,
    borderWidth: 1,
    borderColor: C.borderSoft,
  },

  // Description
  descripcion: {
    color: C.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },

  // Players list
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
    gap: 10,
  },
  playerInfo: { flex: 1 },
  playerName: {
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.bold,
  },
  organizerBadge: {
    color: C.green,
    fontFamily: F.semiBold,
  },
  playerPos: {
    color: C.textMuted,
    fontSize: 11,
    marginTop: 2,
    textTransform: 'capitalize',
  },
  playerTrustPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.greenSoft,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: R.pill,
  },
  playerTrustText: {
    color: C.green,
    fontSize: 11,
    fontFamily: F.extraBold,
  },

  // Action bar
  actionsBar: {
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: C.bg,
    gap: 8,
  },
  joinBtn: {
    backgroundColor: C.green,
    borderRadius: R.row,
    paddingVertical: 14,
    alignItems: 'center',
  },
  joinBtnDone: {
    backgroundColor: C.greenSoft,
    borderWidth: 1,
    borderColor: C.green,
  },
  joinBtnFull: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
  },
  joinLabel: {
    color: '#0E0E0D',
    fontSize: 15,
    fontFamily: F.extraBold,
    letterSpacing: 0.2,
  },
  joinLabelMuted: {
    color: C.textSecondary,
  },
  detailBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  detailLabel: {
    color: C.green,
    fontSize: 14,
    fontFamily: F.bold,
  },
});
