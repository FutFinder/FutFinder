import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { MapPin, Shield, Star, BadgeCheck } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';
import BannerBackdrop from '../ds/BannerBackdrop';
import TagBadge from '../ds/TagBadge';

/**
 * Tarjeta de identidad del jugador: portada con chips (modalidad · posición ·
 * nivel), avatar superpuesto, @username + nombre, comuna · partidos, y dos
 * fichas: club actual y reputación.
 *
 * Todos los textos llegan resueltos desde playerMeta.js (incluidos los N.A.):
 * este componente no decide qué mostrar cuando falta un dato.
 *
 * @param {Array} badges  [{ key, label, placeholder }]
 * @param {object} rating { value, hasRatings, count } de ratingDisplay()
 */
export default function PlayerHeroCard({
  profile,
  badges,
  metaLabel,
  clubNombre,
  rating,
  inicial,
  verificado = false,
  // true → el perfil aún no tiene identidad: el banner se dibuja gris con la
  // leyenda "añade una portada". Con identidad va el degradado verde, igual
  // que en el diseño del perfil completo.
  perfilVacio = false,
  onPressAvatar,
  onPressBanner,
  onPressClub,
  onPressRating,
}) {
  const sinPortada = !profile?.banner_url;
  const mostrarVacio = sinPortada && perfilVacio;

  return (
    <View style={styles.card}>
      <Pressable
        onPress={onPressBanner}
        disabled={!onPressBanner}
        accessibilityRole={onPressBanner ? 'button' : undefined}
        accessibilityLabel={
          onPressBanner ? (sinPortada ? 'Añadir una portada' : 'Cambiar la portada') : undefined
        }
        style={styles.banner}
      >
        {profile?.banner_url ? (
          <Image source={{ uri: profile.banner_url }} style={styles.bannerImg} resizeMode="cover" />
        ) : (
          <BannerBackdrop
            variant={mostrarVacio ? 'empty' : 'filled'}
            emptyLabel={mostrarVacio && onPressBanner ? 'añade una portada' : undefined}
          />
        )}
        <View style={styles.badgeRow}>
          {badges.map((b) => (
            <TagBadge key={b.key} label={b.label} placeholder={b.placeholder} />
          ))}
        </View>
      </Pressable>

      <View style={styles.body}>
        <View style={styles.identityRow}>
          <Pressable
            onPress={onPressAvatar}
            disabled={!onPressAvatar || !profile?.foto_url}
            accessibilityRole={profile?.foto_url ? 'imagebutton' : undefined}
            accessibilityLabel={
              profile?.foto_url
                ? `Foto de perfil de ${profile.username || 'el jugador'}`
                : 'Sin foto de perfil'
            }
            style={styles.avatarWrap}
          >
            {profile?.foto_url ? (
              <Image source={{ uri: profile.foto_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarEmpty]}>
                <Text style={styles.avatarInitial}>{inicial}</Text>
              </View>
            )}
            {verificado ? (
              <View style={styles.verifiedDot}>
                <BadgeCheck
                  color={dsColors.green}
                  size={18}
                  strokeWidth={2.4}
                  accessibilityLabel="Jugador verificado"
                />
              </View>
            ) : null}
          </Pressable>

          <View style={styles.nameCol}>
            {/* adjustsFontSizeToFit + numberOfLines: un @username largo se
                encoge en vez de desbordar la tarjeta. */}
            <Text
              style={styles.username}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.7}
            >
              @{profile?.username || 'jugador'}
            </Text>
            <View style={styles.metaRow}>
              <MapPin color={dsColors.textMuted} size={12} strokeWidth={2} />
              <Text style={styles.metaText} numberOfLines={1}>
                {metaLabel}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.chipsRow}>
          <Chip
            icon={
              <Shield
                color={clubNombre ? dsColors.green : 'rgba(255,255,255,0.35)'}
                size={15}
                strokeWidth={1.8}
              />
            }
            label="Club"
            value={clubNombre || 'Sin club'}
            empty={!clubNombre}
            onPress={clubNombre ? onPressClub : undefined}
          />
          <Chip
            icon={
              <Star
                color={rating.hasRatings ? dsColors.gold : 'rgba(255,255,255,0.35)'}
                size={15}
                strokeWidth={1.8}
                fill={rating.hasRatings ? dsColors.gold : 'none'}
              />
            }
            label="Reputación"
            value={
              rating.hasRatings ? `${rating.value} · ${rating.count} eval.` : 'N.A.'
            }
            empty={!rating.hasRatings}
            gold={rating.hasRatings}
            onPress={rating.hasRatings ? onPressRating : undefined}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Ficha compacta del pie del héroe (club / reputación).
 *
 * Se envuelve siempre en un View con el estilo aplicado como array: un `View`
 * ignora silenciosamente un `style` en forma de función (solo `Pressable` la
 * soporta), y eso dejaba la ficha sin fondo, sin borde y sin dirección de fila.
 */
function Chip({ icon, label, value, empty, gold, onPress }) {
  const contenido = (
    <>
      {icon}
      <View style={styles.chipTexts}>
        <Text style={[styles.chipLabel, gold && styles.chipLabelGold, empty && styles.chipDim]}>
          {label}
        </Text>
        <Text style={[styles.chipValue, empty && styles.chipDim]} numberOfLines={1}>
          {value}
        </Text>
      </View>
    </>
  );

  const chipStyle = [styles.chip, empty && styles.chipEmpty, gold && styles.chipGold];

  if (!onPress) return <View style={chipStyle}>{contenido}</View>;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      style={({ pressed }) => [...chipStyle, pressed && { opacity: 0.7 }]}
    >
      {contenido}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: dsSizes.gutter,
    borderRadius: dsRadius.hero,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
  },

  // ── Portada ──
  banner: {
    height: 118,
    backgroundColor: dsColors.bannerTo,
    position: 'relative',
    overflow: 'hidden',
  },
  bannerImg: { width: '100%', height: '100%' },
  badgeRow: {
    position: 'absolute',
    left: 12,
    top: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },

  // ── Cuerpo ──
  body: {
    backgroundColor: dsColors.surface,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    marginTop: -30,
  },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: dsSizes.logo,
    height: dsSizes.logo,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: dsColors.surface,
    backgroundColor: dsColors.surfaceAlt,
  },
  avatarEmpty: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: {
    fontSize: 24,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.4)',
  },
  verifiedDot: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 24,
    height: 24,
    borderRadius: 9,
    backgroundColor: dsColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameCol: { flex: 1, minWidth: 0, paddingBottom: 4 },
  username: {
    color: dsColors.textPrimary,
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  metaText: { color: dsColors.textMuted, fontSize: 12.5, flexShrink: 1 },

  // ── Fichas ──
  chipsRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  chip: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  chipEmpty: {
    borderStyle: 'dashed',
    borderColor: 'rgba(255, 255, 255, 0.14)',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  chipGold: {
    borderColor: 'rgba(240, 200, 90, 0.22)',
    backgroundColor: 'rgba(240, 200, 90, 0.10)',
  },
  chipTexts: { flex: 1, minWidth: 0 },
  chipLabel: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: dsColors.textMuted,
  },
  chipLabelGold: { color: 'rgba(240, 200, 90, 0.7)' },
  chipValue: { color: dsColors.textPrimary, fontSize: 13, fontWeight: '700' },
  chipDim: { color: 'rgba(255, 255, 255, 0.5)' },
});
