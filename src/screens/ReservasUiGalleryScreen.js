import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronRight, MapPin, Star } from 'lucide-react-native';

import {
  Card,
  Button,
  IconButton,
  Chip,
  Badge,
  ListRow,
  SectionLabel,
  Sheet,
  Stepper,
  NoticeCard,
  StickyFooter,
} from '../components/reservas/ui';
import { reservas as C, reservasFonts as F } from '../theme/colors';

/**
 * Pantalla interna de QA — NO es parte del producto.
 *
 * Valida las primitivas de `src/components/reservas/ui.js` (Fase 1 del
 * handoff de Reservas) contra sus tokens antes de construir las 33
 * pantallas reales sobre ellas. Sin guard de sesión a propósito: no
 * muestra ni depende de ningún dato de usuario.
 */
export default function ReservasUiGalleryScreen({ navigation }) {
  const [chip, setChip] = useState('hoy');
  const [count, setCount] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
          <Text style={styles.title}>Reservas · UI Kit</Text>
          <View style={{ width: 40 }} />
        </View>

        <SectionLabel>Botones</SectionLabel>
        <View style={styles.gap}>
          <Button label="Confirmar reserva" onPress={() => {}} />
          <Button label="Ver otras canchas" variant="secondary" onPress={() => {}} icon={MapPin} />
          <Button label="Cancelar reserva" variant="destructive" onPress={() => {}} />
          <Button label="Deshabilitado" onPress={() => {}} disabled />
          <Button label="Procesando…" onPress={() => {}} loading />
        </View>

        <SectionLabel>Cards</SectionLabel>
        <View style={styles.gap}>
          <Card>
            <Text style={styles.cardTitle}>Complejo Deportivo Ñuñoa</Text>
            <Text style={styles.cardBody}>Fútbol 7 · $40.000/hora</Text>
          </Card>
          <Card selected onPress={() => {}}>
            <Text style={styles.cardTitle}>Dividir entre 2 capitanes</Text>
            <Text style={styles.cardBody}>Cada equipo paga el 50%</Text>
          </Card>
        </View>

        <SectionLabel>Chips</SectionLabel>
        <View style={[styles.row, styles.gapSm]}>
          <Chip label="Hoy" active={chip === 'hoy'} onPress={() => setChip('hoy')} />
          <Chip label="Fútbol 7" active={chip === 'f7'} onPress={() => setChip('f7')} />
          <Chip label="Cerca" active={chip === 'cerca'} onPress={() => setChip('cerca')} icon={MapPin} />
        </View>

        <SectionLabel>Badges</SectionLabel>
        <View style={[styles.row, styles.gapSm]}>
          <Badge label="Verificado" tone="green" />
          <Badge label="Requiere Balance" tone="neutral" />
          <Badge label="Pendiente" tone="amber" />
          <Badge label="Rechazado" tone="red" />
        </View>

        <SectionLabel>Fila de lista</SectionLabel>
        <Card padded={false}>
          <ListRow
            icon={MapPin}
            title="Complejo Deportivo Ñuñoa"
            subtitle="2.3 km · Fútbol 7"
            right={<ChevronRight color={C.textMuted} size={18} />}
            onPress={() => {}}
          />
          <ListRow
            icon={Star}
            title="Calificación"
            subtitle="4.8 (132 reseñas)"
            right={<ChevronRight color={C.textMuted} size={18} />}
            onPress={() => {}}
            last
          />
        </Card>

        <SectionLabel>Stepper</SectionLabel>
        <Card>
          <Stepper value={count} onChange={setCount} min={1} max={22} unitLabel={count === 1 ? 'JUGADOR' : 'JUGADORES'} />
        </Card>

        <SectionLabel>Avisos</SectionLabel>
        <View style={styles.gap}>
          <NoticeCard tone="info">
            Este horario continúa disponible para otros usuarios hasta que se complete la reserva.
          </NoticeCard>
          <NoticeCard tone="quote">
            Este partido utiliza pago dividido entre dos capitanes. Si ambos confirman y la cancha sigue
            disponible, se descontarán automáticamente $20.000 de tu Balance FutFinder.
          </NoticeCard>
          <NoticeCard tone="warning">
            Aún no puedes confirmar esta reserva: 2 jugadores no tienen saldo suficiente.
          </NoticeCard>
        </View>

        <SectionLabel>Sheet</SectionLabel>
        <Button label="Abrir hoja modal" variant="secondary" onPress={() => setSheetOpen(true)} />

        <View style={{ height: 120 }} />
      </ScrollView>

      <StickyFooter>
        <Button label="CTA sticky de fondo" onPress={() => {}} />
      </StickyFooter>

      <Sheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Filtros">
        <Text style={{ fontFamily: F.medium, fontSize: 13, color: C.textSecondary }}>
          Contenido de ejemplo de la hoja modal.
        </Text>
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  scroll: { paddingHorizontal: 20, paddingBottom: 24, gap: 22 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  title: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary },
  gap: { gap: 11, marginTop: 11 },
  gapSm: { gap: 8, marginTop: 11 },
  row: { flexDirection: 'row', flexWrap: 'wrap' },
  cardTitle: { fontFamily: F.extraBold, fontSize: 14, color: C.textPrimary },
  cardBody: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 4 },
});
