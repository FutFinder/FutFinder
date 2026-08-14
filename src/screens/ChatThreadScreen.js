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
  Alert,
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
  RefreshCw,
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
import CambioPartidoCard from '../components/clubes/CambioPartidoCard';
import CancelarEncuentroBar from '../components/clubes/CancelarEncuentroBar';
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
import { getMatchById, getMatchAttendees, withClubs } from '../services/matches';
import { getClubById, listMembers } from '../services/clubs';
import { confirmAttendanceWithGPS } from '../services/attendance';
import { getChallenge, listChallengeEvents, refreshChallenge } from '../services/clubChallenges';
import {
  responderProrroga,
  listRespuestasProrroga,
  getPropuestaVigente,
} from '../services/clubProposals';
import { getChallengeCta, estadoLabel } from '../services/clubChallengeRules';
import {
  getCambioPendiente,
  responderCambioPartido,
} from '../services/clubMatchChanges';
import { accionesDeCambio, nombresDeLosClubes } from '../utils/cambioPartido';
import { cancelarEncuentroClub, getSancionVigente } from '../services/clubSanctions';
import { accionesDeCancelacion } from '../utils/cancelacionEncuentro';
import { crearSondeo } from '../utils/sondeo';
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
  const [challengeProposal, setChallengeProposal] = useState(null);
  const [prorrogaReplies, setProrrogaReplies] = useState([]);
  const [challengeBusy, setChallengeBusy] = useState(false);
  const [myClubIds, setMyClubIds] = useState([]);
  const [myClubIdsTodos, setMyClubIdsTodos] = useState([]);
  const [busyAction, setBusyAction] = useState(false);

  // Cambios negociados del partido publicado (migración 46). El partido se
  // carga acá y no se deduce del desafío porque la solicitud se compara
  // contra los valores VIGENTES: la hora, la cancha y la cuota que hoy tiene
  // `matches`, no las que tenía la propuesta que lo publicó.
  const [cambioPartido, setCambioPartido] = useState(null);
  const [cambioPendiente, setCambioPendiente] = useState(null);
  const [cambioBusy, setCambioBusy] = useState(false);
  const [cambioError, setCambioError] = useState(null);

  // Cancelación del encuentro y sanción del club (migración 47). La sanción se
  // lee de `club_sanctions` y no se pregunta por `club_esta_sancionado()`: esa
  // función está revocada de `authenticated` a propósito, y la RLS de la tabla
  // ya muestra sólo las sanciones de los clubes propios.
  const [sancion, setSancion] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState(null);
  // Firma de la bitácora ya pintada, para que el sondeo no reemplace el
  // arreglo —y con él las burbujas— cuando no hay nada nuevo.
  const firmaEventosRef = useRef('');

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
      // Primero se aplican los vencimientos de ESTA fila: el cron corre cada
      // 5 minutos y sin esto la cabecera podría mostrar «quedan 0 min» en vez
      // de la prórroga que ya correspondía. Si la RPC no existe todavía,
      // devuelve null sin error y se sigue con la lectura de siempre.
      const { data: alDia } = await refreshChallenge(challengeId);
      const { data } = alDia ? { data: alDia } : await getChallenge(challengeId);
      if (!alive) return;
      setClubChallenge(data || null);

      if (!isChallengeThread || !data) return;

      const [{ data: eventos }, { data: { user } = {} }, { data: respuestas }, { data: prop }] =
        await Promise.all([
          listChallengeEvents(challengeId),
          supabase.auth.getUser(),
          listRespuestasProrroga(challengeId),
          getPropuestaVigente(challengeId),
        ]);
      if (!alive) return;
      setChallengeEvents(eventos || []);
      firmaEventosRef.current = (eventos || []).map((e) => e.id).join(',');
      setProrrogaReplies(respuestas || []);
      setChallengeProposal(prop || null);

      if (!user?.id) return;
      const { data: membresias } = await supabase
        .from('club_members')
        .select('club_id, rol')
        .eq('user_id', user.id)
        .in('club_id', [data.club_retador_id, data.club_retado_id]);
      if (alive) {
        const filas = membresias || [];
        setMyClubIds(filas.filter((m) => m.rol === 'admin').map((m) => m.club_id));
        // Todas las membresías, con cualquier rol: responder una propuesta
        // exige NO pertenecer al club proponente ni siquiera como jugador.
        setMyClubIdsTodos(filas.map((m) => m.club_id));
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
   * Acción contextual de la cabecera, con las mismas reglas que usa el resto
   * del módulo (`getChallengeCta`). El contexto se arma con la función pura
   * `challengeCtaContext` — ver el comentario de ese archivo: armarlo a mano
   * acá es lo que una vez dejó el hilo en blanco.
   */
  const challengeCta = useMemo(() => {
    if (!isChallengeThread || !clubChallenge) return null;
    return getChallengeCta(
      challengeCtaContext({
        challenge: clubChallenge,
        misClubIds: myClubIds,
        misClubIdsTodos: myClubIdsTodos,
        online: connection !== 'offline',
        propuesta: challengeProposal,
        respuestasProrroga: prorrogaReplies,
        // Con el club sancionado, `getChallengeCta` devuelve «Club sancionado»
        // en vez de ofrecer una acción que el servidor va a rechazar.
        sancion,
      })
    );
  }, [
    isChallengeThread,
    clubChallenge,
    myClubIds,
    myClubIdsTodos,
    connection,
    challengeProposal,
    prorrogaReplies,
    sancion,
  ]);

  /**
   * El partido publicado y la solicitud de cambio que esté esperando.
   *
   * Se vuelve a pedir después de cada respuesta: aceptar mueve la hora o la
   * cancha del partido, y la tarjeta compara contra los valores vigentes. Con
   * una copia vieja diría «de 17:00 a 18:00» cuando el partido ya está a las
   * 18:00.
   */
  const cargarCambio = useCallback(
    async ({ silencioso = false } = {}) => {
      const matchId = clubChallenge?.match_id;
      if (!isChallengeThread || !matchId) {
        setCambioPartido(null);
        setCambioPendiente(null);
        return;
      }
      const [{ data: m }, { data: pend, error: ePend }] = await Promise.all([
        getMatchById(matchId),
        getCambioPendiente(matchId),
      ]);
      // `getMatchById` devuelve la fila plana. Los NOMBRES de los dos clubes
      // sólo llegan pasando por `withClubs`, y son los que lee la tarjeta: sin
      // esto decía «Esperando la respuesta de el club contrario».
      const [mConClubes] = await withClubs(m ? [m] : []);
      if (!mountedRef.current) return;

      // Un fallo de carga NO se dibuja como «no hay ninguna solicitud»: eso es
      // exactamente lo que hizo que la nómina de U3 mostrara un partido vacío,
      // coherente y falso. Se conserva lo que ya había y se dice qué pasó.
      //
      // Pero un sondeo de fondo que falla no grita: se queda con lo último
      // bueno y espera al siguiente tick. Si cada corte de red pintara un
      // error permanente en la tarjeta, el remedio del refresco sería peor
      // que la enfermedad.
      if (ePend) {
        if (!silencioso) setCambioError(ePend.message);
        return;
      }
      setCambioPartido(mConClubes || m || null);
      setCambioPendiente(pend || null);
    },
    [isChallengeThread, clubChallenge?.match_id]
  );

  useEffect(() => {
    cargarCambio();
  }, [cargarCambio]);

  /**
   * ¿Alguno de mis clubes está sancionado ahora mismo?
   *
   * NO ENTRA EN EL SONDEO DE 15 SEGUNDOS, a propósito. Una sanción sólo puede
   * aparecer mientras el hilo está abierto si otro administrador de mi propio
   * club cancela otro encuentro en ese preciso rato, y pagar una consulta cada
   * quince segundos en todas las sesiones por ese caso no se justifica. Se
   * recarga al abrir el hilo y después de cancelar, que son los dos momentos
   * en que de verdad cambia. Y aunque quedara vieja, la autoridad sigue siendo
   * el servidor: quien intente operar recibirá su negativa igual.
   */
  const cargarSancion = useCallback(async () => {
    if (!isChallengeThread || myClubIds.length === 0) {
      setSancion(null);
      return;
    }
    const { data } = await getSancionVigente(myClubIds);
    if (mountedRef.current) setSancion(data || null);
  }, [isChallengeThread, myClubIds]);

  useEffect(() => {
    cargarSancion();
  }, [cargarSancion]);

  /**
   * Todo lo que puede haber cambiado por acción del OTRO club: los eventos
   * del hilo y la solicitud de cambio con el partido al que apunta.
   */
  const refrescarDesafio = useCallback(
    async ({ silencioso = false } = {}) => {
      if (!isChallengeThread || !challengeId) return;
      const [{ data: eventos }] = await Promise.all([
        listChallengeEvents(challengeId),
        cargarCambio({ silencioso }),
      ]);
      if (!mountedRef.current) return;

      // Sólo se toca el estado si la bitácora de verdad cambió. Reemplazar el
      // arreglo cada 15 segundos volvería a montar las burbujas del hilo sin
      // que haya novedad ninguna, y un chat que parpadea solo es un fallo
      // nuevo a cambio de nada.
      const firma = (eventos || []).map((e) => e.id).join(',');
      if (firma === firmaEventosRef.current) return;
      firmaEventosRef.current = firma;
      setChallengeEvents(eventos || []);
    },
    [isChallengeThread, challengeId, cargarCambio]
  );

  // Al volver de «Pedir un cambio» la pantalla se refresca sola: sin esto, el
  // administrador que acaba de enviar la solicitud volvería al hilo y no la
  // vería hasta reabrirlo.
  useEffect(() => {
    if (!route?.params?.cambioPedido) return;
    refrescarDesafio();
  }, [route?.params?.cambioPedido, refrescarDesafio]);

  /**
   * SONDEO DE RESPALDO, Y ACÁ ES LA ÚNICA VÍA.
   *
   * La suscripción de Realtime de esta pantalla escucha `messages`, y la
   * publicación `supabase_realtime` sólo lleva `messages`, `attendees` y
   * `notifications`. `club_challenge_events` y `club_match_changes` no
   * emiten nada, así que no hay ninguna suscripción posible; y los eventos
   * del ciclo tampoco escriben un mensaje del que colgarse, porque
   * `messages.sender_id` es NOT NULL y el sistema no es un usuario.
   *
   * Sin esto, la sesión de quien pidió un cambio seguía mostrando la
   * solicitud como pendiente después de que el club contrario la respondiera,
   * hasta recargar a mano. Comprobado el 2026-08-13.
   */
  useEffect(
    () =>
      crearSondeo({
        activo: isChallengeThread && !!challengeId,
        onTick: () => refrescarDesafio({ silencioso: true }),
      }),
    [isChallengeThread, challengeId, refrescarDesafio]
  );

  /**
   * Qué acciones de cambio corresponde ofrecer. Espejo puro y probado de la
   * autorización del servidor: `responder_cambio_partido` vuelve a
   * comprobarlo todo con las membresías de PostgreSQL.
   */
  const accionesCambio = useMemo(
    () =>
      accionesDeCambio({
        partido: cambioPartido,
        cambio: cambioPendiente,
        userId: myId,
        clubesAdmin: myClubIds,
        clubesTodos: myClubIdsTodos,
      }),
    [cambioPartido, cambioPendiente, myId, myClubIds, myClubIdsTodos]
  );

  /**
   * Quién pide el cambio y quién debe responderlo, por nombre.
   *
   * Sale del PARTIDO —la misma fila con la que `accionesDeCambio` decide los
   * botones, así que no pueden discrepar— y no del desafío: esa fila nunca
   * trae los clubes embebidos, ni por `getChallenge` (`select('*')`) ni por
   * `refrescar_desafio` (devuelve `club_challenges` a secas).
   */
  const nombresClubes = useMemo(
    () => nombresDeLosClubes({ partido: cambioPartido, cambio: cambioPendiente }),
    [cambioPartido, cambioPendiente]
  );

  const responderCambio = useCallback(
    async (aceptar, motivo) => {
      if (cambioBusy || !cambioPendiente?.id) return;
      setCambioBusy(true);
      setCambioError(null);

      const { error } = await responderCambioPartido(cambioPendiente.id, aceptar, motivo);
      if (!mountedRef.current) return;

      if (error) {
        setCambioBusy(false);
        setCambioError(error.message);
        return;
      }

      // Se recargan las tres cosas que cambiaron: el partido (si se aceptó),
      // la solicitud (ya respondida) y los eventos del hilo. Va por el mismo
      // camino que el sondeo para que la firma de la bitácora quede al día y
      // el siguiente tick no vuelva a repintar por gusto.
      await refrescarDesafio();
      if (mountedRef.current) {
        setCambioBusy(false);
        setCambioPendiente(null);
        notify(aceptar ? 'Cambio aceptado. El partido quedó actualizado.' : 'Cambio rechazado. El partido sigue igual.');
      }
    },
    [cambioBusy, cambioPendiente?.id, refrescarDesafio]
  );

  /**
   * Qué corresponde ofrecer en la barra de cancelación de arriba. Espejo puro
   * y probado de la autorización del servidor: `cancelar_encuentro_club`
   * vuelve a comprobar membresía, estado y plazo con los datos de PostgreSQL.
   *
   * El partido sale de `cambioPartido` —la fila vigente de `matches`— y no de
   * la propuesta que lo publicó: el corte de las 2 horas se mide contra la
   * hora que el partido tiene HOY, que pudo moverse con un cambio negociado.
   */
  const accionesCancelar = useMemo(
    () =>
      accionesDeCancelacion({
        challenge: clubChallenge,
        partido: cambioPartido,
        clubesAdmin: myClubIds,
      }),
    [clubChallenge, cambioPartido, myClubIds]
  );

  const cancelarEncuentro = useCallback(
    async (motivo) => {
      if (cancelBusy || !challengeId) return;
      setCancelBusy(true);
      setCancelError(null);

      const { data, error } = await cancelarEncuentroClub(challengeId, motivo);
      if (!mountedRef.current) return;

      if (error) {
        setCancelBusy(false);
        setCancelError(error.message);
        return;
      }

      // Se recarga TODO lo que la cancelación movió: el desafío (que pasó a
      // cancelado), el partido y la bitácora, y además la sanción, que es la
      // que a partir de ahora bloquea los desafíos nuevos de este club.
      const { data: alDia } = await refreshChallenge(challengeId);
      const { data: fila } = alDia ? { data: alDia } : await getChallenge(challengeId);
      if (mountedRef.current) setClubChallenge(fila || null);
      await refrescarDesafio();
      await cargarSancion();

      if (mountedRef.current) {
        setCancelBusy(false);
        notify(
          data?.sanciona
            ? 'Encuentro cancelado. Tu club queda sancionado 14 días.'
            : 'Encuentro cancelado. Se avisó a los dos clubes y a los inscritos.'
        );
      }
    },
    [cancelBusy, challengeId, refrescarDesafio, cargarSancion]
  );

  const puedeAbrirPartido =
    challengeCta?.kind === 'ver_partido' && !!clubChallenge?.match_id;

  // Qué acciones sabe ejecutar esta pantalla hoy. `aprobar_propuesta` no
  // aprueba desde acá: lleva a `ClubProposal` en modo revisión, porque
  // publicar el partido no se hace de un toque sin haber leído cancha, hora,
  // cupos y cuota. El botón de aprobar de verdad vive en esa pantalla.
  const ctaAccionable =
    puedeAbrirPartido ||
    challengeCta?.kind === 'crear_propuesta' ||
    challengeCta?.kind === 'aprobar_propuesta';

  const handleChallengeCta = useCallback(() => {
    if (puedeAbrirPartido) {
      navigation.navigate('MatchDetail', { matchId: clubChallenge.match_id });
      return;
    }
    if (challengeCta?.kind === 'crear_propuesta') {
      navigation.navigate('ClubProposal', { challengeId, modo: 'crear' });
      return;
    }
    if (challengeCta?.kind === 'aprobar_propuesta') {
      navigation.navigate('ClubProposal', {
        challengeId,
        modo: 'revisar',
        proposalId: challengeProposal?.id,
      });
    }
  }, [
    puedeAbrirPartido,
    navigation,
    clubChallenge?.match_id,
    challengeCta?.kind,
    challengeId,
    challengeProposal?.id,
  ]);

  /**
   * Responder la prórroga. El «No» cierra el desafío en el acto, así que se
   * confirma antes: es la única acción de esta pantalla que no tiene vuelta
   * atrás. El «Sí» no la necesita — como mucho reabre la negociación.
   */
  const enviarRespuestaProrroga = useCallback(
    async (respuesta) => {
      if (challengeBusy || !challengeId) return;
      setChallengeBusy(true);
      const { data, error } = await responderProrroga(challengeId, respuesta);
      if (error) {
        setChallengeBusy(false);
        Alert.alert('No se pudo responder', error.message);
        return;
      }
      if (data) setClubChallenge(data);
      const [{ data: respuestas }, { data: eventos }] = await Promise.all([
        listRespuestasProrroga(challengeId),
        listChallengeEvents(challengeId),
      ]);
      setProrrogaReplies(respuestas || []);
      setChallengeEvents(eventos || []);
      firmaEventosRef.current = (eventos || []).map((e) => e.id).join(',');
      setChallengeBusy(false);
    },
    [challengeBusy, challengeId]
  );

  const handleResponderProrroga = useCallback(
    (respuesta) => {
      if (respuesta) {
        enviarRespuestaProrroga(true);
        return;
      }
      Alert.alert(
        '¿El partido no se disputará?',
        'El desafío se cierra sin acuerdo para los dos clubes y la conversación queda solo como historial.',
        [
          { text: 'Volver', style: 'cancel' },
          {
            text: 'Sí, cerrar el desafío',
            style: 'destructive',
            onPress: () => enviarRespuestaProrroga(false),
          },
        ]
      );
    },
    [enviarRespuestaProrroga]
  );

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

        {/*
          «Cancelar encuentro» va ARRIBA y no en el menú de tres puntos: se
          busca con urgencia y casi siempre con el partido cerca. Enterrarla
          hace que la cancelación se resuelva por WhatsApp y que el club rival
          siga organizando gente para un partido que ya no existe. Separada de
          la barra del ciclo, que vive abajo: aquella lleva la acción que toca
          ahora, ésta es la salida de emergencia.
        */}
        {isChallengeThread && (
          <CancelarEncuentroBar
            acciones={accionesCancelar}
            partido={cambioPartido}
            sancion={sancion}
            ocupado={cancelBusy}
            error={cancelError}
            onCancelar={cancelarEncuentro}
          />
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
            {/*
              Los cambios negociados van SOBRE la cabecera del ciclo y no
              dentro: la cabecera lleva una sola acción y el estado del
              desafío, mientras que esto es una negociación aparte que corre
              con el partido ya publicado. Mezclarlas dejaría dos botones
              compitiendo por el mismo hueco.
            */}
            {isChallengeThread && cambioPendiente && (
              <CambioPartidoCard
                cambio={cambioPendiente}
                acciones={accionesCambio}
                clubProponenteNombre={nombresClubes.proponente}
                clubContrarioNombre={nombresClubes.contrario}
                ocupado={cambioBusy}
                error={cambioError}
                onAceptar={() => responderCambio(true)}
                onRechazar={(motivo) => responderCambio(false, motivo)}
              />
            )}

            {isChallengeThread && !cambioPendiente && accionesCambio.puedePedir && (
              <Pressable
                onPress={() =>
                  navigation.navigate('ClubMatchChange', {
                    matchId: clubChallenge.match_id,
                    challengeId,
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Pedir un cambio de hora, cancha o cuota del partido"
                style={({ pressed }) => [styles.cambioBar, pressed && { opacity: 0.85 }]}
              >
                <RefreshCw color={chatColors.neon} size={16} strokeWidth={2.2} />
                <Text style={styles.cambioBarText}>Pedir un cambio del partido</Text>
              </Pressable>
            )}

            {isChallengeThread && !cambioPendiente && !accionesCambio.puedePedir
              && accionesCambio.esDeClubes && accionesCambio.soyAdmin && (
              <Text style={styles.cambioHint} numberOfLines={2}>
                {accionesCambio.bloqueoPedir}
              </Text>
            )}

            {isChallengeThread && (
              <ChallengeHeader
                challenge={clubChallenge}
                cta={challengeCta}
                onPressCta={ctaAccionable ? handleChallengeCta : null}
                onResponderProrroga={handleResponderProrroga}
                ocupado={challengeBusy}
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

  // Pedir un cambio es una acción secundaria: discreta y sin relleno verde,
  // para que no compita con el CTA principal de la cabecera del ciclo.
  cambioBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 8,
    minHeight: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: chatColors.challengeBorder,
    backgroundColor: 'transparent',
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  cambioBarText: {
    color: chatColors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    includeFontPadding: false,
  },
  cambioHint: {
    marginHorizontal: 14,
    marginBottom: 8,
    color: 'rgba(255,255,255,0.45)',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
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
