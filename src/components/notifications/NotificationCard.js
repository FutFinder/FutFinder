import React from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import {
  UserPlus, CheckCheck, Swords, Shield, CalendarDays, MessageCircle, Star, Bell, Users, Trash2,
  RefreshCw, LockOpen, ListOrdered, LogOut, UserX, Megaphone, CalendarX, ShieldAlert, Scale,
} from 'lucide-react-native';

/** A qué chip de filtro (CLUBES/PARTIDOS/SOCIAL) pertenece cada tipo real de notificación. */
export const CATEGORY = {
  friend_request: 'social',
  friend_accept: 'social',
  message_new: 'social',
  chat_mention_all: 'social',
  match_join: 'partidos',
  match_reminder: 'partidos',
  match_rate: 'partidos',
  match_cancelled: 'partidos',
  join_request: 'partidos',
  join_approved: 'partidos',
  join_rejected: 'partidos',
  match_updated: 'partidos',
  match_slot_free: 'partidos',
  waitlist_turn: 'partidos',
  match_left: 'partidos',
  match_attendance: 'partidos',
  club_request: 'clubes',
  club_request_accepted: 'clubes',
  club_request_rejected: 'clubes',
  club_member_joined: 'clubes',
  club_member_left: 'clubes',
  club_invite_accepted: 'clubes',
  club_challenge: 'clubes',
  club_challenge_accepted: 'clubes',
  club_challenge_rejected: 'clubes',
  club_match_published: 'clubes',
  club_match_reserva_omitida: 'clubes',
  club_match_change: 'clubes',
  club_match_change_responded: 'clubes',
  club_match_cancelled: 'clubes',
  club_sancionado: 'clubes',
  club_revision_resuelta: 'clubes',
};

const ICON = {
  friend_request: UserPlus,
  friend_accept: CheckCheck,
  message_new: MessageCircle,
  chat_mention_all: Megaphone,
  match_join: Users,
  match_reminder: CalendarDays,
  match_rate: Star,
  match_cancelled: CalendarDays,
  join_request: UserPlus,
  join_approved: CheckCheck,
  join_rejected: Bell,
  match_updated: RefreshCw,
  match_slot_free: LockOpen,
  waitlist_turn: ListOrdered,
  match_left: LogOut,
  match_attendance: UserX,
  club_request: Shield,
  club_request_accepted: CheckCheck,
  club_request_rejected: Shield,
  club_member_joined: Users,
  club_member_left: Shield,
  club_invite_accepted: CheckCheck,
  club_challenge: Swords,
  club_challenge_accepted: CheckCheck,
  club_challenge_rejected: Swords,
  club_match_published: Swords,
  club_match_reserva_omitida: UserX,
  club_match_change: RefreshCw,
  club_match_change_responded: CheckCheck,
  club_match_cancelled: CalendarX,
  club_sancionado: ShieldAlert,
  club_revision_resuelta: Scale,
};

const TAG = {
  friend_request: { label: 'SOCIAL', color: '#7DD3FC', bg: 'rgba(125,211,252,0.10)', border: 'rgba(125,211,252,0.26)' },
  friend_accept: { label: 'SOCIAL', color: '#7DD3FC', bg: 'rgba(125,211,252,0.10)', border: 'rgba(125,211,252,0.26)' },
  message_new: { label: 'MENSAJES', color: '#C4B5FD', bg: 'rgba(196,181,253,0.10)', border: 'rgba(196,181,253,0.26)' },
  chat_mention_all: { label: 'MENCIÓN', color: '#C4B5FD', bg: 'rgba(196,181,253,0.10)', border: 'rgba(196,181,253,0.26)' },
  match_join: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_reminder: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_rate: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_cancelled: { label: 'PARTIDO', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
  join_request: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  join_approved: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  join_rejected: { label: 'PARTIDO', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
  match_updated: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_slot_free: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  waitlist_turn: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_left: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_attendance: { label: 'PARTIDO', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
  club_request: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_request_accepted: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_request_rejected: { label: 'CLUBES', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
  club_member_joined: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_member_left: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_invite_accepted: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_challenge: { label: 'DESAFÍO', color: '#FFB347', bg: 'rgba(255,179,71,0.10)', border: 'rgba(255,179,71,0.28)' },
  club_challenge_accepted: { label: 'DESAFÍO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  club_challenge_rejected: { label: 'DESAFÍO', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
  // Verde, no rojo: el rojo está reservado a lo que necesita atención
  // (una negociación trabada), y un partido publicado es una buena noticia.
  club_match_published: { label: 'PARTIDO DE CLUBES', color: '#5AE06A', bg: 'rgba(90,224,106,0.10)', border: 'rgba(90,224,106,0.30)' },
  // Ámbar y no rojo: el partido salió bien, lo que no se pudo aplicar es
  // sólo el cupo de quien lo pidió. Es un «revisa esto», no una alarma.
  club_match_reserva_omitida: { label: 'TU CUPO', color: '#F5C451', bg: 'rgba(245,196,81,0.10)', border: 'rgba(245,196,81,0.28)' },
  // Ámbar: pedir un cambio no es una alarma, pero SÍ espera algo del club que
  // lo recibe —mientras nadie responda, el partido sigue como estaba—.
  club_match_change: { label: 'CAMBIO PEDIDO', color: '#F5C451', bg: 'rgba(245,196,81,0.10)', border: 'rgba(245,196,81,0.28)' },
  // La respuesta ya no espera nada de nadie, así que vuelve al verde del
  // partido de clubes. Que fuera un rechazo no lo convierte en un problema:
  // el partido simplemente se queda como estaba.
  club_match_change_responded: { label: 'PARTIDO DE CLUBES', color: '#5AE06A', bg: 'rgba(90,224,106,0.10)', border: 'rgba(90,224,106,0.30)' },
  // Rojo, y es de las pocas veces que corresponde: el encuentro se terminó y
  // quien lee esto tiene que reorganizar a su gente.
  club_match_cancelled: { label: 'ENCUENTRO CANCELADO', color: '#F87171', bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.28)' },
  club_sancionado: { label: 'CLUB SANCIONADO', color: '#F87171', bg: 'rgba(248,113,113,0.10)', border: 'rgba(248,113,113,0.28)' },
  // Ni rojo ni verde: la revisión puede terminar de las dos formas y el color
  // no puede adelantar cuál, porque la misma etiqueta sirve para las dos.
  club_revision_resuelta: { label: 'REVISIÓN RESUELTA', color: '#F5C451', bg: 'rgba(245,196,81,0.10)', border: 'rgba(245,196,81,0.28)' },
};

const FALLBACK_TAG = { label: 'AVISO', color: 'rgba(255,255,255,0.6)', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' };

/**
 * Avisos que ofrecen un atajo visible además de la tarjeta entera.
 *
 * El atajo se ofrece SOLO si el aviso trae el dato al que lleva: los avisos
 * anteriores a la migración 42 no traen `threadKey` y siguen abriendo la
 * bandeja de desafíos al tocar la tarjeta. Cada entrada declara qué dato
 * necesita y qué dice el botón; el `onPress` es el mismo de la tarjeta, así
 * que no hay dos caminos de navegación que mantener.
 */
const ATAJOS = {
  club_challenge_accepted: {
    dato: 'threadKey',
    label: 'IR AHORA',
    accesible: 'Ir ahora al chat de negociación del desafío',
  },
  club_match_published: {
    dato: 'matchId',
    label: 'VER PARTIDO',
    accesible: 'Ver el partido de clubes recién publicado',
  },
  club_match_reserva_omitida: {
    dato: 'matchId',
    label: 'VER NÓMINA',
    accesible: 'Ver la nómina del partido para inscribirte cuando se resuelva',
  },
  // El único aviso del ciclo que espera una acción concreta del que lo
  // recibe: mientras no responda, el partido no se mueve.
  club_match_change: {
    dato: 'threadKey',
    label: 'RESPONDER',
    accesible: 'Ir al chat de negociación para aceptar o rechazar el cambio',
  },
  // No hay nada que responder, pero sí que leer: el motivo entero y quién
  // canceló están en el evento del hilo.
  club_match_cancelled: {
    dato: 'threadKey',
    label: 'VER MOTIVO',
    accesible: 'Ir al chat de negociación para leer por qué se canceló el encuentro',
  },
  // La decisión y la nota de quien revisó están en el evento del hilo, que es
  // lo único que hay que leer acá.
  club_revision_resuelta: {
    dato: 'threadKey',
    label: 'VER DECISIÓN',
    accesible: 'Ir al chat del encuentro para leer cómo terminó la revisión',
  },
};

function atajoDe(n) {
  const atajo = ATAJOS[n?.type];
  return atajo && n?.data?.[atajo.dato] ? atajo : null;
}

export default function NotificationCard({ notification: n, onPress, onDelete, onPrimary, onSecondary, busy }) {
  const Icon = ICON[n.type] || Bell;
  const tag = TAG[n.type] || FALLBACK_TAG;
  const unread = !n.read;
  // «IR AHORA» no es una acción distinta de tocar la tarjeta: es la misma
  // navegación, hecha evidente. Así no hay dos caminos que mantener.
  const atajo = !n.actions ? atajoDe(n) : null;

  return (
    <Pressable
      onPress={() => !busy && onPress(n)}
      className="flex-row items-start gap-3 overflow-hidden rounded-[18px] border p-3.5 active:opacity-80"
      style={{
        borderColor: unread ? tag.border : 'rgba(255,255,255,0.07)',
        backgroundColor: unread ? tag.bg : 'rgba(255,255,255,0.03)',
        opacity: busy ? 0.6 : 1,
      }}
    >
      {unread ? <View className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ backgroundColor: tag.color }} /> : null}

      <View
        className="h-[38px] w-[38px] items-center justify-center rounded-[13px] border"
        style={{
          borderColor: unread ? tag.border : 'rgba(255,255,255,0.10)',
          backgroundColor: unread ? tag.bg : 'rgba(255,255,255,0.05)',
        }}
      >
        <Icon size={18} color={unread ? tag.color : 'rgba(255,255,255,0.55)'} strokeWidth={1.9} />
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={2} className={`flex-1 text-[15px] font-bold leading-5 ${unread ? 'text-white' : 'text-white/80'}`}>
            {n.title}
          </Text>
          {unread ? <View className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: tag.color }} /> : null}
        </View>

        {n.body ? (
          <Text numberOfLines={3} className="mt-0.5 text-[13.5px] leading-[18px] text-white/50">{n.body}</Text>
        ) : null}

        <View className="mt-2 flex-row items-center gap-2">
          <View className="rounded-full border px-2 py-0.5" style={{ backgroundColor: tag.bg, borderColor: tag.border }}>
            <Text className="text-[9.5px] font-bold tracking-[0.15em]" style={{ color: tag.color }}>{tag.label}</Text>
          </View>
          <Text className="text-[11.5px] font-semibold text-white/35">{n.timeLabel}</Text>
        </View>

        {atajo ? (
          <View className="mt-2.5 flex-row">
            <Pressable
              onPress={() => !busy && onPress(n)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={atajo.accesible}
              className="h-[38px] flex-1 items-center justify-center rounded-xl bg-[#00FF66] active:opacity-80"
              style={busy ? { opacity: 0.6 } : null}
            >
              <Text className="text-[13px] font-bold text-[#04120A]">{atajo.label}</Text>
            </Pressable>
          </View>
        ) : null}

        {n.actions ? (
          <View className="mt-2.5 flex-row gap-2">
            <Pressable
              onPress={() => onPrimary?.(n)}
              disabled={busy}
              className="h-[38px] flex-1 items-center justify-center rounded-xl bg-[#00FF66] active:opacity-80"
              style={busy ? { opacity: 0.6 } : null}
            >
              {busy ? (
                <ActivityIndicator size="small" color="#04120A" />
              ) : (
                <Text className="text-[13px] font-bold text-[#04120A]">{n.actions[0]}</Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => onSecondary?.(n)}
              disabled={busy}
              className="h-[38px] flex-1 items-center justify-center rounded-xl border border-white/12 bg-white/5 active:opacity-70"
              style={busy ? { opacity: 0.6 } : null}
            >
              <Text className="text-[13px] font-bold text-white/75">{n.actions[1]}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Pressable
        onPress={() => !busy && onDelete(n.id)}
        disabled={busy}
        hitSlop={8}
        className="h-[30px] w-[30px] items-center justify-center rounded-[10px] active:bg-[#FF6B6B]/14"
      >
        <Trash2 size={14} color="rgba(255,255,255,0.32)" strokeWidth={1.9} />
      </Pressable>
    </Pressable>
  );
}
