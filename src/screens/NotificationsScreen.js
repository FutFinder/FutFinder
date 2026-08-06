import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Check, Trash2, BellOff } from 'lucide-react-native';

import { tactical as t } from '../theme/colors';
import Banner from '../components/Banner';
import NotificationCard, { CATEGORY } from '../components/notifications/NotificationCard';
import FilterChips from '../components/notifications/FilterChips';
import { getCurrentUser } from '../services/auth';
import { getMyClub, respondToRequest } from '../services/clubs';
import { respondChallenge } from '../services/clubChallenges';
import { acceptFriendRequest, rejectFriendRequest } from '../services/friends';
import {
  listNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
  subscribeToNotifications,
} from '../services/notifications';

/**
 * Pantalla de inbox de notificaciones — "Avisos".
 * - Carga las últimas 50 al entrar, agrupadas por fecha (Hoy / Esta semana / Anteriores).
 * - Filtro por categoría (Todos / Clubes / Partidos / Social).
 * - Realtime: INSERT/UPDATE del usuario se refleja en caliente.
 * - Acciones inline (Aceptar/Rechazar) para desafíos de club, solicitudes de
 *   club y solicitudes de amistad — el resto solo navega al tocar, igual que antes.
 */

const FILTERS = [
  { key: 'todos', label: 'TODOS' },
  { key: 'clubes', label: 'CLUBES' },
  { key: 'partidos', label: 'PARTIDOS' },
  { key: 'social', label: 'SOCIAL' },
];

function formatNotifTime(iso) {
  try {
    const date = new Date(iso);
    const diff = (Date.now() - date.getTime()) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;

    const hhmm = date.toLocaleTimeString('es-CL', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const now = new Date();
    const isToday =
      date.getDate() === now.getDate() &&
      date.getMonth() === now.getMonth() &&
      date.getFullYear() === now.getFullYear();
    if (isToday) return `hoy ${hhmm}`;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const isYesterday =
      date.getDate() === yesterday.getDate() &&
      date.getMonth() === yesterday.getMonth() &&
      date.getFullYear() === yesterday.getFullYear();
    if (isYesterday) return `ayer ${hhmm}`;

    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    if (date.getFullYear() === now.getFullYear()) return `${dd}/${mm} ${hhmm}`;
    const yy = String(date.getFullYear()).slice(2);
    return `${dd}/${mm}/${yy} ${hhmm}`;
  } catch {
    return '';
  }
}

function groupFor(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (diffDays <= 0) return 'Hoy';
    if (diffDays < 7) return 'Esta semana';
    return 'Anteriores';
  } catch {
    return 'Anteriores';
  }
}

const GROUP_ORDER = ['Hoy', 'Esta semana', 'Anteriores'];

/** Acciones inline disponibles para este aviso, o null si solo navega al tocar. */
function actionsFor(n, myClub) {
  const data = n?.data || {};
  if (n.type === 'club_challenge' && data.challengeId) {
    const isAdminOfRetado = myClub?.role === 'admin' && myClub?.id === data.clubRetadoId;
    return isAdminOfRetado ? ['Aceptar reto', 'Rechazar'] : null;
  }
  if (n.type === 'club_request' && data.requestId) {
    return ['Aceptar', 'Rechazar'];
  }
  if (n.type === 'friend_request' && data.friendshipId) {
    return ['Aceptar', 'Rechazar'];
  }
  return null;
}

function navigateForNotif(navigation, n) {
  const data = n?.data || {};
  // Desde una tab, los screens del root stack se alcanzan subiendo al padre.
  const root = navigation.getParent() || navigation;
  switch (n?.type) {
    case 'message_new':
      if (data.threadKey || data.threadId) {
        root.navigate('ChatThread', { threadKey: data.threadKey || data.threadId });
      }
      break;
    case 'match_join':
    case 'match_reminder':
    case 'join_request':
    case 'join_approved':
    case 'join_rejected':
      if (data.matchId) {
        root.navigate('MatchDetail', { matchId: data.matchId });
      }
      break;
    case 'match_rate':
      if (data.matchId) {
        root.navigate('RateMatch', { matchId: data.matchId });
      }
      break;
    case 'match_cancelled':
      navigation.navigate('SearchTab');
      break;
    case 'club_request':
    case 'club_request_accepted':
      if (data.clubId) {
        root.navigate('ClubDetail', { clubId: data.clubId });
      }
      break;
    case 'club_request_rejected':
      navigation.navigate('ClubsTab');
      break;
    case 'club_member_joined':
    case 'club_member_left':
      if (data.clubId) {
        root.navigate('ClubDetail', { clubId: data.clubId });
      }
      break;
    case 'club_challenge':
      // Recibido: abre la bandeja de desafíos de mi club (el retado)
      if (data.clubRetadoId) {
        root.navigate('ClubChallenges', { clubId: data.clubRetadoId });
      }
      break;
    case 'club_challenge_accepted':
    case 'club_challenge_rejected':
      // Respondido: abre la bandeja de desafíos de mi club (el retador)
      if (data.clubRetadorId) {
        root.navigate('ClubChallenges', { clubId: data.clubRetadorId });
      }
      break;
    case 'friend_request':
    case 'friend_accept':
      if (data.fromUserId) {
        root.navigate('UserProfile', { userId: data.fromUserId });
      }
      break;
    default:
      break;
  }
}

export default function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [myClub, setMyClub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('todos');
  const [banner, setBanner] = useState(null);

  const load = useCallback(async () => {
    const [{ data }, clubResult] = await Promise.all([
      listNotifications({ limit: 50 }),
      getMyClub(),
    ]);
    setItems(data || []);
    const mc = clubResult?.data;
    setMyClub(mc ? { id: mc.club.id, role: mc.miRol } : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Realtime: subscribirse a INSERTs/UPDATEs del usuario
  useEffect(() => {
    let unsubscribe = () => {};
    (async () => {
      const user = await getCurrentUser();
      if (!user?.id) return;
      unsubscribe = subscribeToNotifications(user.id, (notif) => {
        setItems((prev) => {
          const idx = prev.findIndex((p) => p.id === notif.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = notif;
            return next;
          }
          return [notif, ...prev];
        });
      });
    })();
    return () => unsubscribe();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handlePress = async (n) => {
    if (!n.read) {
      setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)));
      markAsRead(n.id);
    }
    navigateForNotif(navigation, n);
  };

  const handleDelete = async (id) => {
    setItems((prev) => prev.filter((p) => p.id !== id));
    await deleteNotification(id);
  };

  const handleMarkAll = async () => {
    setItems((prev) => prev.map((p) => ({ ...p, read: true })));
    await markAllAsRead();
  };

  const handleClearAll = async () => {
    if (items.length === 0) return;
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('¿Borrar todas las notificaciones? Esta acción no se puede deshacer.')
        : true;
    if (!ok) return;
    setItems([]);
    await deleteAllNotifications();
  };

  const respond = async (n, accept) => {
    const data = n.data || {};
    let error = null;
    if (n.type === 'club_challenge') {
      ({ error } = await respondChallenge(data.challengeId, accept));
    } else if (n.type === 'club_request') {
      ({ error } = await respondToRequest(data.requestId, accept));
    } else if (n.type === 'friend_request') {
      ({ error } = accept
        ? await acceptFriendRequest(data.friendshipId)
        : await rejectFriendRequest(data.friendshipId));
    }
    if (error) {
      setBanner({ type: 'error', title: 'No pudimos procesar tu respuesta', message: error.message || '' });
      return;
    }
    setItems((prev) =>
      prev.map((p) => (p.id === n.id ? { ...p, read: true, _actionsResolved: true } : p))
    );
    markAsRead(n.id);
  };

  const chips = useMemo(
    () =>
      FILTERS.map((f) => ({
        ...f,
        count:
          f.key === 'todos'
            ? items.length
            : items.filter((n) => CATEGORY[n.type] === f.key).length,
      })),
    [items]
  );

  const sections = useMemo(() => {
    const visible = items.filter((n) => filter === 'todos' || CATEGORY[n.type] === filter);
    const buckets = new Map();
    visible.forEach((n) => {
      const g = groupFor(n.created_at);
      buckets.set(g, [...(buckets.get(g) || []), n]);
    });
    return GROUP_ORDER.filter((g) => buckets.get(g)?.length).map((title) => ({
      title,
      data: buckets.get(title).map((n) => ({
        ...n,
        timeLabel: formatNotifTime(n.created_at),
        actions: n._actionsResolved ? null : actionsFor(n, myClub),
      })),
    }));
  }, [items, filter, myClub]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
        <LinearGradient
          colors={t.headerGradient}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          className="px-5 pb-4 pt-3"
        >
          <View className="mt-2 flex-row items-end justify-between">
            <View>
              <Text className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#00FF66]/75">Centro de actividad</Text>
              <Text className="mt-1 text-[30px] font-extrabold tracking-tight text-white">Avisos</Text>
            </View>
            <View className="flex-row gap-2">
              <Pressable
                onPress={handleMarkAll}
                disabled={items.length === 0}
                className="h-[34px] flex-row items-center gap-1.5 rounded-xl border border-white/12 bg-black/45 px-3 active:opacity-70"
                style={items.length === 0 ? { opacity: 0.3 } : null}
              >
                <Check size={14} color={t.neon} strokeWidth={2.6} />
                <Text className="text-[10.5px] font-bold tracking-[0.14em] text-white/85">LEER TODO</Text>
              </Pressable>
              <Pressable
                onPress={handleClearAll}
                disabled={items.length === 0}
                className="h-[34px] w-[34px] items-center justify-center rounded-xl border border-[#FF6B6B]/28 bg-[#FF6B6B]/10 active:opacity-70"
                style={items.length === 0 ? { opacity: 0.3 } : null}
              >
                <Trash2 size={15} color={t.danger} strokeWidth={1.9} />
              </Pressable>
            </View>
          </View>

          <View className="mt-4">
            <FilterChips chips={chips} active={filter} onChange={setFilter} />
          </View>
        </LinearGradient>

        {banner && (
          <View style={{ paddingHorizontal: 18, paddingTop: 10 }}>
            <Banner type={banner.type} title={banner.title} message={banner.message} onClose={() => setBanner(null)} />
          </View>
        )}

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={t.neon} />
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            style={{ backgroundColor: t.bg }}
            contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 120 }}
            stickySectionHeadersEnabled={false}
            showsVerticalScrollIndicator={false}
            ItemSeparatorComponent={() => <View style={{ height: 9 }} />}
            SectionSeparatorComponent={() => <View style={{ height: 9 }} />}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.neon} colors={[t.neon]} />
            }
            renderSectionHeader={({ section }) => (
              <View className="mb-1 mt-2 flex-row items-center gap-2.5">
                <Text className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/42">{section.title}</Text>
                <View className="h-px flex-1 bg-white/8" />
              </View>
            )}
            renderItem={({ item }) => (
              <NotificationCard
                notification={item}
                onPress={handlePress}
                onDelete={handleDelete}
                onPrimary={(n) => respond(n, true)}
                onSecondary={(n) => respond(n, false)}
              />
            )}
            ListEmptyComponent={
              <View className="mt-10 items-center gap-3 rounded-[20px] border border-dashed border-[#00FF66]/28 bg-[#00FF66]/5 px-5 py-7">
                <View className="h-[46px] w-[46px] items-center justify-center rounded-2xl border border-[#00FF66]/30 bg-[#00FF66]/8">
                  <BellOff size={21} color={t.neon} strokeWidth={1.9} />
                </View>
                <Text className="text-[16px] font-bold text-white">Todo al día</Text>
                <Text className="text-center text-[13.5px] leading-5 text-white/45">No tienes avisos pendientes en este filtro.</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}
