import React from 'react';
import { View, Text, Pressable } from 'react-native';

export default function SectionHeader({ title, actionLabel, onAction }) {
  return (
    <View className="mb-2.5 flex-row items-baseline justify-between">
      <Text className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/42">{title}</Text>
      {actionLabel ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text className="text-[13px] font-semibold text-[#00FF66]">{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
