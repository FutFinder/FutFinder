import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

import { Sheet, Chip, Button } from './ui';
import { reservas as C, reservasFonts as F } from '../../theme/colors';

const COMUNAS = ['Cerca de mí', 'Ñuñoa', 'Providencia', 'Maipú', 'Santiago Centro'];
const TIPOS = ['Todas', 'Fútbol 5', 'Fútbol 7', 'Fútbol 11'];
const FRANJAS = ['Mañana', 'Tarde', 'Noche'];

/**
 * Hoja de filtros de la pantalla «Reservas» (pantalla 3 del handoff).
 *
 * El rango de precio es decorativo a propósito — así está en el prototipo
 * original (`Reservas.dc.html`): los handles del slider están fijos en el
 * CSS, no ligados a ningún estado. No es un recorte propio: se deja igual
 * de no-interactivo hasta que se diseñe un slider real.
 */
export default function FiltrosSheet({
  visible,
  onClose,
  comuna,
  onComuna,
  tipo,
  onTipo,
  franja,
  onFranja,
  onLimpiar,
  resultCount,
}) {
  return (
    <Sheet visible={visible} onClose={onClose} title="Filtros">
      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
        <Section label="Ubicación">
          <ChipRow options={COMUNAS} value={comuna} onChange={onComuna} />
        </Section>
        <Section label="Tipo de cancha">
          <ChipRow options={TIPOS} value={tipo} onChange={onTipo} />
        </Section>
        <Section label="Horario">
          <ChipRow options={FRANJAS} value={franja} onChange={onFranja} />
        </Section>
        <Section label="Precio por hora">
          <Text style={styles.priceLabel}>$20.000 – $40.000</Text>
          <View style={styles.slider}>
            <View style={styles.sliderTrack} />
            <View style={[styles.sliderFill, { left: '12%', right: '26%' }]} />
            <View style={[styles.sliderHandle, { left: '12%' }]} />
            <View style={[styles.sliderHandle, { left: '74%' }]} />
          </View>
        </Section>
      </ScrollView>

      <View style={styles.footer}>
        <Text onPress={onLimpiar} style={styles.limpiar}>
          Limpiar
        </Text>
        <View style={{ flex: 1 }}>
          <Button label={`Ver ${resultCount} complejos`} onPress={onClose} />
        </View>
      </View>
    </Sheet>
  );
}

function Section({ label, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function ChipRow({ options, value, onChange }) {
  return (
    <View style={styles.chipRow}>
      {options.map((opt) => (
        <Chip key={opt} label={opt} active={value === opt} onPress={() => onChange(opt)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 22 },
  sectionLabel: {
    fontFamily: F.bold,
    fontSize: 10.5,
    letterSpacing: 1.5,
    color: C.textSecondary,
    marginBottom: 10,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  priceLabel: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary, marginBottom: 14 },
  slider: { height: 4, justifyContent: 'center' },
  sliderTrack: { height: 4, borderRadius: 2, backgroundColor: C.surfaceAlt },
  sliderFill: { position: 'absolute', height: 4, borderRadius: 2, backgroundColor: C.green },
  sliderHandle: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.green,
    marginLeft: -9,
    borderWidth: 3,
    borderColor: C.bg,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginTop: 6,
  },
  limpiar: {
    fontFamily: F.bold,
    fontSize: 14,
    color: C.textSecondary,
  },
});
