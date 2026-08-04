import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Flag, Check, ArrowLeft } from 'lucide-react-native';

import { dsColors, dsRadius, dsSizes } from '../../theme/colors';
import { MOTIVOS_REPORTE } from '../../services/reports';

const MAX_DESC = 600;

/**
 * Hoja inferior para reportar a otro jugador.
 *
 * Flujo en dos pasos, para que nunca se envíe un reporte de un solo toque:
 *   1. 'form'    → elegir motivo + descripción opcional
 *   2. 'confirm' → resumen y confirmación explícita
 *
 * El resultado (éxito/error) lo comunica la pantalla con el Banner, que es el
 * patrón de feedback de la app. Esta hoja solo informa hacia arriba vía
 * `onSubmit`, que debe devolver `{ error }`.
 *
 * @param {string} username        A quién se reporta (solo para mostrar).
 * @param {Function} onSubmit      async ({ motivo, descripcion }) => { error }
 */
export default function ReportPlayerSheet({ visible, username, onClose, onSubmit }) {
  const [paso, setPaso] = useState('form');
  const [motivo, setMotivo] = useState(null);
  const [descripcion, setDescripcion] = useState('');
  const [enviando, setEnviando] = useState(false);

  const motivoLabel = MOTIVOS_REPORTE.find((m) => m.value === motivo)?.label || '';

  const cerrar = () => {
    if (enviando) return;
    setPaso('form');
    setMotivo(null);
    setDescripcion('');
    onClose?.();
  };

  const enviar = async () => {
    setEnviando(true);
    const { error } = (await onSubmit?.({ motivo, descripcion })) || {};
    setEnviando(false);
    // La pantalla muestra el resultado; aquí solo cerramos si salió bien.
    if (!error) {
      setPaso('form');
      setMotivo(null);
      setDescripcion('');
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={cerrar}
    >
      <Pressable style={styles.backdrop} onPress={cerrar}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />

          {paso === 'form' ? (
            <>
              <View style={styles.titleRow}>
                <Flag color={dsColors.loss} size={18} strokeWidth={2} />
                <Text style={styles.title}>Reportar esta cuenta</Text>
              </View>
              <Text style={styles.subtitle} numberOfLines={2}>
                Cuéntanos qué ocurre con @{username}. Tu reporte es anónimo para esa persona.
              </Text>

              <ScrollView
                style={styles.reasons}
                contentContainerStyle={styles.reasonsContent}
                keyboardShouldPersistTaps="handled"
              >
                {MOTIVOS_REPORTE.map((m) => {
                  const activo = motivo === m.value;
                  return (
                    <Pressable
                      key={m.value}
                      onPress={() => setMotivo(m.value)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: activo }}
                      accessibilityLabel={`Motivo: ${m.label}`}
                      style={({ pressed }) => [
                        styles.reason,
                        activo && styles.reasonActive,
                        pressed && { opacity: 0.8 },
                      ]}
                    >
                      <Text style={[styles.reasonText, activo && styles.reasonTextActive]}>
                        {m.label}
                      </Text>
                      {activo && <Check color={dsColors.green} size={16} strokeWidth={2.6} />}
                    </Pressable>
                  );
                })}

                <Text style={styles.descLabel}>Descripción (opcional)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Cuenta brevemente qué pasó…"
                  placeholderTextColor={dsColors.textMuted}
                  value={descripcion}
                  onChangeText={setDescripcion}
                  multiline
                  maxLength={MAX_DESC}
                  accessibilityLabel="Descripción del reporte, opcional"
                />
                <Text style={styles.counter}>
                  {descripcion.length} / {MAX_DESC}
                </Text>
              </ScrollView>

              <Pressable
                onPress={() => setPaso('confirm')}
                disabled={!motivo}
                accessibilityRole="button"
                accessibilityLabel="Continuar al resumen del reporte"
                style={({ pressed }) => [
                  styles.primary,
                  !motivo && styles.disabled,
                  pressed && motivo && { opacity: 0.85 },
                ]}
              >
                <Text style={styles.primaryText}>Continuar</Text>
              </Pressable>
              <Pressable
                onPress={cerrar}
                accessibilityRole="button"
                accessibilityLabel="Cancelar el reporte"
                style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.secondaryText}>Cancelar</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View style={styles.titleRow}>
                <Pressable
                  onPress={() => !enviando && setPaso('form')}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Volver a editar el reporte"
                >
                  <ArrowLeft color={dsColors.textPrimary} size={18} strokeWidth={2.2} />
                </Pressable>
                <Text style={styles.title}>¿Enviar el reporte?</Text>
              </View>

              <View style={styles.summary}>
                <SummaryRow label="Cuenta" value={`@${username}`} />
                <SummaryRow label="Motivo" value={motivoLabel} />
                {descripcion.trim() ? (
                  <SummaryRow label="Descripción" value={descripcion.trim()} multiline />
                ) : null}
              </View>

              <Text style={styles.warning}>
                El equipo de FutFinder revisará el reporte. No se avisa a la persona reportada
                quién lo envió.
              </Text>

              <Pressable
                onPress={enviar}
                disabled={enviando}
                accessibilityRole="button"
                accessibilityLabel="Confirmar y enviar el reporte"
                style={({ pressed }) => [
                  styles.danger,
                  enviando && styles.disabled,
                  pressed && !enviando && { opacity: 0.85 },
                ]}
              >
                {enviando ? (
                  <ActivityIndicator color={dsColors.loss} />
                ) : (
                  <Text style={styles.dangerText}>Enviar reporte</Text>
                )}
              </Pressable>
              <Pressable
                onPress={cerrar}
                disabled={enviando}
                accessibilityRole="button"
                accessibilityLabel="Cancelar el reporte"
                style={({ pressed }) => [styles.secondary, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.secondaryText}>Cancelar</Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SummaryRow({ label, value, multiline }) {
  return (
    <View style={[styles.sumRow, multiline && styles.sumRowColumn]}>
      <Text style={styles.sumLabel}>{label}</Text>
      <Text style={[styles.sumValue, multiline && styles.sumValueBlock]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: dsColors.surface,
    borderTopLeftRadius: dsRadius.sheet,
    borderTopRightRadius: dsRadius.sheet,
    borderTopWidth: 1,
    borderColor: dsColors.border,
    paddingHorizontal: dsSizes.gutter,
    paddingTop: 14,
    paddingBottom: 30,
    maxHeight: '88%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'center',
    marginBottom: 14,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  title: {
    color: dsColors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    flexShrink: 1,
  },
  subtitle: { color: dsColors.textSecondary, fontSize: 12.5, marginTop: 6, lineHeight: 18 },

  reasons: { marginTop: 14 },
  reasonsContent: { gap: 6, paddingBottom: 4 },
  reason: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 13,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    backgroundColor: dsColors.chip,
  },
  reasonActive: {
    borderColor: 'rgba(90, 224, 106, 0.4)',
    backgroundColor: 'rgba(90, 224, 106, 0.10)',
  },
  reasonText: { color: dsColors.textPrimary, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },
  reasonTextActive: { color: dsColors.green, fontWeight: '700' },

  descLabel: {
    color: dsColors.textSecondary,
    fontSize: 12.5,
    fontWeight: '700',
    marginTop: 10,
  },
  input: {
    minHeight: 88,
    marginTop: 6,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    backgroundColor: dsColors.surfaceAlt,
    color: dsColors.textPrimary,
    fontSize: 13.5,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    textAlignVertical: 'top',
  },
  counter: { color: dsColors.textMuted, fontSize: 11, marginTop: 4, textAlign: 'right' },

  summary: {
    marginTop: 14,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: dsColors.borderSoft,
    backgroundColor: dsColors.surfaceAlt,
    paddingHorizontal: 13,
    paddingVertical: 4,
  },
  sumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
  },
  sumRowColumn: { flexDirection: 'column', alignItems: 'flex-start', gap: 4 },
  sumLabel: { color: dsColors.textMuted, fontSize: 12 },
  sumValue: {
    color: dsColors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
    textAlign: 'right',
  },
  sumValueBlock: { textAlign: 'left', fontWeight: '400', lineHeight: 18 },
  warning: {
    color: dsColors.textMuted,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 10,
  },

  primary: {
    minHeight: 52,
    marginTop: 14,
    borderRadius: dsRadius.md,
    backgroundColor: dsColors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: dsColors.greenInk, fontSize: 15, fontWeight: '800' },
  danger: {
    minHeight: 52,
    marginTop: 14,
    borderRadius: dsRadius.md,
    borderWidth: 1,
    borderColor: 'rgba(232, 115, 123, 0.35)',
    backgroundColor: 'rgba(232, 115, 123, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: { color: dsColors.loss, fontSize: 15, fontWeight: '700' },
  secondary: {
    minHeight: 46,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: dsColors.textSecondary, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});
