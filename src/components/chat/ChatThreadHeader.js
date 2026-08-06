import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, ChevronRight, EllipsisVertical, BellOff } from 'lucide-react-native';

import ThreadAvatar from './ThreadAvatar';
import { chatColors, dsRadius } from '../../theme/colors';

/**
 * Cabecera de la conversación.
 *
 * El chat del club se distingue con un degradado verde y borde de acento
 * (es la conversación permanente); partido y DM usan la barra neutra.
 *
 * Tocar la identidad abre el detalle: participantes del grupo o el perfil
 * público del jugador en un DM.
 */
export default function ChatThreadHeader({
  type,
  title,
  subtitle,
  fotoUrl,
  muted,
  connection = 'online', // 'online' | 'reconnecting' | 'offline'
  onBack,
  onPressIdentity,
  onPressMenu,
}) {
  const isClub = type === 'club';
  const reconnecting = connection === 'reconnecting' || connection === 'offline';

  const Bar = isClub ? LinearGradient : View;
  const barProps = isClub
    ? {
        colors: ['rgba(90,224,106,0.12)', 'rgba(90,224,106,0)'],
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
      }
    : {};

  return (
    <Bar {...barProps} style={[styles.bar, isClub ? styles.barClub : styles.barPlain]}>
      <Pressable
        onPress={onBack}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Volver"
        style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.6 }]}
      >
        <ArrowLeft color={chatColors.textPrimary} size={22} strokeWidth={2.1} />
      </Pressable>

      <Pressable
        onPress={onPressIdentity}
        accessibilityRole="button"
        accessibilityLabel={
          type === 'dm' ? `Ver el perfil de ${title}` : `Ver detalles y jugadores de ${title}`
        }
        style={({ pressed }) => [styles.identity, pressed && { opacity: 0.75 }]}
      >
        <ThreadAvatar type={type} fotoUrl={fotoUrl} name={title} size={42} radius={14} />

        <View style={styles.texts}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {muted && (
              <BellOff
                color="rgba(255,255,255,0.32)"
                size={14}
                strokeWidth={1.8}
                accessibilityLabel="Conversación silenciada"
              />
            )}
          </View>

          <View style={styles.subRow}>
            <Text
              style={[styles.subtitle, reconnecting && styles.subtitleWarn]}
              numberOfLines={1}
            >
              {reconnecting
                ? connection === 'offline'
                  ? 'Sin conexión'
                  : 'Reconectando…'
                : subtitle}
            </Text>
            {!reconnecting && (
              <ChevronRight color={chatColors.green} size={11} strokeWidth={2.4} />
            )}
          </View>
        </View>
      </Pressable>

      <Pressable
        onPress={onPressMenu}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Opciones de la conversación"
        style={({ pressed }) => [styles.menuBtn, pressed && { opacity: 0.7 }]}
      >
        <EllipsisVertical color="rgba(255,255,255,0.75)" size={18} strokeWidth={2.2} />
      </Pressable>
    </Bar>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 6,
    paddingRight: 14,
    paddingTop: 6,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  barPlain: { borderBottomColor: chatColors.cardBorder },
  barClub: { borderBottomColor: 'rgba(90,224,106,0.26)' },

  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 },
  texts: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: {
    color: chatColors.textPrimary,
    fontSize: 16,
    fontWeight: '800',
    flexShrink: 1,
  },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  subtitle: {
    color: chatColors.green,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  subtitleWarn: { color: chatColors.warn },

  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: dsRadius.sm,
    backgroundColor: chatColors.surface,
    borderWidth: 1,
    borderColor: chatColors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
