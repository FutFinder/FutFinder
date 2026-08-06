import React from 'react';
import { View, Text, Pressable } from 'react-native';
import {
  UserPlus, CheckCheck, Swords, Shield, CalendarDays, MessageCircle, Star, Bell, Users, Trash2,
} from 'lucide-react-native';
import { tactical as t } from '../../theme/colors';

/** A qué chip de filtro (CLUBES/PARTIDOS/SOCIAL) pertenece cada tipo real de notificación. */
export const CATEGORY = {
  friend_request: 'social',
  friend_accept: 'social',
  message_new: 'social',
  match_join: 'partidos',
  match_reminder: 'partidos',
  match_rate: 'partidos',
  match_cancelled: 'partidos',
  join_request: 'partidos',
  join_approved: 'partidos',
  join_rejected: 'partidos',
  club_request: 'clubes',
  club_request_accepted: 'clubes',
  club_request_rejected: 'clubes',
  club_member_joined: 'clubes',
  club_member_left: 'clubes',
  club_invite_accepted: 'clubes',
  club_challenge: 'clubes',
  club_challenge_accepted: 'clubes',
  club_challenge_rejected: 'clubes',
};

const ICON = {
  friend_request: UserPlus,
  friend_accept: CheckCheck,
  message_new: MessageCircle,
  match_join: Users,
  match_reminder: CalendarDays,
  match_rate: Star,
  match_cancelled: CalendarDays,
  join_request: UserPlus,
  join_approved: CheckCheck,
  join_rejected: Bell,
  club_request: Shield,
  club_request_accepted: CheckCheck,
  club_request_rejected: Shield,
  club_member_joined: Users,
  club_member_left: Shield,
  club_invite_accepted: CheckCheck,
  club_challenge: Swords,
  club_challenge_accepted: CheckCheck,
  club_challenge_rejected: Swords,
};

const TAG = {
  friend_request: { label: 'SOCIAL', color: '#7DD3FC', bg: 'rgba(125,211,252,0.10)', border: 'rgba(125,211,252,0.26)' },
  friend_accept: { label: 'SOCIAL', color: '#7DD3FC', bg: 'rgba(125,211,252,0.10)', border: 'rgba(125,211,252,0.26)' },
  message_new: { label: 'MENSAJES', color: '#C4B5FD', bg: 'rgba(196,181,253,0.10)', border: 'rgba(196,181,253,0.26)' },
  match_join: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_reminder: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_rate: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  match_cancelled: { label: 'PARTIDO', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
  join_request: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  join_approved: { label: 'PARTIDO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  join_rejected: { label: 'PARTIDO', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
  club_request: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_request_accepted: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_request_rejected: { label: 'CLUBES', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
  club_member_joined: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_member_left: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_invite_accepted: { label: 'CLUBES', color: '#F472B6', bg: 'rgba(244,114,182,0.10)', border: 'rgba(244,114,182,0.28)' },
  club_challenge: { label: 'DESAFÍO', color: '#FFB347', bg: 'rgba(255,179,71,0.10)', border: 'rgba(255,179,71,0.28)' },
  club_challenge_accepted: { label: 'DESAFÍO', color: '#00FF66', bg: 'rgba(0,255,102,0.10)', border: 'rgba(0,255,102,0.28)' },
  club_challenge_rejected: { label: 'DESAFÍO', color: '#FF6B6B', bg: 'rgba(255,107,107,0.10)', border: 'rgba(255,107,107,0.28)' },
};

const FALLBACK_TAG = { label: 'AVISO', color: 'rgba(255,255,255,0.6)', bg: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)' };

export default function NotificationCard({ notification: n, onPress, onDelete, onPrimary, onSecondary }) {
  const Icon = ICON[n.type] || Bell;
  const tag = TAG[n.type] || FALLBACK_TAG;
  const unread = !n.read;

  return (
    <Pressable
      onPress={() => onPress(n)}
      className={`flex-row items-start gap-3 overflow-hidden rounded-[18px] border p-3.5 active:opacity-80 ${
        unread ? 'border-[#00FF66]/16 bg-[#00FF66]/5' : 'border-white/7 bg-white/3'
      }`}
    >
      {unread ? <View className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ backgroundColor: tag.color }} /> : null}

      <View
        className={`h-[38px] w-[38px] items-center justify-center rounded-[13px] border ${
          unread ? 'border-[#00FF66]/28 bg-[#00FF66]/10' : 'border-white/10 bg-white/5'
        }`}
      >
        <Icon size={18} color={unread ? t.neon : 'rgba(255,255,255,0.55)'} strokeWidth={1.9} />
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text numberOfLines={2} className={`flex-1 text-[15px] font-bold leading-5 ${unread ? 'text-white' : 'text-white/82'}`}>
            {n.title}
          </Text>
          {unread ? <View className="h-[7px] w-[7px] rounded-full bg-[#00FF66]" /> : null}
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

        {n.actions ? (
          <View className="mt-2.5 flex-row gap-2">
            <Pressable
              onPress={() => onPrimary?.(n)}
              className="h-[38px] flex-1 items-center justify-center rounded-xl bg-[#00FF66] active:opacity-80"
            >
              <Text className="text-[13px] font-bold text-[#04120A]">{n.actions[0]}</Text>
            </Pressable>
            <Pressable
              onPress={() => onSecondary?.(n)}
              className="h-[38px] flex-1 items-center justify-center rounded-xl border border-white/12 bg-white/5 active:opacity-70"
            >
              <Text className="text-[13px] font-bold text-white/75">{n.actions[1]}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <Pressable onPress={() => onDelete(n.id)} hitSlop={8} className="h-[30px] w-[30px] items-center justify-center rounded-[10px] active:bg-[#FF6B6B]/14">
        <Trash2 size={14} color="rgba(255,255,255,0.32)" strokeWidth={1.9} />
      </Pressable>
    </Pressable>
  );
}
