import React, { useState } from 'react';
import { ScrollView, Pressable, View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// Sombra de borde: si hay más contenido para ese lado, se ve un difuminado
// hacia el fondo oscuro del header — la señal de que se puede seguir
// desplazando. Se oculta sola en cuanto ya no hay nada más para ese lado.
const EDGE_FADE_WIDTH = 22;
const EDGE_COLOR = 'rgba(4,18,10,';

export default function FilterChips({ chips, active, onChange }) {
  const [viewportWidth, setViewportWidth] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollX, setScrollX] = useState(0);

  const canScrollLeft = scrollX > 4;
  const canScrollRight = contentWidth - viewportWidth - scrollX > 4;

  return (
    <View className="relative" onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 7, paddingRight: 14 }}
        onScroll={(e) => setScrollX(e.nativeEvent.contentOffset.x)}
        scrollEventThrottle={32}
        onContentSizeChange={(w) => setContentWidth(w)}
        accessibilityRole="tablist"
      >
        {chips.map((c) => {
          const on = active === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => onChange(c.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${c.label}, ${c.count}`}
              hitSlop={4}
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

      {canScrollLeft ? (
        <LinearGradient
          colors={[EDGE_COLOR + '0.95)', EDGE_COLOR + '0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: EDGE_FADE_WIDTH }}
        />
      ) : null}
      {canScrollRight ? (
        <LinearGradient
          colors={[EDGE_COLOR + '0)', EDGE_COLOR + '0.95)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          pointerEvents="none"
          style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: EDGE_FADE_WIDTH }}
        />
      ) : null}
    </View>
  );
}
