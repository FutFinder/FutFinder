import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Shield,
  Search as SearchIcon,
  ChevronRight,
  Swords,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import ClubCard from '../components/ClubCard';
import { searchClubs, getMyClubs } from '../services/clubs';

/**
 * Exploración de clubes: buscador + listado de TODOS los clubes de FutFinder.
 * Se abre desde ClubsScreen cuando el usuario ya pertenece a un club y quiere
 * descubrir otros. Tocar un club abre su ClubDetailScreen (modo visitante o
 * miembro según corresponda).
 */
export default function ExploreClubsScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clubs, setClubs] = useState([]);
  const [query, setQuery] = useState('');
  const [soyAdminDeAlgo, setSoyAdminDeAlgo] = useState(false);
  const [misClubIds, setMisClubIds] = useState(new Set());

  const load = useCallback(async (q = '') => {
    const [{ data }, { data: mine }] = await Promise.all([
      searchClubs(q),
      getMyClubs(),
    ]);
    setClubs(data || []);
    setSoyAdminDeAlgo((mine || []).some((m) => m.miRol === 'admin'));
    setMisClubIds(new Set((mine || []).map((m) => m.club?.id).filter(Boolean)));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(query);
    }, [load]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load(query);
    setRefreshing(false);
  };

  const onSearch = async (text) => {
    setQuery(text);
    const { data } = await searchClubs(text);
    setClubs(data || []);
  };

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
        <Text style={styles.headerTitle}>Explorar clubes</Text>
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={clubs}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListHeaderComponent={
            <View>
              <View style={styles.searchBox}>
                <SearchIcon color={colors.textMuted} size={18} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Buscar clubes por nombre..."
                  placeholderTextColor={colors.textMuted}
                  value={query}
                  onChangeText={onSearch}
                  autoCapitalize="none"
                />
              </View>
              <Text style={styles.sectionTitle}>
                {query.trim() ? 'Resultados' : 'Clubes en FutFinder'}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const puedoDesafiar = soyAdminDeAlgo && !misClubIds.has(item.id);
            return (
              <ClubCard
                club={item}
                onPress={() => navigation.navigate('ClubDetail', { clubId: item.id })}
                right={
                  puedoDesafiar ? (
                    <Pressable
                      onPress={() =>
                        navigation.navigate('ClubChallenge', {
                          rivalClubId: item.id,
                          rivalNombre: item.nombre,
                          rivalFotoUrl: item.foto_url || null,
                        })
                      }
                      hitSlop={6}
                      style={({ pressed }) => [styles.desafiarBtn, pressed && { opacity: 0.7 }]}
                    >
                      <Swords color="#0E0E0D" size={14} strokeWidth={2.4} />
                      <Text style={styles.desafiarText}>Desafiar</Text>
                    </Pressable>
                  ) : (
                    <ChevronRight color={colors.textMuted} size={18} />
                  )
                }
              />
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Shield color={colors.textMuted} size={42} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>
                {query.trim() ? 'Sin resultados' : 'Todavía no hay clubes'}
              </Text>
              <Text style={styles.emptyText}>
                {query.trim()
                  ? 'Intenta con otro nombre.'
                  : 'Sé el primero en crear un club en tu barrio.'}
              </Text>
            </View>
          }
          contentContainerStyle={styles.listContent}
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
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  desafiarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  desafiarText: { color: '#0E0E0D', fontSize: 12, fontWeight: '800' },
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
    marginBottom: 16,
    marginTop: 4,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
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
