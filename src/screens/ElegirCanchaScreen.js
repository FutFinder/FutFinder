import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check, AlertTriangle } from 'lucide-react-native';

import { reservas as C, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, StickyFooter, NoticeCard } from '../components/reservas/ui';
import NotificationBell from '../components/NotificationBell';
import { getComplejoById } from '../services/reservas';
import { formatCLP } from '../services/reservasRules';

/** Pantalla 6 del handoff `Reservas.dc.html`: elegir cancha dentro del complejo. */
export default function ElegirCanchaScreen({ navigation, route }) {
  const { complejoId, canchaId } = route.params || {};
  const [complejo, setComplejo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(canchaId || null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getComplejoById(complejoId);
    setComplejo(data);
    if (data?.canchas?.length) {
      setSelectedId((prev) => (prev && data.canchas.some((k) => k.id === prev) ? prev : data.canchas[0].id));
    }
    setLoading(false);
  }, [complejoId]);

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

  const canchas = complejo?.canchas || [];
  const selected = canchas.find((k) => k.id === selectedId) || null;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Elegir cancha</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>{complejo?.nombre}</Text>
        </View>
        <NotificationBell />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {canchas.length === 0 ? (
          <View style={{ marginTop: 12 }}>
            <NoticeCard tone="info" icon={AlertTriangle}>
              Este complejo todavía no tiene canchas cargadas.
            </NoticeCard>
          </View>
        ) : (
          <View style={{ gap: 13 }}>
            {canchas.map((k) => {
              const on = k.id === selectedId;
              return (
                <Card key={k.id} selected={on} onPress={() => setSelectedId(k.id)} style={styles.canchaCard}>
                  <View style={styles.canchaRow}>
                    <View style={styles.thumb} />
                    <View style={{ flex: 1 }}>
                      <View style={styles.nombreRow}>
                        <Text style={styles.nombre}>{k.nombre}</Text>
                        <View style={[styles.tipoBadge, on && styles.tipoBadgeOn]}>
                          <Text style={[styles.tipoBadgeText, on && styles.tipoBadgeTextOn]}>{k.tipo}</Text>
                        </View>
                      </View>
                      <Text style={styles.nota} numberOfLines={1}>{k.nota}</Text>
                      <Text style={styles.precio}>
                        {formatCLP(k.total)}<Text style={styles.precioSub}> / hora</Text>
                      </Text>
                    </View>
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on ? <Check color={C.textOnGreen} size={15} strokeWidth={2.8} /> : null}
                    </View>
                  </View>
                </Card>
              );
            })}
            <Text style={styles.hint}>
              Los precios pueden variar según el horario. La disponibilidad se muestra en el paso siguiente.
            </Text>
          </View>
        )}
      </ScrollView>

      {selected ? (
        <StickyFooter>
          <Button
            label={`Ver horarios de ${selected.nombre}`}
            onPress={() => navigation.navigate('FechaHora', { complejoId, canchaId: selected.id })}
          />
        </StickyFooter>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, letterSpacing: -0.2 },
  headerSubtitle: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 2 },

  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110 },

  canchaCard: { padding: 14 },
  canchaRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  thumb: { width: 84, height: 84, borderRadius: 18, flexShrink: 0, backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border },
  nombreRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nombre: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, flexShrink: 1 },
  tipoBadge: { height: 24, paddingHorizontal: 9, borderRadius: 999, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  tipoBadgeOn: { backgroundColor: C.shieldBg },
  tipoBadgeText: { fontFamily: F.bold, color: C.textSecondary, fontSize: 10.5 },
  tipoBadgeTextOn: { color: C.green },
  nota: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12.5, marginTop: 5 },
  precio: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 16, marginTop: 8 },
  precioSub: { fontFamily: F.semiBold, color: C.textSecondary, fontSize: 12 },
  check: {
    width: 26, height: 26, borderRadius: 999, flexShrink: 0, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#2E3430',
  },
  checkOn: { borderWidth: 0, backgroundColor: C.green },

  hint: { fontFamily: F.medium, color: C.textMuted, fontSize: 12, lineHeight: 17, paddingHorizontal: 2, marginTop: 4 },
});
