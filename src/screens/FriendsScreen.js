import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, UserPlus, RotateCw, Search } from 'lucide-react-native';

import PersonRow from '../components/chat/PersonRow';
import { chatColors, dsSizes } from '../theme/colors';
import {
  listMyFriends,
  listIncomingRequests,
  listOutgoingRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  subscribeToFriendships,
} from '../services/friends';
import { notify } from '../utils/notify';
import { threadTimeLabel } from '../utils/chatMeta';

/**
 * «Amigos y solicitudes».
 *
 * Tres pestañas con datos reales: recibidas, enviadas y amigos. Cada acción
 * (aceptar, rechazar, cancelar) escribe en `friendships` y se refleja en la
 * fila sin recargar toda la pantalla, pero además se refresca en segundo
 * plano para que el contador quede correcto.
 *
 * Reglas que se respetan aquí:
 *   - Nunca se ofrece «Agregar amigo» sobre una solicitud pendiente.
 *   - Una solicitud ya resuelta no vuelve a mostrar los botones (queda con su
 *     estado final), así que no se puede aceptar dos veces.
 *   - El botón queda deshabilitado mientras la operación está en vuelo, para
 *     que un doble toque no cree dos escrituras.
 */
export default function FriendsScreen({ navigation }) {
  const [tab, setTab] = useState('recibidas');
  const [incoming, setIncoming] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const [friends, setFriends] = useState([]);
  const [resolved, setResolved] = useState({}); // friendship_id → 'accepted' | 'rejected'
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [inc, out, frs] = await Promise.all([
        listIncomingRequests(),
        listOutgoingRequests(),
        listMyFriends(),
      ]);
      setIncoming(inc || []);
      setOutgoing(out || []);
      setFriends(frs || []);
      setError(false);
    } catch (e) {
      console.error('[FutFinder] FriendsScreen.load:', e);
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const unsub = subscribeToFriendships(() => load());
    return () => {
      try { unsub(); } catch {}
    };
  }, [load]);

  const counts = useMemo(
    () => ({
      recibidas: incoming.filter((r) => !resolved[r.friendship_id]).length,
      enviadas: outgoing.length,
      amigos: friends.length,
    }),
    [incoming, outgoing, friends, resolved]
  );

  const respond = async (request, accept) => {
    if (busyId) return;
    setBusyId(request.friendship_id);
    const { error: err } = accept
      ? await acceptFriendRequest(request.friendship_id)
      : await rejectFriendRequest(request.friendship_id);
    setBusyId(null);

    if (err) {
      notify(
        accept ? 'No pudimos aceptar' : 'No pudimos rechazar',
        err.message || 'Puede que la solicitud ya no exista.'
      );
      load();
      return;
    }
    setResolved((prev) => ({ ...prev, [request.friendship_id]: accept ? 'accepted' : 'rejected' }));
    load();
  };

  const cancel = async (request) => {
    if (busyId) return;
    setBusyId(request.friendship_id);
    const { error: err } = await cancelFriendRequest(request.friendship_id);
    setBusyId(null);
    if (err) {
      notify('No pudimos cancelar', err.message || 'Intenta de nuevo');
      return;
    }
    setOutgoing((prev) => prev.filter((r) => r.friendship_id !== request.friendship_id));
  };

  const openProfile = (userId) => navigation.navigate('UserProfile', { userId });
  const openChat = (user) =>
    navigation.navigate('ChatThread', {
      threadKey: `dm:${user.user_id}`,
      title: '@' + user.username,
      subtitle: 'Amigos',
      fotoUrl: user.foto_url || null,
    });

  const renderRecibidas = () => {
    if (incoming.length === 0) {
      return (
        <Empty
          title="Sin solicitudes pendientes"
          text="Cuando alguien quiera agregarte, la solicitud aparecerá aquí."
        />
      );
    }
    return incoming.map((r) => {
      const state = resolved[r.friendship_id];
      return (
        <PersonRow
          key={r.friendship_id}
          profile={r}
          onPress={() => openProfile(r.user_id)}
          highlight
        >
          {!state && (
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => respond(r, true)}
                disabled={busyId === r.friendship_id}
                accessibilityRole="button"
                accessibilityLabel={`Aceptar la solicitud de @${r.username}`}
                style={({ pressed }) => [
                  styles.accept,
                  busyId === r.friendship_id && { opacity: 0.5 },
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.acceptText}>Aceptar</Text>
              </Pressable>
              <Pressable
                onPress={() => respond(r, false)}
                disabled={busyId === r.friendship_id}
                accessibilityRole="button"
                accessibilityLabel={`Rechazar la solicitud de @${r.username}`}
                style={({ pressed }) => [
                  styles.reject,
                  busyId === r.friendship_id && { opacity: 0.5 },
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={styles.rejectText}>Rechazar</Text>
              </Pressable>
            </View>
          )}

          {state === 'accepted' && (
            <Pressable
              onPress={() => openChat(r)}
              accessibilityRole="button"
              accessibilityLabel={`Ahora son amigos. Abrir el chat con @${r.username}`}
              style={({ pressed }) => [styles.doneAccepted, pressed && { opacity: 0.85 }]}
            >
              <Check color={chatColors.green} size={16} strokeWidth={2.4} />
              <Text style={styles.doneAcceptedText}>Ahora son amigos · Abrir chat</Text>
            </Pressable>
          )}

          {state === 'rejected' && (
            <View style={styles.doneRejected}>
              <Text style={styles.doneRejectedText}>Solicitud rechazada</Text>
            </View>
          )}
        </PersonRow>
      );
    });
  };

  const renderEnviadas = () => {
    if (outgoing.length === 0) {
      return (
        <Empty
          title="No tienes solicitudes enviadas"
          text="Busca jugadores y envíales una solicitud para empezar a chatear."
          action="Buscar jugadores"
          onAction={() =>
            navigation.navigate('Main', {
              screen: 'SearchTab',
              params: { initialMode: 'players' },
            })
          }
        />
      );
    }
    return outgoing.map((r) => (
      <PersonRow
        key={r.friendship_id}
        profile={r}
        line={`Pendiente desde ${threadTimeLabel(r.sent_at)}`}
        onPress={() => openProfile(r.user_id)}
        right={
          <Pressable
            onPress={() => cancel(r)}
            disabled={busyId === r.friendship_id}
            accessibilityRole="button"
            accessibilityLabel={`Cancelar la solicitud enviada a @${r.username}`}
            style={({ pressed }) => [
              styles.cancelBtn,
              busyId === r.friendship_id && { opacity: 0.5 },
              pressed && { opacity: 0.8 },
            ]}
          >
            <Text style={styles.cancelText}>Cancelar</Text>
          </Pressable>
        }
      />
    ));
  };

  const renderAmigos = () => {
    if (friends.length === 0) {
      return (
        <Empty
          title="Todavía no tienes amigos"
          text="Agrega jugadores para hablar sin compartir tu número."
          action="Buscar jugadores"
          onAction={() =>
            navigation.navigate('Main', {
              screen: 'SearchTab',
              params: { initialMode: 'players' },
            })
          }
        />
      );
    }
    return friends.map((f) => (
      <PersonRow
        key={f.friendship_id}
        profile={f}
        onPress={() => openProfile(f.user_id)}
        highlight
        right={
          <Pressable
            onPress={() => openChat(f)}
            accessibilityRole="button"
            accessibilityLabel={`Abrir el chat con @${f.username}`}
            style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.chatBtnText}>Chatear</Text>
          </Pressable>
        }
      />
    ));
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
            Amigos y solicitudes
          </Text>
        </View>

        <View style={styles.segmented}>
          {[
            { id: 'recibidas', label: 'Recibidas' },
            { id: 'enviadas', label: 'Enviadas' },
            { id: 'amigos', label: 'Amigos' },
          ].map((s) => {
            const active = tab === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => setTab(s.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {s.label}
                  {counts[s.id] > 0 ? ` ${counts[s.id]}` : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={chatColors.green} />
            <Text style={styles.loadingText}>Cargando…</Text>
          </View>
        ) : error ? (
          <View style={styles.loading}>
            <Text style={styles.errorTitle}>No pudimos cargar tus amigos</Text>
            <Pressable
              onPress={() => {
                setLoading(true);
                load();
              }}
              accessibilityRole="button"
              accessibilityLabel="Reintentar"
              style={({ pressed }) => [styles.retry, pressed && { opacity: 0.85 }]}
            >
              <RotateCw color={chatColors.inkOnGreen} size={17} strokeWidth={2.2} />
              <Text style={styles.retryText}>Reintentar</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
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
          >
            {tab === 'recibidas' && renderRecibidas()}
            {tab === 'enviadas' && renderEnviadas()}
            {tab === 'amigos' && renderAmigos()}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

function Empty({ title, text, action, onAction }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <UserPlus color={chatColors.green} size={26} strokeWidth={1.7} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{text}</Text>
      {action && (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={action}
          style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.85 }]}
        >
          <Search color={chatColors.green} size={16} strokeWidth={2} />
          <Text style={styles.emptyBtnText}>{action}</Text>
        </Pressable>
      )}
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
    paddingBottom: 12,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: chatColors.textPrimary, fontSize: 17, fontWeight: '800' },

  segmented: {
    flexDirection: 'row',
    marginHorizontal: dsSizes.gutter,
    marginBottom: 16,
    padding: 4,
    borderRadius: 22,
    backgroundColor: chatColors.card,
    borderWidth: 1,
    borderColor: chatColors.borderSoft,
  },
  segment: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  segmentActive: { backgroundColor: chatColors.green },
  segmentText: { color: 'rgba(255,255,255,0.6)', fontSize: 12.5, fontWeight: '700' },
  segmentTextActive: { color: chatColors.inkOnGreen, fontWeight: '800' },

  list: { paddingHorizontal: dsSizes.gutter, paddingBottom: 40, gap: 10 },

  actionRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  accept: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: chatColors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: { color: chatColors.inkOnGreen, fontSize: 13, fontWeight: '800' },
  reject: {
    flex: 1,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: chatColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '800' },

  doneAccepted: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 12,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(90,224,106,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.35)',
  },
  doneAcceptedText: { color: chatColors.green, fontSize: 13, fontWeight: '800' },
  doneRejected: {
    marginTop: 12,
    minHeight: 44,
    borderRadius: 22,
    backgroundColor: chatColors.surface,
    borderWidth: 1,
    borderColor: chatColors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneRejectedText: { color: 'rgba(255,255,255,0.45)', fontSize: 13, fontWeight: '700' },

  cancelBtn: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: chatColors.border,
  },
  cancelText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '800' },

  chatBtn: {
    minHeight: 38,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 18,
    backgroundColor: 'rgba(90,224,106,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.4)',
  },
  chatBtnText: { color: chatColors.green, fontSize: 12, fontWeight: '800' },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: chatColors.textSecondary, fontSize: 13 },
  errorTitle: { color: chatColors.textPrimary, fontSize: 15, fontWeight: '800' },
  retry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    paddingHorizontal: 20,
    borderRadius: 23,
    backgroundColor: chatColors.green,
  },
  retryText: { color: chatColors.inkOnGreen, fontSize: 13.5, fontWeight: '800' },

  empty: { alignItems: 'center', paddingVertical: 50, paddingHorizontal: 24 },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    backgroundColor: 'rgba(90,224,106,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.28)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: { color: chatColors.textPrimary, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  emptyText: {
    marginTop: 7,
    color: 'rgba(255,255,255,0.48)',
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 18,
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.45)',
  },
  emptyBtnText: { color: chatColors.green, fontSize: 13, fontWeight: '800' },
});
