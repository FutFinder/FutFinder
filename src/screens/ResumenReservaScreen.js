import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Info } from 'lucide-react-native';

import { reservas as C, reservasFonts as F } from '../theme/colors';
import { IconButton, Card, NoticeCard, StickyFooter, Button } from '../components/reservas/ui';
import { getComplejoById } from '../services/reservas';
import { formatCLP, SERVICE_FEE_CLP } from '../services/reservasRules';

/** Pantalla 8 del handoff `Reservas.dc.html`: resumen antes de pagar. */
export default function ResumenReservaScreen({ navigation, route }) {
  const { complejoId, canchaId, fechaLabel, horaInicio, horaFin, duracion } = route.params || {};
  const [complejo, setComplejo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getComplejoById(complejoId);
    setComplejo(data);
    setLoading(false);
  }, [complejoId]);

  useEffect(() => { load(); }, [load]);

  const proximamente = () => {
    setToast('El pago todavía no está disponible en esta versión — vuelve pronto.');
    setTimeout(() => setToast(null), 2600);
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator color={C.green} />
        </View>
      </SafeAreaView>
    );
  }

  const cancha = (complejo?.canchas || []).find((k) => k.id === canchaId) || null;
  const detalle = [
    { k: 'Cancha', v: cancha ? `${cancha.nombre} · ${cancha.tipo}` : '—' },
    { k: 'Fecha', v: fechaLabel },
    { k: 'Horario', v: `${horaInicio} – ${horaFin}` },
    { k: 'Duración', v: `${duracion} min` },
  ];

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <Text style={styles.headerTitle}>Resumen de la reserva</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.complejoRow}>
          <View style={styles.thumb} />
          <View style={{ flex: 1 }}>
            <Text style={styles.complejoNombre}>{complejo?.nombre}</Text>
            <Text style={styles.complejoDireccion} numberOfLines={1}>{complejo?.direccion}</Text>
          </View>
        </View>

        <Card style={{ paddingVertical: 6, paddingHorizontal: 16 }}>
          {detalle.map((d, i) => (
            <View key={d.k} style={[styles.detalleRow, i < detalle.length - 1 && styles.detalleDivider]}>
              <Text style={styles.detalleK}>{d.k}</Text>
              <Text style={styles.detalleV}>{d.v}</Text>
            </View>
          ))}
          <View style={styles.detalleRow}>
            <Text style={styles.detalleK}>Jugadores</Text>
            <Text style={styles.detalleV}>Hasta {cancha?.jugadoresHabitual ?? '—'}</Text>
          </View>
        </Card>

        <Card>
          <View style={styles.precioRow}>
            <Text style={styles.precioK}>Cancha · {duracion} min</Text>
            <Text style={styles.precioV}>{cancha ? formatCLP(cancha.base) : '—'}</Text>
          </View>
          <View style={[styles.precioRow, styles.precioDivider]}>
            <Text style={styles.precioK}>Cargo por servicio FutFinder</Text>
            <Text style={styles.precioV}>{formatCLP(SERVICE_FEE_CLP)}</Text>
          </View>
          <View style={styles.totalRow}>
            <Text style={styles.totalK}>Total a pagar</Text>
            <Text style={styles.totalV}>{cancha ? formatCLP(cancha.total) : '—'}</Text>
          </View>
          <Text style={styles.totalNota}>Precio final. Sin cargos adicionales al llegar al recinto.</Text>
        </Card>

        <NoticeCard tone="info" icon={Info}>
          La cancelación se rige por las políticas del complejo. Verás las condiciones antes de pagar.
        </NoticeCard>

        {toast ? <NoticeCard tone="info">{toast}</NoticeCard> : null}
      </ScrollView>

      <StickyFooter>
        <Button label="Continuar al pago" onPress={proximamente} />
      </StickyFooter>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, letterSpacing: -0.2 },

  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110, gap: 14 },

  complejoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 22, padding: 14,
  },
  thumb: { width: 64, height: 64, borderRadius: 16, flexShrink: 0, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border },
  complejoNombre: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 16 },
  complejoDireccion: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 4 },

  detalleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  detalleDivider: { borderBottomWidth: 1, borderBottomColor: C.dividerInner },
  detalleK: { fontFamily: F.medium, color: C.textSecondary, fontSize: 13 },
  detalleV: { fontFamily: F.bold, color: C.textPrimary, fontSize: 14 },

  precioRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  precioDivider: { paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.dividerInner, marginBottom: 2 },
  precioK: { fontFamily: F.medium, color: C.textSecondary, fontSize: 13 },
  precioV: { fontFamily: F.bold, color: C.textPrimary, fontSize: 14 },
  totalRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 16 },
  totalK: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 14 },
  totalV: { fontFamily: F.extraBold, color: C.green, fontSize: 28, letterSpacing: -0.6 },
  totalNota: { fontFamily: F.medium, color: C.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 12 },
});
