import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Plus } from 'lucide-react-native';
import { tactical as t } from '../../theme/colors';

export default function EmptyMatchesCard({ comuna, onCreate }) {
  return (
    <View className="items-center gap-3 rounded-[20px] border border-dashed border-[#00FF66]/28 bg-[#00FF66]/5 px-5 py-6">
      <View className="h-[46px] w-[46px] items-center justify-center rounded-2xl border border-[#00FF66]/30 bg-[#00FF66]/8">
        <Plus size={22} color={t.neon} strokeWidth={2.6} />
      </View>
      <View className="items-center">
        <Text className="text-[16px] font-bold text-white">Sin partidos en tu radio</Text>
        <Text className="mt-0.5 text-center text-[13.5px] leading-5 text-white/45">
          {comuna
            ? `Publica el primero y deja que los clubes de ${comuna} se sumen.`
            : 'Publica el primero y sé el pionero en tu zona.'}
        </Text>
      </View>
      <Pressable onPress={onCreate} className="h-11 w-full items-center justify-center rounded-[13px] bg-[#00FF66] active:opacity-80">
        <Text className="text-[14px] font-bold text-[#04120A]">Publicar partido</Text>
      </Pressable>
    </View>
  );
}
