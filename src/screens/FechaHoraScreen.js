import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'lucide-react-native';

import { reservas as C, reservasFonts as F } from '../theme/colors';
import { IconButton, StickyFooter } from '../components/reservas/ui';
import { getComplejoById, getDisponibilidad } from '../services/reservas';
import { formatCLP, buildFechaOptions, fechaLabel, addMinutesToHora } from '../services/reservasRules';

const DURACIONES = [60, 90];

/** Pantalla 7 del handoff `Reservas.dc.html`: elegir fecha y horario. */
export default function FechaHoraScreen({ navigation, route }) {
  const { complejoId, canchaId } = route.params || {};
  const [complejo, setComplejo] = useState(null);
  const [horas, setHoras] = useState([]);
  const [loading, setLoading] = useState(true);

  const fechas = useMemo(() => buildFechaOptions(), []);
  const [fechaIdx, setFechaIdx] = useState(0);
  const [duracion, setDuracion] = useState(60);
  const [horaIdx, setHoraIdx] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: c }, { data: disp }] = await Promise.all([
      getComplejoById(complejoId),
      getDisponibilidad(canchaId, fechas[0].iso),
    ]);
    setComplejo(c);
    setHoras(disp?.horas || []);
    const primeraDisponible = (disp?.horas || []).findIndex((h) => h.disponible);
    setHoraIdx(primeraDisponible >= 0 ? primeraDisponible : null);
    setLoading(false);
  }, [complejoId, canchaId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  const cancha = (complejo?.canchas || []).find((k) => k.id === canchaId) || complejo?.canchas?.[0] || null;
  const dispCount = horas.filter((h) => h.disponible).length;
  const horaSel = horaIdx != null ? horas[horaIdx] : null;
  const horaFin = horaSel ? addMinutesToHora(horaSel.hora, duracion) : null;
  const fechaTxt = fechaLabel(fechas[fechaIdx]);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Fecha y horario</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{complejo?.nombre} · {cancha?.nombre}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionLabel}>FECHA</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9 }}>
          {fechas.map((f, i) => {
            const on = i === fechaIdx;
            return (
              <Pressable
                key={f.iso}
                onPress={() => setFechaIdx(i)}
                style={[styles.fechaPill, on && styles.fechaPillOn]}
              >
                <Text style={[styles.fechaDow, on && styles.fechaDowOn]}>{f.dow}</Text>
                <Text style={[styles.fechaNum, on && styles.fechaNumOn]}>{f.num}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.rowBetween}>
          <Text style={styles.sectionLabel}>HORARIOS DISPONIBLES</Text>
          <Text style={styles.dispCount}>{dispCount} de {horas.length} libres</Text>
        </View>

        <View style={styles.duracionRow}>
          {DURACIONES.map((d) => {
            const on = d === duracion;
            return (
              <Pressable
                key={d}
                onPress={() => setDuracion(d)}
                style={[styles.duracionPill, on && styles.duracionPillOn]}
              >
                <Text style={[styles.duracionText, on && styles.duracionTextOn]}>{d} min</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.slotsGrid}>
          {horas.map((h, i) => {
            const on = i === horaIdx;
            return (
              <Pressable
                key={h.hora}
                onPress={h.disponible ? () => setHoraIdx(i) : undefined}
                disabled={!h.disponible}
                style={[
                  styles.slot,
                  !h.disponible && styles.slotOcupado,
                  h.disponible && !on && styles.slotDisponible,
                  on && styles.slotOn,
                ]}
              >
                <Text style={[
                  styles.slotText,
                  !h.disponible && styles.slotTextOcupado,
                  on && styles.slotTextOn,
                ]}>
                  {h.hora}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.legendRow}>
          <Legend color={C.surface} border={C.border} label="Disponible" />
          <Legend color={C.green} label="Seleccionado" />
          <Legend color="#0E110E" border="#1C201D" label="Ocupado" />
        </View>
      </ScrollView>

      {horaSel ? (
        <StickyFooter>
          <View style={styles.footerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.resumenHora}>{horaSel.hora} – {horaFin}</Text>
              <Text style={styles.resumenFecha} numberOfLines={1}>
                {fechaTxt} · {cancha ? formatCLP(cancha.total) : ''}
              </Text>
            </View>
            <Pressable
              onPress={() => navigation.navigate('Resumen', {
                complejoId,
                canchaId: cancha?.id,
                fechaLabel: fechaTxt,
                horaInicio: horaSel.hora,
                horaFin,
                duracion,
              })}
              style={({ pressed }) => [styles.continuarBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.continuarText}>Continuar</Text>
            </Pressable>
          </View>
        </StickyFooter>
      ) : null}
    </SafeAreaView>
  );
}

function Legend({ color, border, label }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSwatch, { backgroundColor: color, borderColor: border || color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, letterSpacing: -0.2 },
  headerSubtitle: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 2 },

  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 120 },
  sectionLabel: { fontFamily: F.bold, fontSize: 11, letterSpacing: 1.5, color: C.textSecondary, marginBottom: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 28 },
  dispCount: { fontFamily: F.semiBold, color: C.textSecondary, fontSize: 12 },

  fechaPill: {
    width: 62, height: 76, borderRadius: 18, alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  fechaPillOn: { backgroundColor: C.green, borderColor: C.green },
  fechaDow: { fontFamily: F.extraBold, fontSize: 10, letterSpacing: 1, color: C.textSecondary },
  fechaDowOn: { color: 'rgba(6,19,10,0.7)' },
  fechaNum: { fontFamily: F.extraBold, fontSize: 19, color: C.textPrimary },
  fechaNumOn: { color: C.textOnGreen },

  duracionRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  duracionPill: {
    height: 30, paddingHorizontal: 11, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  duracionPillOn: { backgroundColor: C.shieldBg, borderColor: C.green },
  duracionText: { fontFamily: F.bold, fontSize: 11.5, color: C.textSecondary },
  duracionTextOn: { color: C.green },

  slotsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 16 },
  slot: {
    width: '31%', height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
  },
  slotDisponible: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  slotOcupado: { backgroundColor: '#0E110E', borderWidth: 1, borderColor: '#1C201D' },
  slotOn: {
    backgroundColor: C.green, borderWidth: 1, borderColor: C.green,
    shadowColor: C.green, shadowOpacity: 0.28, shadowRadius: 10, elevation: 3,
  },
  slotText: { fontFamily: F.bold, fontSize: 15, color: C.textPrimary },
  slotTextOcupado: { color: '#454A46', textDecorationLine: 'line-through' },
  slotTextOn: { fontFamily: F.extraBold, color: C.textOnGreen },

  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  legendSwatch: { width: 10, height: 10, borderRadius: 3, borderWidth: 1 },
  legendText: { fontFamily: F.semiBold, color: C.textSecondary, fontSize: 11.5 },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  resumenHora: { fontFamily: F.bold, color: C.textPrimary, fontSize: 13 },
  resumenFecha: { fontFamily: F.medium, color: C.textSecondary, fontSize: 11.5, marginTop: 3 },
  continuarBtn: {
    height: 54, paddingHorizontal: 26, borderRadius: 17, backgroundColor: C.green,
    alignItems: 'center', justifyContent: 'center',
  },
  continuarText: { fontFamily: F.extraBold, color: C.textOnGreen, fontSize: 16 },
});
