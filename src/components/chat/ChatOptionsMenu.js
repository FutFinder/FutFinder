import React from 'react';
import { View, Text, Pressable, Modal, StyleSheet } from 'react-native';

import { chatColors } from '../../theme/colors';

/**
 * Menú de opciones de la conversación (los tres puntos de la cabecera).
 *
 * Las acciones las decide la pantalla, porque no son las mismas en un DM que
 * en un chat de club: del chat del club no se puede salir sin abandonar el
 * club, así que ahí solo se ofrece silenciar.
 *
 * Cada fila mide 48 px y las destructivas se marcan con color coral Y con el
 * icono, para no depender solo del color.
 */
export default function ChatOptionsMenu({ visible, items, onClose }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Cerrar el menú">
        <View />
      </Pressable>

      <View style={styles.sheet}>
        {items.map((item, i) => (
          <React.Fragment key={item.key}>
            {i > 0 && <View style={styles.divider} />}
            <Pressable
              onPress={() => {
                onClose?.();
                item.onPress?.();
              }}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
            >
              {item.icon}
              <Text style={[styles.label, item.destructive && styles.labelDanger]}>
                {item.label}
              </Text>
            </Pressable>
          </React.Fragment>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(5,6,5,0.62)' },
  sheet: {
    position: 'absolute',
    top: 96,
    right: 14,
    width: 244,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: chatColors.cardUnread,
    borderWidth: 1,
    borderColor: chatColors.border,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)' },
  label: { flex: 1, color: chatColors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  labelDanger: { color: chatColors.danger },
});
