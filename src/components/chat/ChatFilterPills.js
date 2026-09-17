import React from 'react';
import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';

import {
  reservas as C,
  reservasSizes as S,
  reservasFonts as F,
  alfa,
} from '../../theme/colors';
import { CHAT_FILTERS } from '../../utils/chatMeta';

/**
 * Píldoras de filtro de la bandeja: Todos · Partidos · Clubes · Amigos.
 *
 * El contador en cero no se pinta (regla del diseño). El estado activo no
 * depende solo del color: cambia el borde y el peso tipográfico, y se anuncia
 * con `accessibilityState.selected`.
 */
export default function ChatFilterPills({ value, counts, onChange }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {CHAT_FILTERS.map((f) => {
        const active = value === f.id;
        const count = counts?.[f.id] || 0;
        return (
          <Pressable
            key={f.id}
            onPress={() => onChange(f.id)}
            hitSlop={6}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              count > 0
                ? `${f.label}, ${count} ${count === 1 ? 'conversación' : 'conversaciones'}`
                : f.label
            }
            style={({ pressed }) => [
              styles.pill,
              active && styles.pillActive,
              pressed && { opacity: 0.75 },
            ]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{f.label}</Text>
            {count > 0 && (
              <Text style={[styles.count, active && styles.countActive]}>{count}</Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: S.screenPadding + 4,
    paddingBottom: 14,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 15,
    borderRadius: 20,
    backgroundColor: '#121412',
    borderWidth: 1,
    borderColor: C.borderSoft,
  },
  pillActive: {
    backgroundColor: alfa(C.green, 0.14),
    borderColor: alfa(C.green, 0.45),
  },
  label: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12.5,
    fontFamily: F.bold,
    includeFontPadding: false,
  },
  labelActive: { color: C.green, fontFamily: F.extraBold },
  count: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12.5,
    fontFamily: F.bold,
    includeFontPadding: false,
  },
  countActive: { color: C.green },
});
