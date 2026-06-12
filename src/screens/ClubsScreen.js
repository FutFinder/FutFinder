import React, { useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Pressable,
  Image,
  RefreshControl,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  Shield,
  Search as SearchIcon,
  Plus,
  Users,
  MessageCircle,
  Crown,
  ChevronRight,
  MapPin,
  BadgeCheck,
  Check,
  X,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import ClubCard from '../components/ClubCard';
import PremiumBadge, { premiumGold } from '../components/PremiumBadge';
import {
  getMyClub,
  searchClubs,
  listMyInvitations,
  respondToRequest,
  CLUB_LIMITS,
} from '../services/clubs';

/**
 * Pestaña Clubes. Dos estados:
 *  - SIN club: buscador de clubes + invitaciones pendientes + crear club
 *  - CON club: vista de mi club con accesos a chat, detalle y planes
 */
export default function ClubsScreen({ navigation, route }) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myClub, setMyClub] = useState(null); // { club, miRol, totalMiembros }
  const [clubs, setClubs] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [query, setQuery] = useState('');
  const [banner, setBanner] = useState(null); // { type, title, message }

  const load = useCallback(async (q = '') => {
    const { data: mine } = await getMyClub();
    setMyClub(mine);
    if (!mine) {
      const [{ data: found }, { data: invs }] = await Promise.all([
        searchClubs(q),
        listMyInvitations(),
      ]);
      setClubs(found || []);
      setInvitations(invs || []);
    }
    setLoading(false);
  }, []);

  // Recargar cada vez que la pestaña gana foco (p.ej. después de crear club)
  useFocusEffect(
    useCallback(() => {
      load(query);
    }, [load]) // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Banner de éxito que viene de ClubDetailScreen al salir/eliminar club
  useEffect(() => {
    if (route?.params?.successTitle) {
      setBanner({
        type: 'success',
        title: route.params.successTitle,
        message: route.params.successMessage || '',
      });
      navigation.setParams({ successTitle: undefined, successMessage: undefined });
    }
  }, [route?.params?.successTitle]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const handleInvitation = async (inv, accept) => {
    const { error } = await respondToRequest(inv.request_id, accept);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo responder', message: error.message });
      return;
    }
    if (accept) {
      setBanner({
        type: 'success',
        title: '¡Bienvenido al club!',
        message: `Ahora eres parte de ${inv.club.nombre}.`,
      });
    }
    await load(query);
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header />
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // ---------- CON CLUB ----------
  if (myClub) {
    const { club, miRol, totalMiembros } = myClub;
    const limites = CLUB_LIMITS[club.plan] || CLUB_LIMITS.estandar;
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header />
        <View style={styles.content}>
          {banner && (
            <Banner {...banner} onClose={() => setBanner(null)} />
          )}

          {/* Tarjeta del club */}
          <Pressable
            onPress={() => navigation.navigate('ClubDetail', { clubId: club.id })}
            style={({ pressed }) => [styles.myClubCard, pressed && { opacity: 0.9 }]}
          >
            {club.foto_url ? (
              <Image source={{ uri: club.foto_url }} style={styles.myClubLogo} />
            ) : (
              <View style={[styles.myClubLogo, styles.logoFallback]}>
                <Shield color={colors.primary} size={36} strokeWidth={1.6} />
              </View>
            )}
            <View style={styles.myClubNameRow}>
              <Text style={styles.myClubName} numberOfLines={1}>
                {club.nombre}
              </Text>
              {club.verificado ? (
                <BadgeCheck color={premiumGold} size={20} strokeWidth={2.2} />
              ) : null}
            </View>
            {club.comuna ? (
              <View style={styles.myClubMeta}>
                <MapPin color={colors.textMuted} size={13} />
                <Text style={styles.myClubMetaText}>
                  {club.comuna}{club.region ? `, ${club.region}` : ''}
                </Text>
              </View>
            ) : null}
            <View style={styles.badgeRow}>
              {club.plan === 'premium' ? (
                <PremiumBadge variant="badge" />
              ) : (
                <View style={styles.planChip}>
                  <Text style={styles.planChipText}>PLAN ESTÁNDAR</Text>
                </View>
              )}
              {miRol === 'admin' && (
                <View style={styles.adminChip}>
                  <Crown color={colors.primary} size={11} strokeWidth={2.4} />
                  <Text style={styles.adminChipText}>Admin</Text>
                </View>
              )}
            </View>
          </Pressable>

          {/* Accesos */}
          <RowAction
            icon={<Users color={colors.primary} size={20} strokeWidth={2} />}
            title="Integrantes"
            subtitle={`${totalMiembros} de ${limites.miembros}`}
            onPress={() => navigation.navigate('ClubDetail', { clubId: club.id })}
          />
          <RowAction
            icon={<MessageCircle color={colors.primary} size={20} strokeWidth={2} />}
            title="Chat del club"
            subtitle="Conversa con tu equipo"
            onPress={() =>
              navigation.navigate('ChatThread', {
                threadKey: `club:${club.id}`,
                title: club.nombre,
                subtitle: 'Chat del club',
                fotoUrl: club.foto_url || null,
              })
            }
          />
          <RowAction
            icon={<Crown color={premiumGold} size={20} strokeWidth={2} />}
            title="Planes del club"
            subtitle={
              club.plan === 'premium'
                ? 'Tu club es Premium'
                : 'Conoce las ventajas Premium'
            }
            onPress={() => navigation.navigate('ClubPlans', { clubId: club.id })}
          />
        </View>
      </SafeAreaView>
    );
  }

  // ---------- SIN CLUB ----------
  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Header />
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
            {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

            {/* Invitaciones pendientes */}
            {invitations.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Invitaciones</Text>
                {invitations.map((inv) => (
                  <ClubCard
                    key={inv.request_id}
                    club={inv.club}
                    onPress={() =>
                      navigation.navigate('ClubDetail', { clubId: inv.club_id })
                    }
                    right={
                      <View style={styles.invActions}>
                        <Pressable
                          onPress={() => handleInvitation(inv, true)}
                          hitSlop={6}
                          style={({ pressed }) => [
                            styles.invBtn,
                            styles.invAccept,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Check color="#0E0E0D" size={16} strokeWidth={2.6} />
                        </Pressable>
                        <Pressable
                          onPress={() => handleInvitation(inv, false)}
                          hitSlop={6}
                          style={({ pressed }) => [
                            styles.invBtn,
                            styles.invReject,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <X color={colors.error} size={16} strokeWidth={2.6} />
                        </Pressable>
                      </View>
                    }
                  />
                ))}
              </View>
            )}

            {/* Buscador */}
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
        renderItem={({ item }) => (
          <ClubCard
            club={item}
            onPress={() => navigation.navigate('ClubDetail', { clubId: item.id })}
            right={<ChevronRight color={colors.textMuted} size={18} />}
          />
        )}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Shield color={colors.textMuted} size={42} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>
              {query.trim() ? 'Sin resultados' : 'Todavía no hay clubes'}
            </Text>
            <Text style={styles.emptyText}>
              Crea el primer club de tu barrio y arma tu equipo.
            </Text>
          </View>
        }
        contentContainerStyle={[styles.listContent, { paddingBottom: 96 }]}
      />
      <Pressable
        onPress={() => navigation.navigate('CreateClub')}
        style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
      >
        <Plus color="#0E0E0D" size={22} strokeWidth={2.8} />
      </Pressable>
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Clubes</Text>
    </View>
  );
}

function RowAction({ icon, title, subtitle, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.rowAction, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.rowIconWrap}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRight color={colors.textMuted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, paddingHorizontal: 16 },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // mi club
  myClubCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  myClubLogo: {
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    marginBottom: 12,
  },
  logoFallback: {
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  myClubNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  myClubName: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  myClubMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  myClubMetaText: { color: colors.textMuted, fontSize: 13 },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
  },
  planChip: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  planChipText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  adminChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  adminChipText: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // accesos
  rowAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
    marginBottom: 10,
  },
  rowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },

  // sin club
  section: { marginBottom: 8 },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
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
    marginBottom: 16,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  invActions: { flexDirection: 'row', gap: 8 },
  invBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  invAccept: { backgroundColor: colors.primary },
  invReject: {
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.error,
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
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(113,181,51,0.5)' },
      default: {
        shadowColor: colors.primary,
        shadowOpacity: 0.5,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 10,
        elevation: 8,
      },
    }),
  },
});
