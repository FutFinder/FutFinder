import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
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
  Star,
  UserPlus,
  Image as ImageIcon,
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
} from '../services/clubs';

// ─────────────────────────────────────────────────────────────────────────────
// PLACEHOLDERS (fase ①, maqueta visual).
// Estas constantes imitan el boceto con datos de ejemplo. En la fase ③
// (subsistema de competencia) se reemplazan por datos reales con ESTAS MISMAS
// formas, así que conectar el servicio no obliga a tocar el render.
//
//   récord   → { v, e, p }
//   zona     → [{ id, nombre, logoUrl, rating }]
//   historial→ [{ id, rivalNombre, miLogoUrl, rivalLogoUrl, miMarcador, suMarcador }]
//   fotos    → [{ id, photo_url }]  (igual que profile_photos; lo conecta la fase ②)
// ─────────────────────────────────────────────────────────────────────────────
const RECORD_PLACEHOLDER = { v: 0, e: 0, p: 0 };

const ZONA_PLACEHOLDER = [
  { id: 'z1', nombre: 'Rival A', logoUrl: null, rating: 3.0 },
  { id: 'z2', nombre: 'Rival B', logoUrl: null, rating: 4.2 },
  { id: 'z3', nombre: 'Rival C', logoUrl: null, rating: 5.0 },
];

const HISTORIAL_PLACEHOLDER = [
  { id: 'h1', rivalNombre: 'Rival A', miLogoUrl: null, rivalLogoUrl: null, miMarcador: 1, suMarcador: 0 },
  { id: 'h2', rivalNombre: 'Rival B', miLogoUrl: null, rivalLogoUrl: null, miMarcador: 2, suMarcador: 3 },
  { id: 'h3', rivalNombre: 'Rival C', miLogoUrl: null, rivalLogoUrl: null, miMarcador: 7, suMarcador: 3 },
];

const FOTOS_PLACEHOLDER = []; // la fase ② lo llena desde club_photos
const FOTOS_TOTAL_PLACEHOLDER = 7; // total de ejemplo para el overlay "+X"

/**
 * Dashboard de un club (boceto): header con editar + plan, banner con logo,
 * récord V-E-P, nombre + verificado, contador de integrantes, "buscar rivales",
 * historial de partidos y fotos del club.
 *
 * La gestión de integrantes / admin vive en ClubMembersScreen, a la que se
 * llega tocando el contador de integrantes.
 */
export default function ClubDetailScreen({ navigation, route }) {
  const { clubId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [me, setMe] = useState(null);
  const [myClubs, setMyClubs] = useState([]);
  const [myRequest, setMyRequest] = useState(null);
  const [banner, setBanner] = useState(null);
  const [working, setWorking] = useState(false);

  const soyMiembro = members.some((m) => m.user_id === me);
  const soyAdmin = members.some((m) => m.user_id === me && m.rol === 'admin');
  const tengoMaxClubs = myClubs.length >= 3;

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    const myId = user?.id || null;
    setMe(myId);

    const [{ data: c }, { data: ms }, { data: mine }] = await Promise.all([
      getClubById(clubId),
      listMembers(clubId),
      getMyClubs(),
    ]);
    setClub(c);
    setMembers(ms || []);
    setMyClubs(mine || []);

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
      {/* HEADER SUPERIOR: editar (admin) · separador · plan del club */}
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
        >
          <ArrowLeft color={colors.textPrimary} size={22} />
        </Pressable>

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

        <View style={{ flex: 1 }} />

        <View style={styles.topDivider} />

        <Pressable
          onPress={() => navigation.navigate('ClubPlans', { clubId: club.id })}
          hitSlop={8}
          style={({ pressed }) => [styles.planChip, pressed && { opacity: 0.7 }]}
        >
          <Crown color={esPremium ? premiumGold : colors.textSecondary} size={16} />
          <View>
            <Text style={styles.planChipLabel}>Plan del club</Text>
            <View
              style={[
                styles.planBadge,
                esPremium ? styles.planBadgePremium : styles.planBadgeFree,
              ]}
            >
              <Text
                style={[
                  styles.planBadgeText,
                  { color: esPremium ? premiumGold : colors.textSecondary },
                ]}
              >
                {esPremium ? 'Premium' : 'Gratuito'}
              </Text>
            </View>
          </View>
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

        {/* BANNER + LOGO superpuesto */}
        <View style={styles.bannerWrap}>
          {club.banner_url ? (
            <Image source={{ uri: club.banner_url }} style={styles.banner} resizeMode="cover" />
          ) : (
            <View style={[styles.banner, styles.bannerFallback]} />
          )}
          {club.foto_url ? (
            <Image source={{ uri: club.foto_url }} style={styles.logo} />
          ) : (
            <View style={[styles.logo, styles.logoFallback]}>
              <Shield color={colors.primary} size={34} strokeWidth={1.6} />
            </View>
          )}
        </View>

        {/* RÉCORD · NOMBRE+VERIFICADO · INTEGRANTES */}
        <View style={styles.identityRow}>
          <View style={styles.recordBox}>
            <Text style={styles.recordNumbers}>
              {RECORD_PLACEHOLDER.v} - {RECORD_PLACEHOLDER.e} - {RECORD_PLACEHOLDER.p}
            </Text>
            <Text style={styles.recordLetters}>V   E   P</Text>
          </View>

          <View style={styles.nameCol}>
            <View style={styles.nameRow}>
              <Text style={styles.clubName} numberOfLines={2}>
                {club.nombre}
              </Text>
              {club.verificado && (
                <BadgeCheck color={premiumGold} size={18} strokeWidth={2.2} />
              )}
            </View>
            {club.comuna ? (
              <View style={styles.metaRow}>
                <MapPin color={colors.textMuted} size={12} />
                <Text style={styles.metaText} numberOfLines={1}>
                  {club.comuna}{club.region ? `, ${club.region}` : ''}
                </Text>
              </View>
            ) : null}
          </View>

          <Pressable
            onPress={() => navigation.navigate('ClubMembers', { clubId: club.id })}
            style={({ pressed }) => [styles.membersBox, pressed && { opacity: 0.7 }]}
          >
            <Users color={colors.textPrimary} size={18} />
            <Text style={styles.membersCount}>{members.length}</Text>
          </Pressable>
        </View>

        {/* Acción para visitantes (no rompe el flujo de unirse) */}
        {!soyMiembro && !tengoMaxClubs && (
          myRequest ? (
            <Button
              label="Cancelar solicitud"
              variant="secondary"
              loading={working}
              onPress={handleCancelRequest}
              style={styles.joinBtn}
            />
          ) : (
            <Button
              label="Solicitar unirme"
              icon={<UserPlus color="#0E0E0D" size={18} strokeWidth={2.4} />}
              loading={working}
              onPress={handleJoin}
              style={styles.joinBtn}
            />
          )
        )}

        {/* BUSCAR RIVALES */}
        <Text style={styles.sectionTitle}>Buscar rivales</Text>
        <View style={styles.rivalsCard}>
          <View style={styles.rivalsColLeft}>
            <View style={styles.rivalsColHeader}>
              <Text style={styles.rivalsColTitle}>Equipos en tu zona</Text>
              <MapPin color={colors.textMuted} size={13} />
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.zonaRow}
            >
              {ZONA_PLACEHOLDER.map((eq) => (
                <View key={eq.id} style={styles.zonaItem}>
                  <ClubCircle uri={eq.logoUrl} size={40} />
                  <View style={styles.ratingRow}>
                    <Text style={styles.ratingText}>{eq.rating.toFixed(1)}</Text>
                    <Star color={premiumGold} size={11} fill={premiumGold} />
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>

          <View style={styles.rivalsDivider} />

          <Pressable
            onPress={() => navigation.navigate('ExploreClubs')}
            style={({ pressed }) => [styles.rivalsColRight, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.rivalsColTitle}>Buscar equipos</Text>
            <View style={styles.searchCircle}>
              <Search color={colors.primary} size={22} />
            </View>
          </Pressable>
        </View>

        {/* HISTORIAL DE PARTIDOS */}
        <Text style={styles.sectionTitle}>Historial de partidos</Text>
        <View style={styles.historyCard}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.historyRow}
          >
            {HISTORIAL_PLACEHOLDER.map((h, idx) => (
              <React.Fragment key={h.id}>
                {idx > 0 && <View style={styles.historyDivider} />}
                <View style={styles.historyItem}>
                  <View style={styles.historySide}>
                    <ClubCircle uri={h.miLogoUrl} size={36} />
                    <Text style={styles.historySideLabel}>(tu club)</Text>
                  </View>
                  <Text style={styles.historyScore}>
                    {h.miMarcador} - {h.suMarcador}
                  </Text>
                  <View style={styles.historySide}>
                    <ClubCircle uri={h.rivalLogoUrl} size={36} />
                    <Text style={styles.historySideLabel}>(rival)</Text>
                  </View>
                </View>
              </React.Fragment>
            ))}
          </ScrollView>
        </View>

        {/* FOTOS DEL CLUB */}
        <Text style={styles.sectionTitle}>Fotos del club</Text>
        <PhotoGrid photos={FOTOS_PLACEHOLDER} total={FOTOS_TOTAL_PLACEHOLDER} />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Círculo de logo de club con fallback a escudo. */
function ClubCircle({ uri, size }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View
      style={[
        styles.clubCircleFallback,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <Shield color={colors.textMuted} size={size * 0.45} strokeWidth={1.8} />
    </View>
  );
}

/**
 * Grid de 4 celdas: 3 fotos + overlay "+X" en la última (mismo patrón que la
 * galería de perfil). En fase ① las celdas van vacías cuando no hay fotos.
 */
function PhotoGrid({ photos, total }) {
  const visibles = photos.slice(0, 3);
  const restantes = total - 3;
  const cells = [0, 1, 2, 3];

  return (
    <View style={styles.photoGrid}>
      {cells.map((idx) => {
        const esOverlay = idx === 3;
        const foto = visibles[idx];
        return (
          <View key={idx} style={styles.photoCell}>
            {foto?.photo_url ? (
              <Image source={{ uri: foto.photo_url }} style={styles.photoImg} resizeMode="cover" />
            ) : esOverlay && restantes > 0 ? (
              <View style={styles.photoOverlay}>
                <Text style={styles.photoOverlayText}>+{restantes}</Text>
              </View>
            ) : (
              <View style={styles.photoEmpty}>
                <ImageIcon color={colors.textMuted} size={20} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Header superior
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
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
  topDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  planChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  planChipLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  planBadge: {
    alignSelf: 'flex-start',
    marginTop: 2,
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  planBadgePremium: { borderColor: premiumGold, backgroundColor: 'rgba(212,175,55,0.10)' },
  planBadgeFree: { borderColor: colors.border, backgroundColor: colors.surfaceAlt },
  planBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.2 },

  scrollContent: { paddingHorizontal: 16, paddingBottom: 40 },

  // Banner + logo
  bannerWrap: { marginTop: 4, marginBottom: 48 },
  banner: {
    width: '100%',
    height: 140,
    borderRadius: radius.lg,
  },
  bannerFallback: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  logo: {
    position: 'absolute',
    bottom: -36,
    alignSelf: 'center',
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: colors.background,
    backgroundColor: colors.surface,
  },
  logoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Identidad: récord · nombre · integrantes
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16,
  },
  recordBox: {
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  recordNumbers: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 1,
  },
  recordLetters: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  nameCol: {
    flex: 1,
    alignItems: 'center',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  clubName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  metaText: { color: colors.textMuted, fontSize: 12 },
  membersBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  membersCount: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
  },

  joinBtn: { marginBottom: 16 },

  // Secciones
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 12,
  },

  // Buscar rivales
  rivalsCard: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
    marginBottom: 8,
  },
  rivalsColLeft: { flex: 1, paddingRight: 12 },
  rivalsColHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginBottom: 12,
  },
  rivalsColTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  zonaRow: { gap: 14, alignItems: 'center', paddingHorizontal: 2 },
  zonaItem: { alignItems: 'center', gap: 5 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingText: { color: colors.textPrimary, fontSize: 12, fontWeight: '700' },
  rivalsDivider: { width: 1, backgroundColor: colors.border },
  rivalsColRight: {
    width: 110,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingLeft: 12,
  },
  searchCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Historial
  historyCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 14,
    marginBottom: 8,
  },
  historyRow: { alignItems: 'center', gap: 14 },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historySide: { alignItems: 'center', gap: 3 },
  historySideLabel: { color: colors.textMuted, fontSize: 10 },
  historyScore: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  historyDivider: { width: 1, height: 56, backgroundColor: colors.border },

  // Fotos
  photoGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  photoCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  photoImg: { width: '100%', height: '100%' },
  photoEmpty: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoOverlay: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoOverlayText: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },

  clubCircleFallback: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
