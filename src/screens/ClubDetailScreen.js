import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  Share,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Search,
  Swords,
  UserPlus,
  Trophy,
  ChevronRight,
} from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../theme/colors';
import Banner from '../components/Banner';
import ClubHeaderBar from '../components/club/ClubHeaderBar';
import ClubHeroCard from '../components/club/ClubHeroCard';
import CreateChallengeButton from '../components/club/CreateChallengeButton';
import SectionHeader from '../components/ds/SectionHeader';
import RivalClubCard from '../components/club/RivalClubCard';
import MatchHistoryCard from '../components/club/MatchHistoryCard';
import ClubPhotoGallery from '../components/club/ClubPhotoGallery';
import PremiumUpsellCard from '../components/club/PremiumUpsellCard';
import EmptyStateCard from '../components/ds/EmptyStateCard';
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
import {
  getClubMatchHistory,
  getDemoMatchHistory,
  calcularRecord,
  formatFechaCorta,
  usarHistorialDemo,
} from '../services/clubMatches';
import {
  modalidadBadges,
  nivelBadge,
  nivelInline,
  ratingLabel as fmtRating,
  distanciaEntreClubesKm,
  metaRival,
} from '../utils/clubMeta';

/** Máximo de rivales sugeridos en el carrusel. */
const MAX_RIVALES = 10;
/** Partidos visibles en la muestra del historial. */
const MAX_HISTORIAL = 3;

/**
 * Detalle del club ("Mi club").
 *
 * DATOS REALES: club, miembros, fotos, desafíos pendientes, rivales sugeridos
 * (con distancia calculada desde la comuna) y partidos de club de la BD.
 *
 * DATOS AÚN NO EXISTENTES EN EL BACKEND, mostrados como N.A. sin inventarse:
 *  - nivel del club        → "NIVEL N.A."
 *  - valoración del club   → "N.A." con estrella
 *  - marcador de partidos  → "vs" en lugar de un score
 *
 * FIXTURES DE DESARROLLO (solo con __DEV__, ver services/clubMatches.js):
 *  - 3 partidos de ejemplo (V/D/E) y su récord 1-1-1 coherente
 *  - placeholders de la galería cuando no hay fotos reales
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
  const [photos, setPhotos] = useState([]);
  const [rivals, setRivals] = useState([]);
  const [historial, setHistorial] = useState([]);
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
  // Soy admin de algún club → puedo desafiar a los rivales del carrusel.
  const puedoDesafiarRivales = (myClubs || []).some((c) => c.miRol === 'admin');

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    const myId = user?.id || null;
    setMe(myId);

    const [
      { data: c },
      { data: ms },
      { data: mine },
      { data: ph },
      { data: candidatos },
      { data: partidos },
      pending,
    ] = await Promise.all([
      getClubById(clubId),
      listMembers(clubId),
      getMyClubs(),
      getClubPhotos(clubId),
      searchClubs(''),
      getClubMatchHistory(clubId),
      countPendingForClub(clubId),
    ]);

    setClub(c);
    setMembers(ms || []);
    setMyClubs(mine || []);
    setPhotos(ph || []);
    setPendingChallenges(pending || 0);

    // Historial: real si existe; si no y estamos en desarrollo, fixtures.
    const reales = partidos || [];
    setHistorial(reales.length > 0 ? reales : usarHistorialDemo() ? getDemoMatchHistory() : []);

    // Rivales sugeridos: otros clubes, ordenados por distancia real cuando
    // se puede calcular; los que no tienen comuna conocida van al final.
    const misClubIds = new Set((mine || []).map((m) => m.club?.id).filter(Boolean));
    const otros = (candidatos || []).filter((r) => r.id !== clubId && !misClubIds.has(r.id));
    const conDistancia = otros.map((r) => ({
      ...r,
      distanciaKm: c ? distanciaEntreClubesKm(c, r) : null,
    }));
    conDistancia.sort((a, b) => {
      if (a.distanciaKm === null) return 1;
      if (b.distanciaKm === null) return -1;
      return a.distanciaKm - b.distanciaKm;
    });
    setRivals(conDistancia.slice(0, MAX_RIVALES));

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

  const handleShare = async () => {
    if (!club) return;
    try {
      await Share.share({
        message: `Mira el club ${club.nombre} en FutFinder${
          club.comuna ? ` · ${club.comuna}` : ''
        }`,
      });
    } catch {
      setBanner({
        type: 'error',
        title: 'No se pudo compartir',
        message: 'Inténtalo de nuevo en unos segundos.',
      });
    }
  };

  const goToChallenge = (rival) => {
    navigation.navigate('ClubChallenge', {
      rivalClubId: rival.id,
      rivalNombre: rival.nombre,
      rivalFotoUrl: rival.foto_url || null,
    });
  };

  const goToGallery = () => navigation.navigate('ClubGallery', { clubId });
  const goToExplore = () => navigation.navigate('ExploreClubs');

  if (loading || !club) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.loadingBar}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Volver"
            style={({ pressed }) => [styles.loadingBackBtn, pressed && { opacity: 0.6 }]}
          >
            <ArrowLeft color={clubColors.textPrimary} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={clubColors.green} />
        </View>
      </SafeAreaView>
    );
  }

  const esPremium = club.plan === 'premium';
  const historialVisible = historial.slice(0, MAX_HISTORIAL);
  const esHistorialDemo = historialVisible.some((p) => p.esDemo);
  // El récord se deriva del historial: real con datos reales, 1-1-1 con fixtures.
  const record = calcularRecord(historial);

  const miembrosLabel = [
    club.comuna || null,
    `${members.length} ${members.length === 1 ? 'miembro' : 'miembros'}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <ClubHeaderBar
        title={soyMiembro ? 'Mi club' : club.nombre}
        esPremium={esPremium}
        puedeEditar={soyAdmin}
        onBack={() => navigation.goBack()}
        onShare={handleShare}
        onEdit={() => navigation.navigate('EditClub', { club })}
        onPlan={() => navigation.navigate('ClubPlans', { clubId: club.id })}
      />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={clubColors.green}
            colors={[clubColors.green]}
          />
        }
      >
        {banner && (
          <View style={styles.bannerWrap}>
            <Banner {...banner} onClose={() => setBanner(null)} />
          </View>
        )}

        <ClubHeroCard
          club={club}
          badges={modalidadBadges(club.modalidad)}
          nivelLabel={nivelBadge(club.nivel)}
          miembrosLabel={miembrosLabel}
          record={record}
          ratingLabel={fmtRating(club.rating)}
          onPressMiembros={() => navigation.navigate('ClubMembers', { clubId: club.id })}
        />

        {/* Acción principal, según mi relación con el club */}
        {soyAdmin ? (
          <CreateChallengeButton
            label="Crear desafío"
            onPress={() => setChallengeSheetOpen(true)}
            onSearch={goToExplore}
          />
        ) : puedoDesafiar ? (
          <CreateChallengeButton
            label="Desafiar a este club"
            accessibilityLabel={`Desafiar a ${club.nombre}`}
            onPress={() => goToChallenge(club)}
            onSearch={goToExplore}
          />
        ) : !soyMiembro && !tengoMaxClubs ? (
          <CreateChallengeButton
            label={myRequest ? 'Cancelar solicitud' : 'Solicitar unirme'}
            icon={
              myRequest ? null : (
                <UserPlus color={clubColors.greenInk} size={20} strokeWidth={2.4} />
              )
            }
            disabled={working}
            onPress={myRequest ? handleCancelRequest : handleJoin}
            onSearch={goToExplore}
          />
        ) : (
          <CreateChallengeButton
            label="Buscar rivales"
            icon={<Search color={clubColors.greenInk} size={20} strokeWidth={2.2} />}
            onPress={goToExplore}
            onSearch={goToExplore}
          />
        )}

        {/* Bandeja de desafíos (miembros del club) */}
        {soyMiembro && (
          <Pressable
            onPress={() => navigation.navigate('ClubChallenges', { clubId: club.id })}
            accessibilityRole="button"
            accessibilityLabel={
              pendingChallenges > 0
                ? `Desafíos. ${pendingChallenges} pendientes`
                : 'Desafíos del club'
            }
            style={({ pressed }) => [styles.rowItem, pressed && styles.rowPressed]}
          >
            <View style={styles.rowIcon}>
              <Swords color={clubColors.green} size={17} strokeWidth={2} />
            </View>
            <Text style={styles.rowLabel}>Desafíos</Text>
            {pendingChallenges > 0 && (
              <View style={styles.rowBadge}>
                <Text style={styles.rowBadgeText}>{pendingChallenges}</Text>
              </View>
            )}
            <ChevronRight color={clubColors.textMuted} size={18} strokeWidth={2.2} />
          </Pressable>
        )}

        {/* ── Buscar rivales ── */}
        <SectionHeader title="Buscar rivales" actionLabel="Ver todos" onAction={goToExplore} />
        {rivals.length === 0 ? (
          <EmptyStateCard
            icon={<Search color={clubColors.textSecondary} size={18} strokeWidth={2} />}
            title="Sin rivales cerca"
            subtitle="Amplía la búsqueda para encontrar más clubes"
            actionLabel="Buscar clubes"
            onAction={goToExplore}
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            snapToAlignment="start"
            decelerationRate="fast"
            snapToInterval={clubSizes.rivalCard + 10}
            contentContainerStyle={styles.rivalsRow}
          >
            {rivals.map((r) => (
              <RivalClubCard
                key={r.id}
                club={r}
                meta={metaRival({ distanciaKm: r.distanciaKm, modalidad: r.modalidad })}
                ratingLabel={fmtRating(r.rating)}
                nivelLabel={nivelInline(r.nivel)}
                puedeDesafiar={puedoDesafiarRivales}
                onPress={() => navigation.navigate('ClubDetail', { clubId: r.id })}
                onChallenge={() => goToChallenge(r)}
              />
            ))}
          </ScrollView>
        )}

        {/* ── Historial de partidos ── */}
        <SectionHeader
          title="Historial de partidos"
          actionLabel={historialVisible.length > 0 ? 'Ver todo' : null}
          onAction={
            historialVisible.length > 0
              ? () => navigation.navigate('ClubChallenges', { clubId: club.id })
              : null
          }
        />
        {historialVisible.length === 0 ? (
          <EmptyStateCard
            icon={<Trophy color={clubColors.textSecondary} size={18} strokeWidth={2} />}
            title="Sin partidos"
            subtitle="Tu club todavía no ha disputado partidos contra otros clubes"
            actionLabel={soyAdmin ? 'Buscar un rival' : null}
            onAction={soyAdmin ? goToExplore : null}
            variant="solid"
          />
        ) : (
          <View style={styles.historyList}>
            {historialVisible.map((p) => (
              <MatchHistoryCard
                key={p.id}
                miNombre={club.nombre}
                rivalNombre={p.rivalNombre}
                miMarcador={p.miMarcador}
                suMarcador={p.suMarcador}
                fechaLabel={formatFechaCorta(p)}
                estado={p.estado}
                resultado={p.resultado}
                onPress={() =>
                  p.esDemo
                    ? setBanner({
                        type: 'info',
                        title: 'Partido de ejemplo',
                        message:
                          'Este partido es una maqueta de desarrollo, todavía no existe en la base de datos.',
                      })
                    : navigation.navigate('MatchDetail', { matchId: p.id })
                }
              />
            ))}
            {esHistorialDemo && (
              <Text style={styles.demoNote}>
                Partidos de ejemplo · solo visibles en desarrollo
              </Text>
            )}
          </View>
        )}

        {/* ── Fotos del club ── */}
        <SectionHeader
          title="Fotos del club"
          actionLabel={photos.length > 0 || usarHistorialDemo() ? 'Ver todas' : null}
          onAction={photos.length > 0 || usarHistorialDemo() ? goToGallery : null}
        />
        <ClubPhotoGallery
          photos={photos}
          showDemo={usarHistorialDemo()}
          puedeAñadir={soyAdmin}
          onAdd={goToGallery}
          onOpenPhoto={goToGallery}
        />

        {/* ── Premium ── */}
        {!esPremium && (
          <PremiumUpsellCard
            onPress={() => navigation.navigate('ClubPlans', { clubId: club.id })}
          />
        )}

        {/* ── Acciones de admin ── */}
        {soyAdmin && (
          <View style={styles.adminList}>
            <Pressable
              onPress={() => navigation.navigate('ClubMembers', { clubId: club.id })}
              accessibilityRole="button"
              accessibilityLabel="Gestionar miembros del club"
              style={({ pressed }) => [styles.adminRow, pressed && styles.rowPressed]}
            >
              <Text style={styles.adminRowText}>Gestionar miembros</Text>
              <ChevronRight color={clubColors.textMuted} size={18} strokeWidth={2.2} />
            </Pressable>
            <View style={styles.adminDivider} />
            <Pressable
              onPress={() => navigation.navigate('EditClub', { club })}
              accessibilityRole="button"
              accessibilityLabel="Ajustes del club"
              style={({ pressed }) => [styles.adminRow, pressed && styles.rowPressed]}
            >
              <Text style={styles.adminRowText}>Ajustes del club</Text>
              <ChevronRight color={clubColors.textMuted} size={18} strokeWidth={2.2} />
            </Pressable>
          </View>
        )}
      </ScrollView>

      {/* Hoja: crear desafío */}
      <Modal
        visible={challengeSheetOpen}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setChallengeSheetOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setChallengeSheetOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Crear desafío</Text>
            <Text style={styles.sheetSubtitle}>Elige cómo quieres encontrar rival</Text>

            <Pressable
              onPress={() => {
                setChallengeSheetOpen(false);
                goToExplore();
              }}
              accessibilityRole="button"
              accessibilityLabel="Elegir un club para desafiar"
              style={({ pressed }) => [styles.sheetPrimary, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.sheetPrimaryText}>Elegir un club</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setChallengeSheetOpen(false);
                setBanner({
                  type: 'info',
                  title: 'Próximamente',
                  message: 'El desafío abierto a cualquier club todavía no está disponible.',
                });
              }}
              accessibilityRole="button"
              accessibilityLabel="Desafío abierto. Próximamente"
              style={({ pressed }) => [styles.sheetSecondary, pressed && { opacity: 0.7 }]}
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: clubColors.background },
  scrollContent: { paddingBottom: 40 },

  // Carga
  loadingBar: { paddingHorizontal: clubSizes.gutter, paddingTop: 4, paddingBottom: 12 },
  loadingBackBtn: {
    width: clubSizes.iconBtn,
    height: clubSizes.iconBtn,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  bannerWrap: { paddingHorizontal: clubSizes.gutter, paddingBottom: 12 },

  // Fila genérica (Desafíos)
  rowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: clubSizes.gutter,
    marginTop: 10,
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.lg,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  rowPressed: { backgroundColor: clubColors.surfaceHover },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: clubRadius.icon,
    backgroundColor: clubColors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    color: clubColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  rowBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: clubColors.loss,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBadgeText: { color: '#2A0C0F', fontSize: 11, fontWeight: '800' },

  // Rivales
  rivalsRow: {
    gap: 10,
    paddingHorizontal: clubSizes.gutter,
    paddingBottom: 4,
  },

  // Historial
  historyList: { paddingHorizontal: clubSizes.gutter, gap: 8 },
  demoNote: {
    color: clubColors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },

  // Acciones de admin
  adminList: {
    marginHorizontal: clubSizes.gutter,
    marginTop: 10,
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.lg,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    overflow: 'hidden',
  },
  adminRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  adminRowText: {
    color: 'rgba(255, 255, 255, 0.8)',
    fontSize: 13.5,
    fontWeight: '600',
  },
  adminDivider: { height: 1, backgroundColor: clubColors.divider },

  // Hoja "Crear desafío"
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: clubColors.surface,
    borderTopLeftRadius: clubRadius.sheet,
    borderTopRightRadius: clubRadius.sheet,
    borderTopWidth: 1,
    borderColor: clubColors.border,
    paddingHorizontal: clubSizes.gutter,
    paddingTop: 14,
    paddingBottom: 30,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    color: clubColors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sheetSubtitle: {
    color: clubColors.textSecondary,
    fontSize: 12.5,
    marginTop: 4,
  },
  sheetPrimary: {
    height: 52,
    marginTop: 14,
    borderRadius: clubRadius.md,
    backgroundColor: clubColors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryText: {
    color: clubColors.greenInk,
    fontSize: 15,
    fontWeight: '800',
  },
  sheetSecondary: {
    height: 52,
    marginTop: 8,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSecondaryText: {
    color: clubColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  sheetSecondaryHint: {
    color: clubColors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
});
