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
import {
  Bell,
  MessageCircle,
  Users,
  User as UserIcon,
  Sparkles,
} from 'lucide-react-native';

import Logo from '../components/Logo';
import { colors, radius } from '../theme/colors';
import { listMyThreads, subscribeToMessages } from '../services/messages';
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
  const [tab, setTab] = useState('all'); // 'all' | 'dm' | 'match'
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await listMyThreads();
    setThreads(list);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    load();
    // Refrescar la lista cuando volvemos a la pestaña Chat
    const unsubFocus = navigation.addListener('focus', load);

    // Suscripción Realtime: cuando llegue/cambie cualquier mensaje
    // refrescamos la lista. Es barato comparado a la fluidez.
    const unsubRT = subscribeToMessages(() => {
      load();
    });

    return () => {
      unsubFocus();
      unsubRT();
    };
  }, [load, navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const filtered = useMemo(() => {
    if (tab === 'all') return threads;
    return threads.filter((t) => t.type === tab);
  }, [tab, threads]);

  const unreadTotal = threads.reduce((acc, t) => acc + (t.unread || 0), 0);

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header */}
        <View style={styles.header}>
          <Logo size={28} />
          <View style={{ position: 'relative' }}>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
            >
              <Bell color={colors.textSecondary} size={20} />
            </Pressable>
            {unreadTotal > 0 && (
              <View style={styles.unreadDot}>
                <Text style={styles.unreadDotText}>
                  {unreadTotal > 9 ? '9+' : unreadTotal}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Title */}
        <View style={{ paddingHorizontal: 20, marginBottom: 12 }}>
          <Text style={styles.bigTitle}>Chats y amigos</Text>
        </View>

        {/* Tabs */}
        <View style={styles.tabsRow}>
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
        </View>

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
          {loading && filtered.length === 0 && (
            <View style={styles.loadingBox}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Cargando conversaciones…</Text>
            </View>
          )}

          {!loading && filtered.length === 0 && (
            <EmptyState
              type={tab}
              onCreate={() => navigation.navigate('SearchTab')}
            />
          )}

          {filtered.map((t) => (
            <Pressable
              key={t.key}
              onPress={() =>
                navigation.getParent()?.navigate('ChatThread', {
                  threadKey: t.key,
                  title: t.title,
                  subtitle: t.subtitle,
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
                {t.type === 'dm' ? (
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

function TabPill({ label, count, active, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.tabPill,
        active && styles.tabPillActive,
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.tabPillText, active && styles.tabPillTextActive]}>
        {label}
      </Text>
      <View style={[styles.tabPillCount, active && styles.tabPillCountActive]}>
        <Text
          style={[
            styles.tabPillCountText,
            active && { color: colors.background },
          ]}
        >
          {count}
        </Text>
      </View>
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
  tabsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  tabPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tabPillText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  tabPillTextActive: {
    color: '#0E0E0D',
  },
  tabPillCount: {
    backgroundColor: colors.background,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 22,
    alignItems: 'center',
  },
  tabPillCountActive: {
    backgroundColor: colors.background,
  },
  tabPillCountText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
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
  },
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
