import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { tactical as t } from '../../theme/colors';

export default function TrustScoreCard({
  score, max = 100, matchesPlayed, reports = 0, tierLabel = 'ÉLITE', onPress,
}) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  return (
    <Pressable onPress={onPress}>
      <LinearGradient
        colors={t.metal}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="overflow-hidden rounded-[20px] border border-white/10 p-4"
      >
        <View>
          <Text className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-white/50">Tu Trust Score</Text>
          <View className="mt-1 flex-row items-end gap-1">
            <Text className="text-[42px] font-black leading-none tracking-tighter text-white">{score}</Text>
            <Text className="mb-1.5 text-[17px] font-semibold text-white/35">/ {max}</Text>
          </View>
        </View>

        <View className="mt-4 h-[7px] overflow-hidden rounded-full bg-white/8">
          <LinearGradient
            colors={['#0A7A3C', t.neon]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ width: `${pct}%`, height: '100%', borderRadius: 999 }}
          />
        </View>

        <View className="mt-3 flex-row items-center justify-between">
          <Text className="text-[12.5px] text-white/45">{matchesPlayed} partidos jugados · {reports} reportes</Text>
          <Text className="text-[10.5px] font-bold tracking-[0.15em] text-[#00FF66]">{tierLabel}</Text>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
