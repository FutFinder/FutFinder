import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import {
  UserPlus,
  UserCheck,
  UserX,
  MessageCircle,
  Clock,
  Shield,
  Flag,
  Ban,
} from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  medidas as S,
  fuentes as F,
  alfa,
} from '../../theme/colors';

/**
 * Acciones sobre el perfil de OTRO jugador: amistad, contactar, invitar a mi
 * club y reportar.
 *
 * Nunca aparece en el perfil propio (lo decide la pantalla), así que aquí no
 * hay riesgo de auto-reportarse ni de auto-invitarse.
 *
 * El estado de amistad se deriva de `friendship` + `myId`, igual que antes del
 * rediseño, para no cambiar el comportamiento del sistema de amigos.
 *
 * `isBlocked` (¿yo bloqueé a este jugador?) manda sobre todo lo demás: si es
 * `true`, se esconden las acciones de amistad/invitación y solo queda
 * "Desbloquear". Si ÉL me bloqueó a mí, `friendship.status` puede llegar en
 * 'blocked' pero `isBlocked` es `false` — no hay forma de saberlo desde acá
 * (por diseño, ver blockedUsers.js), así que se sigue mostrando "Agregar
 * amigo" con normalidad: si lo intenta, la RLS lo rechaza igual que un
 * perfil con privacidad cerrada, con el mismo mensaje genérico.
 */
export default function PlayerPublicActions({
  friendship,
  myId,
  busy,
  puedeInvitarAClub,
  invitandoAClub,
  invitacionClubEnviada,
  yaReportado,
  isBlocked,
  onAdd,
  onAccept,
  onReject,
  onCancel,
  onRemove,
  onMessage,
  onInviteClub,
  onReport,
  onBlock,
  onUnblock,
}) {
  let estado = 'none';
  if (friendship) {
    if (friendship.status === 'accepted') estado = 'friends';
    else if (friendship.status === 'pending') {
      estado = friendship.requester_id === myId ? 'sent' : 'received';
    }
    // 'rejected' / 'blocked' → 'none': se permite reintentar (igual que antes).
  }

  const sonAmigos = estado === 'friends';

  return (
    <View style={styles.wrap}>
      {!isBlocked && (
        <View style={styles.row}>
          {estado === 'none' && (
            <Primary
              onPress={onAdd}
              busy={busy}
              icon={<UserPlus color={C.greenInk} size={17} strokeWidth={2.4} />}
              label="Agregar amigo"
            />
          )}

          {estado === 'sent' && (
            <Outline
              onPress={onCancel}
              busy={busy}
              icon={<Clock color={C.textSecondary} size={15} strokeWidth={2} />}
              label="Solicitud enviada · cancelar"
            />
          )}

          {estado === 'received' && (
            <>
              <Primary
                onPress={onAccept}
                busy={busy}
                icon={<UserCheck color={C.greenInk} size={17} strokeWidth={2.4} />}
                label="Aceptar"
              />
              <Pressable
                onPress={onReject}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Rechazar la solicitud de amistad"
                style={({ pressed }) => [
                  styles.iconBtn,
                  busy && styles.busy,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <UserX color={C.loss} size={17} strokeWidth={2.2} />
              </Pressable>
            </>
          )}

          {sonAmigos && (
            <>
              <Outline
                onPress={onRemove}
                busy={busy}
                icon={<UserCheck color={C.green} size={15} strokeWidth={2.2} />}
                label="Amigos · quitar"
                tint={C.green}
              />
              <Outline
                onPress={onMessage}
                icon={<MessageCircle color={C.textPrimary} size={16} strokeWidth={2} />}
                label="Contactar"
              />
            </>
          )}
        </View>
      )}

      {!isBlocked && puedeInvitarAClub && (
        <Pressable
          onPress={onInviteClub}
          disabled={invitandoAClub || invitacionClubEnviada}
          accessibilityRole="button"
          accessibilityLabel={
            invitacionClubEnviada
              ? 'Ya invitaste a este jugador a tu club'
              : 'Invitar a este jugador a mi club'
          }
          style={({ pressed }) => [
            styles.clubBtn,
            invitacionClubEnviada && styles.clubBtnDone,
            invitandoAClub && styles.busy,
            pressed && { opacity: 0.85 },
          ]}
        >
          {invitandoAClub ? (
            <ActivityIndicator color={C.green} size="small" />
          ) : invitacionClubEnviada ? (
            <Clock color={C.textSecondary} size={16} strokeWidth={2} />
          ) : (
            <Shield color={C.green} size={16} strokeWidth={2} />
          )}
          <Text style={[styles.clubText, invitacionClubEnviada && styles.clubTextDone]}>
            {invitacionClubEnviada ? 'Invitación al club enviada' : 'Invitar a mi club'}
          </Text>
        </Pressable>
      )}

      <Pressable
        onPress={isBlocked ? onUnblock : onBlock}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={isBlocked ? 'Desbloquear a este jugador' : 'Bloquear a este jugador'}
        style={({ pressed }) => [
          styles.blockBtn,
          isBlocked && styles.blockBtnActive,
          busy && styles.busy,
          pressed && { opacity: 0.85 },
        ]}
      >
        <Ban color={isBlocked ? C.loss : C.textMuted} size={16} strokeWidth={2} />
        <Text style={[styles.blockText, isBlocked && styles.blockTextActive]}>
          {isBlocked ? 'Bloqueado · Desbloquear' : 'Bloquear usuario'}
        </Text>
      </Pressable>

      <Pressable
        onPress={onReport}
        disabled={yaReportado}
        accessibilityRole="button"
        accessibilityLabel={
          yaReportado ? 'Ya reportaste esta cuenta' : 'Reportar esta cuenta'
        }
        style={({ pressed }) => [
          styles.reportBtn,
          yaReportado && styles.reportDone,
          pressed && !yaReportado && { opacity: 0.85 },
        ]}
      >
        <Flag
          color={yaReportado ? C.textMuted : C.loss}
          size={16}
          strokeWidth={2}
        />
        <Text style={[styles.reportText, yaReportado && styles.reportTextDone]}>
          {yaReportado ? 'Reporte enviado · en revisión' : 'Reportar esta cuenta'}
        </Text>
      </Pressable>
    </View>
  );
}

function Primary({ onPress, busy, icon, label }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.primary, busy && styles.busy, pressed && { opacity: 0.85 }]}
    >
      {icon}
      <Text style={styles.primaryText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function Outline({ onPress, busy, icon, label, tint }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.outline, busy && styles.busy, pressed && { opacity: 0.7 }]}
    >
      {icon}
      <Text style={[styles.outlineText, tint && { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: S.screenPadding, gap: 8 },
  row: { flexDirection: 'row', gap: 8 },
  busy: { opacity: 0.5 },

  primary: {
    flex: 1,
    minHeight: 50,
    borderRadius: R.iconBtn,
    backgroundColor: C.green,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  primaryText: { color: C.greenInk, fontSize: 14, fontFamily: F.extraBold, flexShrink: 1 },

  outline: {
    flex: 1,
    minHeight: 50,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
  },
  outlineText: { color: C.textPrimary, fontSize: 13.5, fontFamily: F.bold, flexShrink: 1 },

  iconBtn: {
    width: 50,
    minHeight: 50,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: alfa(C.red, 0.35),
    backgroundColor: alfa(C.red, 0.08),
    alignItems: 'center',
    justifyContent: 'center',
  },

  clubBtn: {
    minHeight: 48,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: alfa(C.green, 0.35),
    backgroundColor: alfa(C.green, 0.10),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  clubText: { color: C.green, fontSize: 13.5, fontFamily: F.bold },
  clubBtnDone: { borderColor: C.border, backgroundColor: C.chip },
  clubTextDone: { color: C.textSecondary },

  blockBtn: {
    minHeight: 44,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.chip,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  blockBtnActive: {
    borderColor: alfa(C.red, 0.35),
    backgroundColor: alfa(C.red, 0.08),
  },
  blockText: { color: C.textMuted, fontSize: 13.5, fontFamily: F.bold },
  blockTextActive: { color: C.loss },

  reportBtn: {
    minHeight: 46,
    borderRadius: R.iconBtn,
    borderWidth: 1,
    borderColor: alfa(C.red, 0.3),
    backgroundColor: alfa(C.red, 0.07),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  reportDone: {
    borderColor: C.borderSoft,
    backgroundColor: C.chip,
  },
  reportText: { color: C.loss, fontSize: 13.5, fontFamily: F.bold },
  reportTextDone: { color: C.textMuted },
});
