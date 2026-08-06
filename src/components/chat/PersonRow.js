import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { ChevronRight } from 'lucide-react-native';

import { chatColors, dsRadius } from '../../theme/colors';
import { initialOf, playerLine } from '../../utils/chatMeta';

/**
 * Fila de jugador. La usan la lista de participantes, las solicitudes de
 * amistad y la lista de amigos, para que las tres se vean igual.
 *
 * `line` permite sobrescribir la línea secundaria; si no se pasa, se calcula
 * con `playerLine`, que escribe `N.A.` donde no hay dato real en vez de
 * inventar una posición o un Trust Score.
 */
export default function PersonRow({
  profile,
  line,
  badge,
  right,
  onPress,
  highlight = false,
  children,
}) {
  const username = profile?.username || 'jugador';
  const secondary = line ?? playerLine(profile);

  // Lo navegable es SOLO la fila de identidad, no la tarjeta entera: así los
  // botones de acción de abajo (aceptar, rechazar, cancelar) no quedan dentro
  // de otro botón, que en web dispararía las dos cosas de un clic.
  const identity = (
    <>
      <View style={styles.rowInner}>
        <View style={[styles.avatar, highlight && styles.avatarGreen]}>
          {profile?.foto_url ? (
            <Image
              source={{ uri: profile.foto_url }}
              style={styles.avatarImg}
              accessibilityIgnoresInvertColors
            />
          ) : (
            <Text style={[styles.initial, highlight && styles.initialGreen]}>
              {initialOf(username)}
            </Text>
          )}
        </View>

        <View style={styles.texts}>
          <View style={styles.nameRow}>
            <Text style={styles.name} numberOfLines={1}>
              @{username}
            </Text>
            {!!badge && <RoleBadge {...badge} />}
          </View>
          <Text style={styles.line} numberOfLines={1}>
            {secondary}
          </Text>
        </View>

        {!right && !!onPress && (
          <ChevronRight color="rgba(255,255,255,0.35)" size={16} strokeWidth={2} />
        )}
      </View>
    </>
  );

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        {onPress ? (
          <Pressable
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={`Ver el perfil de @${username}. ${secondary}`}
            style={({ pressed }) => [styles.identity, pressed && { opacity: 0.75 }]}
          >
            {identity}
          </Pressable>
        ) : (
          <View style={styles.identity}>{identity}</View>
        )}
        {right}
      </View>

      {children}
    </View>
  );
}

/** Etiqueta de rol: ADMIN, ORGANIZADOR, TÚ. */
export function RoleBadge({ label, accent = false }) {
  return (
    <View style={[styles.badge, accent && styles.badgeAccent]}>
      <Text style={[styles.badgeText, accent && styles.badgeTextAccent]}>{label}</Text>
    </View>
  );
}

/**
 * Botón de estado de amistad para una fila.
 * Estados: 'none' | 'sent' | 'received' | 'friends' | 'self' | 'unavailable'.
 * Nunca ofrece «Agregar» sobre una solicitud pendiente.
 */
export function FriendActionButton({ status, busy, onAdd, onCancel, onOpenRequest }) {
  if (status === 'self' || status === 'unavailable') return null;

  if (status === 'friends') {
    return (
      <View style={[styles.action, styles.actionFriends]} accessibilityRole="text">
        <Text style={[styles.actionText, { color: chatColors.green }]}>Amigos</Text>
      </View>
    );
  }

  if (status === 'sent') {
    return (
      <Pressable
        onPress={onCancel}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Solicitud enviada. Tocar para cancelarla"
        style={({ pressed }) => [
          styles.action,
          styles.actionSent,
          busy && { opacity: 0.5 },
          pressed && { opacity: 0.75 },
        ]}
      >
        <Text style={[styles.actionText, { color: 'rgba(255,255,255,0.45)' }]}>Enviada</Text>
      </Pressable>
    );
  }

  if (status === 'received') {
    return (
      <Pressable
        onPress={onOpenRequest}
        accessibilityRole="button"
        accessibilityLabel="Te envió una solicitud. Ver para aceptar o rechazar"
        style={({ pressed }) => [styles.action, styles.actionFriends, pressed && { opacity: 0.8 }]}
      >
        <Text style={[styles.actionText, { color: chatColors.green }]}>Responder</Text>
      </Pressable>
    );
  }

  return (
    <Pressable
      onPress={onAdd}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel="Agregar como amigo"
      style={({ pressed }) => [
        styles.action,
        styles.actionAdd,
        busy && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Text style={[styles.actionText, { color: chatColors.green }]}>Agregar</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 12,
    borderRadius: dsRadius.lg,
    backgroundColor: chatColors.card,
    borderWidth: 1,
    borderColor: chatColors.cardBorder,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  identity: { flex: 1, minWidth: 0 },
  rowInner: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: chatColors.avatarNeutralBg,
    borderWidth: 1,
    borderColor: chatColors.avatarNeutralBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarGreen: {
    backgroundColor: chatColors.avatarGreenBg,
    borderColor: 'rgba(90,224,106,0.2)',
  },
  avatarImg: { width: '100%', height: '100%' },
  initial: { color: 'rgba(255,255,255,0.75)', fontSize: 16, fontWeight: '800' },
  initialGreen: { color: chatColors.green },

  texts: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  name: { color: chatColors.textPrimary, fontSize: 14.5, fontWeight: '800', flexShrink: 1 },
  line: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '500',
  },

  badge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    backgroundColor: '#181C18',
    borderWidth: 1,
    borderColor: chatColors.border,
  },
  badgeAccent: {
    backgroundColor: 'rgba(90,224,106,0.14)',
    borderColor: 'rgba(90,224,106,0.32)',
  },
  badgeText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  badgeTextAccent: { color: chatColors.green },

  action: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 13,
    borderRadius: 18,
    borderWidth: 1,
  },
  actionAdd: { borderColor: 'rgba(90,224,106,0.45)' },
  actionSent: { backgroundColor: chatColors.sendIdle, borderColor: 'transparent' },
  actionFriends: {
    backgroundColor: 'rgba(90,224,106,0.14)',
    borderColor: 'rgba(90,224,106,0.4)',
  },
  actionText: { fontSize: 12, fontWeight: '800' },
});
