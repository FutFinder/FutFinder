import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  Image,
  Modal,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Settings,
  Bell,
  User as UserIcon,
  Calendar,
  MapPin,
  Star,
  ShieldCheck,
  FileText,
  Edit3,
  LogOut,
  ChevronRight,
  ArrowLeft,
  UserPlus,
  UserCheck,
  UserX,
  MessageCircle,
  Clock,
  X,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Banner from '../components/Banner';
import { colors, radius } from '../theme/colors';
import {
  getMyProfile,
  getProfileById,
  getMyAttendanceHistory,
  deriveStats,
} from '../services/profile';
import { signOut, getCurrentUser } from '../services/auth';
import { getUserRatingSummary } from '../services/ratings';
import {
  getFriendshipWith,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from '../services/friends';
import { isSupabaseConfigured } from '../services/supabase';

const POSICION_LABEL = {
  arquero: 'Arquero',
  defensa: 'Defensa',
  medio: 'Mediocampista',
  delantero: 'Delantero',
  lateral: 'Lateral',
  volante: 'Volante',
  sin_definir: 'Sin definir',
};

const FLANCO_LABEL = {
  derecho: 'Flanco Der.',
  izquierdo: 'Flanco Izq.',
  ambos: 'Ambos flancos',
};

function fmtFecha(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CL', { day: '2-digit', month: 'short' }) +
      ` ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

export default function ProfileScreen({ navigation, route }) {
  const viewUserId = route?.params?.userId || null;
  const [myId, setMyId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState(null);
  const [friendship, setFriendship] = useState(null); // estado de amistad
  const [friendBusy, setFriendBusy] = useState(false);
  const [ratingSummary, setRatingSummary] = useState(null);
  const [photoViewer, setPhotoViewer] = useState(false);

  // ¿Estoy viendo mi propio perfil o el de otro?
  const isMyProfile = !viewUserId || viewUserId === myId;

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    setMyId(user?.id || null);

    const targetId = !viewUserId || viewUserId === user?.id ? user?.id : viewUserId;

    if (!viewUserId || viewUserId === user?.id) {
      const [p, h] = await Promise.all([
        getMyProfile(),
        getMyAttendanceHistory(8),
      ]);
      setProfile(p);
      setHistory(h);
      setFriendship(null);
    } else {
      const [p, f] = await Promise.all([
        getProfileById(viewUserId),
        getFriendshipWith(viewUserId),
      ]);
      setProfile(p);
      setHistory([]); // no exponemos historial ajeno en V1
      setFriendship(f);
    }

    // Resumen de calificaciones del perfil mostrado
    if (targetId) {
      const summary = await getUserRatingSummary(targetId);
      setRatingSummary(summary);
    }

    setLoading(false);
    setRefreshing(false);
  }, [viewUserId]);

  useEffect(() => {
    load();
    // Refrescar al volver a esta pantalla
    const unsubscribe = navigation.addListener('focus', load);
    return unsubscribe;
  }, [load, navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handleLogout = async () => {
    await signOut();
    // El logout sale del tab navigator y vuelve al stack raíz (Welcome)
    const parent = navigation.getParent();
    if (parent) {
      parent.reset({ index: 0, routes: [{ name: 'Welcome' }] });
    } else {
      navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
    }
  };

  const showBanner = (type, title, message = '') => {
    setBanner({ type, title, message });
    if (type === 'success') setTimeout(() => setBanner(null), 4000);
  };

  // ---- Acciones de amistad (cuando estoy viendo otro perfil) ----
  const handleAddFriend = async () => {
    if (friendBusy) return;
    setFriendBusy(true);
    const { error } = await sendFriendRequest(viewUserId);
    setFriendBusy(false);
    if (error) {
      showBanner('error', 'No pude enviar la solicitud', error.message || '');
      return;
    }
    showBanner('success', 'Solicitud enviada', '@' + (profile?.username || 'jugador') + ' decidirá si te acepta.');
    load();
  };

  const handleAcceptFriend = async () => {
    if (!friendship || friendBusy) return;
    setFriendBusy(true);
    const { error } = await acceptFriendRequest(friendship.id);
    setFriendBusy(false);
    if (error) {
      showBanner('error', 'No pude aceptar', error.message || '');
      return;
    }
    showBanner('success', '¡Amistad confirmada!', 'Ya puedes mandarle mensajes.');
    load();
  };

  const handleRejectFriend = async () => {
    if (!friendship || friendBusy) return;
    setFriendBusy(true);
    const { error } = await rejectFriendRequest(friendship.id);
    setFriendBusy(false);
    if (error) {
      showBanner('error', 'No pude rechazar', error.message || '');
      return;
    }
    showBanner('info', 'Solicitud rechazada', '');
    load();
  };

  const handleCancelRequest = async () => {
    if (!friendship || friendBusy) return;
    setFriendBusy(true);
    const { error } = await cancelFriendRequest(friendship.id);
    setFriendBusy(false);
    if (error) {
      showBanner('error', 'No pude cancelar', error.message || '');
      return;
    }
    showBanner('info', 'Solicitud cancelada', '');
    load();
  };

  const handleRemoveFriend = async () => {
    if (friendBusy || !viewUserId) return;
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('¿Eliminar amistad con @' + (profile?.username || 'jugador') + '?')
        : true;
    if (!ok) return;
    setFriendBusy(true);
    const { error } = await removeFriend(viewUserId);
    setFriendBusy(false);
    if (error) {
      showBanner('error', 'No pude eliminar', error.message || '');
      return;
    }
    showBanner('info', 'Amistad eliminada', '');
    load();
  };

  const handleSendMessage = () => {
    if (!viewUserId || !profile) return;
    const parent = navigation.getParent();
    const nav = parent || navigation;
    nav.navigate('ChatThread', {
      threadKey: 'dm:' + viewUserId,
      title: '@' + (profile.username || 'jugador'),
      subtitle: 'Mensaje directo',
    });
  };

  const stats = deriveStats(profile, history);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header — distinto si es mi perfil o el de otro */}
        <View style={styles.header}>
          {isMyProfile ? (
            <Logo size={28} />
          ) : (
            <Pressable
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <ArrowLeft color={colors.textPrimary} size={20} />
            </Pressable>
          )}
          {!isMyProfile && <Logo size={26} />}
          {isMyProfile ? (
            <Pressable
              onPress={() => navigation.navigate('EditProfile')}
              hitSlop={12}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
            >
              <Settings color={colors.textPrimary} size={20} />
            </Pressable>
          ) : (
            <View style={{ width: 40 }} />
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
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

          {/* Hero card */}
          <View style={styles.heroCard}>
            <Pressable
              onPress={() => profile?.foto_url && setPhotoViewer(true)}
              disabled={!profile?.foto_url}
              style={styles.avatar}
            >
              {profile?.foto_url ? (
                <Image source={{ uri: profile.foto_url }} style={styles.avatarImage} />
              ) : (
                <UserIcon color={colors.primary} size={42} strokeWidth={1.5} />
              )}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.username}>
                @{profile?.username || 'jugador'}
              </Text>
              <View style={styles.metaRow}>
                {profile?.edad ? (
                  <View style={styles.metaItem}>
                    <Calendar color={colors.textSecondary} size={12} />
                    <Text style={styles.metaText}>{profile.edad} años</Text>
                  </View>
                ) : null}
                {profile?.comuna ? (
                  <View style={styles.metaItem}>
                    <MapPin color={colors.textSecondary} size={12} />
                    <Text style={styles.metaText}>
                      {profile.comuna}
                      {profile.region ? `, CL` : ''}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.tagsRow}>
                {renderPosiciones(profile?.posicion_preferida)}
                {profile?.flanco && (
                  <View style={styles.smallTag}>
                    <Text style={styles.smallTagText}>{FLANCO_LABEL[profile.flanco]}</Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Bio */}
          {profile?.bio ? (
            <View style={styles.bioCard}>
              <Text style={styles.bioText}>{profile.bio}</Text>
            </View>
          ) : isMyProfile ? (
            <Pressable
              onPress={() => navigation.navigate('EditProfile')}
              style={({ pressed }) => [
                styles.bioCard,
                styles.bioCardEmpty,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Edit3 color={colors.primary} size={14} />
              <Text style={styles.bioEmptyText}>
                Agrega una descripción sobre tu trayectoria
              </Text>
            </Pressable>
          ) : null}

          {/* Botones de acción para perfil ajeno */}
          {!isMyProfile && (
            <FriendActionRow
              friendship={friendship}
              myId={myId}
              busy={friendBusy}
              onAdd={handleAddFriend}
              onAccept={handleAcceptFriend}
              onReject={handleRejectFriend}
              onCancel={handleCancelRequest}
              onRemove={handleRemoveFriend}
              onMessage={handleSendMessage}
            />
          )}

          {/* Card: Historial Deportivo */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <FileText color={colors.primary} size={16} />
              <Text style={styles.cardTitle}>Historial Deportivo</Text>
            </View>

            <View style={styles.statsRow}>
              <StatBlock value={stats?.partidos_jugados ?? 0} label="Partidos Jugados" />
              <StatBlock value={history.filter(h => h.match).length} label="Inscritos" />
              <StatBlock value={stats?.mvps ?? 0} label="MVPs" highlighted />
            </View>

            <View style={{ height: 14 }} />
            <View style={styles.attRow}>
              <Text style={styles.attLabel}>Tasa de Asistencia</Text>
              <Text style={styles.attValue}>{stats?.tasa_asistencia ?? 100}%</Text>
            </View>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${stats?.tasa_asistencia ?? 100}%` },
                ]}
              />
            </View>

            <Text style={styles.subSectionTitle}>ÚLTIMAS PARTICIPACIONES</Text>
            {history.length === 0 ? (
              <View style={styles.emptyMini}>
                <Text style={styles.emptyMiniText}>
                  Aún no te has inscrito a partidos. Cuando lo hagas, aparecerán aquí.
                </Text>
              </View>
            ) : (
              history.slice(0, 4).map((h) => (
                <View key={h.id} style={styles.histRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.histTitle} numberOfLines={1}>
                      {h.match?.titulo || 'Partido eliminado'}
                    </Text>
                    {h.match?.hora ? (
                      <Text style={styles.histDate}>{fmtFecha(h.match.hora)}</Text>
                    ) : null}
                  </View>
                  <StatusBadge estado={h.estado} />
                </View>
              ))
            )}
          </View>

          {/* Card: Reputación */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Star color={colors.primary} size={16} />
              <Text style={styles.cardTitle}>Reputación</Text>
            </View>

            <View style={styles.repRow}>
              <View>
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((i) => {
                    const score =
                      ratingSummary?.count > 0
                        ? ratingSummary.overall
                        : (stats?.stars ?? 5);
                    const filled = i <= Math.round(score);
                    return (
                      <Star
                        key={i}
                        color={filled ? '#F2C94C' : colors.borderSoft}
                        fill={filled ? '#F2C94C' : 'transparent'}
                        size={20}
                      />
                    );
                  })}
                </View>
                <Text style={styles.repSubtext}>
                  {ratingSummary?.count > 0
                    ? `${ratingSummary.overall.toFixed(1)} / 5.0 · ${ratingSummary.count} evaluación${ratingSummary.count === 1 ? '' : 'es'}`
                    : 'Sin evaluaciones aún'}
                </Text>
              </View>
              <View style={styles.trustBlock}>
                <Text style={styles.trustValue}>{stats?.trust_score ?? 100}</Text>
                <Text style={styles.trustLabel}>Trust Score</Text>
              </View>
            </View>

            <Text style={styles.subSectionTitle}>CALIFICACIONES DE COMPAÑEROS</Text>
            {ratingSummary?.count > 0 ? (
              <>
                <RatingDimension label="Puntualidad" value={ratingSummary.avg_puntualidad} />
                <RatingDimension label="Fair play" value={ratingSummary.avg_fairplay} />
                <RatingDimension label="Nivel" value={ratingSummary.avg_nivel} />
              </>
            ) : (
              <View style={styles.tagsCloud}>
                <Text style={styles.placeholderText}>
                  Las calificaciones aparecerán cuando otros jugadores te
                  evalúen después de partidos confirmados por GPS. ⚡
                </Text>
              </View>
            )}
          </View>

          {/* Card: Asistencia y Penalizaciones */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <ShieldCheck color={colors.primary} size={16} />
              <Text style={styles.cardTitle}>Asistencia y Penalizaciones</Text>
            </View>

            <View style={styles.bigStatsRow}>
              <BigStat
                value={stats?.confirmados_historial ?? 0}
                label="Confirmadas por ubicación"
              />
              <BigStat
                value={stats?.asistencias_confirmadas ?? 0}
                label="Confirmadas totales"
                icon={UserIcon}
              />
            </View>

            <KV label="Ausencias acumuladas" value="0" />
            <KV label="Sanciones activas" value="0" />
            <KV label="Reportes recibidos" value="0" />
            <KV label="Estado de apelaciones" value="Sin apelaciones" />

            <View style={styles.statusGood}>
              <ShieldCheck color={colors.primary} size={16} />
              <View style={{ flex: 1 }}>
                <Text style={styles.statusGoodTitle}>{stats?.estado_cuenta || 'Cuenta en buen estado'}</Text>
                <Text style={styles.statusGoodSub}>
                  Sin sanciones ni restricciones activas
                </Text>
              </View>
            </View>
          </View>

          {/* Card: Auditoria y Soporte */}
          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <FileText color={colors.primary} size={16} />
              <Text style={styles.cardTitle}>Auditoría y Soporte</Text>
            </View>
            <KV label="Última revisión de soporte" value="Sin revisiones" />
            <KV label="Resultado" value="—" />
            <KV label="Próxima auditoría" value="Automática" />

            <Pressable
              style={({ pressed }) => [
                styles.appealBtn,
                pressed && { opacity: 0.7 },
              ]}
              onPress={() =>
                setBanner({
                  type: 'info',
                  title: 'Próximamente',
                  message: 'El sistema de apelaciones se habilitará cuando lances la beta pública.',
                })
              }
            >
              <Text style={styles.appealLabel}>Apelar una decisión</Text>
            </Pressable>
          </View>

          {/* Acciones — solo en mi perfil */}
          {isMyProfile && (
            <>
              <Pressable
                onPress={() => navigation.navigate('EditProfile')}
                style={({ pressed }) => [
                  styles.actionBtn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Edit3 color={colors.primary} size={16} />
                <Text style={styles.actionLabel}>Editar mi perfil</Text>
                <ChevronRight color={colors.textMuted} size={16} />
              </Pressable>

              <Pressable
                onPress={handleLogout}
                style={({ pressed }) => [
                  styles.actionBtn,
                  { borderColor: colors.error },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <LogOut color={colors.error} size={16} />
                <Text style={[styles.actionLabel, { color: colors.error }]}>
                  Cerrar sesión
                </Text>
                <ChevronRight color={colors.error} size={16} />
              </Pressable>
            </>
          )}

          {!isSupabaseConfigured && (
            <Text style={styles.demoNotice}>
              ⚠️ Modo demo — los datos arriba son de ejemplo.
            </Text>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>

      {/* Visor de foto a pantalla completa */}
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
          {profile?.foto_url && (
            <Image
              source={{ uri: profile.foto_url }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

// ---- Botonera de amistad ----
function FriendActionRow({
  friendship, myId, busy,
  onAdd, onAccept, onReject, onCancel, onRemove, onMessage,
}) {
  let state = 'none';
  if (friendship) {
    if (friendship.status === 'accepted') state = 'friends';
    else if (friendship.status === 'pending') {
      state = friendship.requester_id === myId ? 'sent' : 'received';
    } else if (friendship.status === 'rejected' || friendship.status === 'blocked') {
      state = 'none'; // permite reintentar
    }
  }

  return (
    <View style={friendStyles.row}>
      {state === 'none' && (
        <Pressable
          onPress={onAdd}
          disabled={busy}
          style={({ pressed }) => [
            friendStyles.primaryBtn,
            pressed && { opacity: 0.85 },
            busy && { opacity: 0.5 },
          ]}
        >
          <UserPlus color="#0E0E0D" size={16} strokeWidth={2.4} />
          <Text style={friendStyles.primaryLabel}>Agregar amigo</Text>
        </Pressable>
      )}

      {state === 'sent' && (
        <Pressable
          onPress={onCancel}
          disabled={busy}
          style={({ pressed }) => [
            friendStyles.outlineBtn,
            pressed && { opacity: 0.7 },
            busy && { opacity: 0.5 },
          ]}
        >
          <Clock color={colors.textSecondary} size={14} />
          <Text style={friendStyles.outlineLabel}>Solicitud enviada · cancelar</Text>
        </Pressable>
      )}

      {state === 'received' && (
        <>
          <Pressable
            onPress={onAccept}
            disabled={busy}
            style={({ pressed }) => [
              friendStyles.primaryBtn,
              pressed && { opacity: 0.85 },
              busy && { opacity: 0.5 },
            ]}
          >
            <UserCheck color="#0E0E0D" size={16} strokeWidth={2.4} />
            <Text style={friendStyles.primaryLabel}>Aceptar</Text>
          </Pressable>
          <Pressable
            onPress={onReject}
            disabled={busy}
            style={({ pressed }) => [
              friendStyles.dangerBtn,
              pressed && { opacity: 0.7 },
              busy && { opacity: 0.5 },
            ]}
          >
            <UserX color={colors.error} size={16} />
          </Pressable>
        </>
      )}

      {state === 'friends' && (
        <Pressable
          onPress={onRemove}
          disabled={busy}
          style={({ pressed }) => [
            friendStyles.outlineBtn,
            pressed && { opacity: 0.7 },
            busy && { opacity: 0.5 },
          ]}
        >
          <UserCheck color={colors.primary} size={14} />
          <Text style={[friendStyles.outlineLabel, { color: colors.primary }]}>
            Amigos · quitar
          </Text>
        </Pressable>
      )}

      {state === 'friends' && (
        <Pressable
          onPress={onMessage}
          style={({ pressed }) => [
            friendStyles.secondaryBtn,
            pressed && { opacity: 0.7 },
          ]}
        >
          <MessageCircle color={colors.primary} size={16} />
          <Text style={friendStyles.secondaryLabel}>Mensaje</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---- Helpers internos ----

function renderPosiciones(pref) {
  // pref puede ser array (nuevo schema), string (legacy) o null
  let arr = [];
  if (Array.isArray(pref)) arr = pref;
  else if (typeof pref === 'string' && pref) arr = [pref];
  if (arr.length === 0) return null;
  return arr
    .filter((p) => p !== 'sin_definir')
    .map((p) => (
      <View key={p} style={styles.smallTag}>
        <Text style={styles.smallTagText}>{POSICION_LABEL[p] || p}</Text>
      </View>
    ));
}

function signalFromTrust(score) {
  if (score == null) return 'Excelente';
  if (score >= 85) return 'Excelente';
  if (score >= 70) return 'Alta';
  if (score >= 50) return 'Media';
  return 'Baja';
}

// ---- Subcomponentes ----

function RatingDimension({ label, value }) {
  const v = Number(value || 0);
  return (
    <View style={styles.ratingDimRow}>
      <Text style={styles.ratingDimLabel}>{label}</Text>
      <View style={styles.ratingDimRight}>
        <View style={styles.ratingDimStars}>
          {[1, 2, 3, 4, 5].map((i) => {
            const filled = i <= Math.round(v);
            return (
              <Star
                key={i}
                color={filled ? '#F2C94C' : colors.borderSoft}
                fill={filled ? '#F2C94C' : 'transparent'}
                size={14}
              />
            );
          })}
        </View>
        <Text style={styles.ratingDimValue}>{v.toFixed(1)}</Text>
      </View>
    </View>
  );
}

function StatBlock({ value, label, highlighted }) {
  return (
    <View style={[styles.statBlock, highlighted && styles.statBlockHi]}>
      <Text style={[styles.statValue, highlighted && { color: colors.primary }]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function BigStat({ value, label, icon: Icon = MapPin }) {
  return (
    <View style={styles.bigStat}>
      <View style={styles.bigStatIcon}>
        <Icon color={colors.primary} size={18} />
      </View>
      <Text style={styles.bigStatValue}>{value}</Text>
      <Text style={styles.bigStatLabel}>{label}</Text>
    </View>
  );
}

function StatusBadge({ estado }) {
  const palette = {
    inscrito: { bg: colors.surface, fg: colors.textSecondary, label: 'Inscrito' },
    confirmado_gps: { bg: colors.primarySoft, fg: colors.primary, label: '✓ Asistió' },
    no_asistio: { bg: colors.errorSoft, fg: colors.error, label: 'No asistió' },
    cancelado: { bg: colors.surface, fg: colors.textMuted, label: 'Cancelado' },
  }[estado] || { bg: colors.surface, fg: colors.textSecondary, label: estado };
  return (
    <View style={[styles.statusBadge, { backgroundColor: palette.bg }]}>
      <Text style={[styles.statusBadgeText, { color: palette.fg }]}>{palette.label}</Text>
    </View>
  );
}

function SignalRow({ label, value, inverse = false }) {
  const goodLabels = inverse
    ? new Set(['Ninguna', 'Baja'])
    : new Set(['Excelente', 'Alta']);
  const isGood = goodLabels.has(value);
  return (
    <View style={styles.signalRow}>
      <Text style={styles.signalLabel}>{label}</Text>
      <Text
        style={[
          styles.signalValue,
          isGood ? { color: colors.primary } : { color: colors.textSecondary },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function KV({ label, value }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
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
  scroll: { paddingHorizontal: 20, paddingBottom: 32 },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: { width: '100%', height: '100%' },
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
  username: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  tagsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  smallTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.background,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  smallTagText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '600',
  },

  bioCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 12,
  },
  bioCardEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderStyle: 'dashed',
  },
  bioText: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 19,
  },
  bioEmptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },

  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 12,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  cardTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },

  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBlock: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
  },
  statBlockHi: {},
  statValue: {
    color: colors.primary,
    fontSize: 24,
    fontWeight: '800',
  },
  statLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },

  attRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  attLabel: { color: colors.textSecondary, fontSize: 12 },
  attValue: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  progressBar: {
    height: 8,
    backgroundColor: colors.background,
    borderRadius: 4,
    marginTop: 6,
    marginBottom: 14,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
  },

  subSectionTitle: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 8,
    marginBottom: 8,
  },
  histRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  histTitle: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  histDate: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  emptyMini: {
    padding: 14,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  emptyMiniText: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },

  repRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  starsRow: { flexDirection: 'row', gap: 2 },
  repSubtext: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  ratingDimRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  ratingDimLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  ratingDimRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ratingDimStars: { flexDirection: 'row', gap: 1 },
  ratingDimValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    minWidth: 26,
    textAlign: 'right',
  },
  trustBlock: {
    alignItems: 'flex-end',
  },
  trustValue: {
    color: colors.primary,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 32,
  },
  trustLabel: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  tagsCloud: {
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 4,
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },

  signalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  signalLabel: { color: colors.textPrimary, fontSize: 13 },
  signalValue: { fontSize: 13, fontWeight: '700' },

  bigStatsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 6,
  },
  bigStat: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
  },
  bigStatIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  bigStatValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
  },
  bigStatLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },

  kv: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  kvLabel: { color: colors.textPrimary, fontSize: 13 },
  kvValue: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },

  statusGood: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.primary,
    marginTop: 12,
  },
  statusGoodTitle: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  statusGoodSub: {
    color: colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },

  appealBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appealLabel: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginTop: 8,
  },
  actionLabel: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },

  demoNotice: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 16,
  },
});

const friendStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  primaryLabel: {
    color: '#0E0E0D',
    fontSize: 14,
    fontWeight: '800',
  },
  outlineBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
  },
  outlineLabel: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  secondaryLabel: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  dangerBtn: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
