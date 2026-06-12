import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Image,
  Modal,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  MapPin,
  Clock,
  Users,
  DollarSign,
  BarChart3,
  User as UserIcon,
  Crown,
  CheckCircle2,
  Edit3,
  Trash2,
  LogOut,
  ShieldCheck,
  Send,
  Star,
  Check,
  X,
  Clock as ClockIcon,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Banner from '../components/Banner';
import { colors, radius } from '../theme/colors';
import {
  getMatchAttendees,
  deleteMatch,
  leaveMatch,
  joinMatch,
  requestJoinMatch,
  approveJoinRequest,
  rejectJoinRequest,
  getScheduleConflict,
  swapMatch,
  cancelMatchAndJoin,
  leaveMatchPenalized,
  cancelMatch,
} from '../services/matches';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { getCurrentUser } from '../services/auth';
import { isSupabaseConfigured } from '../services/supabase';

function fmtHora(iso) {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    if (sameDay) return `Hoy · ${hh}:${mm}`;
    return d.toLocaleDateString('es-CL', {
      weekday: 'short', day: '2-digit', month: 'short',
    }) + ` · ${hh}:${mm}`;
  } catch {
    return iso;
  }
}

function nivelLabel(n) {
  return ({ recreativo: 'Recreativo', intermedio: 'Intermedio', competitivo: 'Competitivo' })[n] || n;
}

export default function MatchDetailScreen({ route, navigation }) {
  const matchId = route?.params?.matchId;

  const [match, setMatch] = useState(null);
  const [attendees, setAttendees] = useState([]);
  const [myId, setMyId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(null);
  const [photoViewer, setPhotoViewer] = useState(false);
  const [conflict, setConflict] = useState(null);

  const load = useCallback(async () => {
    const [{ data, match: m }, user, conf] = await Promise.all([
      getMatchAttendees(matchId),
      getCurrentUser(),
      getScheduleConflict(matchId),
    ]);
    setMatch(m || null);
    setAttendees(data || []);
    setMyId(user?.id || null);
    setConflict(conf?.conflict ? conf : null);
    setLoading(false);
    setRefreshing(false);
  }, [matchId]);

  useEffect(() => {
    load();
    const unsub = navigation.addListener('focus', load);
    return unsub;
  }, [load, navigation]);

  const showBanner = (type, title, message = '') => {
    setBanner({ type, title, message });
    if (type === 'success') setTimeout(() => setBanner(null), 4000);
  };

  const iAmOrganizer = match && myId && match.id_organizador === myId;
  // "Attendee" cuenta solo a los aceptados (inscrito/confirmado), no a los pendientes
  const iAmAttendee = attendees.some(
    (a) => a.user_id === myId && a.estado !== 'pendiente'
  );

  // Aprobación manual
  const isManual = match?.aprobacion === 'manual';
  const myAtt = attendees.find((a) => a.user_id === myId);
  const iAmPending = myAtt?.estado === 'pendiente';
  const pendingRequests = attendees.filter((a) => a.estado === 'pendiente');
  const confirmedAttendees = attendees.filter((a) => a.estado !== 'pendiente');

  // Calificación post-partido:
  //  - tengo que haber confirmado por GPS
  //  - el partido tiene que haber terminado (hora + duración real)
  const myAttendance = attendees.find((a) => a.user_id === myId);
  const iAmConfirmedGps = myAttendance?.estado === 'confirmado_gps';
  const matchHasPassed =
    match?.hora &&
    Date.now() >=
      new Date(match.hora).getTime() + (match.duracion_min ?? 90) * 60 * 1000;
  const canRateMatch = iAmConfirmedGps && matchHasPassed;

  const handleEdit = () => {
    navigation.navigate('CreateMatch', { matchId });
  };

  // Modal de confirmación cross-platform (web → confirm, nativo → Alert destructivo)
  const confirmAction = (title, msg, confirmLabel) => {
    if (Platform.OS === 'web') {
      return Promise.resolve(
        typeof window !== 'undefined' && window.confirm ? window.confirm(msg) : false
      );
    }
    return new Promise((resolve) => {
      Alert.alert(title, msg, [
        { text: 'Volver', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ]);
    });
  };

  const moreThan2h = () =>
    match?.hora && new Date(match.hora).getTime() - Date.now() > 2 * 60 * 60 * 1000;

  // Anfitrión cancela el partido
  const handleDelete = async () => {
    const early = moreThan2h();
    const pts = early ? 15 : 25;
    const msg = early
      ? `Si cancelas, el partido se borrará para todos los inscritos y perderás ${pts} puntos de Trust Score. ¿Continuar?`
      : `Estás cancelando con menos de 2 horas de anticipación. El partido se borrará para todos y perderás ${pts} puntos de Trust Score. ¿Continuar?`;
    const ok = await confirmAction('Cancelar partido', msg, `Cancelar partido (-${pts} pts)`);
    if (!ok) return;
    setBusy(true);
    const res = await cancelMatch(matchId);
    setBusy(false);
    if (!res?.ok) {
      showBanner('error', 'No pude cancelar', res?.reason || res?.error?.message || '');
      return;
    }
    showBanner('success', 'Partido cancelado', `Se avisó a los inscritos. (-${res.penalty ?? pts} Trust Score)`);
    setTimeout(() => navigation.navigate('Main', { screen: 'HomeTab' }), 800);
  };

  // Jugador sale del partido
  const handleLeave = async () => {
    const early = moreThan2h();
    const pts = early ? 3 : 20;
    const msg = early
      ? `Si sales de este partido perderás ${pts} puntos de Trust Score y liberarás tu cupo. ¿Seguro que quieres salir?`
      : `Falta menos de 2 horas para el partido. Si sales ahora perderás ${pts} puntos de Trust Score. ¿Seguro que quieres salir?`;
    const ok = await confirmAction('Salir del partido', msg, `Salir (-${pts} pts)`);
    if (!ok) return;
    setBusy(true);
    const res = await leaveMatchPenalized(matchId);
    setBusy(false);
    if (!res?.ok) {
      showBanner('error', 'No pude salirme', res?.reason || res?.error?.message || '');
      return;
    }
    showBanner('success', 'Te saliste del partido', `Se liberó tu cupo. (-${res.penalty ?? pts} Trust Score)`);
    setTimeout(() => navigation.goBack(), 800);
  };

  const handleJoin = async () => {
    setBusy(true);
    const result = await joinMatch(matchId);
    setBusy(false);
    if (!result?.ok) {
      showBanner('error', 'No pudimos inscribirte', result?.reason || '');
      return;
    }
    showBanner('success', '¡Te inscribiste!', 'Aprieta Confirmar GPS al llegar a la cancha.');
    load();
  };

  const handleRequestJoin = async () => {
    setBusy(true);
    const result = await requestJoinMatch(matchId);
    setBusy(false);
    if (!result?.ok) {
      showBanner('error', 'No pudimos enviar tu solicitud', result?.reason || result?.error?.message || '');
      return;
    }
    showBanner('success', 'Solicitud enviada', 'El anfitrión recibirá tu solicitud y decidirá si te acepta.');
    load();
  };

  const handleApprove = async (playerId) => {
    setBusy(true);
    const result = await approveJoinRequest(matchId, playerId);
    setBusy(false);
    if (!result?.ok) {
      showBanner('error', 'No pude aprobar', result?.reason || result?.error?.message || '');
      return;
    }
    showBanner('success', 'Jugador aceptado', 'Se sumó al partido y se le notificó.');
    load();
  };

  const handleReject = async (playerId) => {
    setBusy(true);
    const result = await rejectJoinRequest(matchId, playerId);
    setBusy(false);
    if (!result?.ok) {
      showBanner('error', 'No pude rechazar', result?.reason || result?.error?.message || '');
      return;
    }
    showBanner('info', 'Solicitud rechazada', '');
    load();
  };

  const confirmSwap = (title) => {
    const msg = `Ya estás inscrito en un partido a esta hora. ¿Quieres salirte del partido "${title}" para unirte a este?`;
    if (Platform.OS === 'web') {
      return Promise.resolve(
        typeof window !== 'undefined' && window.confirm ? window.confirm(msg) : true
      );
    }
    return new Promise((resolve) => {
      Alert.alert('Cambiar de partido', msg, [
        { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Sí, cambiarme', onPress: () => resolve(true) },
      ]);
    });
  };

  const handleConflictJoin = async () => {
    if (!conflict) return;
    const ok = await confirmSwap(conflict.titulo);
    if (!ok) return;
    setBusy(true);
    const res = await swapMatch(conflict.matchId, matchId);
    setBusy(false);
    if (!res?.ok) {
      showBanner('error', 'No pude cambiarte', res?.reason || res?.error?.message || '');
      return;
    }
    if (res.pending) {
      showBanner('success', 'Solicitud enviada', 'Saliste del partido anterior. El anfitrión debe aceptarte.');
    } else {
      showBanner('success', 'Te cambiaste de partido', 'Saliste del anterior y entraste a este.');
    }
    load();
  };

  const confirmHostCancel = () => {
    const msg =
      'No puedes unirte a otro partido a esta hora sin cerrar el tuyo primero. Si decides abandonar tu partido ahora, este se cancelará por completo, y penalizaremos tu Trust Score con -25 puntos.';
    if (Platform.OS === 'web') {
      return Promise.resolve(
        typeof window !== 'undefined' && window.confirm ? window.confirm(msg) : false
      );
    }
    return new Promise((resolve) => {
      Alert.alert('Cancelar tu partido', msg, [
        { text: 'Volver', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Cancelar Partido y Salir (-25 pts)',
          style: 'destructive',
          onPress: () => resolve(true),
        },
      ]);
    });
  };

  const handleHostConflict = async () => {
    if (!conflict) return;
    const ok = await confirmHostCancel();
    if (!ok) return;
    setBusy(true);
    const res = await cancelMatchAndJoin(conflict.matchId, matchId);
    setBusy(false);
    if (!res?.ok) {
      showBanner('error', 'No pude procesar el cambio', res?.reason || res?.error?.message || '');
      return;
    }
    showBanner(
      'success',
      res.pending ? 'Solicitud enviada' : 'Listo',
      'Cancelaste tu partido y te uniste a este. (-25 Trust Score)'
    );
    load();
  };

  const handleConfirmGPS = async () => {
    setBusy(true);
    const result = await confirmAttendanceWithGPS(matchId);
    setBusy(false);
    if (!result?.ok) {
      showBanner('error', 'No pude confirmar', result?.reason || '');
      return;
    }
    showBanner(
      'success',
      '✅ Asistencia confirmada',
      result.distance ? `Estás a ${Math.round(result.distance)} m. +1 a tu Trust Score.` : ''
    );
    load();
  };

  const handleOpenProfile = (userId) => {
    if (!userId || userId === myId) return;
    navigation.navigate('UserProfile', { userId });
  };

  const handleOpenChat = () => {
    navigation.navigate('ChatThread', {
      threadKey: 'match:' + matchId,
      title: match?.titulo || 'Partido',
      subtitle: (match?.cancha_nombre || '') + (match?.comuna ? ` · ${match.comuna}` : ''),
    });
  };

  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>Cargando detalles…</Text>
      </View>
    );
  }

  if (!match) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.notFoundText}>Partido no encontrado o fue eliminado.</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backBtnLarge, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.backBtnLargeText}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
          >
            <ArrowLeft color={colors.textPrimary} size={20} />
          </Pressable>
          <Logo size={26} />
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.primary}
            />
          }
        >
          {banner && (
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          )}

          {/* Portada si existe */}
          {match.foto_url ? (
            <Pressable style={styles.coverWrap} onPress={() => setPhotoViewer(true)}>
              <Image source={{ uri: match.foto_url }} style={styles.cover} />
            </Pressable>
          ) : null}

          {/* Hero card */}
          <View style={styles.hero}>
            <Text style={styles.matchTitle}>{match.titulo}</Text>
            <View style={styles.heroMetaRow}>
              <MapPin color={colors.primary} size={14} />
              <Text style={styles.heroMetaText}>
                {match.cancha_nombre}{match.comuna ? ` · ${match.comuna}` : ''}
              </Text>
            </View>
            <View style={styles.heroMetaRow}>
              <Clock color={colors.primary} size={14} />
              <Text style={styles.heroMetaText}>{fmtHora(match.hora)}</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Users color={colors.primary} size={16} />
                <Text style={styles.statValue}>
                  {match.cupos_disponibles}/{match.cupos_totales}
                </Text>
                <Text style={styles.statLabel}>Cupos disp.</Text>
              </View>
              <View style={styles.statBox}>
                <BarChart3 color={colors.primary} size={16} />
                <Text style={styles.statValue}>{nivelLabel(match.nivel)}</Text>
                <Text style={styles.statLabel}>Nivel</Text>
              </View>
              <View style={styles.statBox}>
                <DollarSign color={colors.primary} size={16} />
                <Text style={styles.statValue}>
                  {match.precio_cuota === 0 ? 'Free' : `$${match.precio_cuota.toLocaleString('es-CL')}`}
                </Text>
                <Text style={styles.statLabel}>Cuota</Text>
              </View>
            </View>

            {match.descripcion ? (
              <View style={styles.descBox}>
                <Text style={styles.descText}>{match.descripcion}</Text>
              </View>
            ) : null}
          </View>

          {/* Acciones contextuales */}
          <View style={styles.actionsRow}>
            <Pressable
              onPress={handleOpenChat}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.85 }]}
            >
              <Send color={colors.primary} size={16} />
              <Text style={styles.actionLabel}>Chat</Text>
            </Pressable>
            {iAmAttendee && !canRateMatch && (
              <Pressable
                onPress={handleConfirmGPS}
                disabled={busy}
                style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.85 }, busy && { opacity: 0.5 }]}
              >
                <MapPin color={colors.primary} size={16} />
                <Text style={styles.actionLabel}>GPS</Text>
              </Pressable>
            )}
            {canRateMatch && (
              <Pressable
                onPress={() => navigation.navigate('RateMatch', { matchId })}
                style={({ pressed }) => [styles.actionBtnRate, pressed && { opacity: 0.85 }]}
              >
                <Star color="#0E0E0D" size={16} fill="#0E0E0D" />
                <Text style={styles.actionLabelRate}>Calificar</Text>
              </Pressable>
            )}
            {iAmOrganizer ? (
              <>
                <Pressable
                  onPress={handleEdit}
                  disabled={busy}
                  style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.85 }]}
                >
                  <Edit3 color={colors.primary} size={16} />
                  <Text style={styles.actionLabel}>Editar</Text>
                </Pressable>
                <Pressable
                  onPress={handleDelete}
                  disabled={busy}
                  style={({ pressed }) => [styles.actionDanger, pressed && { opacity: 0.7 }, busy && { opacity: 0.5 }]}
                >
                  <Trash2 color={colors.error} size={16} />
                </Pressable>
              </>
            ) : iAmAttendee ? (
              <Pressable
                onPress={handleLeave}
                disabled={busy}
                style={({ pressed }) => [styles.actionDanger, pressed && { opacity: 0.7 }, busy && { opacity: 0.5 }]}
              >
                <LogOut color={colors.error} size={16} />
              </Pressable>
            ) : iAmPending ? (
              <View style={[styles.actionPrimary, styles.actionPending]}>
                <ClockIcon color={colors.primary} size={15} />
                <Text style={styles.actionPendingLabel}>Solicitud enviada</Text>
              </View>
            ) : conflict && !conflict.canSwap ? (
              <View style={[styles.actionPrimary, styles.actionDisabled]}>
                <Text style={styles.actionDisabledLabel}>
                  Ya tienes un partido a esta hora
                </Text>
              </View>
            ) : (
              <Pressable
                onPress={
                  conflict && conflict.canSwap && conflict.iAmHost
                    ? handleHostConflict
                    : conflict && conflict.canSwap
                    ? handleConflictJoin
                    : isManual
                    ? handleRequestJoin
                    : handleJoin
                }
                disabled={busy || match.cupos_disponibles === 0}
                style={({ pressed }) => [styles.actionPrimary, pressed && { opacity: 0.85 }, (busy || match.cupos_disponibles === 0) && { opacity: 0.5 }]}
              >
                <Text style={styles.actionPrimaryLabel}>
                  {match.cupos_disponibles === 0
                    ? 'Lleno'
                    : isManual
                    ? 'Solicitar unirme'
                    : 'Unirme'}
                </Text>
              </Pressable>
            )}
          </View>

          {/* Solicitudes pendientes (solo anfitrión, partidos manuales) */}
          {iAmOrganizer && pendingRequests.length > 0 && (
            <>
              <View style={styles.sectionRow}>
                <Text style={[styles.sectionTitle, { color: colors.primary }]}>
                  SOLICITUDES PENDIENTES
                </Text>
                <Text style={styles.sectionCount}>{pendingRequests.length}</Text>
              </View>
              {pendingRequests.map((a) => (
                <View key={a.attendee_id} style={styles.pendingRow}>
                  <Pressable
                    onPress={() => handleOpenProfile(a.user_id)}
                    style={styles.pendingUser}
                  >
                    <View style={styles.avatar}>
                      {a.foto_url ? (
                        <Image source={{ uri: a.foto_url }} style={styles.avatarImage} />
                      ) : (
                        <UserIcon color={colors.primary} size={18} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.playerName} numberOfLines={1}>
                        @{a.username}
                      </Text>
                      <View style={styles.playerMeta}>
                        <ShieldCheck color={colors.textMuted} size={11} />
                        <Text style={styles.playerMetaText}>Trust {a.trust_score}</Text>
                        {a.comuna ? (
                          <>
                            <Text style={styles.dot}>·</Text>
                            <Text style={styles.playerMetaText}>{a.comuna}</Text>
                          </>
                        ) : null}
                      </View>
                    </View>
                  </Pressable>
                  <Pressable
                    onPress={() => handleApprove(a.user_id)}
                    disabled={busy}
                    style={({ pressed }) => [styles.approveBtn, pressed && { opacity: 0.8 }, busy && { opacity: 0.5 }]}
                  >
                    <Check color="#0E0E0D" size={18} strokeWidth={2.6} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleReject(a.user_id)}
                    disabled={busy}
                    style={({ pressed }) => [styles.rejectBtn, pressed && { opacity: 0.7 }, busy && { opacity: 0.5 }]}
                  >
                    <X color={colors.error} size={18} strokeWidth={2.6} />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {/* Jugadores inscritos */}
          <View style={styles.sectionRow}>
            <Text style={styles.sectionTitle}>JUGADORES INSCRITOS</Text>
            <Text style={styles.sectionCount}>{confirmedAttendees.length}</Text>
          </View>

          {confirmedAttendees.length === 0 && (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                Aún no hay jugadores inscritos.
              </Text>
            </View>
          )}

          {confirmedAttendees.map((a) => (
            <Pressable
              key={a.attendee_id}
              onPress={() => handleOpenProfile(a.user_id)}
              disabled={a.user_id === myId}
              style={({ pressed }) => [
                styles.playerRow,
                pressed && a.user_id !== myId && { opacity: 0.85 },
              ]}
            >
              <View style={[styles.avatar, a.is_organizer && styles.avatarOrganizer]}>
                {a.foto_url ? (
                  <Image source={{ uri: a.foto_url }} style={styles.avatarImage} />
                ) : a.is_organizer ? (
                  <Crown color={a.is_organizer ? '#0E0E0D' : colors.primary} size={18} />
                ) : (
                  <UserIcon color={colors.primary} size={18} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.playerTopRow}>
                  <Text style={styles.playerName} numberOfLines={1}>
                    @{a.username}{a.user_id === myId ? ' (Tú)' : ''}
                  </Text>
                  {a.is_organizer && (
                    <View style={styles.organizerTag}>
                      <Text style={styles.organizerTagText}>ANFITRIÓN</Text>
                    </View>
                  )}
                </View>
                <View style={styles.playerMeta}>
                  <ShieldCheck color={colors.textMuted} size={11} />
                  <Text style={styles.playerMetaText}>Trust {a.trust_score}</Text>
                  {a.comuna ? (
                    <>
                      <Text style={styles.dot}>·</Text>
                      <Text style={styles.playerMetaText}>{a.comuna}</Text>
                    </>
                  ) : null}
                  {a.estado === 'confirmado_gps' && (
                    <>
                      <Text style={styles.dot}>·</Text>
                      <CheckCircle2 color={colors.primary} size={11} />
                      <Text style={[styles.playerMetaText, { color: colors.primary }]}>
                        GPS confirmado
                      </Text>
                    </>
                  )}
                </View>
              </View>
            </Pressable>
          ))}

          {!isSupabaseConfigured && (
            <Text style={styles.demoNotice}>
              ⚠️ Modo demo — los datos son de ejemplo.
            </Text>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={photoViewer}
        transparent
        animationType="fade"
        onRequestClose={() => setPhotoViewer(false)}
      >
        <Pressable style={styles.viewerBackdrop} onPress={() => setPhotoViewer(false)}>
          <Pressable
            onPress={() => setPhotoViewer(false)}
            hitSlop={12}
            style={styles.viewerClose}
          >
            <X color="#FFFFFF" size={26} />
          </Pressable>
          {match?.foto_url && (
            <Image
              source={{ uri: match.foto_url }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingHorizontal: 20, paddingBottom: 24 },
  coverWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  cover: { width: '100%', height: '100%' },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerImage: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').width,
  },
  viewerClose: {
    position: 'absolute',
    top: 50,
    right: 20,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingText: { color: colors.textSecondary, marginTop: 12 },
  notFoundText: { color: colors.textSecondary, fontSize: 14, marginBottom: 16 },
  backBtnLarge: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  backBtnLargeText: { color: colors.textPrimary, fontWeight: '700' },

  hero: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 12,
  },
  matchTitle: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 10,
  },
  heroMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  heroMetaText: { color: colors.textSecondary, fontSize: 13 },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
    marginTop: 4,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 10,
    marginTop: 2,
  },
  descBox: {
    marginTop: 14,
    backgroundColor: colors.background,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  descText: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },

  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 18,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionLabel: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  actionBtnRate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  actionLabelRate: { color: '#0E0E0D', fontSize: 13, fontWeight: '800' },
  actionPrimary: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
  },
  actionPrimaryLabel: { color: '#0E0E0D', fontWeight: '800', fontSize: 14 },
  actionPending: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionPendingLabel: { color: colors.primary, fontWeight: '800', fontSize: 13 },
  actionDisabled: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  actionDisabledLabel: { color: colors.textMuted, fontWeight: '700', fontSize: 13 },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    padding: 10,
    marginBottom: 8,
  },
  pendingUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  approveBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionDanger: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sectionCount: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
  },

  emptyBox: {
    backgroundColor: colors.surfaceAlt,
    padding: 18,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
  },

  playerRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 8,
    alignItems: 'center',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
  avatarOrganizer: {
    backgroundColor: colors.primary,
  },
  playerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playerName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  organizerTag: {
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  organizerTagText: {
    color: '#0E0E0D',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  playerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  playerMetaText: {
    color: colors.textSecondary,
    fontSize: 11,
  },
  dot: { color: colors.textMuted, fontSize: 11, marginHorizontal: 2 },

  demoNotice: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 18,
  },
});
