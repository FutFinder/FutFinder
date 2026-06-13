import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  RefreshControl,
  ActivityIndicator,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Shield,
  MapPin,
  Crown,
  BadgeCheck,
  Check,
  X,
  UserMinus,
  LogOut,
  MessageCircle,
  UserPlus,
  Pencil,
  Trash2,
} from 'lucide-react-native';

import { colors, radius } from '../theme/colors';
import Banner from '../components/Banner';
import Button from '../components/Button';
import { premiumGold } from '../components/PremiumBadge';
import { getCurrentUser } from '../services/auth';
import {
  getClubById,
  listMembers,
  listPendingRequests,
  requestToJoin,
  respondToRequest,
  getMyRequestTo,
  cancelRequest,
  leaveClub,
  removeMember,
  getMyClub,
  promoteToAdmin,
  transferAdmin,
  deleteClub,
  CLUB_LIMITS,
} from '../services/clubs';

/** Confirmación multiplataforma (web usa confirm, native usa Alert). */
function confirmAction(title, message, onConfirm) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n${message}`)) {
      onConfirm();
    }
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: 'Confirmar', style: 'destructive', onPress: onConfirm },
  ]);
}

/**
 * Detalle de un club: header con escudo, integrantes con reputación,
 * y acciones según quién mire:
 *  - visitante sin club  → "Solicitar unirme" / "Cancelar solicitud"
 *  - miembro             → chat + salir del club
 *  - admin               → además: solicitudes pendientes, expulsar
 */
export default function ClubDetailScreen({ navigation, route }) {
  const { clubId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [myRequest, setMyRequest] = useState(null);
  const [me, setMe] = useState(null);
  const [myClubInfo, setMyClubInfo] = useState(null);
  const [banner, setBanner] = useState(null);
  const [working, setWorking] = useState(false);

  const miMembresia = members.find((m) => m.user_id === me);
  const soyMiembro = Boolean(miMembresia);
  const soyAdmin = miMembresia?.rol === 'admin';
  const tengoOtroClub = Boolean(myClubInfo && myClubInfo.club.id !== clubId);

  const load = useCallback(async () => {
    const user = await getCurrentUser();
    const myId = user?.id || null;
    setMe(myId);

    const [{ data: c }, { data: ms }, { data: mine }] = await Promise.all([
      getClubById(clubId),
      listMembers(clubId),
      getMyClub(),
    ]);
    setClub(c);
    setMembers(ms || []);
    setMyClubInfo(mine);

    const amMember = (ms || []).some((m) => m.user_id === myId);
    const amAdmin = (ms || []).some((m) => m.user_id === myId && m.rol === 'admin');

    if (amAdmin) {
      const { data: reqs } = await listPendingRequests(clubId);
      setRequests(reqs || []);
    } else {
      setRequests([]);
    }
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

  const handleRespond = async (req, approve) => {
    const { error } = await respondToRequest(req.request_id, approve);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo responder', message: error.message });
      return;
    }
    if (approve) {
      setBanner({
        type: 'success',
        title: 'Jugador aceptado',
        message: `${req.username} ya es parte del club.`,
      });
    }
    await load();
  };

  const handleLeave = () => {
    const ultimoMiembro = members.length === 1;
    confirmAction(
      ultimoMiembro ? '¿Eliminar el club?' : '¿Salir del club?',
      ultimoMiembro
        ? 'Eres el último integrante: al salir, el club y su chat se eliminan para siempre.'
        : 'Dejarás de ver el chat y los datos internos del club.',
      async () => {
        setWorking(true);
        const { error, clubDeleted } = await leaveClub();
        setWorking(false);
        if (error) {
          console.error('[FutFinder] handleLeave:', error);
          setBanner({ type: 'error', title: 'No se pudo salir', message: error.message });
          return;
        }
        navigation.navigate('Main', {
          screen: 'ClubsTab',
          params: {
            successTitle: clubDeleted ? 'Club eliminado' : 'Has salido del club',
            successMessage: clubDeleted
              ? 'El club fue eliminado correctamente.'
              : 'Ya no eres parte de ese club.',
          },
        });
      }
    );
  };

  const handlePromote = (member) => {
    const limites = CLUB_LIMITS[club?.plan] || CLUB_LIMITS.estandar;
    const adminCount = members.filter((m) => m.rol === 'admin').length;

    if (adminCount < limites.admins) {
      // hay cupo: se suma como admin sin que yo deje de serlo
      confirmAction(
        `¿Hacer admin a ${member.username}?`,
        'Podrá aceptar solicitudes, invitar jugadores y expulsar miembros.',
        async () => {
          const { error } = await promoteToAdmin(member.member_id);
          if (error) {
            setBanner({ type: 'error', title: 'No se pudo promover', message: error.message });
            return;
          }
          setBanner({
            type: 'success',
            title: 'Nuevo administrador',
            message: `${member.username} ahora es admin del club.`,
          });
          await load();
        }
      );
    } else {
      // sin cupo (p.ej. Estándar = 1 admin): ceder mi administración
      confirmAction(
        `¿Ceder la administración a ${member.username}?`,
        `Tu plan permite ${limites.admins} admin${limites.admins > 1 ? 's' : ''}: tú pasarás a ser jugador.`,
        async () => {
          const { error } = await transferAdmin(member.member_id);
          if (error) {
            setBanner({ type: 'error', title: 'No se pudo ceder', message: error.message });
            return;
          }
          setBanner({
            type: 'success',
            title: 'Administración cedida',
            message: `${member.username} es el nuevo admin del club.`,
          });
          await load();
        }
      );
    }
  };

  const handleExpel = (member) => {
    confirmAction(
      `¿Expulsar a ${member.username}?`,
      'Perderá acceso al chat y dejará de ser parte del club.',
      async () => {
        const { error } = await removeMember(member.member_id);
        if (error) {
          setBanner({ type: 'error', title: 'No se pudo expulsar', message: error.message });
          return;
        }
        await load();
      }
    );
  };

  const handleDeleteClub = () => {
    confirmAction(
      '¿Eliminar este club?',
      'Esta acción no se puede deshacer. Se eliminarán todos los miembros, mensajes e historial del club.',
      async () => {
        setWorking(true);
        const { error } = await deleteClub(clubId);
        setWorking(false);
        if (error) {
          console.error('[FutFinder] handleDeleteClub:', error);
          setBanner({ type: 'error', title: 'No se pudo eliminar', message: error.message });
          return;
        }
        navigation.navigate('Main', {
          screen: 'ClubsTab',
          params: {
            successTitle: 'Club eliminado',
            successMessage: 'El club fue eliminado permanentemente.',
          },
        });
      }
    );
  };

  if (loading || !club) {
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
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const limites = CLUB_LIMITS[club.plan] || CLUB_LIMITS.estandar;

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
        <Text style={styles.headerTitle} numberOfLines={1}>
          {club.nombre}
        </Text>
        {soyAdmin && (
          <Pressable
            onPress={() => navigation.navigate('EditClub', { club })}
            hitSlop={8}
            style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.6 }]}
          >
            <Pencil color={colors.primary} size={18} />
          </Pressable>
        )}
        {soyMiembro && (
          <Pressable
            onPress={() =>
              navigation.navigate('ChatThread', {
                threadKey: `club:${club.id}`,
                title: club.nombre,
                subtitle: 'Chat del club',
                fotoUrl: club.foto_url || null,
              })
            }
            hitSlop={8}
            style={({ pressed }) => [styles.chatBtn, pressed && { opacity: 0.6 }]}
          >
            <MessageCircle color={colors.primary} size={18} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => item.member_id}
        contentContainerStyle={styles.listContent}
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

            {/* Header del club */}
            <View style={styles.clubHeader}>
              {club.foto_url ? (
                <Image source={{ uri: club.foto_url }} style={styles.logo} />
              ) : (
                <View style={[styles.logo, styles.logoFallback]}>
                  <Shield color={colors.primary} size={34} strokeWidth={1.6} />
                </View>
              )}
              <View style={styles.clubNameRow}>
                <Text style={styles.clubName}>{club.nombre}</Text>
                {club.verificado ? (
                  <BadgeCheck color={premiumGold} size={18} strokeWidth={2.2} />
                ) : null}
              </View>
              {club.comuna ? (
                <View style={styles.metaRow}>
                  <MapPin color={colors.textMuted} size={13} />
                  <Text style={styles.metaText}>
                    {club.comuna}{club.region ? `, ${club.region}` : ''}
                  </Text>
                </View>
              ) : null}
              {club.descripcion ? (
                <Text style={styles.descripcion}>{club.descripcion}</Text>
              ) : null}
            </View>

            {/* Acción principal para visitantes */}
            {!soyMiembro && !tengoOtroClub && (
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
            {!soyMiembro && tengoOtroClub && (
              <Banner
                type="info"
                title="Ya perteneces a un club"
                message="Para unirte a este club primero debes salir del tuyo."
              />
            )}

            {/* Invitar jugadores (solo admin) */}
            {soyAdmin && (
              <Button
                label="Invitar jugadores"
                icon={<UserPlus color="#0E0E0D" size={18} strokeWidth={2.4} />}
                onPress={() =>
                  navigation.navigate('ClubInvite', {
                    clubId: club.id,
                    clubNombre: club.nombre,
                  })
                }
                style={styles.inviteBtn}
              />
            )}

            {/* Solicitudes pendientes (solo admin) */}
            {soyAdmin && requests.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  Solicitudes pendientes ({requests.length})
                </Text>
                {requests.map((req) => (
                  <View key={req.request_id} style={styles.requestRow}>
                    <MemberAvatar foto={req.foto_url} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName}>{req.username}</Text>
                      <Text style={styles.memberMeta}>
                        Reputación {req.trust_score}
                        {req.comuna ? ` · ${req.comuna}` : ''}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => handleRespond(req, true)}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.reqBtn,
                        styles.reqAccept,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Check color="#0E0E0D" size={16} strokeWidth={2.6} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleRespond(req, false)}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.reqBtn,
                        styles.reqReject,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <X color={colors.error} size={16} strokeWidth={2.6} />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.sectionTitle}>
              Integrantes ({members.length}/{limites.miembros})
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => navigation.navigate('UserProfile', { userId: item.user_id })}
            style={({ pressed }) => [styles.memberRow, pressed && { opacity: 0.85 }]}
          >
            <MemberAvatar foto={item.foto_url} />
            <View style={{ flex: 1 }}>
              <View style={styles.memberNameRow}>
                <Text style={styles.memberName}>{item.username}</Text>
                {item.rol === 'admin' && (
                  <View style={styles.adminChip}>
                    <Crown color={colors.primary} size={10} strokeWidth={2.4} />
                    <Text style={styles.adminChipText}>Admin</Text>
                  </View>
                )}
              </View>
              <Text style={styles.memberMeta}>
                Reputación {item.trust_score}
                {item.comuna ? ` · ${item.comuna}` : ''}
              </Text>
            </View>
            {soyAdmin && item.user_id !== me && item.rol !== 'admin' && (
              <Pressable
                onPress={() => handlePromote(item)}
                hitSlop={8}
                style={({ pressed }) => [styles.promoteBtn, pressed && { opacity: 0.5 }]}
              >
                <Crown color={colors.primary} size={16} />
              </Pressable>
            )}
            {soyAdmin && item.user_id !== me && (
              <Pressable
                onPress={() => handleExpel(item)}
                hitSlop={8}
                style={({ pressed }) => [styles.expelBtn, pressed && { opacity: 0.5 }]}
              >
                <UserMinus color={colors.error} size={16} />
              </Pressable>
            )}
          </Pressable>
        )}
        ListFooterComponent={
          soyMiembro ? (
            <View>
              <Pressable
                onPress={handleLeave}
                style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.7 }]}
              >
                <LogOut color={colors.error} size={16} />
                <Text style={styles.leaveText}>
                  {members.length === 1 ? 'Eliminar club' : 'Salir del club'}
                </Text>
              </Pressable>
              {soyAdmin && (
                <Pressable
                  onPress={handleDeleteClub}
                  disabled={working}
                  style={({ pressed }) => [styles.deleteClubBtn, pressed && { opacity: 0.7 }]}
                >
                  <Trash2 color={colors.error} size={16} />
                  <Text style={styles.leaveText}>Eliminar club permanentemente</Text>
                </Pressable>
              )}
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function MemberAvatar({ foto }) {
  if (foto) {
    return <Image source={{ uri: foto }} style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Shield color={colors.textMuted} size={18} strokeWidth={1.8} />
    </View>
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
  chatBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },

  clubHeader: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    marginBottom: 10,
  },
  logoFallback: {
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clubNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  clubName: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  metaText: { color: colors.textMuted, fontSize: 13 },
  descripcion: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 10,
    maxWidth: 320,
  },
  joinBtn: { marginBottom: 16 },
  inviteBtn: { marginBottom: 16 },

  section: { marginBottom: 8 },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 8,
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    padding: 12,
    marginBottom: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  avatarFallback: {
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderSoft,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  memberName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  memberMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  adminChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  adminChipText: {
    color: colors.primary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  reqBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqAccept: { backgroundColor: colors.primary },
  reqReject: {
    backgroundColor: colors.errorSoft,
    borderWidth: 1,
    borderColor: colors.error,
  },
  promoteBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  expelBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.errorSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorSoft,
  },
  leaveText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '700',
  },
  deleteClubBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.error,
    backgroundColor: colors.errorSoft,
  },
});
