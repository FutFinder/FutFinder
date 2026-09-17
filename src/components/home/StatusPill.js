import React from 'react';
import { View, Text } from 'react-native';

const TONES = {
  neon: { wrap: 'bg-verde/12 border-verde/40', text: 'text-verde' },
  solid: { wrap: 'bg-verde border-verde', text: 'text-verde-ink' },
  neutral: { wrap: 'bg-black/50 border-white/12', text: 'text-white/80' },
  danger: { wrap: 'bg-rojo/10 border-rojo/28', text: 'text-rojo' },
};

export default function StatusPill({ label, tone = 'neon', dot }) {
  const t = TONES[tone];
  return (
    <View className={`flex-row items-center gap-1.5 rounded-full border px-2.5 py-1 ${t.wrap}`}>
      {dot ? <View className={`h-1.5 w-1.5 rounded-full ${tone === 'danger' ? 'bg-rojo' : 'bg-verde'}`} /> : null}
      <Text className={`text-[10.5px] font-bold tracking-[0.15em] ${t.text}`}>{label}</Text>
    </View>
  );
}
