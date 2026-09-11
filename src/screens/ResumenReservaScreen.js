import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Info, Check, Lock } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import { IconButton, Card, NoticeCard, StickyFooter, Button } from '../components/reservas/ui';
import { FieldLabel, TextField } from '../components/reservas/recintoUi';
import { getComplejoById, cobrosDelComplejo, crearReserva } from '../services/reservas';
import { estadoPasarela } from '../services/pagos';
import { totalDeReserva, reservaLista } from '../utils/reservasJugador';
import { telefonoAceptable } from '../utils/recintoPantallas';
import { formatCLP } from '../services/reservasRules';

/**
 * Resumen antes de pagar (pantalla 8 del handoff, más lo que sumaron las
 * migraciones 67 y 68).
 *
 * EL PRECIO SALE DEL BLOQUE ELEGIDO, no del precio base de la cancha: con
 * tarifas por franja la misma cancha vale distinto según la hora, y cobrar el
 * base sería cobrar de más en las horas baratas.
 *
 * EL TELÉFONO ES OBLIGATORIO. El recinto necesita a quién llamar el día del
 * partido si pasa algo, y solo lo ve durante la ventana de 12 horas alrededor
 * del partido. Se dice acá para que quien lo escribe sepa a dónde va.
 *
 * LOS ADICIONALES SON DEL GRUPO, no por persona: o los toma la reserva
 * completa, o ninguno. Y son siempre opcionales — saltarlos tiene que ser
 * evidente.
 *
 * DE ACÁ SE SALE CREANDO LA RESERVA, NO PAGANDO. `crear_reserva` la deja en
 * `armando`, que es un estado real: existe, es suya y NO ocupa el horario.
 * Recién el pago confirmado lo toma. Esa diferencia es el corazón del
 * vertical y por eso está escrita en la pantalla y no solo en el backend.
 *
 * SE PREGUNTA POR LA PASARELA ANTES DE DEJAR APRETAR. Mientras no haya cuenta
 * de comercio conectada, el botón queda apagado y se dice por qué. La
 * alternativa —crear la reserva y descubrir después que no se puede pagar—
 * dejaría reservas muertas dando vueltas por una cuenta que todavía no
 * existe. El día que las credenciales estén cargadas esto se enciende solo,
 * sin tocar una línea.
 */
export default function ResumenReservaScreen({ navigation, route }) {
  const { complejoId, canchaId, fechaLabel, horaInicio, horaFin, precioBloque, fecha } = route.params || {};
  const [complejo, setComplejo] = useState(null);
  const [cobros, setCobros] = useState([]);
  const [elegidos, setElegidos] = useState([]);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [loading, setLoading] = useState(true);
  const [pasarela, setPasarela] = useState(null);
  const [creando, setCreando] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: cs }, { data: ps }] = await Promise.all([
      getComplejoById(complejoId),
      cobrosDelComplejo(complejoId),
      estadoPasarela(),
    ]);
    setComplejo(data);
    setCobros(cs || []);
    // `null` si no se pudo comprobar: no es lo mismo que «no hay». Con `null`
    // el botón queda disponible y el error, si llega, aparece al tocarlo.
    setPasarela(ps ? !!ps.configurada : null);
    setLoading(false);
  }, [complejoId]);

  useEffect(() => { load(); }, [load]);

  const alternar = (id) =>
    setElegidos((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  /**
   * Crea la reserva y manda a pagarla.
   *
   * El orden importa: primero existe la reserva, después el cobro. Cobrar
   * antes de tener la reserva dejaría plata sin a qué asociarla.
   */
  const continuar = async () => {
    setCreando(true);
    setToast(null);
    const { data, error } = await crearReserva({
      canchaId,
      fecha,
      horaInicio,
      modalidad: 'completa',
      medioPago: 'tarjeta',
      nJugadores: cancha?.jugadoresHabitual ?? null,
      contactoNombre: nombre.trim(),
      contactoTelefono: telefono,
      cobros: elegidos,
    });
    setCreando(false);

    if (error || !data?.ok) {
      setToast(error?.message || data?.reason || 'No pudimos crear la reserva.');
      return;
    }
    navigation.navigate('PagoReserva', {
      reservaId: data.reserva_id,
      monto: dinero.total,
      resumen: {
        recinto: complejo?.nombre,
        cancha: cancha ? `${cancha.nombre} · ${cancha.tipo}` : null,
        cuando: `${fechaLabel} · ${horaInicio}–${horaFin}`,
      },
    });
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
  ];

  const elegidosDetalle = cobros.filter((c) => elegidos.includes(c.id));
  // El precio del bloque, no el base de la cancha: con tarifas por franja no
  // son lo mismo.
  const dinero = totalDeReserva({ precioBloque: precioBloque ?? cancha?.base, cobros: elegidosDetalle });
  const telefonoOk = telefonoAceptable(telefono);
  const listo = telefonoOk && reservaLista({
    canchaId, fecha, hora: horaInicio, contactoNombre: nombre, contactoTelefono: telefono,
  });

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

        {cobros.length > 0 ? (
          <Card>
            <Text style={styles.seccion}>¿Necesitas algo más?</Text>
            <Text style={styles.seccionAyuda}>
              Todo opcional, y es del partido completo: lo toma el grupo entero o nadie. Puedes
              seguir sin elegir ninguno.
            </Text>
            <View style={{ gap: 9, marginTop: 13 }}>
              {cobros.map((c) => {
                const on = elegidos.includes(c.id);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => alternar(c.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={({ pressed }) => [styles.cobro, on && styles.cobroOn, pressed && { opacity: 0.9 }]}
                  >
                    <View style={[styles.casilla, on && styles.casillaOn]}>
                      {on ? <Check color={C.textOnGreen} size={13} strokeWidth={3} /> : null}
                    </View>
                    <Text style={[styles.cobroNombre, on && { color: C.textPrimary }]}>{c.nombre}</Text>
                    <Text style={styles.cobroPrecio}>{formatCLP(c.precio)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        ) : null}

        <Card>
          <Text style={styles.seccion}>¿A quién llamamos si pasa algo?</Text>
          <View style={{ gap: 12, marginTop: 12 }}>
            <View>
              <FieldLabel>Tu nombre</FieldLabel>
              <TextField value={nombre} onChangeText={setNombre} placeholder="Vicente" maxLength={60} />
            </View>
            <View>
              <FieldLabel>Teléfono</FieldLabel>
              <TextField
                value={telefono}
                onChangeText={setTelefono}
                placeholder="9 8765 4321"
                keyboardType="phone-pad"
                maxLength={20}
              />
              {!telefonoOk ? (
                <Text style={styles.errorCampo}>Son 9 dígitos y parte con 9.</Text>
              ) : null}
            </View>
          </View>
          <View style={styles.privacidad}>
            <Lock color={C.textSecondary} size={11} strokeWidth={2.2} style={{ marginTop: 2 }} />
            <Text style={styles.privacidadTexto}>
              Solo los ve el recinto donde juegas, y solo hasta 12 horas después del partido. Después
              queda tu @usuario y nada más.
            </Text>
          </View>
        </Card>

        <Card>
          <View style={[styles.precioRow, styles.precioDivider]}>
            <Text style={styles.precioK}>
              {cancha?.nombre || 'Cancha'} · {horaInicio}–{horaFin}
            </Text>
            <Text style={styles.precioV}>{formatCLP(dinero.cancha)}</Text>
          </View>
          {elegidosDetalle.map((c) => (
            <View key={c.id} style={[styles.precioRow, styles.precioDivider]}>
              <Text style={styles.precioK}>{c.nombre}</Text>
              <Text style={styles.precioV}>{formatCLP(c.precio)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalK}>Total a pagar</Text>
            <Text style={styles.totalV}>{formatCLP(dinero.total)}</Text>
          </View>
          <Text style={styles.totalNota}>
            Precio final. Sin cargos adicionales al llegar al recinto.
          </Text>
        </Card>

        <NoticeCard tone="info" icon={Info}>
          Reservar no toma la hora todavía: sigue disponible para otros grupos hasta que el pago
          quede completo. El primero que paga se la lleva. Y puedes cancelar con devolución hasta 12
          horas antes del partido.
        </NoticeCard>

        {pasarela === false ? (
          <NoticeCard tone="warning">
            Todavía no hay medio de pago conectado, así que esta reserva no se puede completar.
            Es lo único que falta.
          </NoticeCard>
        ) : null}

        {toast ? <NoticeCard tone="warning">{toast}</NoticeCard> : null}
      </ScrollView>

      <StickyFooter>
        <Button
          label={listo ? `Continuar al pago · ${formatCLP(dinero.total)}` : 'Continuar al pago'}
          disabled={!listo || pasarela === false}
          loading={creando}
          onPress={continuar}
        />
      </StickyFooter>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  seccion: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  seccionAyuda: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 6 },
  cobro: {
    flexDirection: 'row', alignItems: 'center', gap: 11,
    paddingHorizontal: 13, paddingVertical: 12,
    borderRadius: R.row, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  cobroOn: { borderColor: C.green, backgroundColor: C.selectedBg },
  casilla: {
    width: 20, height: 20, borderRadius: 6,
    borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center',
  },
  casillaOn: { backgroundColor: C.green, borderColor: C.green },
  cobroNombre: { flex: 1, fontFamily: F.bold, fontSize: 13.5, color: C.textSecondary },
  cobroPrecio: { fontFamily: F.semiBold, fontSize: 13.5, color: C.textAmber },
  errorCampo: { fontFamily: F.semiBold, fontSize: 11.5, color: C.red, marginTop: 6 },
  privacidad: { flexDirection: 'row', gap: 6, marginTop: 13 },
  privacidadTexto: { flex: 1, fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15.5 },
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
