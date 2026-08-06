import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { ChevronRight, MessageSquare, UserPlus } from 'lucide-react-native';

import { chatColors, dsRadius, dsSizes } from '../../theme/colors';

/**
 * Piezas sueltas de la conversación y de la bandeja: separador de día,
 * píldora de contexto, cargador de mensajes anteriores, estado vacío del
 * hilo y la tarjeta de solicitudes de amistad.
 */

/** Separador HOY / AYER / MAR 12 AGO. */
export function DayDivider({ label }) {
  return (
    <View style={styles.day} accessibilityRole="header">
      <View style={styles.dayLine} />
      <Text style={styles.dayText}>{label}</Text>
      <View style={styles.dayLine} />
    </View>
  );
}

/** Píldora centrada con el contexto del grupo ('Chat del partido · 10 confirmados'). */
export function ContextPill({ icon, label }) {
  return (
    <View style={styles.pill}>
      {icon}
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

/** Cabecera de la lista: cargar mensajes anteriores. */
export function LoadEarlier({ loading, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel="Cargar mensajes anteriores"
      style={({ pressed }) => [styles.earlier, pressed && { opacity: 0.7 }]}
    >
      {loading ? (
        <ActivityIndicator color={chatColors.green} size="small" />
      ) : (
        <Text style={styles.earlierText}>Cargar mensajes anteriores</Text>
      )}
    </Pressable>
  );
}

/** Conversación sin mensajes. */
export function ThreadEmpty({ title, message }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <MessageSquare color="rgba(90,224,106,0.75)" size={26} strokeWidth={1.6} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

/** Acceso denegado a una conversación (no eres miembro / no estás inscrito). */
export function ThreadDenied({ title, message, onBack }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, styles.emptyIconMuted]}>
        <MessageSquare color="rgba(255,255,255,0.45)" size={26} strokeWidth={1.6} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      {!!message && <Text style={styles.emptyText}>{message}</Text>}
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Volver"
        style={({ pressed }) => [styles.deniedBtn, pressed && { opacity: 0.8 }]}
      >
        <Text style={styles.deniedBtnText}>Volver</Text>
      </Pressable>
    </View>
  );
}

/** Tarjeta de la bandeja: «N solicitudes de amistad». */
export function FriendRequestsCard({ requests, onPress }) {
  const n = requests.length;
  if (n === 0) return null;
  const names = requests
    .slice(0, 2)
    .map((r) => '@' + r.username)
    .join(' y ');

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${n} ${n === 1 ? 'solicitud' : 'solicitudes'} de amistad de ${names}`}
      style={({ pressed }) => [styles.reqCard, pressed && { opacity: 0.85 }]}
    >
      <View style={styles.reqIcon}>
        <UserPlus color={chatColors.green} size={19} strokeWidth={1.9} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.reqTitle}>
          {n} {n === 1 ? 'solicitud de amistad' : 'solicitudes de amistad'}
        </Text>
        <Text style={styles.reqNames} numberOfLines={1}>
          {names}
          {n > 2 ? ` y ${n - 2} más` : ''}
        </Text>
      </View>
      <ChevronRight color={chatColors.green} size={18} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  day: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 },
  dayLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  dayText: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },

  pill: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 16,
    backgroundColor: chatColors.card,
    borderWidth: 1,
    borderColor: chatColors.bubbleTheirsBorder,
  },
  pillText: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontWeight: '700' },

  earlier: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  earlierText: { color: chatColors.green, fontSize: 12.5, fontWeight: '800' },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingVertical: 40,
  },
  emptyIcon: {
    width: 62,
    height: 62,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: chatColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyIconMuted: { borderColor: chatColors.borderSoft },
  emptyTitle: {
    color: chatColors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyText: {
    marginTop: 7,
    color: 'rgba(255,255,255,0.48)',
    fontSize: 13,
    lineHeight: 21,
    textAlign: 'center',
  },
  deniedBtn: {
    marginTop: 22,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.45)',
  },
  deniedBtnText: { color: chatColors.green, fontSize: 13.5, fontWeight: '800' },

  reqCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: dsRadius.xl,
    backgroundColor: 'rgba(90,224,106,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.3)',
  },
  reqIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(90,224,106,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reqTitle: { color: chatColors.textPrimary, fontSize: 14, fontWeight: '800' },
  reqNames: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    fontWeight: '500',
  },
});

export const CHAT_GUTTER = dsSizes.gutter;
