import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { Shield, ChevronRight, Plus } from 'lucide-react-native';
import { colors, radius } from '../../theme/colors';

export default function MyClubCard({ club, onPressClub, onCreateMatch }) {
  return (
    <View style={s.root}>
      <Pressable
        onPress={() => onPressClub(club.id)}
        style={({ pressed }) => [s.mainRow, pressed && { opacity: 0.88 }]}
      >
        {club.foto_url ? (
          <Image source={{ uri: club.foto_url }} style={s.logo} />
        ) : (
          <View style={s.logoPlaceholder}>
            <Shield color={colors.primary} size={20} />
          </View>
        )}
        <View style={s.info}>
          <Text style={s.name} numberOfLines={1}>{club.nombre}</Text>
          <Text style={s.meta}>
            {club.totalMiembros} miembros · {club.role === 'admin' ? 'Admin' : 'Miembro'}
          </Text>
        </View>
        <ChevronRight color={colors.textMuted} size={16} />
      </Pressable>

      {club.role === 'admin' && (
        <Pressable
          onPress={() => onCreateMatch(club.id)}
          style={({ pressed }) => [s.createBtn, pressed && { opacity: 0.85 }]}
        >
          <Plus color="#0E0E0D" size={14} strokeWidth={2.5} />
          <Text style={s.createBtnText}>Crear partido de club</Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    overflow: 'hidden',
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  logoPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1 },
  name: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  meta: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    paddingVertical: 11,
  },
  createBtnText: {
    color: '#0E0E0D',
    fontSize: 13,
    fontWeight: '800',
  },
});
