import React from 'react';
import { View, Text, Pressable, Modal, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  fuentes as F,
} from '../../theme/colors';

/**
 * Bottom sheet del módulo Partidos.
 *
 * Un solo componente para filtros, selectores, confirmaciones y compartir:
 * scrim, grip, título, cierre, contenido scrolleable y pie fijo que respeta
 * la safe area inferior.
 */
export default function Sheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  maxHeightRatio = 0.86,
  scroll = true,
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Cerrar" />
        <View style={[styles.sheet, { maxHeight: `${maxHeightRatio * 100}%` }]}>
          <View style={styles.gripWrap}>
            <View style={styles.grip} />
          </View>

          {title ? (
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{title}</Text>
                {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
              </View>
              <Pressable
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel="Cerrar"
                style={({ pressed }) => [styles.close, pressed && { opacity: 0.7 }]}
              >
                <X color={C.textSoft} size={15} strokeWidth={2.6} />
              </Pressable>
            </View>
          ) : null}

          {scroll ? (
            <ScrollView
              style={{ flexShrink: 1 }}
              contentContainerStyle={styles.body}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>
          ) : (
            <View style={styles.body}>{children}</View>
          )}

          {footer ? (
            <View style={[styles.footer, { paddingBottom: 14 + Math.max(insets.bottom, 12) }]}>{footer}</View>
          ) : (
            <View style={{ height: Math.max(insets.bottom, 16) }} />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: C.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surfaceAlt,
    borderTopLeftRadius: R.hero,
    borderTopRightRadius: R.hero,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  gripWrap: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  grip: { width: 38, height: 4, borderRadius: 2, backgroundColor: C.grip },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  title: { fontSize: 17, fontFamily: F.bold, color: C.textPrimary },
  subtitle: { fontSize: 11.5, color: C.textGhost, marginTop: 2 },
  close: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: C.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: 18, paddingBottom: 6 },
  footer: {
    flexDirection: 'row',
    gap: 9,
    paddingHorizontal: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: C.hairline,
    backgroundColor: C.surfaceAlt,
  },
});
