import React from 'react';
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin, ShieldCheck } from 'lucide-react-native';
import StatusPill from './StatusPill';
import BrandMark from '../BrandMark';
import NotificationBell from '../NotificationBell';
import { tactical as t } from '../../theme/colors';

export default function TacticalHeader({
  userName, comuna, summary, greeting = 'Buenas noches',
  trustScore, verified, clubRoleLabel,
}) {
  return (
    <LinearGradient
      colors={t.headerGradient}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      className="px-5 pb-5 pt-3"
    >
      <View className="mt-2 flex-row items-center">
        <BrandMark />
        <View className="flex-1" />
        <NotificationBell />
      </View>

      <View className="mt-5">
        <Text className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#00FF66]/75">{greeting}</Text>
        <Text className="mt-1 text-[30px] font-extrabold tracking-tight text-white">¡Hola, {userName}!</Text>
        <View className="mt-1.5 flex-row items-center gap-1.5">
          <MapPin size={12} color="rgba(255,255,255,0.5)" />
          <Text className="text-[14px] text-white/60">{comuna ? `${comuna} · ${summary}` : summary}</Text>
        </View>
      </View>

      <View className="mt-4 flex-row flex-wrap gap-2">
        {verified ? (
          <View className="flex-row items-center gap-1.5 rounded-full border border-[#00FF66]/40 bg-[#00FF66]/14 px-2.5 py-1">
            <ShieldCheck size={13} color={t.neon} />
            <Text className="text-[10.5px] font-bold tracking-[0.15em] text-[#00FF66]">VERIFICADO</Text>
          </View>
        ) : null}
        {typeof trustScore === 'number' ? <StatusPill tone="neutral" label={`TRUST ${trustScore}`} /> : null}
        {clubRoleLabel ? <StatusPill tone="neutral" label={clubRoleLabel} /> : null}
      </View>
    </LinearGradient>
  );
}
