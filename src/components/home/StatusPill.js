import React from 'react';
import { View, Text } from 'react-native';

const TONES = {
  neon: { wrap: 'bg-[#00FF66]/12 border-[#00FF66]/40', text: 'text-[#00FF66]' },
  solid: { wrap: 'bg-[#00FF66] border-[#00FF66]', text: 'text-[#04120A]' },
  neutral: { wrap: 'bg-black/50 border-white/12', text: 'text-white/80' },
  danger: { wrap: 'bg-[#FF6B6B]/10 border-[#FF6B6B]/28', text: 'text-[#FF6B6B]' },
};

export default function StatusPill({ label, tone = 'neon', dot }) {
  const t = TONES[tone];
  return (
    <View className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${t.wrap}`}>
      {dot ? <View className={`h-1.5 w-1.5 rounded-full ${tone === 'danger' ? 'bg-[#FF6B6B]' : 'bg-[#00FF66]'}`} /> : null}
      <Text className={`text-[10.5px] font-bold tracking-[0.15em] ${t.text}`}>{label}</Text>
    </View>
  );
}
