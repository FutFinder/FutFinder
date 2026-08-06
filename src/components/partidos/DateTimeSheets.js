import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';

import Sheet from './Sheet';
import { GhostButton, PrimaryButton } from './ui';
import { partidos as P, partidosRadius as R } from '../../theme/colors';

/**
 * Selectores de fecha y hora propios, sin dependencias nuevas.
 *
 * El proyecto no trae `@react-native-community/datetimepicker`, así que en vez
 * de agregar una dependencia (y dos comportamientos distintos entre web y
 * nativo) el diseño se resuelve con lo que ya hay: una lista de los próximos
 * 60 días y una rejilla de horas en bloques de 30 min.
 *
 * Las fechas pasadas no se ofrecen — quedan bloqueadas por construcción, que
 * es lo que pide el handoff.
 */

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** «Jueves 6 de agosto» */
export function formatFechaLarga(date) {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' });
}

/** «Jue 6 ago» */
export function formatFechaCorta(date) {
  if (!date) return '';
  const d = new Date(date);
  return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`;
}

/** Etiqueta relativa: Hoy / Mañana / Jue 6 ago */
export function formatFechaRelativa(date) {
  if (!date) return '';
  const d = new Date(date);
  const today = startOfDay(new Date());
  const target = startOfDay(d);
  const diff = Math.round((target - today) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Mañana';
  return formatFechaCorta(d);
}

export function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Próximo día de la semana pedido (0=dom … 6=sáb), hoy incluido. */
export function nextWeekday(weekday) {
  const now = startOfDay(new Date());
  const delta = (weekday - now.getDay() + 7) % 7;
  const d = new Date(now);
  d.setDate(d.getDate() + delta);
  return d;
}

export function DateSheet({ visible, onClose, value, onSelect, days = 60 }) {
  const [temp, setTemp] = useState(value || startOfDay(new Date()));
  React.useEffect(() => {
    if (visible) setTemp(value || startOfDay(new Date()));
  }, [visible, value]);

  const options = useMemo(() => {
    const base = startOfDay(new Date());
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(base);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [days]);

  const sameDay = (a, b) =>
    a && b && startOfDay(new Date(a)).getTime() === startOfDay(new Date(b)).getTime();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Fecha del partido"
      subtitle="Las fechas pasadas no se pueden elegir"
      maxHeightRatio={0.8}
      footer={
        <>
          <GhostButton label="Cancelar" onPress={onClose} height={46} style={{ flex: 1 }} />
          <PrimaryButton
            label="Aplicar"
            height={46}
            style={{ flex: 1.4 }}
            onPress={() => {
              onSelect(temp);
              onClose();
            }}
          />
        </>
      }
    >
      {options.map((d, i) => {
        const on = sameDay(temp, d);
        return (
          <Pressable
            key={d.toISOString()}
            onPress={() => setTemp(d)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
          >
            <Text style={[styles.rowText, on && styles.rowTextOn]}>
              {i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : capitalize(formatFechaLarga(d))}
            </Text>
            {i > 1 ? <Text style={styles.rowMeta}>{formatFechaCorta(d)}</Text> : null}
            {on ? <View style={styles.dot} /> : null}
          </Pressable>
        );
      })}
    </Sheet>
  );
}

export function TimeSheet({ visible, onClose, value, onSelect, minDate = null }) {
  const [temp, setTemp] = useState(value || '20:00');
  React.useEffect(() => {
    if (visible) setTemp(value || '20:00');
  }, [visible, value]);

  // Bloques de 30 min de 06:00 a 23:30.
  const slots = useMemo(() => {
    const out = [];
    for (let h = 6; h <= 23; h++) {
      out.push(`${String(h).padStart(2, '0')}:00`);
      out.push(`${String(h).padStart(2, '0')}:30`);
    }
    return out;
  }, []);

  // Si el día elegido es hoy, las horas ya pasadas quedan deshabilitadas.
  const isToday =
    minDate && startOfDay(new Date(minDate)).getTime() === startOfDay(new Date()).getTime();
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Hora del partido"
      maxHeightRatio={0.72}
      footer={
        <>
          <GhostButton label="Cancelar" onPress={onClose} height={46} style={{ flex: 1 }} />
          <PrimaryButton
            label="Aplicar"
            height={46}
            style={{ flex: 1.4 }}
            onPress={() => {
              onSelect(temp);
              onClose();
            }}
          />
        </>
      }
    >
      <View style={styles.grid}>
        {slots.map((t) => {
          const [hh, mi] = t.split(':').map(Number);
          const past = isToday && hh * 60 + mi <= nowMinutes;
          const on = temp === t;
          return (
            <Pressable
              key={t}
              onPress={past ? undefined : () => setTemp(t)}
              disabled={past}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: past }}
              style={({ pressed }) => [
                styles.slot,
                on && styles.slotOn,
                past && styles.slotPast,
                pressed && !past && { opacity: 0.8 },
              ]}
            >
              <Text style={[styles.slotText, on && { color: P.text }, past && { color: '#434A44' }]}>
                {t}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 12.5,
    paddingHorizontal: 2,
    borderBottomWidth: 1,
    borderBottomColor: P.divider,
  },
  rowText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: P.textStrong },
  rowTextOn: { color: P.green, fontWeight: '700' },
  rowMeta: { fontSize: 11.5, color: P.textFaint },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: P.green },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingBottom: 8 },
  slot: {
    width: '22.6%',
    height: 44,
    borderRadius: R.control,
    backgroundColor: P.chipAlt,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotOn: { backgroundColor: P.greenSoftStrong, borderColor: P.greenBorder },
  slotPast: { backgroundColor: P.surfaceAlt, borderColor: P.divider },
  slotText: { fontSize: 12.5, fontWeight: '700', color: '#8D958D' },
});
