import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ShieldCheck, TrendingUp, TrendingDown } from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import { getTrustScoreHistory } from '../services/settings';
import { getMyProfile } from '../services/profile';

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('es-CL', {
      day: '2-digit', month: 'short', year: 'numeric',
    }) + ' · ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function HistoryItem({ item }) {
  const isPositive = item.change_amount > 0;
  const color = isPositive ? colors.primary : colors.error;
  const sign = isPositive ? '+' : '';
  const Icon = isPositive ? TrendingUp : TrendingDown;

  return (
    <View style={styles.item}>
      <View style={[styles.iconBubble, { backgroundColor: isPositive ? colors.primarySoft : 'rgba(229,72,77,0.12)' }]}>
        <Icon color={color} size={16} />
      </View>
      <View style={styles.itemInfo}>
        <Text style={styles.itemReason}>{item.reason}</Text>
        <Text style={styles.itemDate}>{formatDate(item.created_at)}</Text>
      </View>
      <Text style={[styles.itemChange, { color }]}>
        {sign}{item.change_amount}
      </Text>
    </View>
  );
}

export default function TrustScoreHistoryScreen({ navigation }) {
  const [history, setHistory] = useState([]);
  const [trustScore, setTrustScore] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [{ data }, profile] = await Promise.all([
      getTrustScoreHistory(100),
      getMyProfile(),
    ]);
    setHistory(data);
    setTrustScore(profile?.trust_score ?? 100);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={colors.textPrimary} size={20} />
        </Pressable>
        <Text style={styles.headerTitle}>Trust Score</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Score actual */}
      <View style={styles.scoreCard}>
        <ShieldCheck color={colors.primary} size={28} />
        <Text style={styles.scoreValue}>{trustScore ?? '—'}</Text>
        <Text style={styles.scoreLabel}>Puntuación actual</Text>
        <Text style={styles.scoreHint}>
          El Trust Score refleja tu confiabilidad como jugador. Aumenta al confirmar asistencia por GPS.
        </Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : history.length === 0 ? (
        <View style={styles.empty}>
          <ShieldCheck color={colors.textMuted} size={40} />
          <Text style={styles.emptyTitle}>Sin historial aún</Text>
          <Text style={styles.emptyText}>
            Confirma tu asistencia a partidos por GPS para ver los cambios aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <HistoryItem item={item} />}
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

  scoreCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    padding: 24,
    gap: 6,
  },
  scoreValue: {
    color: colors.primary,
    fontSize: 52, fontWeight: '900', letterSpacing: -1,
    marginTop: 4,
  },
  scoreLabel: {
    color: colors.textSecondary,
    fontSize: 13, fontWeight: '600',
  },
  scoreHint: {
    color: colors.textMuted,
    fontSize: 12, lineHeight: 17, textAlign: 'center',
    marginTop: 8, paddingHorizontal: 8,
  },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  empty: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 40, gap: 12,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 17, fontWeight: '700',
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 14, lineHeight: 20, textAlign: 'center',
  },

  list: { paddingHorizontal: 16, paddingBottom: 32 },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 14,
    gap: 12,
  },
  iconBubble: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  itemInfo: { flex: 1 },
  itemReason: {
    color: colors.textPrimary,
    fontSize: 14, fontWeight: '600', marginBottom: 2,
  },
  itemDate: { color: colors.textMuted, fontSize: 12 },
  itemChange: {
    fontSize: 18, fontWeight: '800',
    flexShrink: 0,
  },

  separator: { height: 8 },
});
