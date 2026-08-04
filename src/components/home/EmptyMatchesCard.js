import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Trophy, Plus } from 'lucide-react-native';
import { colors, radius } from '../../theme/colors';

export default function EmptyMatchesCard({ comuna, onCreate }) {
  return (
    <View style={s.root}>
      <Trophy color={colors.textMuted} size={30} strokeWidth={1.5} />
      <Text style={s.title}>Sin partidos cerca</Text>
      <Text style={s.sub}>
        {comuna
          ? `No hay partidos en ${comuna}.\n¡Crea el primero!`
          : 'No hay partidos disponibles.\n¡Crea el primero!'}
      </Text>
      <Pressable
        onPress={onCreate}
        style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}
      >
        <Plus color="#0E0E0D" size={14} />
        <Text style={s.btnText}>Crear partido</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
  },
  sub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: radius.pill,
    marginTop: 8,
  },
  btnText: { color: '#0E0E0D', fontSize: 13, fontWeight: '800' },
});
