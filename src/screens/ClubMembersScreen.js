import React, { useCallback, useMemo, useRef, useState } from 'react';
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
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  ArrowLeft,
  Crown,
  Star,
  X,
  UserMinus,
  LogOut,
  MessageCircle,
  UserPlus,
  Search,
  MoreVertical,
  User,
  Pencil,
  Send,
  Plus,
} from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
  alfa,
} from '../theme/colors';
import { etiquetaPosiciones } from '../utils/playerMeta';
import { haceCuanto } from '../utils/tiempoRelativo.js';
import { temaDeClub } from '../theme/clubThemes';
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
import { getMisPermisosEnClub } from '../services/clubPermissions';

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
  const [misPermisos, setMisPermisos] = useState(null);
  const [apodoEdit, setApodoEdit] = useState(null); // { member, value }

  const miMembresia = members.find((m) => m.user_id === me);
  const soyMiembro = Boolean(miMembresia);
  const soyAdmin = miMembresia?.rol === 'admin';
  // Usuario con 3 clubes no puede unirse a otro (sin importar cuáles sean)
  const tengoMaxClubs = myClubs.length >= 3;

  // Tres de los nueve permisos delegables (migración 119) viven en esta
  // pantalla: invitar, editar apodos ajenos y quitar integrantes.
  const puedeInvitar = soyAdmin || !!misPermisos?.invite;
  const puedeEditarApodos = soyAdmin || !!misPermisos?.editNicks;
  const puedeExpulsar = soyAdmin || !!misPermisos?.removeMembers;

  // Token de la carga vigente: navegar adentro/afuera rápido puede disparar
  // varios `load()` seguidos vía `useFocusEffect`, y sin esto la respuesta
  // de uno viejo podía llegar DESPUÉS que la de uno nuevo y pisar el estado.
  const loadTokenRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++loadTokenRef.current;
    const user = await getCurrentUser();
    const myId = user?.id || null;
    if (token !== loadTokenRef.current) return;
    setMe(myId);

    const [{ data: c }, { data: ms }, { data: mine }] = await Promise.all([
      getClubById(clubId),
      listMembers(clubId),
      getMyClubs(),
    ]);
    if (token !== loadTokenRef.current) return;
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
    if (amMember) {
      const { data: permisos } = await getMisPermisosEnClub(clubId);
      setMisPermisos(permisos?.permisos || null);
    } else {
      setMisPermisos(null);
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

  const handlePromote = async (member) => {
    const limites = CLUB_LIMITS;
    // Cuenta fresca, no la del último `load()`: si otro admin cambió el
    // plantel entremedio, decidir con el número viejo podía ofrecer «se
    // suma sin que dejes de ser admin» con el cupo ya lleno (o al revés), y
    // el diálogo prometía algo que el servidor iba a rechazar al confirmar.
    const { data: miembrosFrescos, error: errFrescos } = await listMembers(clubId);
    const adminCount = (errFrescos ? members : miembrosFrescos).filter((m) => m.rol === 'admin').length;

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
      // sin cupo (ya hay 3 admins): ceder mi administración
      confirmar(
        `¿Ceder la administración a ${member.username}?`,
        `Un club puede tener hasta ${limites.admins} admin${limites.admins > 1 ? 's' : ''}: tú pasarás a ser jugador.`,
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
            accessibilityRole="button"
            accessibilityLabel="Volver"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  const limites = CLUB_LIMITS;
  const cuposRestantes = Math.max(0, limites.miembros - members.length);
  const admins = members.filter((m) => m.rol === 'admin').length;
  const tema = temaDeClub(club);
  const isSolicitudesTab = soyAdmin && tab === 'solicitudes';
  const listData = isSolicitudesTab ? requests : filteredMembers;
  const listKeyExtractor = isSolicitudesTab
    ? (item) => item.request_id
    : (item) => item.member_id;
  // Rediseño de Clubes (2026-11-26): el resumen del plantel pasó de una
  // tarjeta con barra al subtítulo de la cabecera.
  const subtitulo = isSolicitudesTab
    ? cuposRestantes > 0
      ? `Quedan ${cuposRestantes} cupo${cuposRestantes === 1 ? '' : 's'}`
      : 'Plantel completo'
    : soyAdmin
      ? `${members.length} de ${limites.miembros} · ${admins} de ${limites.admins} administradores`
      : `${club.nombre} · ${members.length} de ${limites.miembros}`;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
        >
          <ArrowLeft color={C.textPrimary} size={18} strokeWidth={2.2} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Integrantes
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {subtitulo}
          </Text>
        </View>
        {/* Invitar jugadores (admin, o quien tenga el permiso concedido). */}
        {puedeInvitar && (
          <Pressable
            onPress={() =>
              navigation.navigate('ClubInvite', {
                clubId: club.id,
                clubNombre: club.nombre,
              })
            }
            accessibilityRole="button"
            accessibilityLabel="Invitar jugadores"
            style={({ pressed }) => [styles.invitarBtn, pressed && { backgroundColor: C.greenSoftStrong }]}
          >
            <Plus color={C.green} size={15} strokeWidth={2.6} />
            <Text style={styles.invitarBtnText}>Invitar</Text>
          </Pressable>
        )}
        {/* El chat del club vive en la cabecera de la ficha; acá queda como
            segundo camino para quien llega por un enlace a Integrantes. */}
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
            accessibilityRole="button"
            accessibilityLabel="Chat del club"
            style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
          >
            <MessageCircle color={C.textPrimary} size={18} strokeWidth={2.2} />
          </Pressable>
        )}
      </View>

      {soyAdmin && (
        <View style={styles.tabRow}>
          <Pressable
            onPress={() => setTab('miembros')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'miembros' }}
            style={[styles.tabBtn, tab === 'miembros' && { borderBottomColor: tema.main }]}
          >
            <Text style={[styles.tabLabel, tab === 'miembros' && styles.tabLabelActive]}>Miembros</Text>
          </Pressable>
          <Pressable
            onPress={() => setTab('solicitudes')}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === 'solicitudes' }}
            accessibilityLabel={`Solicitudes, ${requests.length} pendientes`}
            style={[styles.tabBtn, tab === 'solicitudes' && { borderBottomColor: tema.main }]}
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

      <FlatList
        data={listData}
        keyExtractor={listKeyExtractor}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={C.green}
            colors={[C.green]}
          />
        }
        ListHeaderComponent={
          <View>
            {banner && <Banner {...banner} onClose={() => setBanner(null)} />}

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
                  <ActivityIndicator color={myRequest ? C.textPrimary : C.textOnGreen} />
                ) : (
                  <>
                    {!myRequest && <UserPlus color={C.textOnGreen} size={18} strokeWidth={2.4} />}
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

            {!isSolicitudesTab && (
              <View style={styles.searchBox}>
                <Search color={C.textSecondary} size={17} strokeWidth={2} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar integrante"
                  placeholderTextColor={C.textSecondary}
                  accessibilityLabel="Buscar por nombre, apodo o posición"
                  style={styles.searchInput}
                />
                {query.length > 0 && (
                  <Pressable onPress={() => setQuery('')} hitSlop={8} style={styles.searchClear}>
                    <X color={C.textSecondary} size={14} strokeWidth={2.4} />
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
        ItemSeparatorComponent={isSolicitudesTab ? null : () => <View style={styles.separador} />}
        renderItem={
          isSolicitudesTab
            ? ({ item }) => {
                const hace = haceCuanto(item.created_at);
                const meta = [hace ? `Hace ${hace}` : null, item.comuna ? `Vive en ${item.comuna}` : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <View style={styles.requestCard}>
                    <Pressable
                      onPress={() => navigation.navigate('UserProfile', { userId: item.user_id })}
                      accessibilityRole="button"
                      accessibilityLabel={`Ver el perfil de ${item.username}`}
                      style={styles.requestTop}
                    >
                      <MemberAvatar foto={item.foto_url} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName}>{item.username}</Text>
                        {meta ? <Text style={styles.memberMeta}>{meta}</Text> : null}
                      </View>
                    </Pressable>
                    <View style={styles.requestActions}>
                      <Pressable
                        onPress={() => handleRespond(item, true)}
                        accessibilityRole="button"
                        accessibilityLabel={`Aceptar a ${item.username}`}
                        style={({ pressed }) => [styles.reqAccept, pressed && { backgroundColor: C.greenActive }]}
                      >
                        <Text style={styles.reqAcceptText}>Aceptar</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleRespond(item, false)}
                        accessibilityRole="button"
                        accessibilityLabel={`Rechazar a ${item.username}`}
                        style={({ pressed }) => [styles.reqReject, pressed && { backgroundColor: C.surfaceHover }]}
                      >
                        <Text style={styles.reqRejectText}>Rechazar</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }
            : ({ item }) => {
                const posiciones = etiquetaPosiciones(item.posicion_preferida);
                const esYo = item.user_id === me;
                const rol =
                  item.rol === 'admin' ? 'Administrador' : item.rol === 'capitan' ? 'Capitán' : 'Jugador';
                const linea = [esYo ? `${rol} · tú` : rol, posiciones].filter(Boolean).join(' · ');
                return (
                  <Pressable
                    onPress={() => navigation.navigate('UserProfile', { userId: item.user_id })}
                    style={({ pressed }) => [styles.memberRow, pressed && { backgroundColor: C.surfaceHover }]}
                  >
                    <MemberAvatar foto={item.foto_url} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.memberName} numberOfLines={1}>
                        {item.username}
                        {item.apodo ? <Text style={styles.memberApodo}> · «{item.apodo}»</Text> : null}
                      </Text>
                      <View style={styles.rolFila}>
                        {item.rol === 'admin' && <Crown color={C.green} size={11} strokeWidth={2.4} />}
                        {item.rol === 'capitan' && <Star color={C.gold} size={11} strokeWidth={2.4} />}
                        <Text style={styles.memberMeta} numberOfLines={1}>
                          {linea}
                        </Text>
                      </View>
                    </View>
                    {esYo ? (
                      <View style={styles.chipNeutro}>
                        <Text style={styles.chipNeutroText}>Tú</Text>
                      </View>
                    ) : (
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
                      accessibilityRole="button"
                      accessibilityLabel={`Opciones de ${item.apodo || item.username || 'este integrante'}`}
                      style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.6 }]}
                    >
                      <MoreVertical color={C.textMuted} size={18} />
                    </Pressable>
                  </Pressable>
                );
              }
        }
        ListFooterComponent={
          isSolicitudesTab ? (
            requests.length > 0 ? (
              <Text style={styles.footNote}>
                Al aceptar, la persona entra como jugador. Cada club admite hasta {limites.miembros}{' '}
                integrantes.
              </Text>
            ) : null
          ) : soyMiembro ? (
            <Pressable
              onPress={handleLeave}
              accessibilityRole="button"
              accessibilityLabel="Salir del club"
              style={({ pressed }) => [styles.leaveBtn, pressed && { opacity: 0.7 }]}
            >
              <LogOut color={C.loss} size={16} />
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
                  icon={<User color={C.textPrimary} size={18} strokeWidth={2} />}
                  label="Ver perfil"
                  onPress={() => {
                    setActionSheet(null);
                    navigation.navigate('UserProfile', { userId: actionSheet.user_id });
                  }}
                />

                {(actionSheet.user_id === me || puedeEditarApodos) && (
                  <SheetAction
                    icon={<Pencil color={C.textPrimary} size={18} strokeWidth={2} />}
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
                    icon={<Send color={C.textPrimary} size={18} strokeWidth={2} />}
                    label="Enviar mensaje"
                    onPress={() => openMessage(actionSheet)}
                  />
                )}

                {soyAdmin && actionSheet.user_id !== me && actionSheet.rol !== 'admin' && (
                  <>
                    <SheetAction
                      icon={<Crown color={C.textPrimary} size={18} strokeWidth={2} />}
                      label="Hacer administrador"
                      onPress={() => {
                        const member = actionSheet;
                        setActionSheet(null);
                        handlePromote(member);
                      }}
                    />
                    {actionSheet.rol === 'capitan' ? (
                      <SheetAction
                        icon={<Star color={C.textPrimary} size={18} strokeWidth={2} />}
                        label="Quitar como capitán"
                        onPress={() => {
                          const member = actionSheet;
                          setActionSheet(null);
                          handleSetCaptain(member, false);
                        }}
                      />
                    ) : (
                      <SheetAction
                        icon={<Star color={C.textPrimary} size={18} strokeWidth={2} />}
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

                {(soyAdmin || (puedeExpulsar && actionSheet.rol !== 'admin')) &&
                  actionSheet.user_id !== me && (
                  <SheetAction
                    icon={<UserMinus color={C.loss} size={18} strokeWidth={2} />}
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
              placeholderTextColor={C.textMuted}
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
                <ActivityIndicator color={C.greenInk} />
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
      <User color={C.textMuted} size={18} strokeWidth={1.8} />
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
      <View style={styles.chipNeutro} accessibilityLabel="Ya son amigos">
        <Text style={styles.chipNeutroText}>Amigos</Text>
      </View>
    );
  }
  if (status === 'sent') {
    return (
      <View style={styles.chipNeutro} accessibilityLabel="Solicitud de amistad enviada">
        <Text style={[styles.chipNeutroText, { color: C.textSecondary }]}>Enviada</Text>
      </View>
    );
  }
  if (status === 'received') {
    return (
      <Pressable
        onPress={onAccept}
        hitSlop={6}
        style={({ pressed }) => [styles.chipVerde, pressed && { backgroundColor: C.greenSoftStrong }]}
        accessibilityRole="button"
        accessibilityLabel="Aceptar solicitud de amistad"
      >
        <Text style={styles.chipVerdeText}>Aceptar</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onAdd}
      hitSlop={6}
      style={({ pressed }) => [styles.chipVerde, pressed && { backgroundColor: C.greenSoftStrong }]}
      accessibilityRole="button"
      accessibilityLabel="Agregar amigo"
    >
      <Text style={styles.chipVerdeText}>Agregar</Text>
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
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: S.screenPadding,
    paddingTop: 4,
    paddingBottom: 12,
    gap: 8,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnPressed: { backgroundColor: C.chipStrong },
  headerTitles: { flex: 1, minWidth: 0 },
  headerTitle: { color: C.textPrimary, fontSize: 19, fontFamily: F.extraBold, letterSpacing: -0.2 },
  headerSubtitle: {
    color: C.textSecondary,
    fontSize: 12.5,
    marginTop: 1,
  },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingHorizontal: S.screenPadding, paddingBottom: 40 },


  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: R.iconBtn,
    backgroundColor: C.green,
    marginBottom: 12,
  },
  primaryBtnText: { color: C.textOnGreen, fontSize: 15, fontFamily: F.extraBold },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 50,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    marginBottom: 12,
  },
  secondaryBtnText: {
    color: C.textPrimary,
    fontSize: 15,
    fontFamily: F.bold,
  },

  tabRow: {
    flexDirection: 'row',
    gap: 20,
    paddingHorizontal: S.screenPadding,
    borderBottomWidth: 1,
    borderBottomColor: C.borderSoft,
    marginBottom: 14,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1,
  },
  tabLabel: { color: C.textSecondary, fontSize: 14, fontFamily: F.bold },
  tabLabelActive: { color: C.textPrimary },
  tabBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: C.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: { color: C.bg, fontSize: 10.5, fontFamily: F.extraBold },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 46,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.iconBtn,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 14,
    // La caja ya marca el campo; el contorno naranjo del navegador no va.
    ...Platform.select({ web: { outlineStyle: 'none' } }),
  },
  searchClear: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },

  emptyHint: {
    color: C.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 20,
  },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },
  avatarFallback: {
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  memberName: { color: C.textPrimary, fontSize: 15, fontFamily: F.bold },
  memberApodo: {
    color: C.textSecondary,
    fontFamily: F.medium,
    fontSize: 13,
  },
  memberMeta: { color: C.textSecondary, fontSize: 12.5, flexShrink: 1 },
  reqAccept: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.green,
  },
  reqReject: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
  },
  invitarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.greenBorderStrong,
    backgroundColor: C.greenSoft,
  },
  invitarBtnText: { color: C.green, fontSize: 13.5, fontFamily: F.bold },
  separador: { height: 1, backgroundColor: C.borderSoft, marginLeft: 56 },
  rolFila: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  chipNeutro: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
    justifyContent: 'center',
  },
  chipNeutroText: { color: C.textPrimary, fontSize: 12, fontFamily: F.bold },
  chipVerde: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: C.greenBorderStrong,
    backgroundColor: C.greenSoft,
    justifyContent: 'center',
  },
  chipVerdeText: { color: C.green, fontSize: 12, fontFamily: F.bold },
  requestCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 10,
    gap: 12,
  },
  requestTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  requestActions: { flexDirection: 'row', gap: 8 },
  reqAcceptText: { color: C.textOnGreen, fontSize: 14, fontFamily: F.extraBold },
  reqRejectText: { color: C.textPrimary, fontSize: 14, fontFamily: F.bold },
  footNote: { color: C.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 6, lineHeight: 17 },
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
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: C.borderSoft,
  },
  leaveText: {
    color: C.loss,
    fontSize: 14,
    fontFamily: F.bold,
  },

  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    borderTopWidth: 1,
    borderColor: C.border,
    paddingHorizontal: S.screenPadding,
    paddingTop: 14,
    paddingBottom: 30,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 3,
    backgroundColor: alfa(C.tinta, 0.2),
    alignSelf: 'center',
    marginBottom: 14,
  },
  sheetTitle: {
    color: C.textPrimary,
    fontSize: 17,
    fontFamily: F.extraBold,
    letterSpacing: -0.3,
    marginBottom: 6,
  },
  sheetSubtitle: {
    color: C.textSecondary,
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
    color: C.textPrimary,
    fontSize: 15,
    fontFamily: F.semiBold,
  },
  sheetActionLabelDanger: { color: C.loss },
  apodoInput: {
    height: 48,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    paddingHorizontal: 14,
    color: C.textPrimary,
    fontSize: 15,
    marginBottom: 14,
  },
  sheetPrimary: {
    height: 50,
    borderRadius: R.iconBtn,
    backgroundColor: C.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetPrimaryText: {
    color: C.greenInk,
    fontSize: 15,
    fontFamily: F.extraBold,
  },
});
