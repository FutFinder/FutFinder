import React from 'react';
import { View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Check,
  CheckCheck,
  Clock3,
  CircleAlert,
  RotateCw,
  TriangleAlert,
} from 'lucide-react-native';

import { chatColors } from '../../theme/colors';
import { hourLabel, initialOf } from '../../utils/chatMeta';

/**
 * Burbuja de mensaje.
 *
 * Agrupación: el primer mensaje de una tanda del mismo autor lleva avatar y
 * nombre; los siguientes pierden ambos y afilan la esquina del lado del
 * autor, igual que en el diseño.
 *
 * Acuses de recibo: SOLO en los DMs, que son los únicos con `read_at` real en
 * la BD. En los chats de grupo no se pinta ningún check, porque no existe
 * estado de lectura por participante y sería una confirmación inventada.
 */
export default function MessageBubble({
  item,
  isGroup,
  onPressSender,
  onRetry,
  onDiscard,
}) {
  const { message, isMine, showAvatar, showSenderName, isFirstOfRun, isLastOfRun } = item;
  const status = message._status || 'sent';
  const failed = status === 'failed';
  const important = !!message.is_important;

  const senderName = message.sender?.username || null;
  const time = hourLabel(message.created_at);

  const corners = bubbleCorners({ isMine, isFirstOfRun, isLastOfRun });

  const bubbleInner = (
    <>
      {important && (
        <View style={styles.importantHeader}>
          <TriangleAlert color={chatColors.warn} size={12} strokeWidth={2.4} />
          <Text style={styles.importantHeaderText}>AVISO IMPORTANTE</Text>
        </View>
      )}

      <Text
        selectable
        style={[styles.text, isMine && !important && styles.textMine]}
      >
        {message.content}
      </Text>

      <View style={[styles.metaRow, !isMine && styles.metaRowStart]}>
        <Text
          style={[
            styles.time,
            isMine && !important && styles.timeMine,
            failed && styles.timeFailed,
          ]}
        >
          {/* Un aviso que no salió NO promete que llegará a nadie. */}
          {failed
            ? 'No se envió'
            : important
            ? `${time} · Llega también a quienes silenciaron el chat`
            : time}
        </Text>
        {failed ? (
          <CircleAlert color={chatColors.danger} size={12} strokeWidth={2.2} />
        ) : (
          isMine && !important && <DeliveryIcon status={status} isGroup={isGroup} message={message} />
        )}
      </View>
    </>
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.row, isMine ? styles.rowMine : styles.rowTheirs]}>
        {!isMine && isGroup && (
          <View style={styles.avatarSlot}>
            {showAvatar && (
              <Pressable
                onPress={() => onPressSender?.(message.sender_id)}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={
                  senderName ? `Ver el perfil de @${senderName}` : 'Ver el perfil del jugador'
                }
                style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.7 }]}
              >
                {message.sender?.foto_url ? (
                  <Image
                    source={{ uri: message.sender.foto_url }}
                    style={styles.avatarImg}
                    accessibilityIgnoresInvertColors
                  />
                ) : (
                  <Text style={styles.avatarInitial}>{initialOf(senderName)}</Text>
                )}
              </Pressable>
            )}
          </View>
        )}

        <View style={styles.column}>
          {showSenderName && senderName && (
            <Pressable
              onPress={() => onPressSender?.(message.sender_id)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={`Ver el perfil de @${senderName}`}
            >
              <Text style={styles.senderName}>{senderName}</Text>
            </Pressable>
          )}

          {important ? (
            <LinearGradient
              colors={['rgba(255,190,90,0.14)', 'rgba(255,190,90,0.03)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[
                styles.bubble,
                styles.bubbleImportant,
                failed && styles.bubbleFailedBorder,
                status === 'sending' && styles.bubbleSending,
                corners,
              ]}
            >
              {bubbleInner}
            </LinearGradient>
          ) : (
            <View
              style={[
                styles.bubble,
                isMine ? styles.bubbleMine : styles.bubbleTheirs,
                failed && styles.bubbleFailed,
                status === 'sending' && styles.bubbleSending,
                corners,
              ]}
            >
              {bubbleInner}
            </View>
          )}
        </View>
      </View>

      {failed && (
        <View style={styles.failedActions}>
          <Pressable
            onPress={() => onRetry?.(message)}
            accessibilityRole="button"
            accessibilityLabel="Reintentar el envío del mensaje"
            style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.8 }]}
          >
            <RotateCw color={chatColors.green} size={14} strokeWidth={2.2} />
            <Text style={styles.retryText}>Reintentar</Text>
          </Pressable>
          <Pressable
            onPress={() => onDiscard?.(message)}
            accessibilityRole="button"
            accessibilityLabel="Descartar el mensaje que no se envió"
            style={({ pressed }) => [styles.discardBtn, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.discardText}>Descartar</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function DeliveryIcon({ status, isGroup, message }) {
  if (status === 'sending') {
    return <Clock3 color="rgba(11,13,11,0.5)" size={12} strokeWidth={2.2} />;
  }
  // Los grupos no tienen estado de lectura por participante en la BD.
  if (isGroup) return null;
  return message.read_at ? (
    <CheckCheck color="rgba(11,13,11,0.6)" size={13} strokeWidth={2.6} />
  ) : (
    <Check color="rgba(11,13,11,0.35)" size={13} strokeWidth={2.6} />
  );
}

/** Radios de la burbuja según su lugar dentro de la tanda del mismo autor. */
function bubbleCorners({ isMine, isFirstOfRun, isLastOfRun }) {
  const R = 20;
  const S = 7;
  if (isMine) {
    return {
      borderTopLeftRadius: R,
      borderTopRightRadius: isFirstOfRun ? R : S,
      borderBottomRightRadius: isLastOfRun ? S : S,
      borderBottomLeftRadius: R,
    };
  }
  return {
    borderTopLeftRadius: isFirstOfRun ? R : S,
    borderTopRightRadius: R,
    borderBottomRightRadius: R,
    borderBottomLeftRadius: isLastOfRun ? S : S,
  };
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },

  avatarSlot: { width: 28 },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: chatColors.avatarNeutralBg,
    borderWidth: 1,
    borderColor: chatColors.avatarNeutralBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '800',
    includeFontPadding: false,
  },

  column: { maxWidth: '78%' },
  senderName: {
    marginBottom: 4,
    marginLeft: 2,
    color: chatColors.green,
    fontSize: 11.5,
    fontWeight: '800',
  },

  bubble: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, borderWidth: 1 },
  bubbleTheirs: {
    backgroundColor: chatColors.bubbleTheirs,
    borderColor: chatColors.bubbleTheirsBorder,
  },
  bubbleMine: { backgroundColor: chatColors.green, borderColor: chatColors.green },
  bubbleSending: { opacity: 0.72 },
  bubbleImportant: { borderColor: 'rgba(255,190,90,0.4)' },
  bubbleFailed: {
    backgroundColor: 'rgba(90,224,106,0.14)',
    borderColor: chatColors.dangerBorder,
    borderStyle: 'dashed',
  },
  bubbleFailedBorder: { borderColor: chatColors.dangerBorder, borderStyle: 'dashed' },

  importantHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  importantHeaderText: {
    color: chatColors.warn,
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1,
  },

  text: { color: chatColors.textPrimary, fontSize: 14.5, lineHeight: 21, fontWeight: '500' },
  textMine: { color: chatColors.inkOnGreen, fontWeight: '600' },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 3,
  },
  metaRowStart: { justifyContent: 'flex-start' },
  time: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: '700',
    flexShrink: 1,
  },
  timeMine: { color: 'rgba(11,13,11,0.55)', fontWeight: '800' },
  timeFailed: { color: chatColors.danger, fontWeight: '800' },

  failedActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.45)',
  },
  retryText: { color: chatColors.green, fontSize: 12.5, fontWeight: '800' },
  discardBtn: {
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: chatColors.border,
  },
  discardText: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: '800' },
});
