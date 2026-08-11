import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BellOff, Shield, Video, TriangleAlert, Swords } from 'lucide-react-native';

import ThreadAvatar from './ThreadAvatar';
import { chatColors, dsRadius } from '../../theme/colors';
import { threadTimeLabel, threadPreview } from '../../utils/chatMeta';
import { resolveThreadAccent, challengeCardLabel } from '../../utils/challengeThread';

/**
 * Fila de la bandeja «Chats y amigos».
 *
 * Jerarquía del diseño para las no leídas: título en 800, hora en verde,
 * contador verde y superficie un punto más clara. El chat del club siempre
 * va destacado con degradado y borde verde porque es la conversación
 * permanente del jugador.
 *
 * Cuando la última novedad es un aviso `/importante` la tarjeta se pinta en
 * ámbar: es el único mensaje que atraviesa el silencio, así que tiene que
 * distinguirse de un no leído normal.
 *
 * El hilo de negociación de un desafío lleva borde rojo neón mientras ese
 * administrador no lo haya abierto — sin animación ni parpadeo. Qué acento
 * corresponde lo decide `resolveThreadAccent(thread)`, no un color escrito
 * acá: ese es el punto por donde más adelante entrará el color temático de
 * cada club.
 */
export default function ConversationCard({ thread, now, onPress }) {
  const unread = thread.unread || 0;
  const hasUnread = unread > 0;
  const important = !!thread.has_important;
  const isClub = thread.type === 'club';
  const isChallenge = thread.type === 'challenge';
  const accent = resolveThreadAccent(thread);

  const preview = threadPreview(thread);
  const time = threadTimeLabel(thread.last_at, now);

  const accessibilityLabel = [
    thread.title,
    kindText(thread),
    preview.prefix ? `${preview.prefix} ${preview.text}` : preview.text,
    hasUnread ? `${unread} sin leer` : null,
    thread.muted ? 'silenciada' : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.card,
        isClub && styles.cardClub,
        isChallenge && styles.cardChallenge,
        accent === 'neon' && styles.cardChallengeNeon,
        hasUnread && !isClub && !isChallenge && styles.cardUnread,
        important && styles.cardImportant,
        pressed && { opacity: 0.85 },
      ]}
    >
      {(isClub || important || accent === 'neon') && (
        <LinearGradient
          colors={
            important
              ? ['rgba(255,190,90,0.12)', 'rgba(255,190,90,0)']
              : accent === 'neon'
              ? ['rgba(255,45,85,0.14)', 'rgba(255,45,85,0)']
              : ['rgba(90,224,106,0.13)', 'rgba(90,224,106,0)']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 0.75, y: 1 }}
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
      )}

      <ThreadAvatar type={thread.type} fotoUrl={thread.foto_url} name={thread.title} />

      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text
            style={[styles.title, hasUnread && styles.titleUnread]}
            numberOfLines={1}
          >
            {thread.title}
          </Text>
          {!!time && (
            <Text
              style={[
                styles.time,
                hasUnread && styles.timeUnread,
                important && styles.timeImportant,
              ]}
            >
              {time}
            </Text>
          )}
        </View>

        <Text style={[styles.preview, hasUnread && styles.previewUnread]} numberOfLines={1}>
          {important && <Text style={styles.previewAviso}>Aviso · </Text>}
          {!!preview.prefix && (
            <Text style={[styles.prefix, hasUnread && styles.prefixUnread]}>
              {preview.prefix}{' '}
            </Text>
          )}
          {preview.text}
        </Text>

        <View style={styles.bottomRow}>
          {isChallenge ? (
            <View style={[styles.kindPill, styles.kindPillChallenge]}>
              <Swords color={chatColors.neon} size={11} strokeWidth={2.3} />
              <Text style={[styles.kindPillText, styles.kindPillTextChallenge]}>
                {challengeCardLabel(thread).toUpperCase()}
              </Text>
            </View>
          ) : isClub ? (
            <View style={[styles.kindPill, important && styles.kindPillImportant]}>
              {important ? (
                <TriangleAlert color={chatColors.warn} size={11} strokeWidth={2.4} />
              ) : (
                <Shield color={chatColors.green} size={11} strokeWidth={2.2} />
              )}
              <Text style={[styles.kindPillText, important && styles.kindPillTextImportant]}>
                {important ? 'IMPORTANTE' : 'CHAT DEL CLUB'}
              </Text>
            </View>
          ) : (
            <View style={styles.kindRow}>
              {thread.type === 'match' && (
                <Video
                  color={hasUnread ? chatColors.green : 'rgba(255,255,255,0.4)'}
                  size={12}
                  strokeWidth={2}
                />
              )}
              <Text style={[styles.kindText, hasUnread && styles.kindTextUnread]} numberOfLines={1}>
                {kindText(thread)}
              </Text>
            </View>
          )}

          <View style={styles.badges}>
            {thread.muted && (
              <BellOff
                color="rgba(255,255,255,0.32)"
                size={15}
                strokeWidth={1.8}
                accessibilityLabel="Conversación silenciada"
              />
            )}
            {hasUnread && (
              <View style={[styles.unread, important && styles.unreadImportant]}>
                <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function kindText(thread) {
  if (thread.type === 'club') return 'Chat del club';
  if (thread.type === 'challenge') return challengeCardLabel(thread);
  if (thread.type === 'match') {
    return thread.subtitle ? `Chat del partido · ${thread.subtitle}` : 'Chat del partido';
  }
  return 'Amigos';
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: dsRadius.xl,
    backgroundColor: chatColors.card,
    borderWidth: 1,
    borderColor: chatColors.cardBorder,
    overflow: 'hidden',
  },
  cardUnread: {
    backgroundColor: chatColors.cardUnread,
    borderColor: chatColors.cardBorderUnread,
  },
  cardClub: {
    backgroundColor: chatColors.cardClub,
    borderColor: chatColors.cardBorderClub,
  },
  cardImportant: { borderColor: chatColors.warnBorder },
  // Ya visto: el hilo sigue siendo reconocible, sin gritar.
  cardChallenge: {
    backgroundColor: chatColors.cardChallenge,
    borderColor: chatColors.challengeBorder,
  },
  // Recién aceptado y sin abrir. Borde, no animación: el enunciado pide
  // que se note, no que parpadee.
  cardChallengeNeon: { borderColor: chatColors.neonBorder },

  body: { flex: 1, minWidth: 0 },

  topRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: {
    flex: 1,
    color: chatColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    includeFontPadding: false,
  },
  titleUnread: { fontWeight: '800' },
  time: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '600',
    includeFontPadding: false,
  },
  timeUnread: { color: chatColors.green, fontWeight: '700' },
  timeImportant: { color: chatColors.warn, fontWeight: '800' },

  preview: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '500',
    lineHeight: 18,
  },
  previewUnread: { color: 'rgba(255,255,255,0.68)' },
  previewAviso: { color: chatColors.warn, fontWeight: '800' },
  prefix: { color: 'rgba(255,255,255,0.72)' },
  prefixUnread: { color: 'rgba(255,255,255,0.85)' },

  bottomRow: {
    marginTop: 7,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 },
  kindText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
  kindTextUnread: { color: chatColors.green },

  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: dsRadius.chip,
    backgroundColor: 'rgba(90,224,106,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.34)',
  },
  kindPillImportant: {
    backgroundColor: chatColors.warnSoft,
    borderColor: 'rgba(255,190,90,0.35)',
  },
  kindPillChallenge: {
    backgroundColor: chatColors.neonSoft,
    borderColor: 'rgba(255,45,85,0.35)',
  },
  kindPillText: {
    color: chatColors.green,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1,
  },
  kindPillTextImportant: { color: chatColors.warn },
  kindPillTextChallenge: { color: chatColors.neon },

  badges: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unread: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: chatColors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadImportant: { backgroundColor: chatColors.warn },
  unreadText: {
    color: chatColors.inkOnGreen,
    fontSize: 11,
    fontWeight: '800',
    includeFontPadding: false,
  },
});
