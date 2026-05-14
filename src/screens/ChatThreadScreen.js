import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Send,
  CheckCheck,
  Check,
  Users,
  User as UserIcon,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import {
  listThreadMessages,
  sendMessage,
  markThreadAsRead,
  subscribeToMessages,
  messageBelongsToThread,
  parseThreadKey,
} from '../services/messages';
import { supabase } from '../services/supabase';
import { notify } from '../utils/notify';
import Banner from '../components/Banner';

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.getHours().toString().padStart(2, '0') + ':' +
      d.getMinutes().toString().padStart(2, '0');
  } catch {
    return '';
  }
}

function sameDay(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  if (sameDay(d, today)) return 'Hoy';
  if (sameDay(d, yest)) return 'Ayer';
  return d.toLocaleDateString('es-CL', {
    weekday: 'long',
    day: '2-digit',
    month: 'short',
  });
}

export default function ChatThreadScreen({ route, navigation }) {
  const threadKey = route?.params?.threadKey;
  const title = route?.params?.title || 'Chat';
  const subtitle = route?.params?.subtitle || '';

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [myId, setMyId] = useState(null);
  const [errorBanner, setErrorBanner] = useState(null);

  const listRef = useRef(null);
  const isMountedRef = useRef(true);

  const t = parseThreadKey(threadKey);
  const isGroup = t?.type === 'match';

  // Cargar usuario actual e historial
  useEffect(() => {
    isMountedRef.current = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (isMountedRef.current) setMyId(user?.id || null);

        const result = await listThreadMessages(threadKey, { limit: 60 });
        if (!isMountedRef.current) return;
        const msgs = Array.isArray(result) ? result : (result?.data || []);
        setMessages(msgs);
        if (result?.error) {
          setErrorBanner({
            type: 'error',
            title: 'No pude cargar los mensajes',
            message: result.error.message || String(result.error),
          });
        }
        setLoading(false);
        try { await markThreadAsRead(threadKey); } catch {}
      } catch (e) {
        console.error('[FutFinder] ChatThread load exception:', e);
        if (isMountedRef.current) {
          setLoading(false);
          setErrorBanner({
            type: 'error',
            title: 'Error inesperado',
            message: e?.message || String(e),
          });
        }
      }
    })();
    return () => {
      isMountedRef.current = false;
    };
  }, [threadKey]);

  // Suscripción Realtime (blindada — si falla no crashea la pantalla)
  useEffect(() => {
    let unsubscribe = () => {};
    try {
      unsubscribe = subscribeToMessages((payload) => {
      // payload.eventType: 'INSERT' | 'UPDATE' | 'DELETE'
      // payload.new: la nueva fila (en INSERT/UPDATE)
      const row = payload.new || payload.old;
      if (!row || !myId) return;

      if (payload.eventType === 'INSERT') {
        if (!messageBelongsToThread(row, threadKey, myId)) return;
        setMessages((prev) => {
          // Dedup: si ya existe (lo insertamos optimisticamente) lo ignoramos
          if (prev.some((m) => m.id === row.id)) return prev;
          return [...prev, row];
        });
        // Marcar como leído si llegó a mí mientras estoy viendo el hilo
        if (row.receiver_id === myId && !row.read_at) {
          markThreadAsRead(threadKey);
        }
      } else if (payload.eventType === 'UPDATE') {
        if (!messageBelongsToThread(row, threadKey, myId)) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === row.id ? { ...m, ...row } : m))
        );
      }
    });
    } catch (e) {
      console.warn('[FutFinder] Realtime subscribe failed:', e?.message || e);
    }
    return () => {
      try { unsubscribe(); } catch {}
    };
  }, [threadKey, myId]);

  // Auto-scroll al final cuando llegan mensajes
  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd?.({ animated: true });
      });
    }
  }, [messages.length]);

  const handleSend = useCallback(async () => {
    if (sending) return;
    const content = draft.trim();
    if (!content) return;

    setSending(true);
    setDraft('');

    // Optimistic update: agregamos el mensaje localmente al toque
    const tempId = `temp_${Date.now()}`;
    const optimistic = {
      id: tempId,
      created_at: new Date().toISOString(),
      sender_id: myId,
      content,
      _optimistic: true,
      ...(isGroup ? { match_id: t.id } : { receiver_id: t.id }),
    };
    setMessages((prev) => [...prev, optimistic]);

    const { data, error } = await sendMessage(threadKey, content);
    setSending(false);

    if (error) {
      notify('No pudimos enviar', error.message || 'Intenta de nuevo');
      // Revertir el optimistic
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      return;
    }

    // Reemplazar el optimistic por el real
    if (data) {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? data : m))
      );
    }
  }, [draft, sending, myId, isGroup, t?.id, threadKey]);

  // Cuando tocan el avatar o @username de un mensaje ajeno
  const handlePressSender = useCallback(
    (userId) => {
      if (!userId || userId === myId) return;
      navigation.navigate('UserProfile', { userId });
    },
    [navigation, myId]
  );

  // Renderiza un mensaje + separador de día si corresponde
  const renderItem = ({ item, index }) => {
    const prev = messages[index - 1];
    const showDay = !prev || !sameDay(prev.created_at, item.created_at);
    return (
      <View>
        {showDay && (
          <View style={styles.dayDivider}>
            <Text style={styles.dayDividerText}>{dayLabel(item.created_at)}</Text>
          </View>
        )}
        <Bubble
          message={item}
          isMine={item.sender_id === myId}
          isGroup={isGroup}
          onPressSender={handlePressSender}
        />
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        {/* Header — tappable en DMs (lleva al perfil del otro) */}
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
          >
            <ArrowLeft color={colors.textPrimary} size={20} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (!t?.id) return;
              if (isGroup) {
                navigation.navigate('MatchDetail', { matchId: t.id });
              } else {
                navigation.navigate('UserProfile', { userId: t.id });
              }
            }}
            style={({ pressed }) => [
              styles.headerCenter,
              pressed && { opacity: 0.7 },
            ]}
          >
            <View style={[styles.headerAvatar, isGroup && styles.headerAvatarGroup]}>
              {isGroup ? (
                <Users color={colors.primary} size={16} />
              ) : (
                <UserIcon color={colors.primary} size={16} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
              {subtitle ? (
                <Text style={styles.headerSubtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
              <Text style={styles.headerHint}>
                {isGroup ? 'Toca para ver detalles y jugadores →' : 'Toca para ver perfil →'}
              </Text>
            </View>
          </Pressable>
          <View style={{ width: 40 }} />
        </View>

        {/* Banner de error si algo falla */}
        {errorBanner && (
          <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
            <Banner
              type={errorBanner.type}
              title={errorBanner.title}
              message={errorBanner.message}
              onClose={() => setErrorBanner(null)}
            />
          </View>
        )}

        {/* Lista */}
        {loading ? (
          <View style={styles.loadingFull}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Cargando mensajes anteriores…</Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyFull}>
            <Text style={styles.emptyTitle}>
              {isGroup ? 'Sé el primero en saludar 👋' : 'Empieza la conversación'}
            </Text>
            <Text style={styles.emptyText}>
              {isGroup
                ? 'Coordina con los jugadores del partido sin compartir números.'
                : 'Escribe un mensaje al jugador para coordinar el próximo partido.'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            onContentSizeChange={() =>
              listRef.current?.scrollToEnd?.({ animated: false })
            }
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* Input */}
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Escribe un mensaje…"
            placeholderTextColor={colors.textMuted}
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={1000}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            blurOnSubmit={false}
          />
          <Pressable
            onPress={handleSend}
            disabled={!draft.trim() || sending}
            style={({ pressed }) => [
              styles.sendBtn,
              pressed && { opacity: 0.85 },
              (!draft.trim() || sending) && { opacity: 0.4 },
            ]}
          >
            <Send color="#0E0E0D" size={18} strokeWidth={2.4} />
          </Pressable>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

// ============================================================
// Bubble: la burbujita de chat estilo luxury-night
// ============================================================
function Bubble({ message, isMine, isGroup, onPressSender }) {
  const time = formatTime(message.created_at);
  const senderName = message.sender?.username
    ? '@' + message.sender.username
    : null;
  const showAvatarColumn = !isMine && isGroup;

  const goToSender = () => {
    if (onPressSender && message.sender_id) onPressSender(message.sender_id);
  };

  return (
    <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
      {/* Avatar lateral solo en grupos para mensajes ajenos */}
      {showAvatarColumn && (
        <Pressable
          onPress={goToSender}
          hitSlop={6}
          style={({ pressed }) => [
            styles.bubbleAvatar,
            pressed && { opacity: 0.7 },
          ]}
        >
          <UserIcon color={colors.primary} size={14} />
        </Pressable>
      )}

      <View
        style={[
          styles.bubble,
          isMine ? styles.bubbleMine : styles.bubbleTheirs,
          message._optimistic && { opacity: 0.65 },
        ]}
      >
        {!isMine && isGroup && senderName ? (
          <Pressable
            onPress={goToSender}
            hitSlop={4}
            style={({ pressed }) => pressed && { opacity: 0.7 }}
          >
            <Text style={styles.senderName}>{senderName} ›</Text>
          </Pressable>
        ) : null}
        <Text
          style={[
            styles.bubbleText,
            isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs,
          ]}
          selectable
        >
          {message.content}
        </Text>
        <View style={styles.metaRow}>
          <Text
            style={[
              styles.metaTime,
              isMine ? { color: 'rgba(14,14,13,0.55)' } : { color: colors.textMuted },
            ]}
          >
            {time}
          </Text>
          {isMine && !isGroup && (
            message.read_at ? (
              <CheckCheck color="#0E0E0D" size={12} strokeWidth={2.4} />
            ) : (
              <Check color="rgba(14,14,13,0.55)" size={12} strokeWidth={2.4} />
            )
          )}
        </View>
      </View>
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
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarGroup: {
    backgroundColor: colors.background,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 1,
  },
  headerHint: {
    color: colors.primary,
    fontSize: 10,
    marginTop: 2,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  list: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },

  dayDivider: {
    alignItems: 'center',
    marginVertical: 12,
  },
  dayDividerText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 4,
    marginVertical: 3,
  },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubbleAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },

  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 6,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bubbleMine: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleTheirs: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.borderSoft,
    borderBottomLeftRadius: 4,
  },
  senderName: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
    letterSpacing: 0.2,
  },
  bubbleText: {
    fontSize: 14,
    lineHeight: 19,
  },
  bubbleTextMine: { color: '#0E0E0D' },
  bubbleTextTheirs: { color: colors.textPrimary },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    gap: 4,
    marginTop: 2,
  },
  metaTime: {
    fontSize: 10,
    fontWeight: '600',
  },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 8 : 12,
    backgroundColor: colors.background,
    borderTopWidth: 1,
    borderTopColor: colors.borderSoft,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingFull: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  emptyFull: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
});
