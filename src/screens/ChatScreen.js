import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  RefreshControl,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  MessageCircle,
  Users,
  User as UserIcon,
  Sparkles,
  EyeOff,
  UserPlus,
  UserCheck,
  UserX,
  Send,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import Banner from '../components/Banner';
import { colors, radius } from '../theme/colors';
import { listMyThreads, subscribeToMessages, hideThread } from '../services/messages';
import {
  listMyFriends,
  listIncomingRequests,
  acceptFriendRequest,
  rejectFriendRequest,
} from '../services/friends';
import { isSupabaseConfigured } from '../services/supabase';

function timeAgo(iso) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d} d`;
    return new Date(iso).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' });
  } catch {
    return '';
  }
}

export default function ChatScreen({ navigation }) {
  const [tab, setTab] = useState('all'); // 'all' | 'dm' | 'match' | 'friends'
  const [threads, setThreads] = useState([]);
  const [friends, setFriends] = useState([]);
  const [incomingReqs, setIncomingReqs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const [result, frs, reqs] = await Promise.all([
        listMyThreads(),
        listMyFriends(),
        listIncomingRequests(),
      ]);
      const list = result?.data || [];
      setThreads(list);
      setFriends(frs || []);
      setIncomingReqs(reqs || []);
      if (result?.error) {
        const msg = result.error.message || String(result.error);
        // Caso típico: tabla messages no existe (migration 04 sin correr)
        if (/relation .* messages.* does not exist/i.test(msg) ||
            /undefined.*messages/i.test(msg)) {
          setErrorBanner({
            type: 'error',
            title: 'Chat no está configurado',
            message: 'Falta correr la migration 04 en Supabase (crea la tabla messages).',
          });
        } else {
          setErrorBanner({
            type: 'error',
            title: 'No pude cargar tus chats',
            message: msg,
          });
        }
      } else {
        setErrorBanner(null);
      }
    } catch (e) {
      console.error('[FutFinder] ChatScreen.load exception:', e);
      setErrorBanner({
        type: 'error',
        title: 'Error inesperado',
        message: e?.message || String(e),
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const unsubFocus = navigation.addListener('focus', load);
    let unsubRT = () => {};
    try {
      unsubRT = subscribeToMessages(() => load());
    } catch (e) {
      console.warn('[FutFinder] No se pudo suscribir a Realtime:', e?.message || e);
    }
    return () => {
      unsubFocus();
      try { unsubRT(); } catch {}
    };
  }, [load, navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const filtered = useMemo(() => {
    if (tab === 'friends' || tab === 'all') return threads;
    return threads.filter((t) => t.type === tab);
  }, [tab, threads]);

  const unreadTotal = threads.reduce((acc, t) => acc + (t.unread || 0), 0);

  const handleHide = async (threadKey) => {
    const ok =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm('¿Esconder esta conversación de tu vista? Reaparecerá si llega un mensaje nuevo.')
        : true;
    if (!ok) return;
    setBusyId(threadKey);
    await hideThread(threadKey);
    setBusyId(null);
    load();
  };

  const handleAcceptReq = async (friendshipId) => {
    setBusyId(friendshipId);
    await acceptFriendRequest(friendshipId);
    setBusyId(null);
    load();
  };

  const handleRejectReq = async (friendshipId) => {
    setBusyId(friendshipId);
    await rejectFriendRequest(friendshipId);
    setBusyId(null);
    load();
  };

  const openDM = (userId, username) => {
    navigation.getParent()?.navigate('ChatThread', {
      threadKey: 'dm:' + userId,
      title: '@' + (username || 'jugador'),
      subtitle: 'Mensaje directo',
    });
  };

  const openUserProfile = (userId) => {
    navigation.getParent()?.navigate('UserProfile', { userId });
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Logo size={28} />
        </View>

        {/* Title */}
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          <Text style={styles.bigTitle}>Chats y amigos</Text>
        </View>

        {/* Tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsRow}
          style={styles.tabsScroll}
        >
          <TabPill
            label="Todos"
            count={threads.length}
            active={tab === 'all'}
            onPress={() => setTab('all')}
          />
          <TabPill
            label="Directos"
            count={threads.filter((t) => t.type === 'dm').length}
            active={tab === 'dm'}
            onPress={() => setTab('dm')}
          />
          <TabPill
            label="Partidos"
            count={threads.filter((t) => t.type === 'match').length}
            active={tab === 'match'}
            onPress={() => setTab('match')}
          />
          <TabPill
            label="Amigos"
            count={friends.length + incomingReqs.length}
            active={tab === 'friends'}
            onPress={() => setTab('friends')}
            highlight={incomingReqs.length > 0}
          />
        </ScrollView>

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
            />
          }
        >
          {errorBanner && (
            <Banner
              type={errorBanner.type}
              title={errorBanner.title}
              message={errorBanner.message}
              onClose={() => setErrorBanner(null)}
            />
          )}

          {loading && filtered.length === 0 && tab !== 'friends' && (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Cargando conversaciones…</Text>
            </View>
          )}

          {/* === Tab Amigos === */}
          {tab === 'friends' && (
            <>
              {incomingReqs.length > 0 && (
                <>
                  <Text style={styles.sectionHeading}>SOLICITUDES RECIBIDAS</Text>
                  {incomingReqs.map((r) => (
                    <View key={r.friendship_id} style={styles.threadRow}>
                      <Pressable
                        onPress={() => openUserProfile(r.user_id)}
                        style={styles.avatar}
                      >
                        <UserIcon color={colors.primary} size={20} />
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.threadTitle} numberOfLines={1}>
                          @{r.username}
                        </Text>
                        <Text style={styles.threadPreview} numberOfLines={1}>
                          Quiere agregarte como amigo · Trust {r.trust_score}
                        </Text>
                      </View>
                      <Pressable
                        onPress={() => handleAcceptReq(r.friendship_id)}
                        disabled={busyId === r.friendship_id}
                        style={({ pressed }) => [
                          styles.acceptBtn,
                          pressed && { opacity: 0.85 },
                        ]}
                      >
                        <UserCheck color="#0E0E0D" size={14} />
                      </Pressable>
                      <Pressable
                        onPress={() => handleRejectReq(r.friendship_id)}
                        disabled={busyId === r.friendship_id}
                        style={({ pressed }) => [
                          styles.rejectBtn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <UserX color={colors.error} size={14} />
                      </Pressable>
                    </View>
                  ))}
                </>
              )}

              <Text style={styles.sectionHeading}>
                {friends.length > 0 ? 'MIS AMIGOS' : 'TODAVÍA NO TIENES AMIGOS'}
              </Text>

              {friends.length === 0 && incomingReqs.length === 0 && (
                <View style={styles.empty}>
                  <View style={styles.emptyIcon}>
                    <UserPlus color={colors.primary} size={28} strokeWidth={1.6} />
                  </View>
                  <Text style={styles.emptyTitle}>Empieza a hacer red</Text>
                  <Text style={styles.emptyText}>
                    Visita el perfil de otros jugadores (desde un partido o
                    buscando) y tócales "Agregar amigo".
                  </Text>
                </View>
              )}

              {friends.map((f) => (
                <View key={f.friendship_id} style={styles.threadRow}>
                  <Pressable
                    onPress={() => openUserProfile(f.user_id)}
                    style={styles.avatar}
                  >
                    <UserIcon color={colors.primary} size={20} />
                  </Pressable>
                  <Pressable
                    onPress={() => openUserProfile(f.user_id)}
                    style={{ flex: 1 }}
                  >
                    <Text style={styles.threadTitle} numberOfLines={1}>
                      @{f.username}
                    </Text>
                    <Text style={styles.threadPreview} numberOfLines={1}>
                      {f.comuna ? f.comuna + ' · ' : ''}Trust {f.trust_score}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openDM(f.user_id, f.username)}
                    style={({ pressed }) => [
                      styles.dmBtn,
                      pressed && { opacity: 0.85 },
                    ]}
                  >
                    <Send color={colors.primary} size={14} />
                  </Pressable>
                </View>
              ))}
            </>
          )}

          {tab !== 'friends' && !loading && filtered.length === 0 && (
            <EmptyState
              type={tab}
              onCreate={() => navigation.navigate('SearchTab')}
            />
          )}

          {tab !== 'friends' && filtered.map((t) => (
            <Pressable
              key={t.key}
              onPress={() =>
                navigation.getParent()?.navigate('ChatThread', {
                  threadKey: t.key,
                  title: t.title,
                  subtitle: t.subtitle,
                  fotoUrl: t.foto_url || null,
                })
              }
              style={({ pressed }) => [
                styles.threadRow,
                pressed && { opacity: 0.85 },
              ]}
            >
              <View
                style={[
                  styles.avatar,
                  t.type === 'match' && styles.avatarMatch,
                ]}
              >
                {t.foto_url ? (
                  <Image source={{ uri: t.foto_url }} style={styles.avatarImg} />
                ) : t.type === 'dm' ? (
                  <UserIcon color={colors.primary} size={20} />
                ) : (
                  <Users color={colors.primary} size={20} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.threadTopRow}>
                  <Text style={styles.threadTitle} numberOfLines={1}>
                    {t.title}
                  </Text>
                  <Text style={styles.threadTime}>{timeAgo(t.last_at)}</Text>
                </View>
                <View style={styles.threadBottomRow}>
                  <Text
                    style={[
                      styles.threadPreview,
                      t.unread > 0 && { color: colors.textPrimary, fontWeight: '700' },
                    ]}
                    numberOfLines={1}
                  >
                    {t.last_message?.content || t.subtitle}
                  </Text>
                  {t.unread > 0 && (
                    <View style={styles.unreadBadge}>
                      <Text style={styles.unreadBadgeText}>{t.unread}</Text>
                    </View>
                  )}
                </View>
                {t.type === 'match' && (
                  <View style={styles.matchTag}>
                    <Sparkles color={colors.primary} size={10} />
                    <Text style={styles.matchTagText}>Chat de partido</Text>
                  </View>
                )}
              </View>
              <Pressable
                onPress={(e) => {
                  e.stopPropagation?.();
                  handleHide(t.key);
                }}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.hideBtn,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <EyeOff color={colors.textMuted} size={14} />
              </Pressable>
            </Pressable>
          ))}

          {!isSupabaseConfigured && (
            <Text style={styles.demoNotice}>
              ⚠️ Modo demo — el chat se activa cuando Supabase esté configurado.
            </Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function TabPill({ label, count, active, onPress, highlight = false }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabPill,
        active && styles.tabPillActive,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.tabPillText, active && styles.tabPillTextActive]}>
        {label}
      </Text>
      {count > 0 && (
        <Text
          style={[
            styles.tabPillCount,
            active && styles.tabPillCountActive,
            highlight && !active && styles.tabPillCountHighlight,
          ]}
        >
          {count}
        </Text>
      )}
      {highlight && !active && <View style={styles.tabPillDot} />}
    </Pressable>
  );
}

function EmptyState({ type, onCreate }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MessageCircle color={colors.primary} size={32} strokeWidth={1.5} />
      </View>
      <Text style={styles.emptyTitle}>Aún no tienes conversaciones</Text>
      <Text style={styles.emptyText}>
        {type === 'match'
          ? 'Cuando te inscribas a un partido, el chat grupal aparecerá aquí.'
          : type === 'dm'
          ? 'Los mensajes directos con otros jugadores aparecerán aquí.'
          : 'Inscríbete a un partido para empezar a chatear con otros jugadores.'}
      </Text>
      <Pressable
        onPress={onCreate}
        style={({ pressed }) => [
          styles.emptyBtn,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.emptyBtnText}>Buscar partidos</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.error,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.background,
  },
  unreadDotText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '800',
  },
  bigTitle: {
    color: colors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  tabsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 16,
  },
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  tabPillActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  tabPillText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.2,
    includeFontPadding: false,
  },
  tabPillTextActive: {
    color: colors.primary,
    fontWeight: '800',
  },
  tabPillCount: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textMuted,
    includeFontPadding: false,
  },
  tabPillCountActive: {
    color: colors.primary,
  },
  tabPillCountHighlight: {
    color: colors.error,
  },
  tabPillDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.error,
    marginLeft: 1,
  },
  sectionHeading: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    marginTop: 8,
    marginBottom: 10,
  },
  hideBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dmBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 18,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    justifyContent: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },

  threadRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginBottom: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarMatch: {
    backgroundColor: colors.background,
    borderColor: colors.primary,
  },
  threadTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  threadTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
    marginRight: 8,
  },
  threadTime: {
    color: colors.textMuted,
    fontSize: 11,
  },
  threadBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  threadPreview: {
    color: colors.textSecondary,
    fontSize: 12,
    flex: 1,
  },
  unreadBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    color: '#0E0E0D',
    fontSize: 11,
    fontWeight: '800',
  },
  matchTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  matchTagText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  empty: {
    alignItems: 'center',
    padding: 28,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primarySoft,
    borderWidth: 1.5,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  emptyBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  emptyBtnText: {
    color: '#0E0E0D',
    fontSize: 13,
    fontWeight: '800',
  },

  demoNotice: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 16,
  },
});
