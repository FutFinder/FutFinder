import React from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Plus, ChevronRight, Shield } from 'lucide-react-native';
import StatusPill from './StatusPill';
import { tactical as t } from '../../theme/colors';

const MODALIDAD_LABEL = { futbol7: 'Fútbol 7', futbol11: 'Fútbol 11', ambos: 'Fútbol 7 y 11' };

export default function MyClubCard({ club, onPressClub, onCreateMatch }) {
  const modLabel = MODALIDAD_LABEL[club.modalidad] || null;

  return (
    <LinearGradient colors={[t.surface, t.surfaceAlt]} className="overflow-hidden rounded-[20px] border border-white/8">
      <Pressable
        onPress={() => onPressClub(club.id)}
        className="flex-row items-center gap-3 px-4 pb-3.5 pt-4 active:opacity-90"
      >
        {club.foto_url ? (
          <Image source={{ uri: club.foto_url }} className="h-14 w-14 rounded-2xl border border-[#00FF66]/25" />
        ) : (
          <View className="h-14 w-14 items-center justify-center rounded-2xl border border-[#00FF66]/25 bg-white/5">
            <Shield color={t.neon} size={22} strokeWidth={1.8} />
          </View>
        )}
        <View className="flex-1">
          <Text numberOfLines={1} className="text-[19px] font-extrabold tracking-tight text-white">{club.nombre}</Text>
          <View className="mt-1 flex-row items-center gap-2">
            {club.role === 'admin' ? <StatusPill label="ADMIN" tone="neon" /> : null}
            <Text numberOfLines={1} className="flex-1 text-[13px] text-white/55">
              {club.totalMiembros} {club.totalMiembros === 1 ? 'miembro' : 'miembros'}{modLabel ? ` · ${modLabel}` : ''}
            </Text>
          </View>
        </View>
        <ChevronRight color="rgba(255,255,255,0.75)" size={18} />
      </Pressable>

      {club.role === 'admin' ? (
        <View className="px-4 pb-4 pt-1">
          <Pressable
            onPress={() => onCreateMatch(club.id)}
            className="h-[46px] flex-row items-center justify-center gap-1.5 rounded-2xl bg-[#00FF66] active:opacity-80"
            style={{ shadowColor: t.neon, shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } }}
          >
            <Plus size={18} color={t.neonInk} strokeWidth={3} />
            <Text className="text-[14px] font-bold text-[#04120A]">Crear partido de club</Text>
          </Pressable>
        </View>
      ) : null}
    </LinearGradient>
  );
}
