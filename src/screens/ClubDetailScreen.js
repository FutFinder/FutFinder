import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Modal,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Shield,
  Crown,
  BadgeCheck,
  Pencil,
  Users,
  MapPin,
  Search,
  UserPlus,
  Swords,
  Image as ImageIcon,
  ImagePlus,
  Trophy,
  ChevronRight,
  Sparkles,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { premiumGold } from '../components/PremiumBadge';
import { getCurrentUser } from '../services/auth';
import {
  getClubById,
  listMembers,
  getMyClubs,
  getMyRequestTo,
  requestToJoin,
  cancelRequest,
  searchClubs,
} from '../services/clubs';
import { getClubPhotos } from '../services/clubGallery';
import { countPendingForClub } from '../services/clubChallenges';

// El récord V-E-D no tiene backend real todavía (no existe marcador en
// `matches` ni agregación de resultados por club); se muestra en 0 hasta que
// se implemente el subsistema de competencia. La calificación de clubes
// tampoco existe como campo, por eso se muestra "—".
const RECORD_PLACEHOLDER = { v: 0, e: 0, d: 0 };

export default function ClubDetailScreen({ navigation, route }) {
  const { clubId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [myClubs, setMyClubs] = useState([]);
  const [myRequest, setMyRequest] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [rivals, setRivals] = useState([]);
  const [pendingChallenges, setPendingChallenges] = useState(0);
  const [banner, setBanner] = useState(null);
  const [working, setWorking] = useState(false);
  const [challengeSheetOpen, setChallengeSheetOpen] = useState(false);

  const soyMiembro = members.some((m) => m.user_id === me);
  const soyAdmin = members.some((m) => m.user_id === me && m.rol === 'admin');
  const tengoMaxClubs = myClubs.length >= 3;
  // Puedo desafiar a este club si soy admin de OTRO club distinto.
  const puedoDesafiar =
    !soyMiembro && (myClubs || []).some((c) => c.miRol === 'admin' && c.club?.id !== clubId);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    const myId = user?.id || null;
    setMe(myId);

    const [{ data: c }, { data: ms }, { data: mine }, { data: ph }, { data: candidatos }, pending] =
      await Promise.all([
        getClubById(clubId),
        listMembers(clubId),
        getMyClubs(),
        getClubPhotos(clubId),
        searchClubs(''),
        countPendingForClub(clubId),
      ]);
    setClub(c);
    setMembers(ms || []);
    setMyClubs(mine || []);
    setPhotos(ph || []);
    setPendingChallenges(pending || 0);

    // "Equipos en tu zona": otros clubes, priorizando la misma comuna.
    const misClubIds = new Set((mine || []).map((m) => m.club?.id).filter(Boolean));
    const otros = (candidatos || []).filter((r) => r.id !== clubId && !misClubIds.has(r.id));
    const misma = otros.filter((r) => c && r.comuna && r.comuna === c.comuna);
    const resto = otros.filter((r) => !misma.includes(r));
    setRivals([...misma, ...resto].slice(0, 10));

    const amMember = (ms || []).some((m) => m.user_id === myId);
    if (!amMember && myId) {
      const { data: mr } = await getMyRequestTo(clubId);
      setMyRequest(mr);
    } else {
      setMyRequest(null);
    }
    setLoading(false);
  }, [clubId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleJoin = async () => {
    setWorking(true);
    const { error } = await requestToJoin(clubId);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo enviar', message: error.message });
      return;
    }
    setBanner({
      type: 'success',
      title: 'Solicitud enviada',
      message: 'Un administrador del club la revisará pronto.',
    });
    await load();
  };

  const handleCancelRequest = async () => {
    if (!myRequest) return;
    setWorking(true);
    const { error } = await cancelRequest(myRequest.id);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'Error', message: error.message });
      return;
    }
    setMyRequest(null);
  };

  const goToChallenge = (rival) => {
    navigation.navigate('ClubChallenge', {
      rivalClubId: rival.id,
      rivalNombre: rival.nombre,
      rivalFotoUrl: rival.foto_url || null,
    });
  };

  if (loading || !club) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.topBar}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
          >
            <ArrowLeft color={colors.textPrimary} size={22} />
          </Pressable>
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const esPremium = club.plan === 'premium';

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      {/* HEADER */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={colors.textPrimary} size={22} />
        </Pressable>

        <Text style={styles.headerTitle} numberOfLines={1}>
          {soyMiembro ? 'Mi club' : club.nombre}
        </Text>

        {soyAdmin && (
          <Pressable
            onPress={() => navigation.navigate('EditClub', { club })}
            hitSlop={8}
            style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.6 }]}
          >
            <Pencil color={colors.primary} size={16} />
            <Text style={styles.editLabel}>Editar</Text>
          </Pressable>
        )}

        <Pressable
          onPress={() => navigation.navigate('ClubPlans', { clubId: club.id })}
          hitSlop={8}
          style={({ pressed }) => [styles.planChip, pressed && { opacity: 0.7 }]}
        >
          <Crown color={esPremium ? premiumGold : colors.textSecondary} size={15} />
          <Text style={[styles.planChipText, { color: esPremium ? premiumGold : colors.textSecondary }]}>
            {esPremium ? 'Premium' : 'Gratis'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
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

        {/* TARJETA DE IDENTIDAD: banner + logo + nombre + stats */}
        <View style={styles.card}>
          <View style={styles.bannerBox}>
            {club.banner_url ? (
              <Image source={{ uri: club.banner_url }} style={styles.bannerImg} resizeMode="cover" />
            ) : (
              <View style={styles.bannerFallback}>
                <View style={styles.bannerGlow} />
              </View>
            )}
          </View>

          <View style={styles.cardBody}>
            <View style={styles.identityRow}>
              {club.foto_url ? (
                <Image source={{ uri: club.foto_url }} style={styles.logo} />
              ) : (
                <View style={[styles.logo, styles.logoFallback]}>
                  <Shield color={colors.primary} size={30} strokeWidth={1.6} />
                </View>
              )}
              <View style={styles.nameCol}>
                <View style={styles.nameRow}>
                  <Text style={styles.clubName} numberOfLines={1}>
                    {club.nombre}
                  </Text>
                  {club.verificado && <BadgeCheck color={premiumGold} size={17} strokeWidth={2.2} />}
                </View>
                <Pressable
                  onPress={() => navigation.navigate('ClubMembers', { clubId: club.id })}
                  style={({ pressed }) => [styles.metaRow, pressed && { opacity: 0.7 }]}
                  hitSlop={6}
                >
                  <MapPin color={colors.textMuted} size={12} />
                  <Text style={styles.metaText} numberOfLines={1}>
                    {club.comuna ? `${club.comuna} · ` : ''}
                    {members.length} {members.length === 1 ? 'miembro' : 'miembros'}
                  </Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.statsGrid}>
              <View style={[styles.statCell, styles.statCellWin]}>
                <Text style={[styles.statNumber, { color: colors.primary }]}>{RECORD_PLACEHOLDER.v}</Text>
                <Text style={[styles.statLabel, { color: colors.primary }]}>V</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statNumber}>{RECORD_PLACEHOLDER.e}</Text>
                <Text style={styles.statLabel}>E</Text>
              </View>
              <View style={[styles.statCell, styles.statCellLoss]}>
                <Text style={[styles.statNumber, { color: colors.error }]}>{RECORD_PLACEHOLDER.d}</Text>
                <Text style={[styles.statLabel, { color: colors.error }]}>D</Text>
              </View>
              <View style={styles.statCell}>
                <Text style={styles.statNumber}>—</Text>
                <Text style={styles.statLabel}>RATING</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ACCIÓN PRINCIPAL + BUSCAR */}
        <View style={styles.actionRow}>
          {soyMiembro && soyAdmin ? (
            <Button
              label="Crear desafío"
              icon={<Swords color="#0E0E0D" size={18} strokeWidth={2.4} />}
              onPress={() => setChallengeSheetOpen(true)}
              style={{ flex: 1 }}
            />
          ) : puedoDesafiar ? (
            <Button
              label="Desafiar a este club"
              icon={<Swords color="#0E0E0D" size={18} strokeWidth={2.4} />}
              onPress={() => goToChallenge({ id: club.id, nombre: club.nombre, foto_url: club.foto_url })}
              style={{ flex: 1 }}
            />
          ) : !soyMiembro && !tengoMaxClubs ? (
            myRequest ? (
              <Button
                label="Cancelar solicitud"
                variant="secondary"
                loading={working}
                onPress={handleCancelRequest}
                style={{ flex: 1 }}
              />
            ) : (
              <Button
                label="Solicitar unirme"
                icon={<UserPlus color="#0E0E0D" size={18} strokeWidth={2.4} />}
                loading={working}
                onPress={handleJoin}
                style={{ flex: 1 }}
              />
            )
          ) : (
            <View style={{ flex: 1 }} />
          )}
          <Pressable
            onPress={() => navigation.navigate('ExploreClubs')}
            style={({ pressed }) => [styles.searchBtn, pressed && { opacity: 0.7 }]}
          >
            <Search color={colors.textPrimary} size={20} />
          </Pressable>
        </View>

        {/* Bandeja de desafíos (miembros del club) */}
        {soyMiembro && (
          <Pressable
            onPress={() => navigation.navigate('ClubChallenges', { clubId: club.id })}
            style={({ pressed }) => [styles.rowItem, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.primarySoft }]}>
              <Swords color={colors.primary} size={17} />
            </View>
            <Text style={styles.rowLabel}>Desafíos</Text>
            {pendingChallenges > 0 && (
              <View style={styles.rowBadge}>
                <Text style={styles.rowBadgeText}>{pendingChallenges}</Text>
              </View>
            )}
            <ChevronRight color={colors.textMuted} size={18} />
          </Pressable>
        )}

        {/* BUSCAR RIVALES */}
        <SectionHeader
          title="Buscar rivales"
          actionLabel="Ver todos"
          onAction={() => navigation.navigate('ExploreClubs')}
        />
        {rivals.length === 0 ? (
          <EmptyCard
            icon={<Search color={colors.textSecondary} size={18} strokeWidth={2} />}
            title="Sin rivales cerca"
            subtitle="Amplía tu búsqueda para encontrar más clubes"
            actionLabel="Buscar clubes"
            onAction={() => navigation.navigate('ExploreClubs')}
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rivalsRow}
          >
            {rivals.map((r) => (
              <View key={r.id} style={styles.rivalCard}>
                <Pressable
                  onPress={() => navigation.navigate('ClubDetail', { clubId: r.id })}
                  style={({ pressed }) => [styles.rivalTop, pressed && { opacity: 0.7 }]}
                >
                  <ClubCircle uri={r.foto_url} size={42} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.rivalName} numberOfLines={1}>
                      {r.nombre}
                    </Text>
                    <Text style={styles.rivalMeta} numberOfLines={1}>
                      {r.comuna || 'Sin comuna'} · {r.total_miembros}{' '}
                      {r.total_miembros === 1 ? 'miembro' : 'miembros'}
                    </Text>
                  </View>
                </Pressable>
                {puedoDesafiar ? (
                  <Pressable
                    onPress={() => goToChallenge(r)}
                    style={({ pressed }) => [styles.rivalChallengeBtn, pressed && { opacity: 0.75 }]}
                  >
                    <Text style={styles.rivalChallengeText}>Desafiar</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>
        )}

        {/* HISTORIAL DE PARTIDOS */}
        <SectionHeader title="Historial de partidos" />
        <EmptyCard
          icon={<Trophy color={colors.textSecondary} size={18} strokeWidth={2} />}
          title="Sin partidos"
          subtitle="Tu club todavía no ha disputado partidos contra otros clubes"
          actionLabel={soyAdmin ? 'Buscar un rival' : null}
          onAction={soyAdmin ? () => navigation.navigate('ExploreClubs') : null}
        />

        {/* FOTOS DEL CLUB */}
        <SectionHeader
          title="Fotos del club"
          actionLabel={photos.length > 0 ? 'Ver todas' : null}
          onAction={photos.length > 0 ? () => navigation.navigate('ClubGallery', { clubId: club.id }) : null}
        />
        <PhotoGrid
          photos={photos}
          onPress={() => navigation.navigate('ClubGallery', { clubId: club.id })}
        />

        {/* UPSELL PREMIUM */}
        {!esPremium && (
          <Pressable
            onPress={() => navigation.navigate('ClubPlans', { clubId: club.id })}
            style={({ pressed }) => [styles.upsellCard, pressed && { opacity: 0.85 }]}
          >
            <View style={styles.upsellIcon}>
              <Sparkles color={premiumGold} size={18} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.upsellTitle}>Desbloquea Premium</Text>
              <Text style={styles.upsellSubtitle}>Más integrantes, más admins y verificación</Text>
            </View>
            <ChevronRight color={colors.textMuted} size={18} />
          </Pressable>
        )}

        {/* ACCIONES DE ADMIN */}
        {soyAdmin && (
          <View style={styles.adminList}>
            <Pressable
              onPress={() => navigation.navigate('ClubMembers', { clubId: club.id })}
              style={({ pressed }) => [styles.adminRow, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.adminRowText}>Gestionar miembros</Text>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
            <View style={styles.adminDivider} />
            <Pressable
              onPress={() => navigation.navigate('EditClub', { club })}
              style={({ pressed }) => [styles.adminRow, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.adminRowText}>Ajustes del club</Text>
              <ChevronRight color={colors.textMuted} size={18} />
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* HOJA: crear desafío */}
      <Modal
        visible={challengeSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setChallengeSheetOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setChallengeSheetOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Crear desafío</Text>
            <Text style={styles.sheetSubtitle}>Elige cómo quieres encontrar rival</Text>

            <Button
              label="Elegir un club"
              onPress={() => {
                setChallengeSheetOpen(false);
                navigation.navigate('ExploreClubs');
              }}
              style={{ marginTop: 16 }}
            />
            <Pressable
              onPress={() =>
                setBanner({
                  type: 'info',
                  title: 'Próximamente',
                  message: 'El desafío abierto a cualquier club todavía no está disponible.',
                })
              }
              style={({ pressed }) => [styles.sheetSecondaryBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.sheetSecondaryText}>Desafío abierto</Text>
              <Text style={styles.sheetSecondaryHint}>Próximamente</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function SectionHeader({ title, actionLabel, onAction }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyCard({ icon, title, subtitle, actionLabel, onAction }) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIcon}>{icon}</View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptySubtitle}>{subtitle}</Text>
      {actionLabel ? (
        <Pressable
          onPress={onAction}
          style={({ pressed }) => [styles.emptyBtn, pressed && { opacity: 0.75 }]}
        >
          <Text style={styles.emptyBtnText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Círculo de logo de club con fallback a escudo. */
function ClubCircle({ uri, size }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={[styles.clubCircleFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Shield color={colors.textMuted} size={size * 0.45} strokeWidth={1.8} />
    </View>
  );
}

/**
 * Grid de fotos: celda "Añadir" + hasta 5 fotos, con overlay "+N" en la
 * última si hay más. Toca cualquier celda para abrir la galería completa.
 */
function PhotoGrid({ photos, onPress }) {
  const visibles = photos.slice(0, 5);
  const restantes = photos.length - 5;

  return (
    <View style={styles.photoGrid}>
      <Pressable onPress={onPress} style={[styles.photoCell, styles.photoAddCell]}>
        <ImagePlus color={colors.primary} size={20} strokeWidth={2} />
        <Text style={styles.photoAddLabel}>Añadir</Text>
      </Pressable>
      {visibles.length === 0 ? (
        <Pressable onPress={onPress} style={[styles.photoCell, styles.photoCellSpan2]}>
          <View style={styles.photoEmpty}>
            <ImageIcon color={colors.textMuted} size={18} />
            <Text style={styles.photoEmptyText}>Aún no hay fotos</Text>
          </View>
        </Pressable>
      ) : (
        visibles.map((foto, idx) => {
          const esUltima = idx === visibles.length - 1;
          return (
            <Pressable key={foto.id} onPress={onPress} style={styles.photoCell}>
              <Image source={{ uri: foto.photo_url }} style={styles.photoImg} resizeMode="cover" />
              {esUltima && restantes > 0 && (
                <View style={styles.photoOverlay}>
                  <Text style={styles.photoOverlayText}>+{restantes}</Text>
                </View>
              )}
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  editLabel: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  planChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  planChipText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2, textTransform: 'uppercase' },

  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // Tarjeta de identidad
  card: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderSoft,
    marginTop: 4,
    marginBottom: 16,
  },
  bannerBox: { height: 100 },
  bannerImg: { width: '100%', height: '100%' },
  bannerFallback: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  bannerGlow: {
    position: 'absolute',
    right: -40,
    top: -50,
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: colors.primarySoft,
  },
  cardBody: {
    backgroundColor: colors.surface,
    padding: 14,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginTop: -30,
  },
  logo: {
    width: 68,
    height: 68,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.surfaceAlt,
  },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  nameCol: { flex: 1, minWidth: 0, paddingBottom: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  clubName: { color: colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: -0.3, flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  metaText: { color: colors.textMuted, fontSize: 12.5 },

  statsGrid: { flexDirection: 'row', gap: 6, marginTop: 14 },
  statCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  statCellWin: { backgroundColor: colors.primarySoft, borderColor: 'rgba(113,181,51,0.24)' },
  statCellLoss: { backgroundColor: 'rgba(229,72,77,0.10)', borderColor: 'rgba(229,72,77,0.24)' },
  statNumber: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 1, marginTop: 3 },

  // Acción principal
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  searchBtn: {
    width: 54,
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Fila genérica (desafíos)
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  rowIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  rowBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },

  // Secciones
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 10,
  },
  sectionTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
  sectionAction: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  // Rivales (carrusel)
  rivalsRow: { gap: 10, paddingBottom: 4 },
  rivalCard: {
    width: 196,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    gap: 10,
  },
  rivalTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rivalName: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  rivalMeta: { color: colors.textMuted, fontSize: 11.5, marginTop: 2 },
  rivalChallengeBtn: {
    height: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(113,181,51,0.35)',
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rivalChallengeText: { color: colors.primary, fontSize: 13, fontWeight: '700' },

  // Estado vacío
  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 18,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 9,
  },
  emptyTitle: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  emptySubtitle: {
    color: colors.textMuted,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
  emptyBtn: {
    marginTop: 12,
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(113,181,51,0.35)',
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBtnText: { color: colors.primary, fontSize: 12.5, fontWeight: '700' },

  // Fotos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  photoCell: {
    width: '31%',
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  photoCellSpan2: { width: '65.5%' },
  photoAddCell: {
    borderWidth: 1.5,
    borderColor: 'rgba(113,181,51,0.4)',
    borderStyle: 'dashed',
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  photoAddLabel: { color: colors.primary, fontSize: 11, fontWeight: '700' },
  photoImg: { width: '100%', height: '100%' },
  photoEmpty: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  photoEmptyText: { color: colors.textMuted, fontSize: 11 },
  photoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoOverlayText: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },

  // Upsell Premium
  upsellCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 13,
    marginBottom: 16,
  },
  upsellIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(212,164,55,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  upsellTitle: { color: colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  upsellSubtitle: { color: colors.textMuted, fontSize: 11.5, marginTop: 2 },

  // Acciones de admin
  adminList: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
  },
  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  adminRowText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  adminDivider: { height: 1, backgroundColor: colors.borderSoft },

  // Hoja "Crear desafío"
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 30,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  sheetSubtitle: { color: colors.textMuted, fontSize: 12.5, marginTop: 4 },
  sheetSecondaryBtn: {
    height: 54,
    marginTop: 8,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSecondaryText: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  sheetSecondaryHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },

  clubCircleFallback: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
