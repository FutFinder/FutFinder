import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Platform } from 'react-native';
import { Send, Smile, Lock, WifiOff } from 'lucide-react-native';

import { chatColors } from '../../theme/colors';
import { canSendDraft } from '../../utils/chatMeta';
import { MAX_MESSAGE_LENGTH } from '../../services/messages';

/**
 * Compositor de la conversación.
 *
 * Sin permiso de escritura NO se oculta el chat: el compositor se reemplaza
 * por la tarjeta «Solo lectura» que explica por qué, tal como pide el diseño.
 *
 * El botón de enviar se apaga con el campo vacío, mientras hay un envío en
 * curso y sin conexión — no existe una cola offline, así que el compositor
 * no promete una: el aviso de "sin conexión" es permanente (no depende del
 * placeholder, que desaparece apenas hay texto escrito) y el botón queda
 * inhabilitado hasta que vuelva la conexión.
 */
export default function ChatComposer({
  value,
  onChangeText,
  onSend,
  onOpenEmoji,
  sending,
  canWrite = true,
  readOnlyTitle = 'Solo lectura',
  readOnlyMessage,
  commandSuggestions = [],
  onPickCommand,
  offline = false,
  inputRef,
  onSelectionChange,
}) {
  const [focused, setFocused] = useState(false);

  if (!canWrite) {
    return (
      <View style={styles.readOnlyBar}>
        <View style={styles.readOnlyCard} accessibilityRole="summary">
          <Lock color="rgba(255,255,255,0.55)" size={19} strokeWidth={1.8} />
          <View style={{ flex: 1 }}>
            <Text style={styles.readOnlyTitle}>{readOnlyTitle}</Text>
            {!!readOnlyMessage && <Text style={styles.readOnlyText}>{readOnlyMessage}</Text>}
          </View>
        </View>
      </View>
    );
  }

  const enabled = canSendDraft(value, { sending, canWrite, offline, maxLength: MAX_MESSAGE_LENGTH });
  const isCommand = (value || '').trim().startsWith('/');

  return (
    <View>
      {offline && (
        <View style={styles.offlineWrap}>
          <View style={styles.offlineCard} accessibilityRole="summary">
            <WifiOff color={chatColors.warn} size={16} strokeWidth={2} />
            <Text style={styles.offlineText}>Sin conexión — no puedes enviar mensajes ahora.</Text>
          </View>
        </View>
      )}

      {commandSuggestions.length > 0 && (
        <View style={styles.commandsWrap}>
          <View style={styles.commandsCard}>
            <Text style={styles.commandsTitle}>COMANDOS DEL CHAT</Text>
            {commandSuggestions.map((c, i) => (
              <Pressable
                key={c.command}
                onPress={() => onPickCommand?.(c)}
                accessibilityRole="button"
                accessibilityLabel={`${c.command}. ${c.hint}`}
                style={({ pressed }) => [
                  styles.commandRow,
                  i === 0 && styles.commandRowFirst,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.commandName, i === 0 && styles.commandNameAccent]}>
                  {c.command}
                </Text>
                <Text style={styles.commandHint}>{c.hint}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      <View style={styles.bar}>
        <Pressable
          onPress={onOpenEmoji}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Abrir el selector de emoji"
          style={({ pressed }) => [styles.emojiBtn, pressed && { opacity: 0.6 }]}
        >
          <Smile color="rgba(255,255,255,0.55)" size={23} strokeWidth={1.7} />
        </Pressable>

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onSelectionChange={onSelectionChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={offline ? 'Sin conexión — no puedes enviar' : 'Escribe un mensaje…'}
          placeholderTextColor="rgba(255,255,255,0.35)"
          multiline
          maxLength={MAX_MESSAGE_LENGTH}
          accessibilityLabel="Escribe un mensaje"
          style={[
            styles.input,
            focused && styles.inputFocused,
            isCommand && styles.inputCommand,
          ]}
        />

        <Pressable
          onPress={onSend}
          disabled={!enabled}
          accessibilityRole="button"
          accessibilityLabel="Enviar mensaje"
          accessibilityState={{ disabled: !enabled }}
          style={({ pressed }) => [
            styles.sendBtn,
            enabled ? styles.sendBtnOn : styles.sendBtnOff,
            pressed && enabled && { opacity: 0.85 },
          ]}
        >
          <Send
            color={enabled ? chatColors.inkOnGreen : 'rgba(255,255,255,0.25)'}
            size={20}
            strokeWidth={enabled ? 2.1 : 1.9}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 10 : 14,
    backgroundColor: chatColors.composerBar,
    borderTopWidth: 1,
    borderTopColor: chatColors.cardBorder,
  },
  emojiBtn: {
    width: 44,
    height: 46,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 132,
    borderRadius: 23,
    backgroundColor: chatColors.inputBg,
    borderWidth: 1,
    borderColor: chatColors.borderSoft,
    color: chatColors.textPrimary,
    fontSize: 14.5,
    fontWeight: '500',
    paddingHorizontal: 18,
    paddingTop: Platform.OS === 'ios' ? 13 : 10,
    paddingBottom: Platform.OS === 'ios' ? 13 : 10,
    // En web el input trae el anillo de foco del navegador (ámbar) que no
    // pertenece al diseño; el borde verde del propio campo ya indica el foco.
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  },
  // El foco se marca con el borde verde del propio campo, no con el anillo del
  // navegador: se ve igual en web y en nativo, y sigue sin depender del color
  // porque el cursor también entra en el campo.
  inputFocused: { borderColor: 'rgba(90,224,106,0.35)' },
  inputCommand: { borderColor: 'rgba(90,224,106,0.55)', color: chatColors.green },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOn: { backgroundColor: chatColors.green },
  sendBtnOff: { backgroundColor: chatColors.sendIdle },

  // Sin conexión — visible aunque el compositor tenga texto escrito (a
  // diferencia del placeholder, que desaparece apenas hay valor).
  offlineWrap: { paddingHorizontal: 14, paddingTop: 10 },
  offlineCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: chatColors.warnSoft,
    borderWidth: 1,
    borderColor: chatColors.warnBorder,
  },
  offlineText: { flex: 1, color: chatColors.warn, fontSize: 12, fontWeight: '700' },

  // Solo lectura
  readOnlyBar: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 14 : 18,
    backgroundColor: chatColors.composerBar,
    borderTopWidth: 1,
    borderTopColor: chatColors.cardBorder,
  },
  readOnlyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 14,
    borderRadius: 20,
    backgroundColor: chatColors.card,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.16)',
  },
  readOnlyTitle: { color: chatColors.textPrimary, fontSize: 13, fontWeight: '800' },
  readOnlyText: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.48)',
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '500',
  },

  // Comandos
  commandsWrap: { paddingHorizontal: 14 },
  commandsCard: {
    marginBottom: 10,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: chatColors.inputBg,
    borderWidth: 1,
    borderColor: 'rgba(90,224,106,0.28)',
  },
  commandsTitle: {
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 7,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1,
  },
  commandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  commandRowFirst: { backgroundColor: 'rgba(90,224,106,0.08)', borderTopWidth: 0 },
  commandName: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '800' },
  commandNameAccent: { color: chatColors.green },
  commandHint: {
    flex: 1,
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: '500',
  },
});
