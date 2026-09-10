import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, AlertTriangle, Plus } from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Chip, Button, NoticeCard, StickyFooter } from '../components/reservas/ui';
import { Skeleton, WeekStrip, BloqueFila } from '../components/reservas/recintoUi';
import { canchasDelRecinto, calendarioDeCancha, eliminarBloqueo } from '../services/recinto';
import { estadoDeBloque } from '../utils/recintoAgenda';
import { hoyISO, semanaDe, rotuloDeSemana, fechaRelativa } from '../utils/recintoPantallas';
import { formatCLP } from '../services/reservasRules';

/**
 * Calendario del día de una cancha (artboards 1p, 3c y 4e).
 *
 * TRES ESTADOS Y NO CUATRO. Un bloque está libre, reservado por un jugador, u
 * ocupado por el recinto. Un bloque con gente juntando la plata sigue LIBRE:
 * se le agrega el aviso de que hay un grupo armando, pero se puede ocupar y
 * cualquier otro grupo puede llevárselo. Es la regla central del vertical y
 * `estadoDeBloque()` es la que la traduce.
 *
 * El calendario cuelga de la CANCHA y no del recinto porque así está el modelo
 * de datos: horarios, tarifas y bloqueos son todos por cancha. Por eso lo
 * primero de la pantalla es elegir cuál, cuando hay más de una.
 */
export default function CalendarioCanchaScreen({ navigation, route }) {
  const { complejoId, canchaId: canchaInicial } = route.params || {};
  const hoy = hoyISO();
  const [canchas, setCanchas] = useState([]);
  const [canchaId, setCanchaId] = useState(canchaInicial || null);
  const [fecha, setFecha] = useState(hoy);
  const [calendario, setCalendario] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  // Las canchas se piden UNA vez por recinto. `canchaId` no va en las
  // dependencias a propósito: si fuera, cambiar de cancha con los chips
  // volvería a pedir la lista entera en cada toque.
  useEffect(() => {
    (async () => {
      const { data, error: err } = await canchasDelRecinto(complejoId);
      setCanchas(data || []);
      setError(err?.message || null);
      if (data?.length) setCanchaId((actual) => actual || data[0].id);
      else setCargando(false);
    })();
  }, [complejoId]);

  const cargar = useCallback(async () => {
    if (!canchaId) return;
    setCargando(true);
    const { data, error: err } = await calendarioDeCancha(canchaId, fecha);
    setCalendario(data);
    setError(err?.message || null);
    setCargando(false);
  }, [canchaId, fecha]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const cancha = useMemo(() => canchas.find((k) => k.id === canchaId) || null, [canchas, canchaId]);
  const slots = calendario?.slots || [];

  const quitar = async (bloqueoId) => {
    const { error: err } = await eliminarBloqueo(bloqueoId);
    if (err) { setError(err.message); return; }
    cargar();
  };

  const ocupar = (desde) =>
    navigation.navigate('OcuparHorario', {
      complejoId,
      canchaId,
      canchaNombre: cancha?.nombre,
      fecha,
      desde,
      slots,
    });

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Calendario</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {cancha?.nombre || route.params?.nombre || ''} · {rotuloDeSemana(fecha)}
          </Text>
        </View>
      </View>

      {canchas.length > 1 ? (
        // `flexGrow: 0` es obligatorio: un ScrollView horizontal dentro de una
        // columna se estira a lo alto de todo el espacio libre y se come lo
        // que viene abajo — acá, la tira de días.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.canchasScroll}
          contentContainerStyle={styles.canchasTira}
        >
          {canchas.map((k) => (
            <Chip
              key={k.id}
              label={k.activa ? k.nombre : `${k.nombre} · inactiva`}
              active={k.id === canchaId}
              onPress={() => setCanchaId(k.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.semanaWrap}>
        <WeekStrip dias={semanaDe(fecha)} seleccionada={fecha} onSelect={setFecha} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : cargando ? (
          <View style={{ gap: 9 }}>
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} height={58} radius={18} />)}
          </View>
        ) : canchas.length === 0 ? (
          <Card>
            <Text style={styles.vacioTitulo}>Este recinto todavía no tiene canchas</Text>
            <Text style={styles.vacioTexto}>
              Sin canchas no hay calendario. Las canchas se cargan desde la administración del recinto.
            </Text>
          </Card>
        ) : slots.length === 0 ? (
          <Card>
            <Text style={styles.vacioTitulo}>
              {cancha?.tiene_horario ? 'Cerrado este día' : 'Esta cancha no tiene horario cargado'}
            </Text>
            <Text style={styles.vacioTexto}>
              {cancha?.tiene_horario
                ? `La cancha no atiende ${fechaRelativa(fecha).toLowerCase()}. El horario de atención se define por día de la semana.`
                : 'Mientras no tenga horario de atención no se puede reservar ni ocupar ninguna hora.'}
            </Text>
          </Card>
        ) : (
          <View style={{ gap: 9 }}>
            <Text style={styles.diaRotulo}>
              {fechaRelativa(fecha)} · {slots[0].hora_inicio} a {slots[slots.length - 1].hora_fin}
              {calendario?.duracion_slot_min ? ` · bloques de ${calendario.duracion_slot_min} min` : ''}
            </Text>
            {slots.map((s, i) => (
              <Slot
                key={s.hora_inicio}
                slot={s}
                anterior={slots[i - 1]}
                onOcupar={() => ocupar(s.hora_inicio)}
                onQuitar={quitar}
                onAbrirReserva={(id) => navigation.navigate('ReservaRecinto', { reservaId: id })}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {slots.length > 0 && !cargando ? (
        <StickyFooter>
          <Button label="Ocupar un horario" icon={Plus} onPress={() => ocupar(slots[0].hora_inicio)} />
        </StickyFooter>
      ) : null}
    </SafeAreaView>
  );
}

/** Una fila del día. `anterior` sirve para no repetir un bloqueo de varias horas. */
function Slot({ slot, anterior, onOcupar, onQuitar, onAbrirReserva }) {
  const b = estadoDeBloque(slot);
  const precio = slot.precio ? formatCLP(slot.precio) : null;

  if (b.estado === 'bloqueada' && b.bloqueo) {
    const externo = b.bloqueo.tipo === 'externo';
    const continuacion = anterior?.bloqueo?.id === b.bloqueo.id;
    if (continuacion) {
      return (
        <BloqueFila
          hora={slot.hora_inicio}
          titulo={`Sigue lo de las ${b.bloqueo.hora_inicio}`}
          tono="amber"
          continuacion
        />
      );
    }
    return (
      <BloqueFila
        hora={slot.hora_inicio}
        tono="amber"
        titulo={externo
          ? (b.bloqueo.contacto_nombre || 'Reservado por fuera')
          : 'Ocupada por ti'}
        detalle={[
          b.bloqueo.motivo,
          `${b.bloqueo.hora_inicio} a ${b.bloqueo.hora_fin}`,
          externo && b.bloqueo.contacto_telefono ? b.bloqueo.contacto_telefono : null,
        ].filter(Boolean).join(' · ')}
        accion="Quitar"
        onAccion={() => onQuitar(b.bloqueo.id)}
      />
    );
  }

  if (b.estado === 'reservada' && b.reserva) {
    return (
      <BloqueFila
        hora={slot.hora_inicio}
        titulo="Reservada"
        detalle={[
          `@${b.reserva.organizador_username}`,
          b.reserva.medio_pago === 'tarjeta' ? 'pagada con tarjeta' : 'pagada',
          precio,
        ].filter(Boolean).join(' · ')}
        onPress={() => onAbrirReserva(b.reserva.id)}
      />
    );
  }

  return (
    <BloqueFila
      hora={slot.hora_inicio}
      tono="green"
      titulo="Libre"
      detalle={[
        precio,
        // La hora sigue disponible aunque haya gente juntando la plata: el
        // primero que confirma se la lleva.
        b.hayGrupoArmando
          ? `${b.gruposEnCurso} ${b.gruposEnCurso === 1 ? 'grupo está armando' : 'grupos están armando'} — sigue disponible`
          : null,
      ].filter(Boolean).join(' · ')}
      accion="Ocupar"
      onAccion={onOcupar}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: S.screenPadding,
    paddingTop: 6,
    paddingBottom: 10,
  },
  headerTitle: { fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  headerSub: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 2 },
  canchasScroll: { flexGrow: 0, flexShrink: 0 },
  canchasTira: { paddingHorizontal: S.screenPadding, gap: 8, paddingBottom: 12, alignItems: 'center' },
  semanaWrap: { paddingHorizontal: S.screenPadding, paddingBottom: 12 },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 110 },
  diaRotulo: { fontFamily: F.semiBold, fontSize: 12, color: C.textSecondary, marginBottom: 3 },
  vacioTitulo: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  vacioTexto: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary, lineHeight: 18.5, marginTop: 7 },
});
