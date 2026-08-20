import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ShieldOff, AlertTriangle } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import { listBlockedUsers, unblockUser } from '../services/blockedUsers';

function inicialDe(profile) {
  const base = profile?.nombre || profile?.username || '';
  return base.trim().charAt(0).toUpperCase() || '?';
}

function BlockedRow({ item, busy, onUnblock }) {
  const profile = item.profile;
  return (
    <View style={styles.row}>
      {profile?.foto_url ? (
        <Image source={{ uri: profile.foto_url }} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarFallback]}>
          <Text style={styles.avatarInitial}>{inicialDe(profile)}</Text>
        </View>
      )}
      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={1}>
          {profile?.nombre || profile?.username || 'Cuenta eliminada'}
        </Text>
        {profile?.username ? (
          <Text style={styles.rowUsername} numberOfLines={1}>@{profile.username}</Text>
        ) : null}
      </View>
      <Pressable
        onPress={onUnblock}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Desbloquear a ${profile?.username || 'este usuario'}`}
        style={({ pressed }) => [
          styles.unblockBtn,
          busy && { opacity: 0.5 },
          pressed && { opacity: 0.85 },
        ]}
      >
        <Text style={styles.unblockText}>{busy ? 'Desbloqueando...' : 'Desbloquear'}</Text>
      </Pressable>
    </View>
  );
}

export default function BlockedUsersScreen({ navigation }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await listBlockedUsers();
    setItems(data || []);
    setError(err);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleUnblock = async (row) => {
    setBusyId(row.id);
    const { error: err } = await unblockUser(row.blockedId);
    setBusyId(null);
    if (err) return;
    setItems((prev) => prev.filter((r) => r.id !== row.id));
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={colors.textPrimary} size={20} />
        </Pressable>
        <Text style={styles.headerTitle}>Bloqueados</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.loadingBox}>
          <AlertTriangle color={colors.error} size={30} strokeWidth={1.8} />
          <Text style={styles.errorTitle}>No pudimos cargar tu lista</Text>
          <Text style={styles.errorMsg}>{error?.message || 'Revisa tu conexión e intenta de nuevo.'}</Text>
          <Pressable
            onPress={load}
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.retryLabel}>Reintentar</Text>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <ShieldOff color={colors.textMuted} size={40} />
          <Text style={styles.emptyTitle}>No has bloqueado a nadie</Text>
          <Text style={styles.emptyText}>
            Cuando bloqueas a alguien desde su perfil, aparece en esta lista y puedes desbloquearlo cuando quieras.
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <BlockedRow item={item} busy={busyId === item.id} onUnblock={() => handleUnblock(item)} />
          )}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 18, fontWeight: '800', letterSpacing: -0.3,
  },

  loadingBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 30,
  },
  errorTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '800', textAlign: 'center' },
  errorMsg: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  retryBtn: {
    marginTop: 4,
    height: 44,
    paddingHorizontal: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: { color: '#0E0E0D', fontSize: 14, fontWeight: '800' },

  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, gap: 12,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  emptyText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },

  list: { paddingHorizontal: 16, paddingBottom: 32 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 12,
    gap: 12,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  avatarInitial: { color: colors.textSecondary, fontSize: 16, fontWeight: '700' },
  rowInfo: { flex: 1 },
  rowName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  rowUsername: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  unblockBtn: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unblockText: { color: colors.textPrimary, fontSize: 12.5, fontWeight: '700' },

  separator: { height: 8 },
});
