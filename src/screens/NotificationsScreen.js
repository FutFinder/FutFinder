import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  UserPlus,
  Users,
  MessageCircle,
  Calendar,
  Star,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import { getCurrentUser } from '../services/auth';
import {
  listNotifications,
  markAsRead,
  markAllAsRead,
  subscribeToNotifications,
} from '../services/notifications';

/**
 * Pantalla de inbox de notificaciones.
 * - Carga las últimas 50 al entrar.
 * - Realtime: si llega una notif nueva mientras está abierta, se agrega arriba.
 * - Pull-to-refresh.
 * - Tap: marca como leída + navega a la pantalla relacionada (mismo destino
 *   que el tap de la push).
 * - Botón "Marcar todas" en el header.
 */

function NotifIcon({ type }) {
  const props = { size: 18, color: colors.primary, strokeWidth: 2.2 };
  switch (type) {
    case 'friend_request':
      return <UserPlus {...props} />;
    case 'friend_accept':
      return <CheckCheck {...props} />;
    case 'match_join':
      return <Users {...props} />;
    case 'message_new':
      return <MessageCircle {...props} />;
    case 'match_reminder':
      return <Calendar {...props} />;
    case 'match_rate':
      return <Star {...props} />;
    default:
      return <Bell {...props} />;
  }
}

function timeAgo(iso) {
  try {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'ahora';
    if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
    return `hace ${Math.floor(diff / 86400)} d`;
  } catch {
    return '';
  }
}

function navigateForNotif(navigation, n) {
  const data = n?.data || {};
  switch (n?.type) {
    case 'message_new':
      if (data.threadId) {
        navigation.navigate('ChatThread', { threadId: data.threadId });
      }
      break;
    case 'match_join':
    case 'match_reminder':
      if (data.matchId) {
        navigation.navigate('MatchDetail', { matchId: data.matchId });
      }
      break;
    case 'match_rate':
      if (data.matchId) {
        navigation.navigate('RateMatch', { matchId: data.matchId });
      }
      break;
    case 'friend_request':
    case 'friend_accept':
      // Si tienes pantalla de amigos puedes redirigir ahí; por ahora al perfil propio.
      if (data.fromUserId) {
        navigation.navigate('UserProfile', { userId: data.fromUserId });
      }
      break;
    default:
      break;
  }
}

export default function NotificationsScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await listNotifications({ limit: 50 });
    setItems(data || []);
    setLoading(false);
  }, []);

  // Cargar al montar
  useEffect(() => {
    load();
  }, [load]);

  // Realtime: subscribirse a INSERTs nuevos del usuario
  useEffect(() => {
    let unsubscribe = () => {};
    (async () => {
      const user = await getCurrentUser();
      if (!user?.id) return;
      unsubscribe = subscribeToNotifications(user.id, (notif) => {
        // Si ya está en la lista (por race condition), no la duplicamos
        setItems((prev) => {
          if (prev.some((p) => p.id === notif.id)) return prev;
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

  const handleTap = async (n) => {
    if (!n.read) {
      // Optimistic: marcar visualmente como leída ya
      setItems((prev) =>
        prev.map((p) => (p.id === n.id ? { ...p, read: true } : p))
      );
      markAsRead(n.id);
    }
    navigateForNotif(navigation, n);
  };

  const handleMarkAll = async () => {
    setMarkingAll(true);
    setItems((prev) => prev.map((p) => ({ ...p, read: true })));
    await markAllAsRead();
    setMarkingAll(false);
  };

  const unreadCount = items.filter((n) => !n.read).length;

  const renderItem = ({ item }) => {
    return (
      <Pressable
        onPress={() => handleTap(item)}
        style={({ pressed }) => [
          styles.row,
          !item.read && styles.rowUnread,
          pressed && { opacity: 0.85 },
        ]}
      >
        <View style={styles.iconWrap}>
          <NotifIcon type={item.type} />
          {!item.read && <View style={styles.unreadDot} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          {item.body ? (
            <Text style={styles.body} numberOfLines={2}>
              {item.body}
            </Text>
          ) : null}
          <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <View style={styles.root}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
          >
            <ArrowLeft color={colors.textPrimary} size={22} />
          </Pressable>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Notificaciones</Text>
            {unreadCount > 0 && (
              <Text style={styles.headerSubtitle}>{unreadCount} sin leer</Text>
            )}
          </View>

          <Pressable
            onPress={unreadCount > 0 ? handleMarkAll : undefined}
            disabled={unreadCount === 0 || markingAll}
            hitSlop={8}
            style={({ pressed }) => [
              styles.markAllBtn,
              pressed && { opacity: 0.6 },
              unreadCount === 0 && { opacity: 0.3 },
            ]}
          >
            <Check color={colors.primary} size={18} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyBox}>
            <Bell color={colors.textMuted} size={42} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Sin notificaciones</Text>
            <Text style={styles.emptyText}>
              Cuando alguien se una a tu partido, te mande mensaje o solicitud
              de amistad, lo verás acá.
            </Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.sep} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1 },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  markAllBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 40, paddingTop: 8 },
  sep: { height: 8 },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  rowUnread: {
    backgroundColor: colors.surface,
    borderColor: colors.primary + '55',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.background,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  time: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 6,
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    gap: 12,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginTop: 6,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
    maxWidth: 280,
  },
});
