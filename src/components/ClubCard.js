import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { Shield, Users, MapPin, BadgeCheck } from 'lucide-react-native';
import { colors, radius } from '../theme/colors';
import { premiumGold } from './PremiumBadge';

/**
 * Tarjeta de club para listas (búsqueda, invitaciones).
 * Muestra logo (o escudo default), nombre, ubicación, miembros y
 * la insignia de verificación si el club es Premium verificado.
 */
export default function ClubCard({ club, totalMiembros, onPress, right }) {
  const miembros = totalMiembros ?? club.total_miembros ?? 0;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      {club.foto_url ? (
        <Image source={{ uri: club.foto_url }} style={styles.logo} />
      ) : (
        <View style={[styles.logo, styles.logoFallback]}>
          <Shield color={colors.primary} size={26} strokeWidth={1.8} />
        </View>
      )}

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {club.nombre}
          </Text>
          {club.verificado ? (
            <BadgeCheck color={premiumGold} size={16} strokeWidth={2.2} />
          ) : null}
        </View>

        <View style={styles.metaRow}>
          {club.comuna ? (
            <View style={styles.metaItem}>
              <MapPin color={colors.textMuted} size={12} />
              <Text style={styles.metaText} numberOfLines={1}>
                {club.comuna}
              </Text>
            </View>
          ) : null}
          <View style={styles.metaItem}>
            <Users color={colors.textMuted} size={12} />
            <Text style={styles.metaText}>{miembros} integrantes</Text>
          </View>
        </View>
      </View>

      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSoft,
    padding: 12,
    marginBottom: 10,
  },
  logo: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
  },
  logoFallback: {
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
