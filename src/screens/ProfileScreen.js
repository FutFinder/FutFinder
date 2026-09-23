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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Clock,
  AlertCircle,
  UserX,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
  alfa,
} from '../theme/colors';
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
import PlayerPublicActions from '../components/player/PlayerPublicActions';
import ReportPlayerSheet from '../components/player/ReportPlayerSheet';
import ProfileSkeleton from '../components/player/ProfileSkeleton';

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
import { getMyClubs, inviteToClub } from '../services/clubs';
import {
  getFriendshipWith,
  sendFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from '../services/friends';
import { reportUser, countReportsAgainst, getMyPendingReportFor } from '../services/reports';
import { isBlockedByMe, blockUser, unblockUser } from '../services/blockedUsers';
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
  const insets = useSafeAreaInsets();

  const [myId, setMyId] = useState(null);
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [ratingSummary, setRatingSummary] = useState(null);
  const [accountStatus, setAccountStatus] = useState({ suspended: false, suspended_until: null });
  const [reportesRecibidos, setReportesRecibidos] = useState(0);
  const [friendship, setFriendship] = useState(null);
  const [isBlocked, setIsBlocked] = useState(false);
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
  const [blockConfirm, setBlockConfirm] = useState(false);
  // Invitar a mi club desde el perfil: va directo a ESTE jugador. Si administro
  // más de un club, primero se elige cuál (`clubPicker`).
  const [clubPicker, setClubPicker] = useState(false);
  const [invitandoClub, setInvitandoClub] = useState(false);
  const [clubesInvitados, setClubesInvitados] = useState(() => new Set());

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
        setIsBlocked(false);
        const clubs = await getMyClubs();
        setMisClubs(clubs.data || []);
      } else {
        const [f, clubs, reporteMio, bloqueado] = await Promise.all([
          getFriendshipWith(viewUserId),
          getMyClubs(),
          getMyPendingReportFor(viewUserId),
          isBlockedByMe(viewUserId),
        ]);
        setFriendship(f);
        setMisClubs(clubs.data || []);
        setYaReportado(Boolean(reporteMio.data));
        setIsBlocked(bloqueado);
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

  const handleConfirmBlock = async () => {
    setBlockConfirm(false);
    await runFriendAction(
      () => blockUser(viewUserId),
      'Usuario bloqueado',
      'Ya no podrá enviarte solicitudes ni escribirte.',
      'No pude bloquear'
    );
  };

  const handleUnblock = () =>
    runFriendAction(() => unblockUser(viewUserId), 'Usuario desbloqueado', null, 'No pude desbloquear');

  const handleSendMessage = () => {
    if (!viewUserId || !profile) return;
    const parent = navigation.getParent();
    (parent || navigation).navigate('ChatThread', {
      threadKey: `dm:${viewUserId}`,
      title: `@${profile.username || 'jugador'}`,
      subtitle: 'Mensaje directo',
    });
  };

  // Desde el perfil de un jugador la invitación le llega a él y a nadie más:
  // mandarlo al buscador con todos los jugadores obligaba a encontrarlo de
  // nuevo en una lista enorme. El buscador sigue en el club, para cuando no
  // se sabe a quién invitar.
  const clubesQueAdministro = misClubs.filter((c) => c.miRol === 'admin' && c.club?.id);

  const invitarAClub = async (club) => {
    if (invitandoClub || !viewUserId) return;
    setInvitandoClub(true);
    const { error } = await inviteToClub(club.id, viewUserId);
    setInvitandoClub(false);
    if (error) {
      showBanner('error', 'No se pudo invitar', error.message || '');
      return;
    }
    setClubesInvitados((prev) => new Set(prev).add(club.id));
    showBanner(
      'success',
      'Invitación enviada',
      `@${profile?.username || 'jugador'} verá tu invitación a ${club.nombre} en su pestaña Clubes.`
    );
  };

  const handleInviteClub = () => {
    const pendientes = clubesQueAdministro.filter((c) => !clubesInvitados.has(c.club.id));
    if (pendientes.length === 0) return;
    if (clubesQueAdministro.length > 1) {
      setClubPicker(true);
      return;
    }
    invitarAClub(pendientes[0].club);
  };

  const handlePickClub = (club) => {
    setClubPicker(false);
    invitarAClub(club);
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
                <UserX color={C.loss} size={18} strokeWidth={2} />
              ) : (
                <AlertCircle color={C.loss} size={18} strokeWidth={2} />
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
  const puedeInvitarAClub = !isOwnProfile && clubesQueAdministro.length > 0;
  const invitacionClubEnviada =
    puedeInvitarAClub && clubesQueAdministro.every((c) => clubesInvitados.has(c.club.id));
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
        contentContainerStyle={[styles.scroll, { paddingBottom: 110 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.green}
            colors={[C.green]}
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
              invitandoAClub={invitandoClub}
              invitacionClubEnviada={invitacionClubEnviada}
              yaReportado={yaReportado}
              isBlocked={isBlocked}
              onAdd={handleAddFriend}
              onAccept={handleAcceptFriend}
              onReject={handleRejectFriend}
              onCancel={handleCancelRequest}
              onRemove={handleRemoveFriend}
              onMessage={handleSendMessage}
              onInviteClub={handleInviteClub}
              onReport={() => setReportOpen(true)}
              onBlock={() => setBlockConfirm(true)}
              onUnblock={handleUnblock}
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
            icon={<Clock color={C.textSecondary} size={18} strokeWidth={1.9} />}
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

        {/* ── Auditoría: solo el dueño de la cuenta ──
            Editar perfil ya vive en cada campo editable de la propia ficha
            (avatar, banner, bio, galería…) y cerrar sesión en Ajustes — la
            fila y el botón de acá abajo eran una segunda puerta a lo mismo. */}
        {isOwnProfile && <AuditSupportCard reportesRecibidos={reportesRecibidos} />}

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

      {/* Elegir a cuál de mis clubes invitarlo (solo si administro más de uno) */}
      <Modal
        visible={clubPicker}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setClubPicker(false)}
      >
        <Pressable style={styles.dialogBackdrop} onPress={() => setClubPicker(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>¿A qué club invitas a @{profile.username || 'jugador'}?</Text>
            <Text style={styles.dialogText}>Le llega la invitación y decide si acepta.</Text>
            {clubesQueAdministro.map(({ club }) => {
              const enviada = clubesInvitados.has(club.id);
              return (
                <Pressable
                  key={club.id}
                  onPress={() => handlePickClub(club)}
                  disabled={enviada}
                  accessibilityRole="button"
                  accessibilityLabel={enviada ? `Ya invitaste a ${club.nombre}` : `Invitar a ${club.nombre}`}
                  style={({ pressed }) => [
                    styles.dialogOption,
                    enviada && styles.dialogOptionDone,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text
                    style={[styles.dialogOptionText, enviada && styles.dialogOptionTextDone]}
                    numberOfLines={1}
                  >
                    {enviada ? `${club.nombre} · invitación enviada` : club.nombre}
                  </Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => setClubPicker(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancelar"
              style={({ pressed }) => [styles.dialogCancel, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.dialogCancelText}>Cancelar</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Confirmación de bloqueo */}
      <Modal
        visible={blockConfirm}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setBlockConfirm(false)}
      >
        <Pressable style={styles.dialogBackdrop} onPress={() => setBlockConfirm(false)}>
          <Pressable style={styles.dialog} onPress={() => {}}>
            <Text style={styles.dialogTitle}>¿Bloquear a @{profile.username || 'jugador'}?</Text>
            <Text style={styles.dialogText}>
              No podrá enviarte solicitudes de amistad ni escribirte. Puedes desbloquearlo cuando quieras.
            </Text>
            <Pressable
              onPress={handleConfirmBlock}
              accessibilityRole="button"
              accessibilityLabel="Confirmar bloqueo"
              style={({ pressed }) => [styles.dialogDanger, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.dialogDangerText}>Bloquear</Text>
            </Pressable>
            <Pressable
              onPress={() => setBlockConfirm(false)}
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
            <X color={C.textPrimary} size={22} strokeWidth={2.2} />
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
              <ChevronLeft color={C.textPrimary} size={22} strokeWidth={2.2} />
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
              <ChevronRight color={C.textPrimary} size={22} strokeWidth={2.2} />
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: {},
  bannerWrap: { paddingHorizontal: S.screenPadding, paddingBottom: 12 },
  errorWrap: { paddingTop: 8 },

  publicActions: { marginTop: 14 },
  participaciones: { paddingHorizontal: S.screenPadding, gap: 8 },

  demoNote: {
    color: C.textMuted,
    fontSize: 11.5,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: S.screenPadding,
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
    backgroundColor: C.surface,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.border,
    padding: 18,
  },
  dialogTitle: { color: C.textPrimary, fontSize: 17, fontFamily: F.extraBold },
  dialogText: {
    color: C.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },
  dialogDanger: {
    minHeight: 48,
    marginTop: 16,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: alfa(C.red, 0.35),
    backgroundColor: alfa(C.red, 0.10),
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialogDangerText: { color: C.loss, fontSize: 14.5, fontFamily: F.bold },
  dialogOption: {
    minHeight: 48,
    marginTop: 10,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: alfa(C.green, 0.35),
    backgroundColor: alfa(C.green, 0.10),
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  dialogOptionDone: { borderColor: C.borderSoft, backgroundColor: C.chip },
  dialogOptionText: { color: C.green, fontSize: 14.5, fontFamily: F.bold },
  dialogOptionTextDone: { color: C.textMuted },
  dialogCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  dialogCancelText: { color: C.textSecondary, fontSize: 14, fontFamily: F.semiBold },

  // Visores de imagen
  viewer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 14,
  },
  viewerImg: { width: '100%', flex: 1, borderRadius: R.cardSm },
  viewerHint: { color: C.textSecondary, fontSize: 12.5 },
  viewerClose: { position: 'absolute', top: 44, right: 20, zIndex: 2, padding: 6 },
  viewerNav: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  viewerNavBtn: {
    width: 44,
    height: 44,
    borderRadius: R.iconBtn,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewerNavOff: { opacity: 0.3 },
  viewerCounter: { color: C.textPrimary, fontSize: 13, fontFamily: F.bold, minWidth: 56, textAlign: 'center' },
});
