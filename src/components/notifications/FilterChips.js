import React from 'react';
import { ScrollView, Pressable, View, Text } from 'react-native';

export default function FilterChips({ chips, active, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 7 }}>
      {chips.map((c) => {
        const on = active === c.key;
        return (
          <Pressable
            key={c.key}
            onPress={() => onChange(c.key)}
            className={`flex-row items-center gap-1.5 rounded-full border px-3 py-1.5 ${
              on ? 'border-[#00FF66]/40 bg-[#00FF66]/16' : 'border-white/12 bg-black/50'
            }`}
          >
            <Text className={`text-[10.5px] font-bold tracking-[0.14em] ${on ? 'text-[#00FF66]' : 'text-white/60'}`}>
              {c.label}
            </Text>
            <View className={`min-w-[17px] items-center justify-center rounded-full px-1 py-px ${on ? 'bg-[#00FF66]' : 'bg-white/10'}`}>
              <Text className={`text-[10px] font-bold ${on ? 'text-[#04120A]' : 'text-white/60'}`}>{c.count}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
