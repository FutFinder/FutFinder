import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Search as SearchIcon,
  UserPlus,
  Check,
  Shield,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import { searchPlayers } from '../services/profile';
import { inviteToClub, listMembers } from '../services/clubs';

/**
 * Invitar jugadores al club (vista de admin).
 * Busca por username y envía invitaciones (tipo 'invitacion'):
 * el jugador las ve en su pestaña Clubes y decide si acepta.
 */
export default function ClubInviteScreen({ navigation, route }) {
  const { clubId, clubNombre } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState([]);
  const [memberIds, setMemberIds] = useState(new Set());
  const [invitedIds, setInvitedIds] = useState(new Set());
  const [sendingId, setSendingId] = useState(null);
  const [banner, setBanner] = useState(null);

  const search = useCallback(async (text) => {
    const { data } = await searchPlayers(text, { limit: 30 });
    setPlayers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: members } = await listMembers(clubId);
      setMemberIds(new Set((members || []).map((m) => m.user_id)));
      await search('');
    })();
  }, [clubId, search]);

  const onSearch = (text) => {
    setQuery(text);
    search(text);
  };

  const handleInvite = async (player) => {
    setSendingId(player.id);
    const { error } = await inviteToClub(clubId, player.id);
    setSendingId(null);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo invitar', message: error.message });
      return;
    }
    setInvitedIds((prev) => new Set(prev).add(player.id));
    setBanner({
      type: 'success',
      title: 'Invitación enviada',
      message: `${player.username} verá tu invitación en su pestaña Clubes.`,
    });
  };

  // No tiene sentido invitar a quienes ya son parte del club
  const candidates = players.filter((p) => !memberIds.has(p.id));

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={colors.textPrimary} size={22} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Invitar jugadores</Text>
          {clubNombre ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {clubNombre}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.searchBox}>
        <SearchIcon color={colors.textMuted} size={18} />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar jugadores por username..."
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={onSearch}
          autoCapitalize="none"
          autoFocus
        />
      </View>

      {banner && (
        <View style={styles.bannerWrap}>
          <Banner {...banner} onClose={() => setBanner(null)} />
        </View>
      )}

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={candidates}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const invited = invitedIds.has(item.id);
            return (
              <Pressable
                onPress={() => navigation.navigate('UserProfile', { userId: item.id })}
                style={({ pressed }) => [styles.playerRow, pressed && { opacity: 0.85 }]}
              >
                {item.foto_url ? (
                  <Image source={{ uri: item.foto_url }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarFallback]}>
                    <Shield color={colors.textMuted} size={18} strokeWidth={1.8} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.playerName}>{item.username}</Text>
                  <Text style={styles.playerMeta}>
                    Reputación {item.trust_score ?? 100}
                    {item.comuna ? ` · ${item.comuna}` : ''}
                  </Text>
                </View>
                {invited ? (
                  <View style={styles.invitedChip}>
                    <Check color={colors.primary} size={14} strokeWidth={2.6} />
                    <Text style={styles.invitedText}>Invitado</Text>
                  </View>
                ) : sendingId === item.id ? (
                  <ActivityIndicator color={colors.primary} size="small" />
                ) : (
                  <Pressable
                    onPress={() => handleInvite(item)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.inviteBtn, pressed && { opacity: 0.7 }]}
                  >
                    <UserPlus color="#0E0E0D" size={16} strokeWidth={2.4} />
                  </Pressable>
                )}
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <SearchIcon color={colors.textMuted} size={36} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>
                {query.trim() ? 'Sin resultados' : 'Busca jugadores'}
              </Text>
              <Text style={styles.emptyText}>
                Escribe el username del jugador que quieres sumar a tu club.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 1,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingHorizontal: 14,
    height: 48,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  bannerWrap: { paddingHorizontal: 16 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  avatarFallback: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  playerName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  playerMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  inviteBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invitedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  invitedText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  emptyBox: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800' },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 260,
    lineHeight: 18,
  },
});
