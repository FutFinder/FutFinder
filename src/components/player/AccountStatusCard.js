import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ShieldCheck, AlertCircle, ChevronDown } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';

/**
 * "Estado de la cuenta": cabecera verde (buen estado) o coral (sanción activa),
 * dos contadores de asistencia y un detalle desplegable.
 *
 * En el perfil AJENO el detalle no se ofrece: las ausencias, los reportes
 * recibidos y el estado de apelaciones son información privada del dueño.
 * Solo se muestra la cabecera, que es lo público (si la cuenta está sancionada
 * o no).
 *
 * @param {boolean} suspended         Sanción activa.
 * @param {string|null} suspendedUntil ISO hasta cuándo.
 * @param {object} stats  { confirmados_historial, asistencias_confirmadas, ausencias_historial }
 * @param {number} reportesRecibidos  Conteo real (RPC count_reports_against).
 */
export default function AccountStatusCard({
  suspended,
  suspendedUntil,
  stats,
  reportesRecibidos = 0,
  isOwnProfile,
}) {
  const [abierto, setAbierto] = useState(false);

  const hasta = suspendedUntil ? fechaLegible(suspendedUntil) : null;
  const ausencias = stats?.ausencias_historial ?? 0;

  return (
    <View style={[styles.card, suspended && styles.cardSanction]}>
      <View style={[styles.header, suspended ? styles.headerSanction : styles.headerOk]}>
        <View style={[styles.headerIcon, suspended ? styles.iconSanction : styles.iconOk]}>
          {suspended ? (
            <AlertCircle color={dsColors.loss} size={18} strokeWidth={2} />
          ) : (
            <ShieldCheck color={dsColors.green} size={18} strokeWidth={2} />
          )}
        </View>
        <View style={styles.headerTexts}>
          <Text style={[styles.headerTitle, { color: suspended ? dsColors.loss : dsColors.green }]}>
            {suspended ? 'Sanción activa' : 'Cuenta en buen estado'}
          </Text>
          <Text style={styles.headerSub}>
            {suspended
              ? [
                  hasta ? `No puede inscribirse hasta el ${hasta}` : 'No puede inscribirse',
                  ausencias > 0
                    ? `${ausencias} ${ausencias === 1 ? 'ausencia' : 'ausencias'}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'Sin sanciones ni restricciones activas'}
          </Text>
        </View>
      </View>

      <View style={styles.counters}>
        <Counter
          value={stats?.confirmados_historial ?? 0}
          label="Confirmadas por ubicación"
          dim={(stats?.confirmados_historial ?? 0) === 0}
        />
        <Counter
          value={stats?.asistencias_confirmadas ?? 0}
          label="Confirmadas totales"
          dim={(stats?.asistencias_confirmadas ?? 0) === 0}
        />
      </View>

      {/* El detalle es privado: solo el dueño de la cuenta lo ve. */}
      {isOwnProfile && (
        <>
          {abierto && (
            <View style={styles.detail}>
              <Row label="Ausencias acumuladas" value={String(ausencias)} />
              <Row
                label="Sanciones activas"
                value={suspended ? '1' : '0'}
                danger={suspended}
              />
              <Row label="Reportes recibidos" value={String(reportesRecibidos)} />
              <Row label="Estado de apelaciones" value="Sin apelaciones" muted />
            </View>
          )}

          <Pressable
            onPress={() => setAbierto((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: abierto }}
            accessibilityLabel={
              abierto ? 'Ocultar detalle del estado de la cuenta' : 'Ver detalle del estado de la cuenta'
            }
            style={({ pressed }) => [styles.toggle, pressed && styles.togglePressed]}
          >
            <Text style={styles.toggleText}>{abierto ? 'Ocultar detalle' : 'Ver detalle'}</Text>
            <ChevronDown
              color={dsColors.green}
              size={14}
              strokeWidth={2.4}
              style={abierto ? styles.chevronUp : undefined}
            />
          </Pressable>
        </>
      )}
    </View>
  );
}

function Counter({ value, label, dim }) {
  return (
    <View style={styles.counter}>
      <Text style={[styles.counterValue, dim && styles.dim]}>{value}</Text>
      <Text style={styles.counterLabel}>{label}</Text>
    </View>
  );
}

function Row({ label, value, danger, muted }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text
        style={[
          styles.rowValue,
          danger && { color: dsColors.loss },
          muted && { color: 'rgba(255, 255, 255, 0.6)' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

/** '2026-08-12T…' → '12 ago'. */
function fechaLegible(iso) {
  try {
    return new Date(iso)
      .toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
      .replace('.', '');
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: dsSizes.gutter,
    backgroundColor: dsColors.surface,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    borderRadius: dsRadius.xl,
    overflow: 'hidden',
  },
  cardSanction: { borderColor: 'rgba(232, 115, 123, 0.28)' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 13,
    paddingVertical: 12,
  },
  headerOk: { backgroundColor: 'rgba(90, 224, 106, 0.08)' },
  headerSanction: { backgroundColor: 'rgba(232, 115, 123, 0.08)' },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: dsRadius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOk: { backgroundColor: 'rgba(90, 224, 106, 0.14)' },
  iconSanction: { backgroundColor: 'rgba(232, 115, 123, 0.14)' },
  headerTexts: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 13.5, fontWeight: '700' },
  headerSub: { color: 'rgba(255, 255, 255, 0.5)', fontSize: 11.5, marginTop: 2 },

  counters: { flexDirection: 'row', gap: 6, paddingHorizontal: 13, paddingTop: 12 },
  counter: {
    flex: 1,
    minWidth: 0,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  counterValue: { color: dsColors.textPrimary, fontSize: 18, fontWeight: '800', lineHeight: 20 },
  dim: { color: 'rgba(255, 255, 255, 0.5)' },
  counterLabel: { color: 'rgba(255, 255, 255, 0.5)', fontSize: 10.5, marginTop: 4 },

  detail: { paddingHorizontal: 13, paddingTop: 10 },
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

  toggle: {
    minHeight: 44,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: dsColors.divider,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  togglePressed: { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
  toggleText: { color: dsColors.green, fontSize: 13, fontWeight: '700' },
  chevronUp: { transform: [{ rotate: '180deg' }] },
});
