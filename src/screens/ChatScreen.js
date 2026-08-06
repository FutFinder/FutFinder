import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import ChatInboxHeader from '../components/chat/ChatInboxHeader';
import ChatFilterPills from '../components/chat/ChatFilterPills';
import ConversationCard from '../components/chat/ConversationCard';
import { FriendRequestsCard } from '../components/chat/ThreadDecorations';
import {
  InboxSkeleton,
  InboxEmpty,
  InboxError,
  OfflineBanner,
  FilterEmpty,
} from '../components/chat/ChatStates';

import { chatColors, dsSizes } from '../theme/colors';
import { listMyThreads, subscribeToMessages } from '../services/messages';
import { listIncomingRequests, subscribeToFriendships } from '../services/friends';
import { isSupabaseConfigured } from '../services/supabase';
import { filterThreads, filterCounts, sortThreadsByActivity } from '../utils/chatMeta';
import useConnection from '../utils/useConnection';

/**
 * Bandeja «Chats y amigos».
 *
 * Muestra en una sola lista los tres tipos de conversación (partido, club y
 * mensaje directo) ordenados por actividad más reciente, con los no leídos
 * calculados en el servidor.
 *
 * Actualización en tiempo real: cualquier INSERT/UPDATE en `messages` y
 * cualquier cambio en `friendships` recarga la bandeja. La recarga va
 * agrupada en una ventana corta para que una ráfaga de mensajes no dispare
 * veinte consultas seguidas.
 *
 * Un fallo de la carga secundaria (solicitudes de amistad) NO bloquea la
 * pantalla: la bandeja se muestra igual y solo se pierde la tarjeta de
 * solicitudes.
 */
export default function ChatScreen({ navigation }) {
  const [filter, setFilter] = useState('todos');
  const [threads, setThreads] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [now, setNow] = useState(() => new Date());

  const { connection, isOffline, reportChannelStatus } = useConnection();

  const mountedRef = useRef(true);
  const reloadTimerRef = useRef(null);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setError(null);

    const [threadsRes, reqs] = await Promise.all([
      listMyThreads(),
      // La carga secundaria no puede tumbar la bandeja.
      listIncomingRequests().catch(() => []),
    ]);

    if (!mountedRef.current) return;

    if (threadsRes.error) {
      const msg = threadsRes.error.message || String(threadsRes.error);
      const faltaTabla = /messages/i.test(msg) && /does not exist|could not find/i.test(msg);
      setError({
        code: faltaTabla ? 'CH-MIGRACION-04' : threadsRes.error.code || 'CH-503',
        message: faltaTabla
          ? 'Falta correr la migración 04 en Supabase (crea la tabla messages).'
          : msg,
      });
      // Si igual vinieron conversaciones parciales, se muestran.
      if ((threadsRes.data || []).length > 0) setThreads(sortThreadsByActivity(threadsRes.data));
    } else {
      setError(null);
      setThreads(sortThreadsByActivity(threadsRes.data || []));
    }

    setRequests(reqs || []);
    setNow(new Date());
    setLoading(false);
    setRefreshing(false);
  }, []);

  /** Recarga agrupada: varias señales seguidas producen una sola consulta. */
  const scheduleReload = useCallback(() => {
    if (reloadTimerRef.current) return;
    reloadTimerRef.current = setTimeout(() => {
      reloadTimerRef.current = null;
      load({ silent: true });
    }, 400);
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    load();
    return () => {
      mountedRef.current = false;
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, [load]);

  // Recargar al volver a la pestaña (p. ej. tras leer una conversación).
  useEffect(() => navigation.addListener('focus', () => load({ silent: true })), [
    navigation,
    load,
  ]);

  // Realtime: mensajes nuevos y cambios en las solicitudes de amistad.
  useEffect(() => {
    const unsubMessages = subscribeToMessages(scheduleReload, {
      onStatus: reportChannelStatus,
    });
    const unsubFriends = subscribeToFriendships(scheduleReload);
    return () => {
      try { unsubMessages(); } catch {}
      try { unsubFriends(); } catch {}
    };
  }, [scheduleReload, reportChannelStatus]);

  const counts = useMemo(() => filterCounts(threads), [threads]);
  const visible = useMemo(() => filterThreads(threads, filter), [threads, filter]);

  const openThread = useCallback(
    (thread) => {
      navigation.getParent()?.navigate('ChatThread', {
        threadKey: thread.key,
        title: thread.title,
        subtitle: thread.subtitle,
        fotoUrl: thread.foto_url || null,
      });
    },
    [navigation]
  );

  const goFriends = useCallback(
    () => navigation.getParent()?.navigate('Friends'),
    [navigation]
  );
  const goSearchPlayers = useCallback(
    () => navigation.navigate('SearchTab', { initialMode: 'players' }),
    [navigation]
  );
  const goSearchMatches = useCallback(
    () => navigation.navigate('SearchTab', { initialMode: 'matches' }),
    [navigation]
  );
  const goExploreClubs = useCallback(
    () => navigation.getParent()?.navigate('ExploreClubs'),
    [navigation]
  );

  const showRequestsCard =
    requests.length > 0 && (filter === 'todos' || filter === 'amigos');

  const hasNothingAtAll = threads.length === 0 && requests.length === 0;

  const renderBody = () => {
    if (loading) return <InboxSkeleton />;

    if (error && threads.length === 0) {
      return <InboxError code={error.code} onRetry={() => { setLoading(true); load(); }} />;
    }

    if (hasNothingAtAll) {
      return (
        <InboxEmpty onSearchPlayers={goSearchPlayers} onSearchMatches={goSearchMatches} />
      );
    }

    return (
      <FlatList
        data={visible}
        keyExtractor={(t) => t.key}
        renderItem={({ item }) => (
          <ConversationCard thread={item} now={now} onPress={() => openThread(item)} />
        )}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListHeaderComponent={
          showRequestsCard ? (
            <View style={{ marginBottom: 12 }}>
              <FriendRequestsCard requests={requests} onPress={goFriends} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <FilterEmpty filter={filter} onExploreClubs={goExploreClubs} />
        }
        ListFooterComponent={
          <>
            {!!error && threads.length > 0 && (
              <Text style={styles.softError}>
                No pudimos actualizar todo. Desliza para reintentar.
              </Text>
            )}
            {!isSupabaseConfigured && (
              <Text style={styles.demo}>
                Modo demo — el chat se activa cuando Supabase esté configurado.
              </Text>
            )}
          </>
        }
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        windowSize={9}
        removeClippedSubviews={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={chatColors.green}
          />
        }
      />
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ChatInboxHeader pendingRequests={requests.length} onPressFriends={goFriends} />

        {connection !== 'online' && <OfflineBanner />}

        {!loading && !hasNothingAtAll && (
          <ChatFilterPills value={filter} counts={counts} onChange={setFilter} />
        )}

        {renderBody()}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chatColors.background },
  list: {
    paddingHorizontal: dsSizes.gutter,
    paddingBottom: 120, // deja aire sobre la tab bar flotante
  },
  softError: {
    marginTop: 18,
    color: chatColors.warn,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  demo: {
    marginTop: 18,
    color: 'rgba(255,255,255,0.32)',
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
});
