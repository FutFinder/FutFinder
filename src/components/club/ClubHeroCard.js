import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { MapPin, BadgeCheck } from 'lucide-react-native';

import { clubColors, clubRadius, clubSizes } from '../../theme/colors';
import ClubLogo from './ClubLogo';
import TagBadge from '../ds/TagBadge';
import BannerBackdrop from '../ds/BannerBackdrop';
import ClubStatsRow from './ClubStatsRow';

/**
 * Tarjeta principal del club: banner con etiquetas de modalidad y nivel,
 * logo superpuesto, nombre + verificado, comuna · miembros y récord V/E/D/rating.
 *
 * Todos los textos llegan ya resueltos desde clubMeta.js (incluidos los N.A.),
 * este componente no decide qué mostrar cuando falta un dato.
 */
export default function ClubHeroCard({
  club,
  badges,
  nivelLabel,
  miembrosLabel,
  record,
  ratingLabel,
  onPressMiembros,
}) {
  return (
    <View style={styles.card}>
      <View style={styles.banner}>
        {club.banner_url ? (
          <Image source={{ uri: club.banner_url }} style={styles.bannerImg} resizeMode="cover" />
        ) : (
          <BannerBackdrop />
        )}
        <View style={styles.badgeRow}>
          {badges.map((b) => (
            <TagBadge key={b} label={b} />
          ))}
          <TagBadge label={nivelLabel} />
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.identityRow}>
          <ClubLogo
            uri={club.foto_url}
            size={clubSizes.logo}
            borderRadius={22}
            accent={clubColors.green}
            style={styles.logo}
          />
          <View style={styles.nameCol}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>
                {club.nombre}
              </Text>
              {club.verificado ? (
                <BadgeCheck
                  color={clubColors.gold}
                  size={17}
                  strokeWidth={2.2}
                  accessibilityLabel="Club verificado"
                />
              ) : null}
            </View>
            <Pressable
              onPress={onPressMiembros}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Ver integrantes. ${miembrosLabel}`}
              style={({ pressed }) => [styles.metaRow, pressed && { opacity: 0.7 }]}
            >
              <MapPin color={clubColors.textSecondary} size={12} strokeWidth={2} />
              <Text style={styles.metaText} numberOfLines={1}>
                {miembrosLabel}
              </Text>
            </Pressable>
          </View>
        </View>

        <ClubStatsRow record={record} ratingLabel={ratingLabel} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: clubSizes.gutter,
    borderRadius: clubRadius.hero,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: clubColors.borderSoft,
  },

  // ── Banner ──
  banner: {
    height: 118,
    backgroundColor: clubColors.bannerTo,
    position: 'relative',
    overflow: 'hidden',
  },
  bannerImg: { width: '100%', height: '100%' },
  badgeRow: {
    position: 'absolute',
    left: 12,
    top: 12,
    flexDirection: 'row',
    gap: 6,
  },

  // ── Cuerpo ──
  body: {
    backgroundColor: clubColors.surface,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginTop: -30,
  },
  logo: {
    borderWidth: 2,
    borderColor: clubColors.surface,
    backgroundColor: clubColors.surfaceAlt,
  },
  nameCol: { flex: 1, minWidth: 0, paddingBottom: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: {
    color: clubColors.textPrimary,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    flexShrink: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  metaText: {
    color: clubColors.textSecondary,
    fontSize: 12.5,
    flexShrink: 1,
  },
});
