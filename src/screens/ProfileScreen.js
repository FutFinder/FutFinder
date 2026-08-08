import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  Modal,
  Share,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Pencil,
  LogOut,
  Clock,
  AlertCircle,
  UserX,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../theme/colors';
import Banner from '../components/Banner';
import SectionHeader from '../components/ds/SectionHeader';
import EmptyStateCard from '../components/ds/EmptyStateCard';
import PlayerProfileTopBar from '../components/player/PlayerProfileTopBar';
import PlayerHeroCard from '../components/player/PlayerHeroCard';
import PlayerBioSection from '../components/player/PlayerBioSection';
import PlayerStatsCard from '../components/player/PlayerStatsCard';
import ParticipationCard from '../components/player/ParticipationCard';
import PlayerPhotoGallery from '../components/player/PlayerPhotoGallery';
import ReputationCard from '../components/player/ReputationCard';
import AccountStatusCard from '../components/player/AccountStatusCard';
import AuditSupportCard from '../components/player/AuditSupportCard';
import ProfileActionRow from '../components/player/ProfileActionRow';
import PlayerPublicActions from '../components/player/PlayerPublicActions';
import ReportPlayerSheet from '../components/player/ReportPlayerSheet';
import ProfileSkeleton from '../components/player/ProfileSkeleton';

import { signOut } from '../services/auth';
import { useAuth } from '../contexts/AuthContext';
import {
  getMyProfile,
  getProfileById,
  getAttendanceHistoryFor,
  getAccountStatusFor,
  deriveStats,
} from '../services/profile';
import { getUserRatingSummary } from '../services/ratings';
import { getProfilePhotos } from '../services/gallery';
import { getMyClubs } from '../services/clubs';
import {
  getFriendshipWith,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from '../services/friends';
import { reportUser, countReportsAgainst, getMyPendingReportFor } from '../services/reports';
import { isSupabaseConfigured } from '../services/supabase';
import {
  playerBadges,
  ratingDisplay,
  trustDisplay,
  attendanceDisplay,
  participacionEstado,
  metaParticipacion,
  metaJugador,
  inicialDe,
  perfilIncompleto,
} from '../utils/playerMeta';
import {
  usarPerfilDemo,
  getDemoProfile,
  getDemoHistory,
  getDemoRatingSummary,
} from '../services/playerDemo';

/** Participaciones visibles en la muestra. */
const MAX_PARTICIPACIONES = 3;
/** Cuántas filas de historial pedimos para calcular la tasa de asistencia. */
const HISTORIAL_LIMITE = 20;

/**
 * Perfil de jugador. Una sola pantalla para tres contextos, decididos por
 * datos reales y nunca por una bandera visual:
 *
 *   1. Perfil propio completo   → isOwnProfile && hay datos
 *   2. Perfil propio recién creado → isOwnProfile && sin datos (mismos
 *      componentes, alimentados con estados vacíos)
 *   3. Perfil público de otro   → !isOwnProfile
 *
 * `isOwnProfile` se resuelve comparando IDs de usuario, no nombres.
 *
 * QUÉ ES REAL: username, foto, portada, comuna, bio, posiciones, modalidad,
 * nivel, club, galería, valoraciones (tabla `ratings`), Trust Score,
 * participaciones (tabla `attendees`, lectura pública), sanción activa
 * (`profiles.estado`) y conteo de reportes recibidos.
 *
 * QUÉ NO EXISTE EN EL BACKEND y por eso se muestra honestamente:
 *  - MVPs: la columna existe pero nada la incrementa → 0 real.
 *  - Moderación y apelaciones: no hay panel de soporte, así que "Auditoría y
 *    soporte" es informativo y "Apelar" está deshabilitado (ver reports.js).
 *
 * FIXTURES DE DESARROLLO: services/playerDemo.js, solo con __DEV__ y su
 * interruptor en true. Nunca tocan la base de datos.
 */
export default function ProfileScreen({ navigation, route }) {
  const viewUserId = route?.params?.userId || null;
  const { isAuthenticated, user: authUser } = useAuth();

  const [myId, setMyId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [ratingSummary, setRatingSummary] = useState(null);
  const [accountStatus, setAccountStatus] = useState({ suspended: false, suspended_until: null });
  const [reportesRecibidos, setReportesRecibidos] = useState(0);
  const [friendship, setFriendship] = useState(null);
  const [misClubs, setMisClubs] = useState([]);
  const [yaReportado, setYaReportado] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [friendBusy, setFriendBusy] = useState(false);

  const [reportOpen, setReportOpen] = useState(false);
  const [avatarViewer, setAvatarViewer] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(null);
  const [logoutConfirm, setLogoutConfirm] = useState(false);

  // Contexto único: se compara por identificador, nunca por nombre.
  const isOwnProfile = !viewUserId || (myId !== null && viewUserId === myId);

  const showBanner = useCallback((type, title, message = '') => {
    setBanner({ type, title, message });
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // La sesión sale del contexto global (ya resuelta por el guard antes de
      // que esta pantalla pudiera montarse), no de una nueva llamada de red:
      // así "sin sesión" nunca se confunde con un problema de conexión.
      if (!isAuthenticated && !viewUserId) {
        setMyId(null);
        setLoadError('sin-sesion');
        setLoading(false);
        return;
      }

      const uid = authUser?.id || null;
      setMyId(uid);

      const propio = !viewUserId || viewUserId === uid;
      const targetId = propio ? uid : viewUserId;

      if (!targetId) {
        setLoadError(propio ? 'sin-sesion' : 'no-existe');
        setLoading(false);
        return;
      }

      const [p, h, ph, rs, acc, reportes] = await Promise.all([
        propio ? getMyProfile() : getProfileById(viewUserId),
        getAttendanceHistoryFor(targetId, HISTORIAL_LIMITE),
        getProfilePhotos(targetId),
        getUserRatingSummary(targetId),
        getAccountStatusFor(targetId),
        countReportsAgainst(targetId),
      ]);

      if (!p) {
        setLoadError(propio ? 'perfil' : 'no-existe');
        setLoading(false);
        return;
      }

      // Fixtures de desarrollo: solo rellenan lo que está vacío y solo con el
      // interruptor activado. Los datos reales siempre ganan.
      const demo = usarPerfilDemo();
      setProfile(demo ? getDemoProfile(p) : p);
      setHistory(demo && h.length === 0 ? getDemoHistory() : h);
      setPhotos(ph.data || []);
      setRatingSummary(demo && (rs?.count ?? 0) === 0 ? getDemoRatingSummary() : rs);
      setAccountStatus(acc);
      setReportesRecibidos(reportes.data || 0);

      if (propio) {
        setFriendship(null);
        setYaReportado(false);
        const clubs = await getMyClubs();
        setMisClubs(clubs.data || []);
      } else {
        const [f, clubs, reporteMio] = await Promise.all([
          getFriendshipWith(viewUserId),
          getMyClubs(),
          getMyPendingReportFor(viewUserId),
        ]);
        setFriendship(f);
        setMisClubs(clubs.data || []);
        setYaReportado(Boolean(reporteMio.data));
      }
    } catch (e) {
      console.error('[FutFinder] ProfileScreen load:', e?.message || e);
      setLoadError('perfil');
    } finally {
      setLoading(false);
    }
  }, [viewUserId]);

  useEffect(() => {
    const unsub = navigation.addListener('focus', load);
    load();
    return unsub;
  }, [navigation, load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // ── Derivados ──
  const stats = useMemo(() => deriveStats(profile, history), [profile, history]);
  const rating = useMemo(() => ratingDisplay(ratingSummary), [ratingSummary]);
  const trust = useMemo(() => trustDisplay(profile), [profile]);
  const attendance = useMemo(() => attendanceDisplay(history), [history]);
  const badges = useMemo(() => playerBadges(profile), [profile]);

  const participaciones = useMemo(
    () => history.filter((h) => h.match).slice(0, MAX_PARTICIPACIONES),
    [history]
  );

  // ── Acciones propias ──
  const goEdit = () => navigation.navigate('EditProfile');
  const goSettings = () => navigation.navigate('Settings');
  const goTrustHistory = () => navigation.navigate('TrustScoreHistory');

  const handleShare = async () => {
    if (!profile) return;
    try {
      await Share.share({
        message: `Mira el perfil de @${profile.username || 'jugador'} en FutFinder${
          profile.comuna ? ` · ${profile.comuna}` : ''
        }`,
      });
    } catch {
      showBanner('error', 'No se pudo compartir', 'Inténtalo de nuevo en unos segundos.');
    }
  };

  const handleLogout = async () => {
    setLogoutConfirm(false);
    await signOut();
    const parent = navigation.getParent();
    (parent || navigation).reset({ index: 0, routes: [{ name: 'Welcome' }] });
  };

  // ── Acciones sobre otro jugador ──
  const runFriendAction = async (fn, okTitle, okMsg, errTitle) => {
    if (friendBusy) return;
    setFriendBusy(true);
    const { error } = (await fn()) || {};
    setFriendBusy(false);
    if (error) {
      showBanner('error', errTitle, error.message || '');
      return;
    }
    if (okTitle) showBanner('success', okTitle, okMsg || '');
    load();
  };

  const handleAddFriend = () =>
    runFriendAction(
      () => sendFriendRequest(viewUserId),
      'Solicitud enviada',
      `@${profile?.username || 'jugador'} decidirá si te acepta.`,
      'No pude enviar la solicitud'
    );

  const handleAcceptFriend = () =>
    friendship &&
    runFriendAction(
      () => acceptFriendRequest(friendship.id),
      '¡Amistad confirmada!',
      'Ya puedes mandarle mensajes.',
      'No pude aceptar'
    );

  const handleRejectFriend = () =>
    friendship &&
    runFriendAction(() => rejectFriendRequest(friendship.id), null, null, 'No pude rechazar');

  const handleCancelRequest = () =>
    friendship &&
    runFriendAction(() => cancelFriendRequest(friendship.id), null, null, 'No pude cancelar');

  const handleRemoveFriend = () =>
    runFriendAction(() => removeFriend(viewUserId), null, null, 'No pude eliminar');

  const handleSendMessage = () => {
    if (!viewUserId || !profile) return;
    const parent = navigation.getParent();
    (parent || navigation).navigate('ChatThread', {
      threadKey: `dm:${viewUserId}`,
      title: `@${profile.username || 'jugador'}`,
      subtitle: 'Mensaje directo',
    });
  };

  const handleInviteClub = () => {
    const club = misClubs.find((c) => c.miRol === 'admin');
    if (!club?.club?.id) return;
    navigation.navigate('ClubInvite', { clubId: club.club.id });
  };

  const handleSubmitReport = async ({ motivo, descripcion }) => {
    const { error } = await reportUser({ reportedId: viewUserId, motivo, descripcion });
    if (error) {
      showBanner('error', 'No se pudo enviar el reporte', error.message || '');
      return { error };
    }
    setReportOpen(false);
    setYaReportado(true);
    showBanner(
      'success',
      'Reporte enviado',
      'Lo revisaremos. No le avisamos a esa persona quién lo envió.'
    );
    return {};
  };

  // Sin sesión no hay nada que editar ni configurar (el guard global ya
  // debería haber sacado de acá a un usuario no autenticado, pero esto cubre
  // el instante entre un cierre de sesión y esa redirección).
  const canManageOwnProfile = isOwnProfile && isAuthenticated;

  // ── Estados de carga / error ──
  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <PlayerProfileTopBar
          isOwnProfile={isOwnProfile}
          title={isOwnProfile ? 'Mi perfil' : 'Perfil'}
          onBack={() => navigation.goBack()}
          onShare={() => {}}
          onEdit={canManageOwnProfile ? goEdit : undefined}
          onSettings={canManageOwnProfile ? goSettings : undefined}
          onMore={() => {}}
        />
        <ProfileSkeleton />
      </SafeAreaView>
    );
  }

  if (loadError || !profile) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <PlayerProfileTopBar
          isOwnProfile={isOwnProfile}
          title={isOwnProfile ? 'Mi perfil' : 'Perfil'}
          onBack={() => navigation.goBack()}
          onShare={() => {}}
          onEdit={canManageOwnProfile ? goEdit : undefined}
          onSettings={canManageOwnProfile ? goSettings : undefined}
          onMore={() => {}}
        />
        <View style={styles.errorWrap}>
          <EmptyStateCard
            icon={
              loadError === 'no-existe' ? (
                <UserX color={dsColors.loss} size={18} strokeWidth={2} />
              ) : (
                <AlertCircle color={dsColors.loss} size={18} strokeWidth={2} />
              )
            }
            title={
              loadError === 'no-existe'
                ? 'Este jugador no existe'
                : loadError === 'sin-sesion'
                  ? 'Inicia sesión para ver tu perfil'
                  : 'No pudimos cargar el perfil'
            }
            subtitle={
              loadError === 'no-existe'
                ? 'La cuenta pudo haberse eliminado.'
                : loadError === 'sin-sesion'
                  ? 'Tu sesión no está activa. Inicia sesión para continuar.'
                  : 'Revisa tu conexión e inténtalo otra vez.'
            }
            actionLabel={
              loadError === 'no-existe'
                ? 'Volver'
                : loadError === 'sin-sesion'
                  ? 'Iniciar sesión'
                  : 'Reintentar'
            }
            onAction={
              loadError === 'no-existe'
                ? () => navigation.goBack()
                : loadError === 'sin-sesion'
                  ? () => (navigation.getParent() || navigation).reset({
                      index: 0,
                      routes: [{ name: 'Login' }],
                    })
                  : () => {
                      setLoading(true);
                      load();
                    }
            }
          />
        </View>
      </SafeAreaView>
    );
  }

  // La ficha "Club" muestra mi club sea cual sea mi rol; invitar exige ser admin.
  const clubActual = isOwnProfile ? misClubs[0]?.club?.nombre || null : null;
  const puedeInvitarAClub =
    !isOwnProfile && misClubs.some((c) => c.miRol === 'admin');
  // El estado "perfil nuevo" sale de los datos reales, no de una bandera visual.
  const perfilVacio = perfilIncompleto({ profile, history, photos });

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <PlayerProfileTopBar
        isOwnProfile={isOwnProfile}
        title={isOwnProfile ? 'Mi perfil' : `@${profile.username || 'jugador'}`}
        onBack={() => navigation.goBack()}
        onShare={handleShare}
        onEdit={goEdit}
        onSettings={goSettings}
        onMore={() => setReportOpen(true)}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={dsColors.green}
            colors={[dsColors.green]}
          />
        }
      >
        {banner && (
          <View style={styles.bannerWrap}>
            <Banner {...banner} onClose={() => setBanner(null)} />
          </View>
        )}

        <PlayerHeroCard
          profile={profile}
          badges={badges}
          metaLabel={metaJugador(profile, stats?.partidos_jugados ?? 0)}
          clubNombre={clubActual}
          rating={rating}
          inicial={inicialDe(profile)}
          perfilVacio={perfilVacio}
          onPressAvatar={profile.foto_url ? () => setAvatarViewer(true) : undefined}
          onPressBanner={isOwnProfile ? goEdit : undefined}
          onPressClub={isOwnProfile && clubActual ? () => navigation.navigate('ClubsTab') : undefined}
          onPressRating={rating.hasRatings ? goTrustHistory : undefined}
        />

        {/* Acciones sobre otro jugador (amistad, contactar, invitar, reportar) */}
        {!isOwnProfile && (
          <View style={styles.publicActions}>
            <PlayerPublicActions
              friendship={friendship}
              myId={myId}
              busy={friendBusy}
              puedeInvitarAClub={puedeInvitarAClub}
              yaReportado={yaReportado}
              onAdd={handleAddFriend}
              onAccept={handleAcceptFriend}
              onReject={handleRejectFriend}
              onCancel={handleCancelRequest}
              onRemove={handleRemoveFriend}
              onMessage={handleSendMessage}
              onInviteClub={handleInviteClub}
              onReport={() => setReportOpen(true)}
            />
          </View>
        )}

        {/* ── Sobre mí ── */}
        {(profile.bio?.trim() || isOwnProfile) && (
          <>
            <SectionHeader
              title="Sobre mí"
              actionLabel={isOwnProfile && profile.bio?.trim() ? 'Editar' : null}
              onAction={isOwnProfile && profile.bio?.trim() ? goEdit : null}
            />
            <PlayerBioSection bio={profile.bio} isOwnProfile={isOwnProfile} onEdit={goEdit} />
          </>
        )}

        {/* ── Rendimiento ── */}
        <SectionHeader title="Rendimiento" />
        <PlayerStatsCard stats={stats} attendance={attendance} />

        {/* ── Últimas participaciones ── */}
        <SectionHeader
          title="Últimas participaciones"
          actionLabel={participaciones.length > 0 ? 'Ver todo' : null}
          onAction={
            participaciones.length > 0 ? () => navigation.navigate('SearchTab') : null
          }
        />
        {participaciones.length === 0 ? (
          <EmptyStateCard
            icon={<Clock color={dsColors.textSecondary} size={18} strokeWidth={1.9} />}
            title={isOwnProfile ? 'Aún no te has inscrito a partidos' : 'Sin participaciones'}
            subtitle={
              isOwnProfile
                ? 'Cuando lo hagas, aparecerán aquí'
                : 'Este jugador todavía no ha jugado partidos'
            }
            actionLabel={isOwnProfile ? 'Buscar partidos' : null}
            onAction={isOwnProfile ? () => navigation.navigate('SearchTab') : null}
            variant="solid"
          />
        ) : (
          <View style={styles.participaciones}>
            {participaciones.map((p) => (
              <ParticipationCard
                key={p.id}
                titulo={p.match.titulo || 'Partido'}
                meta={metaParticipacion(p)}
                estado={participacionEstado(p)}
                esMvp={false}
                onPress={() =>
                  p.id.startsWith?.('demo-')
                    ? showBanner(
                        'info',
                        'Partido de ejemplo',
                        'Es una maqueta de desarrollo, no existe en la base de datos.'
                      )
                    : navigation.navigate('MatchDetail', { matchId: p.match.id })
                }
              />
            ))}
          </View>
        )}

        {/* ── Galería ── */}
        <SectionHeader
          title={isOwnProfile ? 'Mi galería' : 'Galería'}
          actionLabel={photos.length > 0 ? 'Ver todas' : null}
          onAction={photos.length > 0 ? () => setGalleryIndex(0) : null}
        />
        <PlayerPhotoGallery
          photos={photos}
          isOwnProfile={isOwnProfile}
          onAdd={goEdit}
          onOpenPhoto={(idx) => setGalleryIndex(idx)}
        />

        {/* ── Reputación ── */}
        <SectionHeader
          title="Reputación"
          actionLabel={isOwnProfile ? 'Ver historial' : null}
          onAction={isOwnProfile ? goTrustHistory : null}
        />
        <ReputationCard rating={rating} trust={trust} />

        {/* ── Estado de la cuenta ── */}
        <SectionHeader title="Estado de la cuenta" />
        <AccountStatusCard
          suspended={accountStatus.suspended}
          suspendedUntil={accountStatus.suspended_until}
          stats={stats}
          reportesRecibidos={reportesRecibidos}
          isOwnProfile={isOwnProfile}
        />

        {/* ── Auditoría y acciones: solo el dueño de la cuenta ── */}
        {isOwnProfile && (
          <>
            <AuditSupportCard reportesRecibidos={reportesRecibidos} />

            <ProfileActionRow
              icon={<Pencil color={dsColors.green} size={17} strokeWidth={2} />}
              label="Editar mi perfil"
              onPress={goEdit}
              style={styles.actionSpaced}
            />

            <Pressable
              onPress={() => setLogoutConfirm(true)}
              accessibilityRole="button"
              accessibilityLabel="Cerrar sesión"
              style={({ pressed }) => [styles.logout, pressed && { opacity: 0.8 }]}
            >
              <LogOut color={dsColors.loss} size={17} strokeWidth={2} />
              <Text style={styles.logoutText}>Cerrar sesión</Text>
            </Pressable>
          </>
        )}

        {!isSupabaseConfigured && (
          <Text style={styles.demoNote}>
            Modo demo · configura Supabase para ver datos reales
          </Text>
        )}
      </ScrollView>

      {/* Hoja de reporte */}
      <ReportPlayerSheet
        visible={reportOpen && !isOwnProfile}
        username={profile.username || 'jugador'}
        onClose={() => setReportOpen(false)}
        onSubmit={handleSubmitReport}
      />

      {/* Confirmación de cierre de sesión */}
      <Modal
        visible={logoutConfirm}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setLogoutConfirm(false)}
      >
        <Pressable style={styles.dialogBackdrop} onPress={() => setLogoutConfirm(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>¿Cerrar sesión?</Text>
            <Text style={styles.dialogText}>
              Tendrás que volver a iniciar sesión para entrar a tu cuenta.
            </Text>
            <Pressable
              onPress={handleLogout}
              accessibilityRole="button"
              accessibilityLabel="Confirmar cerrar sesión"
              style={({ pressed }) => [styles.dialogDanger, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.dialogDangerText}>Cerrar sesión</Text>
            </Pressable>
            <Pressable
              onPress={() => setLogoutConfirm(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
              style={({ pressed }) => [styles.dialogCancel, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.dialogCancelText}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Visor del avatar */}
      <Modal
        visible={avatarViewer}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setAvatarViewer(false)}
      >
        <Pressable style={styles.viewer} onPress={() => setAvatarViewer(false)}>
          {profile.foto_url && (
            <Image source={{ uri: profile.foto_url }} style={styles.viewerImg} resizeMode="contain" />
          )}
          <Text style={styles.viewerHint}>Toca para cerrar</Text>
        </Pressable>
      </Modal>

      {/* Visor de la galería con navegación */}
      <Modal
        visible={galleryIndex !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setGalleryIndex(null)}
      >
        <View style={styles.viewer}>
          <Pressable
            onPress={() => setGalleryIndex(null)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Cerrar la galería"
            style={styles.viewerClose}
          >
            <X color={dsColors.textPrimary} size={22} strokeWidth={2.2} />
          </Pressable>

          {galleryIndex !== null && photos[galleryIndex] && (
            <Image
              source={{ uri: photos[galleryIndex].photo_url }}
              style={styles.viewerImg}
              resizeMode="contain"
              accessibilityLabel={`Foto ${galleryIndex + 1} de ${photos.length}`}
            />
          )}

          <View style={styles.viewerNav}>
            <Pressable
              onPress={() => setGalleryIndex((i) => Math.max(0, (i ?? 0) - 1))}
              disabled={galleryIndex === 0}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Foto anterior"
              style={({ pressed }) => [
                styles.viewerNavBtn,
                galleryIndex === 0 && styles.viewerNavOff,
                pressed && { opacity: 0.7 },
              ]}
            >
              <ChevronLeft color={dsColors.textPrimary} size={22} strokeWidth={2.2} />
            </Pressable>
            <Text style={styles.viewerCounter}>
              {(galleryIndex ?? 0) + 1} / {photos.length}
            </Text>
            <Pressable
              onPress={() => setGalleryIndex((i) => Math.min(photos.length - 1, (i ?? 0) + 1))}
              disabled={galleryIndex === photos.length - 1}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Foto siguiente"
              style={({ pressed }) => [
                styles.viewerNavBtn,
                galleryIndex === photos.length - 1 && styles.viewerNavOff,
                pressed && { opacity: 0.7 },
              ]}
            >
              <ChevronRight color={dsColors.textPrimary} size={22} strokeWidth={2.2} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: dsColors.background },
  scroll: { paddingBottom: 36 },
  bannerWrap: { paddingHorizontal: dsSizes.gutter, paddingBottom: 12 },
  errorWrap: { paddingTop: 8 },

  publicActions: { marginTop: 14 },
  participaciones: { paddingHorizontal: dsSizes.gutter, gap: 8 },

  actionSpaced: { marginTop: 10 },
  logout: {
    minHeight: 50,
    marginHorizontal: dsSizes.gutter,
    marginTop: 8,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(232, 115, 123, 0.35)',
    backgroundColor: 'rgba(232, 115, 123, 0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutText: { color: dsColors.loss, fontSize: 14, fontWeight: '700' },
  demoNote: {
    color: dsColors.textMuted,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: dsSizes.gutter,
  },

  // Diálogo de confirmación
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: dsColors.surface,
    borderRadius: dsRadius.xl,
    borderWidth: 1,
    borderColor: dsColors.border,
    padding: 18,
  },
  dialogTitle: { color: dsColors.textPrimary, fontSize: 17, fontWeight: '800' },
  dialogText: {
    color: dsColors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  dialogDanger: {
    minHeight: 48,
    marginTop: 16,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(232, 115, 123, 0.35)',
    backgroundColor: 'rgba(232, 115, 123, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogDangerText: { color: dsColors.loss, fontSize: 14.5, fontWeight: '700' },
  dialogCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  dialogCancelText: { color: dsColors.textSecondary, fontSize: 14, fontWeight: '600' },

  // Visores de imagen
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 14,
  },
  viewerImg: { width: '100%', flex: 1, borderRadius: dsRadius.xl },
  viewerHint: { color: dsColors.textSecondary, fontSize: 12.5 },
  viewerClose: { position: 'absolute', top: 44, right: 20, zIndex: 2, padding: 6 },
  viewerNav: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  viewerNavBtn: {
    width: 44,
    height: 44,
    borderRadius: dsRadius.md,
    backgroundColor: dsColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNavOff: { opacity: 0.3 },
  viewerCounter: { color: dsColors.textPrimary, fontSize: 13, fontWeight: '700', minWidth: 56, textAlign: 'center' },
});
