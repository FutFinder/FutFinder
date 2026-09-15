import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Image,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Shield,
  Crown,
  Star,
  Check,
  X,
  UserMinus,
  LogOut,
  MessageCircle,
  UserPlus,
  UserCheck,
  Clock,
  Search,
  MoreVertical,
  User,
  Pencil,
  Send,
} from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../theme/colors';
import { etiquetaPosiciones } from '../utils/playerMeta';
import Banner from '../components/Banner';
import { getCurrentUser } from '../services/auth';
import {
  getFriendshipStatuses,
  sendFriendRequest,
  acceptFriendRequest,
} from '../services/friends';
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
  getMyClubs,
  promoteToAdmin,
  transferAdmin,
  setCaptain,
  setApodo,
  CLUB_LIMITS,
} from '../services/clubs';
import useConfirmacion from '../components/useConfirmacion';

/** Confirmación multiplataforma (web usa confirm, native usa Alert). */
/**
 * Integrantes de un club: lista de miembros con reputación, apodo y rol, y
 * acciones según quién mire:
 *  - visitante sin club  → "Solicitar unirme" / "Cancelar solicitud"
 *  - miembro             → chat, buscar, ver ficha de cada compañero
 *  - admin               → además: solicitudes, capitán, admin, expulsar
 *
 * Se llega aquí desde el contador de integrantes del dashboard (ClubDetail).
 */
export default function ClubMembersScreen({ navigation, route }) {
  // `window.confirm` no abre nada en web: devuelve false al instante y la
  // acción no se ejecutaba nunca, sin decir por qué. Diálogo propio.
  const { confirmar, dialogo } = useConfirmacion();
  const { clubId } = route.params || {};

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [club, setClub] = useState(null);
  const [members, setMembers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [myRequest, setMyRequest] = useState(null);
  const [me, setMe] = useState(null);
  const [myClubs, setMyClubs] = useState([]);
  const [friendStatus, setFriendStatus] = useState(new Map()); // user_id -> { status, friendshipId }
  const [banner, setBanner] = useState(null);
  const [working, setWorking] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState('miembros'); // 'miembros' | 'solicitudes'
  const [actionSheet, setActionSheet] = useState(null); // miembro seleccionado en el menú ⋮
  const [apodoEdit, setApodoEdit] = useState(null); // { member, value }

  const miMembresia = members.find((m) => m.user_id === me);
  const soyMiembro = Boolean(miMembresia);
  const soyAdmin = miMembresia?.rol === 'admin';
  // Usuario con 3 clubes no puede unirse a otro (sin importar cuáles sean)
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

    // Estado de amistad con cada integrante (para el botón "Agregar amigo")
    if (myId && ms && ms.length > 0) {
      const otherIds = ms.map((m) => m.user_id).filter((id) => id !== myId);
      const { data: statuses } = await getFriendshipStatuses(otherIds);
      setFriendStatus(statuses || new Map());
    } else {
      setFriendStatus(new Map());
    }

    const amMember = (ms || []).some((m) => m.user_id === myId);
    const amAdmin = (ms || []).some((m) => m.user_id === myId && m.rol === 'admin');

    if (amAdmin) {
      const { data: reqs } = await listPendingRequests(clubId);
      setRequests(reqs || []);
    } else {
      setRequests([]);
      setTab('miembros');
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

  const filteredMembers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => {
      if (m.username?.toLowerCase().includes(q)) return true;
      if (m.apodo?.toLowerCase().includes(q)) return true;
      if ((m.posicion_preferida || []).some((p) => p.replace('_', ' ').includes(q))) return true;
      return false;
    });
  }, [members, query]);

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
    confirmar(
      '¿Salir del club?',
      'Dejarás de ver el chat y los datos internos del club.',
      async () => {
        setWorking(true);
        const { error, clubDeleted } = await leaveClub(clubId);
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
      confirmar(
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
      confirmar(
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

  const handleSetCaptain = async (member, on) => {
    setWorking(true);
    const { error } = await setCaptain(member.member_id, on);
    setWorking(false);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo actualizar', message: error.message });
      return;
    }
    setBanner({
      type: 'success',
      title: on ? 'Nuevo capitán' : 'Capitán actualizado',
      message: on
        ? `${member.username} ahora es capitán del club.`
        : `${member.username} ya no es capitán.`,
    });
    await load();
  };

  const handleSaveApodo = async (member, value) => {
    setWorking(true);
    const { error } = await setApodo(member.member_id, value);
    setWorking(false);
    setApodoEdit(null);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo guardar', message: error.message });
      return;
    }
    await load();
  };

  const handleAddFriend = async (member) => {
    // Optimista: marcamos "enviada" de inmediato
    setFriendStatus((prev) => {
      const next = new Map(prev);
      next.set(member.user_id, { status: 'sent', friendshipId: null });
      return next;
    });
    const { data, error } = await sendFriendRequest(member.user_id);
    if (error) {
      // revertir
      setFriendStatus((prev) => {
        const next = new Map(prev);
        next.set(member.user_id, { status: 'none', friendshipId: null });
        return next;
      });
      setBanner({ type: 'error', title: 'No se pudo enviar', message: error.message });
      return;
    }
    setFriendStatus((prev) => {
      const next = new Map(prev);
      // si ya existía relación aceptada, getFriendshipWith la devolvió
      const isAccepted = data?.status === 'accepted';
      next.set(member.user_id, {
        status: isAccepted ? 'friends' : 'sent',
        friendshipId: data?.id || null,
      });
      return next;
    });
    setBanner({
      type: 'success',
      title: 'Solicitud enviada',
      message: `Le enviaste una solicitud de amistad a ${member.username}.`,
    });
  };

  const handleAcceptFriend = async (member, friendshipId) => {
    if (!friendshipId) return;
    const { error } = await acceptFriendRequest(friendshipId);
    if (error) {
      setBanner({ type: 'error', title: 'No se pudo aceptar', message: error.message });
      return;
    }
    setFriendStatus((prev) => {
      const next = new Map(prev);
      next.set(member.user_id, { status: 'friends', friendshipId });
      return next;
    });
    setBanner({
      type: 'success',
      title: '¡Nuevo amigo!',
      message: `Ahora tú y ${member.username} son amigos.`,
    });
  };

  const handleExpel = (member) => {
    confirmar(
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

  const openMessage = (member) => {
    setActionSheet(null);
    (navigation.getParent() || navigation).navigate('ChatThread', {
      threadKey: `dm:${member.user_id}`,
      title: `@${member.username}`,
      subtitle: 'Mensaje directo',
      fotoUrl: member.foto_url || null,
    });
  };

  if (loading || !club) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.header}>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
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

  const limites = CLUB_LIMITS[club.plan] || CLUB_LIMITS.estandar;
  const cuposRestantes = Math.max(0, limites.miembros - members.length);
  const isSolicitudesTab = soyAdmin && tab === 'solicitudes';
  const listData = isSolicitudesTab ? requests : filteredMembers;
  const listKeyExtractor = isSolicitudesTab
    ? (item) => item.request_id
    : (item) => item.member_id;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          <ArrowLeft color={clubColors.textPrimary} size={18} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Integrantes
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {club.nombre}
          </Text>
        </View>
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
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <MessageCircle color={clubColors.green} size={18} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>

      <FlatList
        data={listData}
        keyExtractor={listKeyExtractor}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={clubColors.green}
            colors={[clubColors.green]}
          />
        }
        ListHeaderComponent={
          <View>
            {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

            <View style={styles.summaryCard}>
              <View style={styles.summaryHeaderRow}>
                <Text style={styles.summaryTitle}>
                  Plantel {members.length}/{limites.miembros}
                </Text>
              </View>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${Math.min(100, (members.length / limites.miembros) * 100)}%` },
                  ]}
                />
              </View>
              <Text style={styles.summaryHint}>
                {cuposRestantes > 0
                  ? `Quedan ${cuposRestantes} cupo${cuposRestantes === 1 ? '' : 's'} en el plantel`
                  : 'Plantel completo'}
              </Text>
            </View>

            {/* Acción principal para visitantes */}
            {!soyMiembro && !tengoMaxClubs && (
              <Pressable
                onPress={myRequest ? handleCancelRequest : handleJoin}
                disabled={working}
                style={({ pressed }) => [
                  myRequest ? styles.secondaryBtn : styles.primaryBtn,
                  pressed && !working && { opacity: 0.85 },
                  working && { opacity: 0.6 },
                ]}
              >
                {working ? (
                  <ActivityIndicator color={myRequest ? clubColors.textPrimary : clubColors.greenInk} />
                ) : (
                  <>
                    {!myRequest && <UserPlus color={clubColors.greenInk} size={18} strokeWidth={2.4} />}
                    <Text style={myRequest ? styles.secondaryBtnText : styles.primaryBtnText}>
                      {myRequest ? 'Cancelar solicitud' : 'Solicitar unirme'}
                    </Text>
                  </>
                )}
              </Pressable>
            )}
            {!soyMiembro && tengoMaxClubs && (
              <Banner
                type="info"
                title="Ya perteneces al máximo de 3 clubes"
                message="Para unirte a este club primero debes salir de uno de tus clubes."
              />
            )}

            {/* Invitar jugadores (solo admin) */}
            {soyAdmin && (
              <Pressable
                onPress={() =>
                  navigation.navigate('ClubInvite', {
                    clubId: club.id,
                    clubNombre: club.nombre,
                  })
                }
                style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.85 }]}
              >
                <UserPlus color={clubColors.greenInk} size={18} strokeWidth={2.4} />
                <Text style={styles.primaryBtnText}>Invitar jugadores</Text>
              </Pressable>
            )}

            {soyAdmin && (
              <View style={styles.tabRow}>
                <Pressable
                  onPress={() => setTab('miembros')}
                  style={[styles.tabBtn, tab === 'miembros' && styles.tabBtnActive]}
                >
                  <Text style={[styles.tabLabel, tab === 'miembros' && styles.tabLabelActive]}>
                    Integrantes
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setTab('solicitudes')}
                  style={[styles.tabBtn, tab === 'solicitudes' && styles.tabBtnActive]}
                >
                  <Text style={[styles.tabLabel, tab === 'solicitudes' && styles.tabLabelActive]}>
                    Solicitudes
                  </Text>
                  {requests.length > 0 && (
                    <View style={styles.tabBadge}>
                      <Text style={styles.tabBadgeText}>{requests.length}</Text>
                    </View>
                  )}
                </Pressable>
              </View>
            )}

            {!isSolicitudesTab && (
              <View style={styles.searchBox}>
                <Search color={clubColors.textSecondary} size={18} strokeWidth={2} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar por nombre, apodo o posición"
                  placeholderTextColor={clubColors.textSecondary}
                  style={styles.searchInput}
                />
                {query.length > 0 && (
                  <Pressable onPress={() => setQuery('')} hitSlop={8} style={styles.searchClear}>
                    <X color={clubColors.textSecondary} size={14} strokeWidth={2.4} />
                  </Pressable>
                )}
              </View>
            )}

            {isSolicitudesTab && requests.length === 0 && (
              <Text style={styles.emptyHint}>No hay solicitudes pendientes.</Text>
            )}
            {!isSolicitudesTab && filteredMembers.length === 0 && query.length > 0 && (
              <Text style={styles.emptyHint}>Nadie coincide con «{query}».</Text>
            )}
          </View>
        }
        renderItem={
          isSolicitudesTab
            ? ({ item }) => (
                <View style={styles.requestRow}>
                  <MemberAvatar foto={item.foto_url} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{item.username}</Text>
                    <Text style={styles.memberMeta}>
                      Reputación {item.trust_score}
                      {item.comuna ? ` · ${item.comuna}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleRespond(item, true)}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.reqBtn,
                      styles.reqAccept,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Check color={clubColors.greenInk} size={16} strokeWidth={2.6} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleRespond(item, false)}
                    hitSlop={6}
                    style={({ pressed }) => [
                      styles.reqBtn,
                      styles.reqReject,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <X color={clubColors.loss} size={16} strokeWidth={2.6} />
                  </Pressable>
                </View>
              )
            : ({ item }) => {
                const posiciones = etiquetaPosiciones(item.posicion_preferida);
                return (
                  <Pressable
                    onPress={() => navigation.navigate('UserProfile', { userId: item.user_id })}
                    style={({ pressed }) => [styles.memberRow, pressed && { opacity: 0.9 }]}
                  >
                    <MemberAvatar foto={item.foto_url} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {item.username}
                        {item.apodo ? <Text style={styles.memberApodo}> "{item.apodo}"</Text> : null}
                      </Text>
                      {(item.rol === 'admin' || item.rol === 'capitan') && (
                        <View style={styles.badgeRow}>
                          {item.rol === 'admin' && (
                            <View style={styles.adminChip}>
                              <Crown color={clubColors.green} size={10} strokeWidth={2.4} />
                              <Text style={styles.adminChipText}>Admin</Text>
                            </View>
                          )}
                          {item.rol === 'capitan' && (
                            <View style={styles.capitanChip}>
                              <Star color={clubColors.gold} size={10} strokeWidth={2.4} />
                              <Text style={styles.capitanChipText}>Capitán</Text>
                            </View>
                          )}
                        </View>
                      )}
                      <Text style={styles.memberMeta} numberOfLines={1}>
                        Reputación {item.trust_score}
                        {posiciones ? ` · ${posiciones}` : ''}
                        {item.comuna ? ` · ${item.comuna}` : ''}
                      </Text>
                    </View>
                    {item.user_id !== me && (
                      <FriendControl
                        status={friendStatus.get(item.user_id)?.status || 'none'}
                        onAdd={() => handleAddFriend(item)}
                        onAccept={() =>
                          handleAcceptFriend(item, friendStatus.get(item.user_id)?.friendshipId)
                        }
                      />
                    )}
                    <Pressable
                      onPress={() => setActionSheet(item)}
                      hitSlop={8}
                      style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.6 }]}
                    >
                      <MoreVertical color={clubColors.textMuted} size={18} />
                    </Pressable>
                  </Pressable>
                );
              }
        }
        ListFooterComponent={
          soyMiembro ? (
            <Pressable
              onPress={handleLeave}
              style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.7 }]}
            >
              <LogOut color={clubColors.loss} size={16} />
              <Text style={styles.leaveText}>Salir del club</Text>
            </Pressable>
          ) : null
        }
      />

      {/* Hoja: acciones sobre un integrante */}
      <Modal
        visible={!!actionSheet}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setActionSheet(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setActionSheet(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            {actionSheet && (
              <>
                <Text style={styles.sheetTitle} numberOfLines={1}>
                  {actionSheet.username}
                  {actionSheet.apodo ? ` "${actionSheet.apodo}"` : ''}
                </Text>

                <SheetAction
                  icon={<User color={clubColors.textPrimary} size={18} strokeWidth={2} />}
                  label="Ver perfil"
                  onPress={() => {
                    setActionSheet(null);
                    navigation.navigate('UserProfile', { userId: actionSheet.user_id });
                  }}
                />

                {(actionSheet.user_id === me || soyAdmin) && (
                  <SheetAction
                    icon={<Pencil color={clubColors.textPrimary} size={18} strokeWidth={2} />}
                    label="Editar apodo"
                    onPress={() => {
                      const member = actionSheet;
                      setApodoEdit({ member, value: member.apodo || '' });
                      setActionSheet(null);
                    }}
                  />
                )}

                {actionSheet.user_id !== me && (
                  <SheetAction
                    icon={<Send color={clubColors.textPrimary} size={18} strokeWidth={2} />}
                    label="Enviar mensaje"
                    onPress={() => openMessage(actionSheet)}
                  />
                )}

                {soyAdmin && actionSheet.user_id !== me && actionSheet.rol !== 'admin' && (
                  <>
                    <SheetAction
                      icon={<Crown color={clubColors.textPrimary} size={18} strokeWidth={2} />}
                      label="Hacer administrador"
                      onPress={() => {
                        const member = actionSheet;
                        setActionSheet(null);
                        handlePromote(member);
                      }}
                    />
                    {actionSheet.rol === 'capitan' ? (
                      <SheetAction
                        icon={<Star color={clubColors.textPrimary} size={18} strokeWidth={2} />}
                        label="Quitar como capitán"
                        onPress={() => {
                          const member = actionSheet;
                          setActionSheet(null);
                          handleSetCaptain(member, false);
                        }}
                      />
                    ) : (
                      <SheetAction
                        icon={<Star color={clubColors.textPrimary} size={18} strokeWidth={2} />}
                        label="Nombrar capitán"
                        onPress={() => {
                          const member = actionSheet;
                          setActionSheet(null);
                          handleSetCaptain(member, true);
                        }}
                      />
                    )}
                  </>
                )}

                {soyAdmin && actionSheet.user_id !== me && (
                  <SheetAction
                    icon={<UserMinus color={clubColors.loss} size={18} strokeWidth={2} />}
                    label="Quitar del club"
                    destructive
                    onPress={() => {
                      const member = actionSheet;
                      setActionSheet(null);
                      handleExpel(member);
                    }}
                  />
                )}
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Hoja: editar apodo */}
      <Modal
        visible={!!apodoEdit}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setApodoEdit(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setApodoEdit(null)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Apodo en el club</Text>
            <Text style={styles.sheetSubtitle}>
              Solo lo ven los integrantes de {club.nombre}. Déjalo vacío para quitarlo.
            </Text>
            <TextInput
              value={apodoEdit?.value || ''}
              onChangeText={(v) => setApodoEdit((prev) => (prev ? { ...prev, value: v } : prev))}
              placeholder="Ej: El Muro"
              placeholderTextColor={clubColors.textMuted}
              maxLength={18}
              autoFocus
              style={styles.apodoInput}
            />
            <Pressable
              onPress={() => apodoEdit && handleSaveApodo(apodoEdit.member, apodoEdit.value)}
              disabled={working}
              style={({ pressed }) => [
                styles.sheetPrimary,
                pressed && !working && { opacity: 0.85 },
                working && { opacity: 0.6 },
              ]}
            >
              {working ? (
                <ActivityIndicator color={clubColors.greenInk} />
              ) : (
                <Text style={styles.sheetPrimaryText}>Guardar</Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {dialogo}
    </SafeAreaView>
  );
}

function MemberAvatar({ foto }) {
  if (foto) {
    return <Image source={{ uri: foto }} style={styles.avatar} />;
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Shield color={clubColors.textMuted} size={18} strokeWidth={1.8} />
    </View>
  );
}

/**
 * Control de amistad junto a cada integrante:
 *  - friends  → ícono de amigos (sin acción)
 *  - sent     → "Solicitud enviada" (deshabilitado)
 *  - received → "Aceptar" (acepta la solicitud que me mandaron)
 *  - none     → "Agregar amigo"
 */
function FriendControl({ status, onAdd, onAccept }) {
  if (status === 'friends') {
    return (
      <View style={styles.friendIconBox} accessibilityLabel="Ya son amigos">
        <UserCheck color={clubColors.green} size={16} strokeWidth={2.2} />
      </View>
    );
  }
  if (status === 'sent') {
    return (
      <View style={styles.friendIconBoxMuted} accessibilityLabel="Solicitud enviada">
        <Clock color={clubColors.textMuted} size={14} strokeWidth={2.2} />
      </View>
    );
  }
  if (status === 'received') {
    return (
      <Pressable
        onPress={onAccept}
        hitSlop={6}
        style={({ pressed }) => [styles.friendIconBox, pressed && { opacity: 0.7 }]}
        accessibilityLabel="Aceptar solicitud de amistad"
      >
        <Check color={clubColors.green} size={16} strokeWidth={2.6} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onAdd}
      hitSlop={6}
      style={({ pressed }) => [styles.friendIconBoxMuted, pressed && { opacity: 0.7 }]}
      accessibilityLabel="Agregar amigo"
    >
      <UserPlus color={clubColors.textSecondary} size={14} strokeWidth={2.4} />
    </Pressable>
  );
}

function SheetAction({ icon, label, onPress, destructive, disabled }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.sheetAction,
        pressed && !disabled && styles.sheetActionPressed,
        disabled && { opacity: 0.4 },
      ]}
    >
      <View style={styles.sheetActionIcon}>{icon}</View>
      <Text style={[styles.sheetActionLabel, destructive && styles.sheetActionLabelDanger]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: clubColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: clubSizes.gutter,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 8,
  },
  iconBtn: {
    width: clubSizes.iconBtn,
    height: clubSizes.iconBtn,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: clubColors.chipStrong },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: {
    color: clubColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  headerSubtitle: {
    color: clubColors.textSecondary,
    fontSize: 12.5,
    marginTop: 1,
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: clubSizes.gutter, paddingBottom: 40 },

  summaryCard: {
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.lg,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    padding: 14,
    marginBottom: 14,
  },
  summaryHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  summaryTitle: {
    color: clubColors.textPrimary,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: clubColors.chip,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: clubColors.green,
  },
  summaryHint: {
    color: clubColors.textMuted,
    fontSize: 12,
    marginTop: 8,
  },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: clubRadius.md,
    backgroundColor: clubColors.green,
    marginBottom: 12,
  },
  primaryBtnText: {
    color: clubColors.greenInk,
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    marginBottom: 12,
  },
  secondaryBtnText: {
    color: clubColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },

  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flex: 1,
    height: 40,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
  },
  tabBtnActive: {
    backgroundColor: clubColors.greenSoft,
    borderColor: clubColors.greenBorder,
  },
  tabLabel: {
    color: clubColors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  tabLabelActive: { color: clubColors.green },
  tabBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: clubColors.loss,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { color: '#2A0C0F', fontSize: 10, fontWeight: '800' },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    backgroundColor: clubColors.surface,
    borderWidth: 1,
    borderColor: clubColors.border,
    borderRadius: clubRadius.md,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: clubColors.textPrimary,
    fontSize: 14,
  },
  searchClear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyHint: {
    color: clubColors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },

  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.lg,
    borderWidth: 1,
    borderColor: clubColors.greenBorder,
    padding: 12,
    marginBottom: 8,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: clubColors.surface,
    borderRadius: clubRadius.lg,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    padding: 12,
    marginBottom: 8,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  avatarFallback: {
    backgroundColor: clubColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
  },
  memberName: {
    color: clubColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  memberApodo: {
    color: clubColors.textSecondary,
    fontWeight: '500',
    fontSize: 13,
  },
  memberMeta: {
    color: clubColors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
  },
  adminChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: clubColors.greenSoft,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  adminChipText: {
    color: clubColors.green,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  capitanChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: clubColors.goldSoft,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  capitanChipText: {
    color: clubColors.gold,
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
  reqAccept: { backgroundColor: clubColors.green },
  reqReject: {
    backgroundColor: clubColors.chip,
    borderWidth: 1,
    borderColor: clubColors.loss,
  },
  friendIconBox: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: clubColors.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendIconBoxMuted: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: clubColors.chip,
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
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
    borderRadius: clubRadius.lg,
    borderWidth: 1,
    borderColor: clubColors.loss,
    backgroundColor: 'rgba(232, 115, 123, 0.1)',
  },
  leaveText: {
    color: clubColors.loss,
    fontSize: 14,
    fontWeight: '700',
  },

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
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  sheetSubtitle: {
    color: clubColors.textSecondary,
    fontSize: 12.5,
    marginBottom: 14,
  },
  sheetAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
  },
  sheetActionPressed: { opacity: 0.6 },
  sheetActionIcon: {
    width: 24,
    alignItems: 'center',
  },
  sheetActionLabel: {
    color: clubColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  sheetActionLabelDanger: { color: clubColors.loss },
  apodoInput: {
    height: 48,
    borderRadius: clubRadius.md,
    borderWidth: 1,
    borderColor: clubColors.border,
    backgroundColor: clubColors.chip,
    paddingHorizontal: 14,
    color: clubColors.textPrimary,
    fontSize: 15,
    marginBottom: 14,
  },
  sheetPrimary: {
    height: 50,
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
});
