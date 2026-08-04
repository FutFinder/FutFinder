import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { FileText, ChevronDown } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';

/**
 * "Auditoría y soporte" — SOLO perfil propio.
 *
 * Estado real del backend: no existe moderación. Nadie revisa reportes, no hay
 * panel de soporte y no hay flujo de apelaciones (ver services/reports.js).
 * Por eso esta tarjeta es informativa y el botón "Apelar una decisión" está
 * DESHABILITADO a propósito, con la razón visible debajo: no hay decisiones
 * que apelar hasta que exista moderación.
 *
 * Cuando se implemente, este es el punto de entrada a conectar.
 *
 * @param {number} reportesRecibidos Conteo real de reportes en mi contra.
 */
export default function AuditSupportCard({ reportesRecibidos = 0 }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={() => setAbierto((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: abierto }}
        accessibilityLabel="Auditoría y soporte. Sin revisiones"
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <View style={styles.icon}>
          <FileText color="rgba(255, 255, 255, 0.6)" size={17} strokeWidth={1.9} />
        </View>
        <View style={styles.texts}>
          <Text style={styles.title}>Auditoría y soporte</Text>
          <Text style={styles.sub}>Sin revisiones · próxima auditoría automática</Text>
        </View>
        <ChevronDown
          color="rgba(255, 255, 255, 0.4)"
          size={15}
          strokeWidth={2.4}
          style={abierto ? styles.chevronUp : undefined}
        />
      </Pressable>

      {abierto && (
        <View style={styles.detail}>
          <Row label="Última revisión de soporte" value="Sin revisiones" muted />
          <Row label="Resultado" value="—" muted />
          <Row label="Próxima auditoría" value="Automática" muted />
          <Row label="Reportes en mi contra" value={String(reportesRecibidos)} muted />

          <View
            style={styles.disabledBtn}
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel="Apelar una decisión. No disponible: se activa solo si recibes un reporte o una sanción"
          >
            <Text style={styles.disabledText}>Apelar una decisión</Text>
          </View>
          <Text style={styles.disabledHint}>
            Se activa solo si recibes un reporte o una sanción sobre tu cuenta
          </Text>
        </View>
      )}
    </View>
  );
}

function Row({ label, value, muted }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, muted && { color: 'rgba(255, 255, 255, 0.6)' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: dsSizes.gutter,
    marginTop: 10,
    backgroundColor: dsColors.surface,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    borderRadius: dsRadius.xl,
    overflow: 'hidden',
  },
  header: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    padding: 13,
  },
  pressed: { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
  icon: {
    width: 36,
    height: 36,
    borderRadius: dsRadius.sm,
    backgroundColor: dsColors.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  texts: { flex: 1, minWidth: 0 },
  title: { color: dsColors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  sub: { color: 'rgba(255, 255, 255, 0.5)', fontSize: 11.5, marginTop: 2 },
  chevronUp: { transform: [{ rotate: '180deg' }] },

  detail: { paddingHorizontal: 13, paddingBottom: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: dsColors.divider,
  },
  rowLabel: { color: 'rgba(255, 255, 255, 0.72)', fontSize: 13, flexShrink: 1 },
  rowValue: { color: dsColors.textPrimary, fontSize: 13, fontWeight: '700' },

  disabledBtn: {
    minHeight: 44,
    marginTop: 8,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    borderRadius: dsRadius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledText: { color: 'rgba(255, 255, 255, 0.3)', fontSize: 13, fontWeight: '600' },
  disabledHint: {
    color: 'rgba(255, 255, 255, 0.35)',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
});
