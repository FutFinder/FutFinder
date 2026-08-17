import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ArrowLeft, Check, Trash2, BellOff, ServerCrash } from 'lucide-react-native';

import { tactical as t } from '../theme/colors';
import Banner from '../components/Banner';
import NotificationCard, { CATEGORY } from '../components/notifications/NotificationCard';
import FilterChips from '../components/notifications/FilterChips';
import { getCurrentUser } from '../services/auth';
import { getMisClubesAdmin, respondToRequest, getClubById } from '../services/clubs';
import { getMatchById } from '../services/matches';
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
import { navigateToNotification } from '../utils/notificationTargets';
import { puedeResponderDesafio } from '../utils/permisosDesafio';
import {
  getInboxStatus,
  createRequestGuard,
  runOptimistic,
  withAllRead,
  withoutId,
  withActionsResolved,
} from '../utils/notificationInbox';

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

// Ids "sintéticos" para las acciones globales — comparten el mismo guard y
// el mismo set de busyIds que las notificaciones individuales, ya que no
// hay colisión posible con un uuid real.
const MARK_ALL_ID = '__markAll__';
const CLEAR_ALL_ID = '__clearAll__';

/**
 * Acciones inline disponibles para este aviso, o null si solo navega al tocar.
 *
 * `clubesAdmin` son TODOS los clubes que administra el usuario. Antes se
 * comparaba contra `getMyClub()`, que devuelve el PRIMERO por `joined_at`:
 * quien administra varios sólo veía botones en los retos dirigidos al club
 * más antiguo, y los demás llegaban sin acciones y sin explicación.
 */
function actionsFor(n, clubesAdmin) {
  const data = n?.data || {};
  if (n.type === 'club_challenge' && data.challengeId) {
    // Sin `estado` en el payload: se ofrece y responde el servidor si el
    // desafío ya dejó de estar pendiente.
    return puedeResponderDesafio({ clubesAdmin, clubRetadoId: data.clubRetadoId })
      ? ['Aceptar reto', 'Rechazar']
      : null;
  }
  if (n.type === 'club_request' && data.requestId) {
    return ['Aceptar', 'Rechazar'];
  }
  if (n.type === 'friend_request' && data.friendshipId) {
    return ['Aceptar', 'Rechazar'];
  }
  return null;
}

export default function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  // TODOS los clubes que administro. `null` es «no se pudo averiguar» y no
  // se confunde con «no administro ninguno» ([]).
  const [clubesAdmin, setClubesAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('todos');
  const [banner, setBanner] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const navigatingIds = useRef(new Set());
  const actionGuard = useRef(createRequestGuard()).current;

  const setBusy = useCallback((id, isBusy) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    const [{ data, error }, clubResult] = await Promise.all([
      listNotifications({ limit: 50 }),
      getMisClubesAdmin(),
    ]);
    if (error) {
      // No pisamos `items`: si ya había una lista cargada, se queda ahí
      // debajo del estado de error hasta el próximo reintento exitoso.
      setLoadError(error);
      return;
    }
    setLoadError(null);
    setItems(data || []);
    setClubesAdmin(clubResult?.data ?? null);
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const status = getInboxStatus({ loading, loadError });

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

  const handleRetry = async () => {
    setLoading(true);
    await load();
    setLoading(false);
  };

  const handlePress = async (n) => {
    // Guarda contra el doble tap: mientras se resuelve el destino de esta
    // notificación, un segundo tap sobre la misma tarjeta no dispara otra
    // navegación.
    if (navigatingIds.current.has(n.id)) return;
    navigatingIds.current.add(n.id);

    if (!n.read) {
      setItems((prev) => prev.map((p) => (p.id === n.id ? { ...p, read: true } : p)));
      markAsRead(n.id);
    }
    // Desde una tab, los screens del root stack se alcanzan subiendo al padre.
    const root = navigation.getParent() || navigation;
    try {
      await navigateToNotification(n, {
        navigate: (screen, params) => root.navigate(screen, params),
        onMissing: (copy) => setBanner({ type: 'info', title: copy.title, message: copy.message }),
        onUnresolved: (copy) => setBanner({ type: 'info', title: copy.title, message: copy.message }),
        getMatchById,
        getClubById,
      });
    } finally {
      navigatingIds.current.delete(n.id);
    }
  };

  const handleDelete = async (id) => {
    if (!actionGuard.begin(id)) return;
    setBusy(id, true);
    const { error } = await runOptimistic({
      items,
      apply: (list) => withoutId(list, id),
      action: () => deleteNotification(id),
      setItems,
    });
    actionGuard.end(id);
    setBusy(id, false);
    if (error) {
      setBanner({ type: 'error', title: 'No pudimos eliminar el aviso', message: error.message || '' });
    }
  };

  const handleMarkAll = async () => {
    if (items.length === 0) return;
    if (!actionGuard.begin(MARK_ALL_ID)) return;
    setBusy(MARK_ALL_ID, true);
    const { error } = await runOptimistic({
      items,
      apply: withAllRead,
      action: () => markAllAsRead(),
      setItems,
    });
    actionGuard.end(MARK_ALL_ID);
    setBusy(MARK_ALL_ID, false);
    if (error) {
      setBanner({ type: 'error', title: 'No pudimos marcar todo como leído', message: error.message || '' });
    }
  };

  const handleClearAll = async () => {
    if (items.length === 0) return;
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('¿Borrar todas las notificaciones? Esta acción no se puede deshacer.')
        : true;
    if (!ok) return;
    if (!actionGuard.begin(CLEAR_ALL_ID)) return;
    setBusy(CLEAR_ALL_ID, true);
    const { error } = await runOptimistic({
      items,
      apply: () => [],
      action: () => deleteAllNotifications(),
      setItems,
    });
    actionGuard.end(CLEAR_ALL_ID);
    setBusy(CLEAR_ALL_ID, false);
    if (error) {
      setBanner({ type: 'error', title: 'No pudimos borrar las notificaciones', message: error.message || '' });
    }
  };

  const respond = async (n, accept) => {
    const id = n.id;
    // A diferencia de eliminar/marcar todo, aceptar o rechazar tiene
    // consecuencias reales (une a un club, confirma una amistad...), así que
    // no lo aplicamos de forma optimista: se muestra ocupado y solo se
    // actualiza la tarjeta cuando el servidor confirmó qué pasó.
    if (!actionGuard.begin(id)) return;
    setBusy(id, true);

    const data = n.data || {};
    let error = null;
    let threadKey = null;
    if (n.type === 'club_challenge') {
      ({ error, threadKey } = await respondChallenge(data.challengeId, accept));
    } else if (n.type === 'club_request') {
      ({ error } = await respondToRequest(data.requestId, accept));
    } else if (n.type === 'friend_request') {
      ({ error } = accept
        ? await acceptFriendRequest(data.friendshipId)
        : await rejectFriendRequest(data.friendshipId));
    }

    actionGuard.end(id);
    setBusy(id, false);

    if (error) {
      setBanner({ type: 'error', title: 'No pudimos procesar tu respuesta', message: error.message || '' });
      return;
    }
    setItems((prev) => withActionsResolved(prev, id));
    markAsRead(id);

    // Aceptar un desafío desde el aviso abre el chat de negociación: es
    // donde hay que actuar a continuación, y dejar al usuario mirando la
    // bandeja de avisos lo obligaría a buscarlo por su cuenta.
    if (threadKey) {
      navigation.navigate('ChatThread', { threadKey, challengeId: data.challengeId });
    }
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
        actions: n._actionsResolved ? null : actionsFor(n, clubesAdmin),
      })),
    }));
  }, [items, filter, clubesAdmin]);

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
            <View className="flex-row items-center gap-3">
              <Pressable
                onPress={() => navigation.goBack()}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Salir de Avisos"
                className="h-[34px] w-[34px] items-center justify-center rounded-xl border border-white/12 bg-black/45 active:opacity-70"
              >
                <ArrowLeft size={16} color={t.text} strokeWidth={2.2} />
              </Pressable>
              <View>
                <Text className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#00FF66]/75">Centro de actividad</Text>
                <Text className="mt-1 text-[30px] font-extrabold tracking-tight text-white">Avisos</Text>
              </View>
            </View>
            <View className="flex-row gap-2">
              <Pressable
                onPress={handleMarkAll}
                disabled={items.length === 0 || busyIds.has(MARK_ALL_ID)}
                className="h-[34px] flex-row items-center gap-1.5 rounded-xl border border-white/12 bg-black/45 px-3 active:opacity-70"
                style={items.length === 0 || busyIds.has(MARK_ALL_ID) ? { opacity: 0.3 } : null}
              >
                {busyIds.has(MARK_ALL_ID) ? (
                  <ActivityIndicator size="small" color={t.neon} />
                ) : (
                  <Check size={14} color={t.neon} strokeWidth={2.6} />
                )}
                <Text className="text-[10.5px] font-bold tracking-[0.14em] text-white/85">LEER TODO</Text>
              </Pressable>
              <Pressable
                onPress={handleClearAll}
                disabled={items.length === 0 || busyIds.has(CLEAR_ALL_ID)}
                className="h-[34px] w-[34px] items-center justify-center rounded-xl border border-[#FF6B6B]/28 bg-[#FF6B6B]/10 active:opacity-70"
                style={items.length === 0 || busyIds.has(CLEAR_ALL_ID) ? { opacity: 0.3 } : null}
              >
                {busyIds.has(CLEAR_ALL_ID) ? (
                  <ActivityIndicator size="small" color={t.danger} />
                ) : (
                  <Trash2 size={15} color={t.danger} strokeWidth={1.9} />
                )}
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

        {status === 'loading' ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color={t.neon} />
          </View>
        ) : status === 'error' ? (
          <View className="flex-1 items-center justify-center gap-3 px-8">
            <View className="h-[46px] w-[46px] items-center justify-center rounded-2xl border border-[#FF6B6B]/30 bg-[#FF6B6B]/8">
              <ServerCrash size={21} color={t.danger} strokeWidth={1.9} />
            </View>
            <Text className="text-[16px] font-bold text-white">No pudimos cargar tus avisos</Text>
            <Text className="text-center text-[13.5px] leading-5 text-white/45">
              {loadError?.message || 'El servidor no respondió. Revisa tu conexión e intenta de nuevo.'}
            </Text>
            <Pressable
              onPress={handleRetry}
              className="mt-1 h-11 items-center justify-center rounded-[13px] bg-[#00FF66] px-6 active:opacity-80"
            >
              <Text className="text-[14px] font-bold text-[#04120A]">Reintentar</Text>
            </Pressable>
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
                <Text className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/40">{section.title}</Text>
                <View className="h-px flex-1 bg-white/8" />
              </View>
            )}
            renderItem={({ item }) => (
              <NotificationCard
                notification={item}
                busy={busyIds.has(item.id)}
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
