import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { MapPin } from 'lucide-react-native';

import Sheet from './Sheet';
import PickerSheet from './PickerSheet';
import { GhostButton, PrimaryButton, OptionChip, SectionLabel, Note, ErrorHint, SelectField } from './ui';
import { partidos as P, partidosRadius as R } from '../../theme/colors';
import { DIST_OPTS, EDAD_PRESETS, MODALIDADES, NIVELES } from '../../services/matchRules';
import { REGIONES, getComunasOfRegion } from '../../data/regiones-chile';

/**
 * Hoja de filtros del listado de Partidos (variante 1d del handoff).
 *
 * Trabaja sobre una copia del filtro (`temp`): nada se aplica al listado hasta
 * que el usuario toca «Mostrar resultados», y «Limpiar» vuelve al filtro
 * neutro sin cerrar la hoja.
 *
 * `previewCount` lo calcula la pantalla con el filtro temporal, así que el
 * botón muestra el número real de partidos que va a mostrar.
 */

export const FECHA_OPTS = [
  { label: 'Cualquier día', value: 'todos' },
  { label: 'Hoy', value: 'hoy' },
  { label: 'Mañana', value: 'manana' },
  { label: 'Fin de semana', value: 'finde' },
];

export const CUOTA_OPTS = [
  { label: 'Cualquiera', value: null },
  { label: 'Gratis', value: { min: 0, max: 0 } },
  { label: 'Hasta $5.000', value: { min: 0, max: 5000 } },
];

export const DISP_OPTS = [
  { label: 'Todos', value: 'todos' },
  { label: 'Con cupos', value: 'con_cupos' },
];

/** Filtro neutro. La pantalla lo usa como estado inicial y como «Limpiar». */
export const EMPTY_FILTERS = {
  region: null,
  comuna: null,
  maxKm: null,
  fecha: 'todos',
  modalidad: null,
  nivel: null,
  edadPreset: 0,
  edadMin: '',
  edadMax: '',
  cuota: null,
  disponibilidad: 'todos',
};

export function countActiveFilters(f) {
  let n = 0;
  if (f.region) n++;
  if (f.comuna) n++;
  if (f.maxKm != null) n++;
  if (f.fecha !== 'todos') n++;
  if (f.modalidad) n++;
  if (f.nivel) n++;
  if (f.edadPreset !== 0) n++;
  if (f.cuota) n++;
  if (f.disponibilidad !== 'todos') n++;
  return n;
}

export default function FiltersSheet({ visible, onClose, filters, onApply, previewCount }) {
  const [temp, setTemp] = useState(filters);
  const [picker, setPicker] = useState(null); // 'region' | 'comuna'

  React.useEffect(() => {
    if (visible) setTemp(filters);
  }, [visible, filters]);

  const set = (patch) => setTemp((t) => ({ ...t, ...patch }));

  const comunas = temp.region ? getComunasOfRegion(temp.region) : [];
  const customOn = temp.edadPreset === -1;
  const edadMin = temp.edadMin === '' ? null : Number(temp.edadMin);
  const edadMax = temp.edadMax === '' ? null : Number(temp.edadMax);
  const edadBad =
    customOn && edadMin != null && edadMax != null && edadMin >= edadMax;

  const count = typeof previewCount === 'function' ? previewCount(temp) : null;

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        title="Filtros"
        maxHeightRatio={0.92}
        footer={
          <>
            <GhostButton
              label="Limpiar"
              height={48}
              style={{ flex: 1 }}
              onPress={() => setTemp(EMPTY_FILTERS)}
            />
            <PrimaryButton
              label={count == null ? 'Mostrar resultados' : `Mostrar ${count} ${count === 1 ? 'partido' : 'partidos'}`}
              height={48}
              style={{ flex: 1.6 }}
              disabled={edadBad}
              onPress={() => {
                onApply(temp);
                onClose();
              }}
            />
          </>
        }
      >
        {/* Ubicación */}
        <Group label="Ubicación">
          <SelectField
            icon={MapPin}
            value={temp.region ? shorten(temp.region) : null}
            placeholder="Cualquier región"
            onPress={() => setPicker('region')}
          />
          <SelectField
            value={temp.comuna}
            placeholder={temp.region ? 'Cualquier comuna' : 'Elige una región primero'}
            onPress={() => temp.region && setPicker('comuna')}
          />
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>Distancia máxima</Text>
            <Text style={styles.rowValue}>
              {DIST_OPTS.find((d) => d.value === temp.maxKm)?.label || 'Cualquiera'}
            </Text>
          </View>
          <View style={styles.row}>
            {DIST_OPTS.map((d) => (
              <OptionChip
                key={String(d.value)}
                label={d.label}
                flex
                height={38}
                active={temp.maxKm === d.value}
                onPress={() => set({ maxKm: d.value })}
              />
            ))}
          </View>
          <Note>
            La distancia se calcula en tu dispositivo. Nunca compartimos tu ubicación
            con otros usuarios.
          </Note>
        </Group>

        {/* Fecha */}
        <Group label="Fecha">
          <View style={styles.wrap}>
            {FECHA_OPTS.map((o) => (
              <OptionChip
                key={o.value}
                label={o.label}
                active={temp.fecha === o.value}
                onPress={() => set({ fecha: o.value })}
              />
            ))}
          </View>
        </Group>

        {/* Modalidad */}
        <Group label="Modalidad">
          <View style={styles.row}>
            <OptionChip label="Todas" flex active={temp.modalidad == null} onPress={() => set({ modalidad: null })} />
            {MODALIDADES.map((m) => (
              <OptionChip
                key={m.value}
                label={m.label}
                flex
                active={temp.modalidad === m.value}
                onPress={() => set({ modalidad: m.value })}
              />
            ))}
          </View>
        </Group>

        {/* Nivel */}
        <Group label="Nivel">
          <View style={styles.wrap}>
            <OptionChip label="Todos" active={temp.nivel == null} onPress={() => set({ nivel: null })} />
            {NIVELES.map((n) => (
              <OptionChip
                key={n.value}
                label={n.label}
                active={temp.nivel === n.value}
                onPress={() => set({ nivel: n.value })}
              />
            ))}
          </View>
        </Group>

        {/* Rango de edad */}
        <Group label="Rango de edad">
          <View style={styles.wrap}>
            {EDAD_PRESETS.map((p, i) => (
              <OptionChip
                key={p.label}
                label={p.label}
                active={temp.edadPreset === i}
                onPress={() => set({ edadPreset: i })}
              />
            ))}
            <OptionChip
              label="Personalizado"
              active={customOn}
              onPress={() => set({ edadPreset: -1 })}
            />
          </View>
          {customOn ? (
            <View style={styles.edadBox}>
              <TextInput
                value={String(temp.edadMin ?? '')}
                onChangeText={(v) => set({ edadMin: v.replace(/\D/g, '').slice(0, 2) })}
                placeholder="17"
                placeholderTextColor={P.textPlaceholder}
                keyboardType="number-pad"
                style={styles.edadInput}
              />
              <Text style={styles.edadDash}>–</Text>
              <TextInput
                value={String(temp.edadMax ?? '')}
                onChangeText={(v) => set({ edadMax: v.replace(/\D/g, '').slice(0, 2) })}
                placeholder="26"
                placeholderTextColor={P.textPlaceholder}
                keyboardType="number-pad"
                style={styles.edadInput}
              />
              <Text style={styles.edadUnit}>años</Text>
            </View>
          ) : null}
          {edadBad ? <ErrorHint>La edad mínima debe ser menor que la máxima</ErrorHint> : null}
          <Note>
            Incluye los partidos sin restricción de edad. «Personalizado» acepta el
            rango exacto, por ejemplo 17–26.
          </Note>
        </Group>

        {/* Cuota */}
        <Group label="Cuota">
          <View style={styles.row}>
            {CUOTA_OPTS.map((o) => (
              <OptionChip
                key={o.label}
                label={o.label}
                flex
                active={JSON.stringify(temp.cuota) === JSON.stringify(o.value)}
                onPress={() => set({ cuota: o.value })}
              />
            ))}
          </View>
        </Group>

        {/* Disponibilidad */}
        <Group label="Disponibilidad">
          <View style={styles.row}>
            {DISP_OPTS.map((o) => (
              <OptionChip
                key={o.value}
                label={o.label}
                flex
                active={temp.disponibilidad === o.value}
                onPress={() => set({ disponibilidad: o.value })}
              />
            ))}
          </View>
        </Group>
      </Sheet>

      <PickerSheet
        visible={picker === 'region'}
        onClose={() => setPicker(null)}
        title="Región"
        options={REGIONES.map((r) => ({ value: r.nombre, label: r.nombre }))}
        value={temp.region}
        searchPlaceholder="Buscar región…"
        allowClear
        clearLabel="Cualquier región"
        onSelect={(v) => set({ region: v, comuna: null })}
      />
      <PickerSheet
        visible={picker === 'comuna'}
        onClose={() => setPicker(null)}
        title="Comuna"
        subtitle={temp.region ? `${comunas.length} en ${shorten(temp.region)}` : ''}
        options={comunas}
        value={temp.comuna}
        searchPlaceholder="Buscar comuna…"
        allowClear
        clearLabel="Cualquier comuna"
        onSelect={(v) => set({ comuna: v })}
      />
    </>
  );
}

function Group({ label, children }) {
  return (
    <View style={{ gap: 9, marginBottom: 18 }}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </View>
  );
}

export function shorten(region) {
  if (!region) return '';
  return region
    .replace(/^Región\s+(de\s+|del\s+)?/i, '')
    .replace(/\s+de Santiago$/i, '');
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    marginTop: 2,
  },
  rowLabel: { fontSize: 12, color: P.textFaint },
  rowValue: { fontSize: 12.5, fontWeight: '700', color: P.green },
  edadBox: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: P.chipAlt,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  edadInput: {
    width: 34,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: P.text,
    ...({ outlineStyle: 'none' }),
  },
  edadDash: { fontSize: 12, fontWeight: '600', color: P.textPlaceholder },
  edadUnit: { fontSize: 11, color: P.textGhost },
});
