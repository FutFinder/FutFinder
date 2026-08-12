import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  User as UserIcon,
  Users,
  BellOff,
  Bell,
  Trash2,
  Flag,
  Star,
  MapPin,
  Swords,
  Video,
} from 'lucide-react-native';
import EmojiPicker from 'rn-emoji-keyboard';

import ChatThreadHeader from '../components/chat/ChatThreadHeader';
import ChatComposer from '../components/chat/ChatComposer';
import ChatOptionsMenu from '../components/chat/ChatOptionsMenu';
import MessageBubble from '../components/chat/MessageBubble';
import {
  DayDivider,
  ContextPill,
  LoadEarlier,
  ThreadEmpty,
  ThreadDenied,
} from '../components/chat/ThreadDecorations';
import ReportPlayerSheet from '../components/player/ReportPlayerSheet';
import ChallengeHeader from '../components/clubes/ChallengeHeader';
import ChallengeEventBubble from '../components/clubes/ChallengeEventBubble';
import Banner from '../components/Banner';

import { chatColors } from '../theme/colors';
import {
  listThreadMessages,
  sendMessage,
  markThreadAsRead,
  subscribeToMessages,
  messageBelongsToThread,
  parseThreadKey,
  hideThread,
  getThreadAccess,
  setThreadMuted,
  isThreadMuted,
  parseComposerCommand,
  suggestCommands,
  canUseMentionAll,
} from '../services/messages';
import { getMatchById, getMatchAttendees } from '../services/matches';
import { getClubById, listMembers } from '../services/clubs';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { getChallenge, listChallengeEvents } from '../services/clubChallenges';
import { getChallengeCta, estadoLabel } from '../services/clubChallengeRules';
import { parseChallengeThread, challengeCtaContext } from '../utils/challengeThread';
import { reportUser } from '../services/reports';
import { supabase } from '../services/supabase';
import { notify } from '../utils/notify';
import {
  decorateMessages,
  canSendDraft,
  mergeOlderMessages,
  decideAutoScroll,
  attachCachedSender,
  needsSenderFetch,
  isGroupType,
} from '../utils/chatMeta';
import useConnection from '../utils/useConnection';

const PAGE_SIZE = 40;

/**
 * Conversación: chat de partido, de club o mensaje directo.
 *
 * Envío
 * -----
 * El mensaje se pinta al toque con estado `sending` y se reconcilia con la
 * fila real que devuelve el servidor (misma clave temporal → se reemplaza,
 * así que Realtime no puede duplicarlo). Si falla queda como `failed` con
 * «Reintentar» y «Descartar», y el texto NO se pierde.
 *
 * Permisos
 * --------
 * `getThreadAccess` decide si se puede leer y escribir. Sin permiso de
 * escritura el chat no se oculta: se lee y el compositor se reemplaza por
 * «Solo lectura». Sin permiso de lectura se muestra el estado de acceso
 * denegado. En los dos casos la protección real es la RLS, no esta pantalla.
 */
export default function ChatThreadScreen({ route, navigation }) {
  const threadKey = route?.params?.threadKey;
  const paramTitle = route?.params?.title || 'Chat';
  const paramSubtitle = route?.params?.subtitle || '';
  const fotoUrl = route?.params?.fotoUrl || null;
  const t = useMemo(() => parseThreadKey(threadKey), [threadKey]);
  const isGroup = isGroupType(t?.type);

  // El desafío al que pertenece esta conversación. Puede llegar por dos
  // caminos distintos, y los dos siguen vivos:
  //   - `challenge:<id>`: el hilo GRUPAL de negociación (migración 42).
  //   - `dm:<userId>` + params.challengeId: el DM LEGADO entre dos
  //     administradores de un desafío anterior, que habilita el chat
  //     aunque no sean amigos.
  const challengeId = useMemo(
    () => parseChallengeThread(threadKey)?.challengeId || route?.params?.challengeId || null,
    [threadKey, route?.params?.challengeId]
  );
  const isChallengeThread = t?.type === 'challenge';

  const [myId, setMyId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [banner, setBanner] = useState(null);
  const [access, setAccess] = useState(null);
  const [muted, setMuted] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [context, setContext] = useState(null); // info del club / partido
  const [clubChallenge, setClubChallenge] = useState(null);
  const [challengeEvents, setChallengeEvents] = useState([]);
  const [myClubIds, setMyClubIds] = useState([]);
  const [busyAction, setBusyAction] = useState(false);

  const listRef = useRef(null);
  const mountedRef = useRef(true);
  const selectionRef = useRef({ start: 0, end: 0 });
  const inputRef = useRef(null);

  // ── Perfiles de remitentes para enriquecer mensajes de Realtime ──
  // La fila cruda que entrega Realtime no trae `sender` (eso lo resuelve
  // listThreadMessages con un join). Se cachea lo que ya vino con `sender`
  // en la carga inicial/paginación, y solo se va a buscar a la red lo que
  // todavía no se vio (alguien que aún no había hablado en el hilo).
  const profilesRef = useRef(new Map());
  const fetchingSendersRef = useRef(new Set());

  // ── Scroll: posición al paginar, autoscroll solo si corresponde ──
  const listHeightRef = useRef(0);
  const scrollYRef = useRef(0);
  const nearBottomRef = useRef(true);
  const isPrependingRef = useRef(false);
  const didInitialScrollRef = useRef(false);

  const { connection, reportChannelStatus } = useConnection();

  const canWrite = access ? access.canWrite : true;
  const canRead = access ? access.canRead : true;
  const isClubAdmin = !!access?.isClubAdmin;

  const cacheSenders = useCallback((msgs) => {
    for (const m of msgs || []) {
      if (m?.sender && m?.sender_id) profilesRef.current.set(m.sender_id, m.sender);
    }
  }, []);

  // ── Carga inicial ────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    profilesRef.current = new Map();
    fetchingSendersRef.current = new Set();
    listHeightRef.current = 0;
    scrollYRef.current = 0;
    nearBottomRef.current = true;
    isPrependingRef.current = false;
    didInitialScrollRef.current = false;

    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!mountedRef.current) return;
        setMyId(user?.id || null);

        const acc = await getThreadAccess(threadKey, { challengeId });
        if (!mountedRef.current) return;
        setAccess(acc);

        if (!acc.canRead) {
          setLoading(false);
          return;
        }

        const [page, mutedNow] = await Promise.all([
          listThreadMessages(threadKey, { limit: PAGE_SIZE }),
          isThreadMuted(threadKey),
        ]);
        if (!mountedRef.current) return;

        cacheSenders(page.data);
        setMessages(page.data || []);
        setHasMore(!!page.hasMore);
        setMuted(mutedNow);
        if (page.error) {
          setBanner({
            type: 'error',
            title: 'No pudimos cargar los mensajes',
            message: page.error.message || String(page.error),
          });
        }
        setLoading(false);
        markThreadAsRead(threadKey).catch(() => {});
      } catch (e) {
        console.error('[FutFinder] ChatThread load:', e);
        if (!mountedRef.current) return;
        setLoading(false);
        setBanner({
          type: 'error',
          title: 'Error inesperado',
          message: e?.message || String(e),
        });
      }
    })();

    return () => {
      mountedRef.current = false;
    };
  }, [threadKey, challengeId]);

  // ── Contexto del hilo: nº de jugadores, fecha del partido… ───
  useEffect(() => {
    if (!t?.id) return undefined;
    let alive = true;

    (async () => {
      if (t.type === 'club') {
        const [{ data: club }, { data: members }] = await Promise.all([
          getClubById(t.id),
          listMembers(t.id),
        ]);
        if (!alive) return;
        setContext({
          kind: 'club',
          club,
          memberCount: (members || []).length,
        });
      } else if (t.type === 'match') {
        const [{ data: match }, attendees] = await Promise.all([
          getMatchById(t.id),
          getMatchAttendees(t.id),
        ]);
        if (!alive) return;
        const confirmados = (attendees?.data || []).filter(
          (a) => a.estado !== 'cancelado'
        ).length;
        setContext({ kind: 'match', match, confirmados });
      }
    })();

    return () => {
      alive = false;
    };
  }, [t?.id, t?.type]);

  // ── Chat de desafío de club ──────────────────────────────────
  // En el hilo grupal se cargan además la bitácora (que se intercala como
  // burbujas de sistema) y de qué club soy administrador, que es lo que
  // decide qué acción corresponde ofrecer.
  useEffect(() => {
    if (!challengeId) return undefined;
    let alive = true;
    (async () => {
      const { data } = await getChallenge(challengeId);
      if (!alive) return;
      setClubChallenge(data || null);

      if (!isChallengeThread || !data) return;

      const [{ data: eventos }, { data: { user } = {} }] = await Promise.all([
        listChallengeEvents(challengeId),
        supabase.auth.getUser(),
      ]);
      if (!alive) return;
      setChallengeEvents(eventos || []);

      if (!user?.id) return;
      const { data: membresias } = await supabase
        .from('club_members')
        .select('club_id, rol')
        .eq('user_id', user.id)
        .in('club_id', [data.club_retador_id, data.club_retado_id]);
      if (alive) {
        setMyClubIds(
          (membresias || []).filter((m) => m.rol === 'admin').map((m) => m.club_id)
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [challengeId, isChallengeThread]);

  // Trae el perfil (username/foto_url) de un remitente que todavía no
  // habíamos visto hablar en este hilo, y parcha con él cualquier mensaje
  // suyo que ya esté en pantalla sin `sender`. El contenido del mensaje ya
  // se mostró al instante vía Realtime; esto solo completa nombre/avatar en
  // cuanto llega, sin bloquear la aparición del mensaje.
  const fetchAndAttachSender = useCallback((senderId) => {
    if (fetchingSendersRef.current.has(senderId)) return;
    fetchingSendersRef.current.add(senderId);
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, username, foto_url')
        .eq('id', senderId)
        .maybeSingle();
      fetchingSendersRef.current.delete(senderId);
      if (!data || !mountedRef.current) return;
      profilesRef.current.set(senderId, data);
      setMessages((prev) =>
        prev.map((m) => (m.sender_id === senderId && !m.sender ? { ...m, sender: data } : m))
      );
    })();
  }, []);

  // ── Realtime ─────────────────────────────────────────────────
  useEffect(() => {
    if (!myId || !canRead) return undefined;

    const unsubscribe = subscribeToMessages(
      (payload) => {
        const row = payload.new || payload.old;
        if (!row) return;
        if (!messageBelongsToThread(row, threadKey, myId)) return;

        if (payload.eventType === 'INSERT') {
          const enrichedRow = attachCachedSender(row, {
            isGroup,
            myId,
            profilesById: profilesRef.current,
          });
          setMessages((prev) => {
            if (prev.some((m) => m.id === enrichedRow.id)) return prev;
            // Si es el eco de un mensaje propio que estaba en vuelo, se
            // reemplaza en vez de duplicarse.
            const pendingIdx = prev.findIndex(
              (m) =>
                m._status === 'sending' &&
                m.content === enrichedRow.content &&
                m.sender_id === enrichedRow.sender_id
            );
            if (pendingIdx >= 0) {
              const next = [...prev];
              next[pendingIdx] = enrichedRow;
              return next;
            }
            // Un mensaje ajeno que llega mientras el usuario lee historial
            // no debe arrastrarlo al final: decideAutoScroll ya respeta
            // nearBottomRef, pero forzarlo aquí para los propios asegura
            // que enviar SIEMPRE haga scroll aunque se haya scrolleado
            // hacia arriba justo antes de tocar enviar.
            if (enrichedRow.sender_id === myId) nearBottomRef.current = true;
            return [...prev, enrichedRow];
          });
          if (row.sender_id !== myId) {
            markThreadAsRead(threadKey).catch(() => {});
            if (needsSenderFetch(row, { isGroup, myId, profilesById: profilesRef.current })) {
              fetchAndAttachSender(row.sender_id);
            }
          }
        } else if (payload.eventType === 'UPDATE') {
          setMessages((prev) => prev.map((m) => (m.id === row.id ? { ...m, ...row } : m)));
        }
      },
      { onStatus: reportChannelStatus }
    );

    return () => {
      try { unsubscribe(); } catch {}
    };
  }, [threadKey, myId, canRead, isGroup, reportChannelStatus, fetchAndAttachSender]);

  // ── Cargar mensajes anteriores ───────────────────────────────
  const loadEarlier = useCallback(async () => {
    if (loadingEarlier || messages.length === 0) return;
    setLoadingEarlier(true);
    const oldest = messages[0]?.created_at;
    const page = await listThreadMessages(threadKey, { limit: PAGE_SIZE, before: oldest });
    if (!mountedRef.current) return;
    setLoadingEarlier(false);
    if (page.error) {
      notify('No pudimos cargar más', page.error.message || 'Intenta de nuevo');
      return;
    }
    cacheSenders(page.data);
    setHasMore(!!page.hasMore);
    setMessages((prev) => {
      const merged = mergeOlderMessages(prev, page.data);
      // No hay scrollToEnd aquí: decideAutoScroll (en onContentSizeChange)
      // ajusta el offset para que la posición visible del usuario no
      // salte. Solo se marca "prependiendo" si de verdad se agregó algo
      // (Realtime pudo haber traído ya todo lo que esta página trajo).
      isPrependingRef.current = merged.length > prev.length;
      return merged;
    });
  }, [loadingEarlier, messages, threadKey, cacheSenders]);

  // ── Envío ────────────────────────────────────────────────────
  const deliver = useCallback(
    async (localId, body, important, mentionAll) => {
      const { data, error } = await sendMessage(threadKey, body, { important, mentionAll });
      if (!mountedRef.current) return;

      if (error) {
        setMessages((prev) =>
          prev.map((m) => (m.id === localId ? { ...m, _status: 'failed' } : m))
        );
        return;
      }
      setMessages((prev) => {
        // Si Realtime ya trajo la fila real, se descarta la optimista.
        if (data && prev.some((m) => m.id === data.id)) {
          return prev.filter((m) => m.id !== localId);
        }
        return prev.map((m) => (m.id === localId ? { ...data, _status: 'sent' } : m));
      });
    },
    [threadKey]
  );

  const offline = connection === 'offline';

  const handleSend = useCallback(async () => {
    if (!canSendDraft(draft, { sending, canWrite, offline })) return;

    const parsed = parseComposerCommand(draft);
    const important = parsed.command === '/importante';
    const mentionAll = parsed.command === '/todos';

    if (important && !isClubAdmin) {
      notify(
        'Solo los administradores',
        'El comando /importante lo puede usar un administrador del club.'
      );
      return;
    }
    if (mentionAll && !canUseMentionAll(t?.type)) {
      notify('No disponible aquí', 'El comando /todos solo existe en chats grupales.');
      return;
    }
    // El cuerpo real del mensaje: sin el comando delante.
    const body = parsed.command ? parsed.body : parsed.raw.trim();
    if (!body) {
      notify('Escribe el aviso', `Después de ${parsed.command} falta el texto del mensaje.`);
      return;
    }

    setSending(true);
    setDraft('');

    const localId = `local_${Date.now()}_${Math.round(Math.random() * 1e6)}`;
    const optimistic = {
      id: localId,
      created_at: new Date().toISOString(),
      sender_id: myId,
      content: body,
      is_important: important,
      mention_all: mentionAll,
      _status: 'sending',
      _local: true,
      ...(t?.type === 'match'
        ? { match_id: t.id }
        : t?.type === 'club'
        ? { club_id: t.id }
        : t?.type === 'challenge'
        ? { challenge_id: t.id }
        : { receiver_id: t.id }),
    };
    // Enviar siempre lleva al final, aunque el usuario estuviera leyendo
    // mensajes más arriba justo antes de tocar enviar.
    nearBottomRef.current = true;
    setMessages((prev) => [...prev, optimistic]);

    await deliver(localId, body, important, mentionAll);
    if (mountedRef.current) setSending(false);
  }, [draft, sending, canWrite, offline, isClubAdmin, myId, t?.type, t?.id, deliver]);

  const handleRetry = useCallback(
    async (message) => {
      nearBottomRef.current = true;
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, _status: 'sending' } : m))
      );
      await deliver(message.id, message.content, !!message.is_important, !!message.mention_all);
    },
    [deliver]
  );

  const handleDiscard = useCallback((message) => {
    setMessages((prev) => prev.filter((m) => m.id !== message.id));
  }, []);

  // ── Acciones del menú ────────────────────────────────────────
  const handleToggleMute = useCallback(async () => {
    const next = !muted;
    setMuted(next); // optimista: el estado es solo mío
    const { error } = await setThreadMuted(threadKey, next);
    if (error) {
      setMuted(!next);
      notify('No pudimos cambiar el silencio', error.message || 'Intenta de nuevo');
    }
  }, [muted, threadKey]);

  const handleDeleteChat = useCallback(async () => {
    setBusyAction(true);
    const { error } = await hideThread(threadKey);
    setBusyAction(false);
    if (error) {
      notify('No pudimos eliminar la conversación', error.message || 'Intenta de nuevo');
      return;
    }
    navigation.goBack();
  }, [threadKey, navigation]);

  const openIdentity = useCallback(() => {
    if (!t?.id) return;
    if (t.type === 'dm') navigation.navigate('UserProfile', { userId: t.id });
    else navigation.navigate('ChatDetails', { threadKey, title: paramTitle, fotoUrl });
  }, [t?.id, t?.type, navigation, threadKey, paramTitle, fotoUrl]);

  const handleRateMatch = () => t?.id && navigation.navigate('RateMatch', { matchId: t.id });

  const handleConfirmGPS = async () => {
    if (!t?.id || busyAction) return;
    setBusyAction(true);
    const r = await confirmAttendanceWithGPS(t.id);
    setBusyAction(false);
    setBanner(
      r?.ok
        ? {
            type: 'success',
            title: 'Asistencia confirmada',
            message: r.distance
              ? `Estás a ${Math.round(r.distance)} m. +1 a tu Trust Score.`
              : 'Tu asistencia quedó registrada.',
          }
        : { type: 'error', title: 'No pude confirmar', message: r?.reason || 'Intenta de nuevo' }
    );
  };

  const handleEmojiSelected = useCallback((emojiObj) => {
    const emoji = emojiObj.emoji;
    const { start, end } = selectionRef.current;
    setDraft((prev) => {
      const next = prev.substring(0, start) + emoji + prev.substring(end);
      const pos = start + emoji.length;
      selectionRef.current = { start: pos, end: pos };
      return next;
    });
  }, []);

  const handlePressSender = useCallback(
    (userId) => {
      if (!userId || userId === myId) return;
      navigation.navigate('UserProfile', { userId });
    },
    [navigation, myId]
  );

  /**
   * Reporte desde el chat individual. Reutiliza el mismo servicio que el
   * perfil público, así que no se puede reportar dos veces al mismo jugador
   * ni reportarse a uno mismo: eso ya lo valida `reportUser`.
   */
  const handleSubmitReport = useCallback(
    async ({ motivo, descripcion }) => {
      if (t?.type !== 'dm' || !t?.id) return { error: { message: 'Reporte no disponible aquí' } };
      const { error } = await reportUser({ reportedId: t.id, motivo, descripcion });
      setBanner(
        error
          ? { type: 'error', title: 'No pudimos enviar el reporte', message: error.message }
          : {
              type: 'success',
              title: 'Reporte enviado',
              message: 'Lo revisaremos. El jugador no sabe quién lo reportó.',
            }
      );
      return { error };
    },
    [t?.type, t?.id]
  );

  // ── Derivados de presentación ────────────────────────────────
  const decorated = useMemo(
    () => decorateMessages(messages, { myId, isGroup }),
    [messages, myId, isGroup]
  );

  /**
   * Lo que se pinta en la lista: los mensajes decorados y, en un hilo de
   * desafío, los eventos del ciclo intercalados por hora.
   *
   * Los eventos NO pasan por `decorateMessages`: no tienen autor, así que
   * no agrupan burbujas, no muestran avatar y no pueden partir la tanda de
   * mensajes de un administrador. Por eso se mezclan acá, después de
   * decorar, y no antes.
   */
  const timeline = useMemo(() => {
    const mensajes = decorated.map((d) => ({
      kind: 'message',
      key: String(d.message.id),
      at: d.message.created_at,
      decorated: d,
    }));

    if (!isChallengeThread || challengeEvents.length === 0) return mensajes;

    const eventos = challengeEvents.map((e) => ({
      kind: 'event',
      key: `event:${e.id}`,
      at: e.created_at,
      event: e,
    }));

    return [...mensajes, ...eventos].sort(
      (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
    );
  }, [decorated, challengeEvents, isChallengeThread]);

  /**
   * Acción contextual de la cabecera. Se calcula con las mismas reglas que
   * usa el resto del módulo (`getChallengeCta`), pero en esta fase solo hay
   * una transición que la app sepa ejecutar desde acá: abrir el partido
   * cuando ya existe. Las demás se muestran como información — ver el
   * comentario de `ChallengeHeader`.
   */
  const challengeCta = useMemo(() => {
    if (!isChallengeThread || !clubChallenge) return null;
    return getChallengeCta(
      challengeCtaContext({
        challenge: clubChallenge,
        misClubIds: myClubIds,
        online: connection !== 'offline',
      })
    );
  }, [isChallengeThread, clubChallenge, myClubIds, connection]);

  const puedeAbrirPartido =
    challengeCta?.kind === 'ver_partido' && !!clubChallenge?.match_id;

  const handleChallengeCta = useCallback(() => {
    if (!puedeAbrirPartido) return;
    navigation.navigate('MatchDetail', { matchId: clubChallenge.match_id });
  }, [puedeAbrirPartido, navigation, clubChallenge?.match_id]);

  const headerSubtitle = useMemo(() => {
    if (t?.type === 'challenge') {
      // El estado del ciclo es lo que de verdad orienta acá: el título ya
      // dice qué dos clubes se enfrentan.
      if (!clubChallenge) return paramSubtitle || 'Negociación del desafío';
      const admins = myClubIds.length > 0 ? 'Administradores de ambos clubes' : 'Solo lectura';
      return `${estadoLabel(clubChallenge.estado)} · ${admins}`;
    }
    if (t?.type === 'club') {
      const n = context?.memberCount;
      return n ? `Chat del club · ${n} ${n === 1 ? 'jugador' : 'jugadores'}` : 'Chat del club';
    }
    if (t?.type === 'match') {
      const m = context?.match;
      if (!m) return paramSubtitle || 'Chat del partido';
      const fecha = m.hora
        ? new Date(m.hora)
            .toLocaleDateString('es-CL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })
            .replace('.', '')
        : null;
      return [fecha, m.comuna].filter(Boolean).join(' · ') || 'Chat del partido';
    }
    return canWrite ? 'Amigos · Ver perfil' : 'Ver perfil';
  }, [t?.type, context, paramSubtitle, canWrite, clubChallenge, myClubIds]);

  const commandSuggestions = useMemo(
    () => (isGroup ? suggestCommands(draft, { isClubAdmin, threadType: t?.type }) : []),
    [draft, isGroup, t?.type, isClubAdmin]
  );

  const matchEnded =
    context?.kind === 'match' &&
    context.match?.hora &&
    Date.now() >=
      new Date(context.match.hora).getTime() + (context.match.duracion_min ?? 90) * 60 * 1000;

  const menuItems = useMemo(() => {
    const items = [];
    if (t?.type === 'dm') {
      items.push({
        key: 'profile',
        label: 'Ver perfil',
        icon: <UserIcon color="rgba(255,255,255,0.8)" size={17} strokeWidth={1.8} />,
        onPress: () => navigation.navigate('UserProfile', { userId: t.id }),
      });
    } else {
      items.push({
        key: 'details',
        label: 'Detalles y jugadores',
        icon: <Users color="rgba(255,255,255,0.8)" size={17} strokeWidth={1.8} />,
        onPress: openIdentity,
      });
    }

    items.push({
      key: 'mute',
      label: muted ? 'Activar notificaciones' : 'Silenciar conversación',
      icon: muted ? (
        <Bell color="rgba(255,255,255,0.8)" size={17} strokeWidth={1.8} />
      ) : (
        <BellOff color="rgba(255,255,255,0.8)" size={17} strokeWidth={1.8} />
      ),
      onPress: handleToggleMute,
    });

    // Del chat del club no se puede salir sin abandonar el club: solo se
    // silencia. Por eso «Eliminar conversación» no aparece ahí. Lo mismo
    // vale para la negociación de un desafío: tiene un plazo corriendo, y
    // sacarla de la bandeja es la mejor forma de que se venza sin que
    // nadie se entere.
    if (t?.type !== 'club' && t?.type !== 'challenge') {
      items.push({
        key: 'delete',
        label: 'Eliminar conversación',
        icon: <Trash2 color="rgba(255,255,255,0.8)" size={17} strokeWidth={1.8} />,
        onPress: handleDeleteChat,
      });
    }

    if (t?.type === 'dm') {
      items.push({
        key: 'report',
        label: 'Reportar cuenta',
        destructive: true,
        icon: <Flag color={chatColors.danger} size={17} strokeWidth={1.8} />,
        onPress: () => setReportOpen(true),
      });
    }

    return items;
  }, [t?.type, t?.id, muted, navigation, openIdentity, handleToggleMute, handleDeleteChat]);

  // ── Render ───────────────────────────────────────────────────
  if (access && !access.canRead) {
    return (
      <View style={styles.root}>
        <SafeAreaView edges={['top']} style={{ flex: 1 }}>
          <ChatThreadHeader
            type={t?.type}
            title={paramTitle}
            subtitle=""
            fotoUrl={fotoUrl}
            connection={connection}
            onBack={() => navigation.goBack()}
            onPressIdentity={() => {}}
            onPressMenu={() => {}}
          />
          <ThreadDenied
            title={access.title || 'No puedes ver esta conversación'}
            message={access.message}
            onBack={() => navigation.goBack()}
          />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ChatThreadHeader
          type={t?.type}
          title={paramTitle}
          subtitle={headerSubtitle}
          fotoUrl={fotoUrl}
          muted={muted}
          connection={connection}
          onBack={() => navigation.goBack()}
          onPressIdentity={openIdentity}
          onPressMenu={() => setMenuOpen(true)}
        />

        {banner && (
          <View style={styles.bannerWrap}>
            <Banner
              type={banner.type}
              title={banner.title}
              message={banner.message}
              onClose={() => setBanner(null)}
            />
          </View>
        )}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={chatColors.green} />
            <Text style={styles.loadingText}>Cargando mensajes…</Text>
          </View>
        ) : timeline.length === 0 ? (
          <ThreadEmpty
            title={isGroup ? 'Sé el primero en saludar' : 'Empieza la conversación'}
            message={
              t?.type === 'club'
                ? 'Coordina con los jugadores del club sin compartir números.'
                : t?.type === 'match'
                ? 'Coordina con los jugadores del partido sin compartir números.'
                : t?.type === 'challenge'
                ? 'Acuerden acá la cancha, la fecha y la hora del partido.'
                : 'Escríbele para coordinar el próximo partido.'
            }
          />
        ) : (
          <FlatList
            ref={listRef}
            data={timeline}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) =>
              item.kind === 'event' ? (
                <ChallengeEventBubble event={item.event} />
              ) : (
                <View>
                  {item.decorated.startsDay && <DayDivider label={item.decorated.dayLabel} />}
                  <MessageBubble
                    item={item.decorated}
                    isGroup={isGroup}
                    onPressSender={handlePressSender}
                    onRetry={handleRetry}
                    onDiscard={handleDiscard}
                  />
                </View>
              )
            }
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <>
                {hasMore && <LoadEarlier loading={loadingEarlier} onPress={loadEarlier} />}
                {context?.kind === 'match' && (
                  <ContextPill
                    icon={<Video color={chatColors.green} size={13} strokeWidth={2} />}
                    label={`Chat del partido · ${context.confirmados} ${
                      context.confirmados === 1 ? 'confirmado' : 'confirmados'
                    }`}
                  />
                )}
              </>
            }
            onScroll={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              scrollYRef.current = contentOffset.y;
              const distanceFromBottom =
                contentSize.height - contentOffset.y - layoutMeasurement.height;
              nearBottomRef.current = distanceFromBottom < 120;
            }}
            scrollEventThrottle={32}
            onContentSizeChange={(_w, newHeight) => {
              const action = decideAutoScroll({
                isPrepending: isPrependingRef.current,
                isInitial: !didInitialScrollRef.current,
                nearBottom: nearBottomRef.current,
                prevHeight: listHeightRef.current,
                newHeight,
                prevScrollY: scrollYRef.current,
              });
              if (action.type === 'toOffset') {
                listRef.current?.scrollToOffset({ offset: action.offset, animated: action.animated });
              } else if (action.type === 'toEnd') {
                listRef.current?.scrollToEnd?.({ animated: action.animated });
                didInitialScrollRef.current = true;
              }
              isPrependingRef.current = false;
              listHeightRef.current = newHeight;
            }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            initialNumToRender={20}
            windowSize={11}
          />
        )}

        {/* Partido terminado: acciones en lugar del compositor */}
        {isGroup && matchEnded ? (
          <View style={styles.endedBar}>
            <Pressable
              onPress={handleRateMatch}
              disabled={busyAction}
              accessibilityRole="button"
              accessibilityLabel="Calificar el partido"
              style={({ pressed }) => [styles.endedBtn, pressed && { opacity: 0.8 }]}
            >
              <Star color={chatColors.green} size={16} fill={chatColors.green} />
              <Text style={styles.endedBtnText}>Calificar</Text>
            </Pressable>
            <Pressable
              onPress={handleConfirmGPS}
              disabled={busyAction}
              accessibilityRole="button"
              accessibilityLabel="Confirmar asistencia con GPS"
              style={({ pressed }) => [styles.endedBtn, pressed && { opacity: 0.8 }]}
            >
              <MapPin color={chatColors.green} size={16} />
              <Text style={styles.endedBtnText}>GPS</Text>
            </Pressable>
            <Pressable
              onPress={handleDeleteChat}
              disabled={busyAction}
              accessibilityRole="button"
              accessibilityLabel="Eliminar esta conversación"
              style={({ pressed }) => [styles.endedBtnDanger, pressed && { opacity: 0.75 }]}
            >
              <Trash2 color={chatColors.danger} size={16} />
              <Text style={styles.endedBtnDangerText}>Eliminar</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {isChallengeThread && (
              <ChallengeHeader
                challenge={clubChallenge}
                cta={challengeCta}
                onPressCta={puedeAbrirPartido ? handleChallengeCta : null}
              />
            )}

            {challengeId && !isChallengeThread && clubChallenge?.estado === 'aceptado' && (
              clubChallenge.match_id ? (
                <Pressable
                  onPress={() =>
                    navigation.navigate('MatchDetail', { matchId: clubChallenge.match_id })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Ver el partido de club creado"
                  style={({ pressed }) => [styles.challengeBar, pressed && { opacity: 0.85 }]}
                >
                  <Swords color={chatColors.green} size={18} />
                  <Text style={styles.challengeBarText}>Ver el partido de club creado</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() =>
                    navigation.navigate('CreateMatch', { clubChallengeId: challengeId })
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Crear partido de club"
                  style={({ pressed }) => [
                    styles.challengeBar,
                    styles.challengeBarCreate,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Swords color={chatColors.inkOnGreen} size={18} strokeWidth={2.4} />
                  <Text style={styles.challengeBarCreateText}>Crear partido de club</Text>
                </Pressable>
              )
            )}

            <ChatComposer
              inputRef={inputRef}
              value={draft}
              onChangeText={setDraft}
              onSelectionChange={(e) => {
                selectionRef.current = e.nativeEvent.selection;
              }}
              onSend={handleSend}
              onOpenEmoji={() => setEmojiOpen(true)}
              sending={sending}
              canWrite={canWrite}
              readOnlyTitle={access?.title || 'Solo lectura'}
              readOnlyMessage={access?.message}
              offline={connection === 'offline'}
              commandSuggestions={commandSuggestions}
              onPickCommand={(c) => setDraft(`${c.command} `)}
            />

            <EmojiPicker
              open={emojiOpen}
              onClose={() => setEmojiOpen(false)}
              onEmojiSelected={handleEmojiSelected}
              theme={{
                backdrop: 'rgba(0,0,0,0.55)',
                knob: chatColors.green,
                container: chatColors.surface,
                header: chatColors.textPrimary,
                category: {
                  icon: chatColors.textMuted,
                  iconActive: chatColors.green,
                  container: chatColors.surfaceAlt,
                  containerActive: chatColors.greenSoft,
                },
                search: {
                  background: chatColors.surfaceAlt,
                  placeholder: chatColors.textMuted,
                  text: chatColors.textPrimary,
                  icon: chatColors.textMuted,
                },
              }}
            />
          </>
        )}
      </SafeAreaView>

      <ChatOptionsMenu
        visible={menuOpen}
        items={menuItems}
        onClose={() => setMenuOpen(false)}
      />

      {t?.type === 'dm' && (
        <ReportPlayerSheet
          visible={reportOpen}
          username={paramTitle.replace(/^@/, '')}
          onClose={() => setReportOpen(false)}
          onSubmit={handleSubmitReport}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: chatColors.background },
  bannerWrap: { paddingHorizontal: 14, paddingTop: 10 },

  list: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 },

  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: chatColors.textSecondary, fontSize: 13 },

  challengeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 8,
    minHeight: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.45)',
    backgroundColor: 'rgba(90,224,106,0.10)',
  },
  challengeBarText: { color: chatColors.green, fontSize: 14, fontWeight: '800' },
  challengeBarCreate: { backgroundColor: chatColors.green, borderColor: chatColors.green },
  challengeBarCreateText: { color: chatColors.inkOnGreen, fontSize: 14, fontWeight: '800' },

  endedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 10 : 16,
    backgroundColor: chatColors.composerBar,
    borderTopWidth: 1,
    borderTopColor: chatColors.cardBorder,
  },
  endedBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 46,
    paddingHorizontal: 10,
    borderRadius: 23,
    backgroundColor: chatColors.card,
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.35)',
  },
  endedBtnText: { color: chatColors.textPrimary, fontSize: 13, fontWeight: '800' },
  endedBtnDanger: {
    flex: 1.1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 46,
    paddingHorizontal: 10,
    borderRadius: 23,
    backgroundColor: chatColors.dangerSoft,
    borderWidth: 1,
    borderColor: chatColors.dangerBorder,
  },
  endedBtnDangerText: { color: chatColors.danger, fontSize: 13, fontWeight: '800' },
});
