import React, { useCallback, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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
  Compass,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import ClubCard from '../components/ClubCard';
import PremiumBadge, { premiumGold } from '../components/PremiumBadge';
import { getCurrentUser } from '../services/auth';
import {
  getClubUnreadCount,
  markClubChatRead,
  subscribeToClubMessages,
} from '../services/messages';
import {
  getMyClubs,
  searchClubs,
  listMyInvitations,
  listPendingRequests,
  respondToRequest,
  subscribeToPendingRequests,
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
  const [myClubs, setMyClubs] = useState([]); // [{ club, miRol, totalMiembros }]
  const [clubs, setClubs] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [query, setQuery] = useState('');
  const [banner, setBanner] = useState(null); // { type, title, message }
  const [pendingCounts, setPendingCounts] = useState({}); // { [clubId]: number }
  const [chatUnread, setChatUnread] = useState({}); // { [clubId]: number }
  const [me, setMe] = useState(null);

  // Suscripciones Realtime a solicitudes pendientes para todos los clubs donde soy admin
  useEffect(() => {
    const adminClubs = myClubs.filter((m) => m.miRol === 'admin');
    if (adminClubs.length === 0) {
      setPendingCounts({});
      return;
    }

    const fetchCounts = async () => {
      const updates = {};
      await Promise.all(
        adminClubs.map(async ({ club }) => {
          const { data } = await listPendingRequests(club.id);
          updates[club.id] = (data || []).length;
        })
      );
      setPendingCounts(updates);
    };
    fetchCounts();

    const unsubs = adminClubs.map(({ club }) =>
      subscribeToPendingRequests(club.id, async () => {
        const { data } = await listPendingRequests(club.id);
        setPendingCounts((prev) => ({ ...prev, [club.id]: (data || []).length }));
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [myClubs]);

  // Badge de mensajes no leídos del chat de cada club + Realtime
  useEffect(() => {
    if (myClubs.length === 0) {
      setChatUnread({});
      return;
    }
    const myClubIds = myClubs.map((m) => m.club.id);

    const fetchUnread = async () => {
      const updates = {};
      await Promise.all(
        myClubIds.map(async (clubId) => {
          const { data } = await getClubUnreadCount(clubId);
          updates[clubId] = data || 0;
        })
      );
      setChatUnread(updates);
    };
    fetchUnread();

    // Realtime: un mensaje nuevo en uno de mis clubes (que no sea mío) suma 1
    const unsub = subscribeToClubMessages((row) => {
      if (!myClubIds.includes(row.club_id)) return;
      if (me && row.sender_id === me) return;
      setChatUnread((prev) => ({
        ...prev,
        [row.club_id]: (prev[row.club_id] || 0) + 1,
      }));
    });

    return unsub;
  }, [myClubs, me]);

  const load = useCallback(async (q = '') => {
    const [user, { data: mines }, { data: found }] = await Promise.all([
      getCurrentUser(),
      getMyClubs(),
      searchClubs(q),
    ]);
    setMe(user?.id || null);
    const myClubsData = mines || [];
    setMyClubs(myClubsData);
    setClubs(found || []);
    if (myClubsData.length < 3) {
      const { data: invs } = await listMyInvitations();
      setInvitations(invs || []);
    } else {
      setInvitations([]);
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

  // Abrir el chat de un club: marca leído y limpia su badge antes de navegar
  const openClubChat = async (club) => {
    setChatUnread((prev) => ({ ...prev, [club.id]: 0 }));
    await markClubChatRead(club.id);
    navigation.navigate('ChatThread', {
      threadKey: `club:${club.id}`,
      title: club.nombre,
      subtitle: 'Chat del club',
      fotoUrl: club.foto_url || null,
    });
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

  // ---------- CON CLUB (1, 2 o 3 clubes) ----------
  if (myClubs.length > 0) {
    const hasMaxClubs = myClubs.length >= 3;
    const hasSingleClub = myClubs.length === 1;
    const { club, miRol, totalMiembros } = myClubs[0];
    const limites = CLUB_LIMITS[club.plan] || CLUB_LIMITS.estandar;

    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Header />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

          {/* ── 1 club: tarjeta grande + accesos rápidos ── */}
          {hasSingleClub && (
            <>
              <Text style={styles.sectionTitle}>Mi Club</Text>
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
                  <Text style={styles.myClubName} numberOfLines={1}>{club.nombre}</Text>
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
              <RowAction
                icon={<Users color={colors.primary} size={20} strokeWidth={2} />}
                title="Integrantes"
                subtitle={`${totalMiembros} de ${limites.miembros}`}
                onPress={() => navigation.navigate('ClubDetail', { clubId: club.id })}
                badge={miRol === 'admin' ? (pendingCounts[club.id] || 0) : 0}
              />
              <RowAction
                icon={<MessageCircle color={colors.primary} size={20} strokeWidth={2} />}
                title="Chat del club"
                subtitle="Conversa con tu equipo"
                onPress={() => openClubChat(club)}
                badge={chatUnread[club.id] || 0}
              />
              <RowAction
                icon={<Crown color={premiumGold} size={20} strokeWidth={2} />}
                title="Plan del club"
                subtitle={club.plan === 'premium' ? 'Plan Premium' : 'Plan Gratuito'}
                onPress={() => navigation.navigate('ClubPlans', { clubId: club.id })}
              />
            </>
          )}

          {/* ── 2-3 clubes: tarjetas compactas ── */}
          {!hasSingleClub && (
            <>
              <Text style={styles.sectionTitle}>
                Mis Clubes ({myClubs.length}/3)
              </Text>
              {myClubs.map(({ club: c, miRol: rol, totalMiembros: total }) => (
                <ClubCard
                  key={c.id}
                  club={c}
                  totalMiembros={total}
                  onPress={() => navigation.navigate('ClubDetail', { clubId: c.id })}
                  right={
                    <View style={styles.multiClubRight}>
                      {((rol === 'admin' && (pendingCounts[c.id] || 0) > 0) ||
                        (chatUnread[c.id] || 0) > 0) && (
                        <View style={styles.badgeCircle}>
                          <Text style={styles.badgeText}>
                            {(() => {
                              const n =
                                (rol === 'admin' ? pendingCounts[c.id] || 0 : 0) +
                                (chatUnread[c.id] || 0);
                              return n > 9 ? '9+' : n;
                            })()}
                          </Text>
                        </View>
                      )}
                      {rol === 'admin' && (
                        <View style={styles.adminChip}>
                          <Crown color={colors.primary} size={10} strokeWidth={2.4} />
                          <Text style={styles.adminChipText}>Admin</Text>
                        </View>
                      )}
                      <ChevronRight color={colors.textMuted} size={18} />
                    </View>
                  }
                />
              ))}
            </>
          )}

          {/* Invitaciones (solo si el usuario aún puede unirse a más clubes) */}
          {invitations.length > 0 && (
            <View style={[styles.section, { marginTop: 16 }]}>
              <Text style={styles.sectionTitle}>Invitaciones</Text>
              {invitations.map((inv) => (
                <ClubCard
                  key={inv.request_id}
                  club={inv.club}
                  onPress={() => navigation.navigate('ClubDetail', { clubId: inv.club_id })}
                  right={
                    <View style={styles.invActions}>
                      <Pressable
                        onPress={() => handleInvitation(inv, true)}
                        hitSlop={6}
                        style={({ pressed }) => [styles.invBtn, styles.invAccept, pressed && { opacity: 0.7 }]}
                      >
                        <Check color="#0E0E0D" size={16} strokeWidth={2.6} />
                      </Pressable>
                      <Pressable
                        onPress={() => handleInvitation(inv, false)}
                        hitSlop={6}
                        style={({ pressed }) => [styles.invBtn, styles.invReject, pressed && { opacity: 0.7 }]}
                      >
                        <X color={colors.error} size={16} strokeWidth={2.6} />
                      </Pressable>
                    </View>
                  }
                />
              ))}
            </View>
          )}
        </ScrollView>

        {/* Botón gris "Explorar clubes" (abajo a la izquierda) */}
        <Pressable
          onPress={() => navigation.navigate('ExploreClubs')}
          style={({ pressed }) => [styles.exploreBtn, pressed && { opacity: 0.85 }]}
        >
          <Compass color={colors.textPrimary} size={18} strokeWidth={2.2} />
          <Text style={styles.exploreBtnText}>Explorar clubes</Text>
        </Pressable>

        {/* FAB: crear club si aún hay cupo (< 3 clubes) */}
        {!hasMaxClubs && (
          <Pressable
            onPress={() => navigation.navigate('CreateClub')}
            style={({ pressed }) => [styles.createClubFab, pressed && { opacity: 0.85 }]}
          >
            <Plus color="#0E0E0D" size={16} strokeWidth={2.8} />
            <Text style={styles.createClubFabText}>Crear club</Text>
          </Pressable>
        )}
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

      {/* Botón pill "Crear club" — esquina inferior derecha */}
      <Pressable
        onPress={() => navigation.navigate('CreateClub')}
        style={({ pressed }) => [styles.createClubFab, pressed && { opacity: 0.85 }]}
      >
        <Plus color="#0E0E0D" size={16} strokeWidth={2.8} />
        <Text style={styles.createClubFabText}>Crear club</Text>
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

function RowAction({ icon, title, subtitle, onPress, badge = 0 }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.rowAction, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.rowIconWrap}>
        {icon}
        {badge > 0 && (
          <View style={styles.badgeCircle}>
            <Text style={styles.badgeText}>{badge > 9 ? '9+' : badge}</Text>
          </View>
        )}
      </View>
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
  scrollContent: { paddingHorizontal: 16, paddingBottom: 96 },
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

  divider: {
    height: 1,
    backgroundColor: colors.borderSoft,
    marginVertical: 20,
  },

  // badge de solicitudes pendientes
  badgeCircle: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.background,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 13,
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
  multiClubRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  createClubFab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: colors.primary,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(113,181,51,0.45)' },
      default: {
        shadowColor: colors.primary,
        shadowOpacity: 0.45,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 10,
        elevation: 8,
      },
    }),
  },
  createClubFabText: {
    color: '#0E0E0D',
    fontSize: 14,
    fontWeight: '800',
  },
  // botón gris "Explorar clubes" (abajo a la izquierda)
  exploreBtn: {
    position: 'absolute',
    left: 20,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 24,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.35)' },
      default: {
        shadowColor: '#000',
        shadowOpacity: 0.3,
        shadowOffset: { width: 0, height: 4 },
        shadowRadius: 10,
        elevation: 8,
      },
    }),
  },
  exploreBtnText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
});
