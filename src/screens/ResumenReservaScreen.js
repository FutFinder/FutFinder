import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Info, Check, Lock } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasFonts as F } from '../theme/colors';
import {
  IconButton, Card, NoticeCard, StickyFooter, Button, Foto, Stepper,
} from '../components/reservas/ui';
import { FieldLabel, TextField, ChoiceCard } from '../components/reservas/recintoUi';
import {
  getComplejoById, cobrosDelComplejo, crearReserva, getMiBalance,
  reservarCanchaDelPartido,
} from '../services/reservas';
import { estadoPasarela } from '../services/pagos';
import { totalDeReserva, reservaLista } from '../utils/reservasJugador';
import { telefonoAceptable } from '../utils/recintoPantallas';
import { MAX_JUGADORES, MIN_JUGADORES, repartoDeCuotas } from '../utils/pagoDividido';
import { alcanzaPara } from '../utils/saldo';
import { calzaConElPartido, leerIntencion, olvidarIntencion } from '../utils/intencionDeReserva';
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
 * PAGAR SOLO O DIVIDIR SON DOS CAMINOS DISTINTOS, Y SE ELIGE ACÁ.
 *
 * Dividir es SOLO con Balance, y no por una limitación técnica. Con Balance
 * nadie pone plata hasta que están todos: el cobro ocurre entero, a todos a
 * la vez, o no ocurre. Eso hace que un grupo que no se completa no deje NADA
 * que devolver, y que la hora no tenga que retenerse mientras se arma.
 * Dividir con tarjeta sería lo contrario: cada uno paga de verdad al entrar,
 * y el grupo que se cae deja cinco reembolsos que alguien tiene que hacer a
 * mano. Por eso el servidor lo rechaza desde la migración 55 y acá ni se
 * ofrece.
 *
 * La contracara honesta: cargar saldo todavía no existe (`cargar_balance`
 * quedó revocada en la migración 73 justo porque acreditaba plata sin
 * cobrarla). Así que el camino dividido se puede recorrer entero, pero quien
 * no tenga saldo lo ve apagado y con el motivo escrito.
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
  // Si se viene desde un desafío de clubes, la reserva es de ese partido y
  // entre capitanes. Se lee una sola vez para que soltarla no la reviva.
  const [desafio, setDesafio] = useState(() => leerIntencion());
  const [modalidad, setModalidad] = useState(() => (leerIntencion() ? 'capitanes' : 'completa'));
  const [nJugadores, setNJugadores] = useState(null);
  const [saldo, setSaldo] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: cs }, { data: ps }, { data: sal }] = await Promise.all([
      getComplejoById(complejoId),
      cobrosDelComplejo(complejoId),
      estadoPasarela(),
      getMiBalance(),
    ]);
    setComplejo(data);
    setSaldo(sal?.saldo ?? null);
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
    // OJO: `modalidad` es la elegida, y 'completa' NO divide. Acá había una
    // segunda copia de esta cuenta que solo miraba 'jugadores', así que
    // elegir capitanes creaba una reserva COMPLETA con tarjeta y mandaba a
    // la pasarela. Dos definiciones de lo mismo en el mismo archivo: la de
    // arriba se corrigió y esta se quedó atrás.
    const divide = modalidad !== 'completa';

    // Desde un desafío se usa la puerta que además invita al capitán rival y
    // enlaza el partido. Hacerlo con `crear_reserva` dejaría una reserva de
    // capitanes sin segundo capitán, que no se puede confirmar nunca.
    if (desafio) {
      const r = await reservarCanchaDelPartido({
        matchId: desafio.matchId,
        canchaId, fecha, horaInicio,
        contactoNombre: nombre.trim(),
        contactoTelefono: telefono,
        cobros: elegidos,
      });
      setCreando(false);
      if (r.error || !r.data?.ok) {
        setToast(r.error?.message || r.data?.reason || 'No pudimos reservar la cancha del partido.');
        return;
      }
      olvidarIntencion();
      navigation.navigate('ArmarReserva', { reservaId: r.data.reserva_id });
      return;
    }

    const { data, error } = await crearReserva({
      canchaId,
      fecha,
      horaInicio,
      // Dividir exige Balance y pagar solo va por tarjeta: son dos caminos
      // completos, no una casilla que se marca sobre el mismo.
      modalidad: divide ? modalidad : 'completa',
      medioPago: divide ? 'balance' : 'tarjeta',
      // `n_jugadores` es solo de la modalidad 'jugadores': en capitanes el
      // servidor calcula la mitad solo, y mandarlo choca con el CHECK de la
      // tabla (`reservas_jugadores_datos`).
      nJugadores: modalidad === 'jugadores' ? reparto.n : null,
      contactoNombre: nombre.trim(),
      contactoTelefono: telefono,
      cobros: elegidos,
    });
    setCreando(false);

    if (error || !data?.ok) {
      setToast(error?.message || data?.reason || 'No pudimos crear la reserva.');
      return;
    }
    if (divide) {
      navigation.navigate('ArmarReserva', { reservaId: data.reserva_id });
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
  const baseLista = telefonoOk && reservaLista({
    canchaId, fecha, hora: horaInicio, contactoNombre: nombre, contactoTelefono: telefono,
  });

  // Los adicionales entran en la división: son del partido, no de quien los
  // marcó. Dividir solo la cancha dejaría al organizador pagando el asado.
  const tope = Math.max(MIN_JUGADORES, cancha?.jugadoresHabitual || MIN_JUGADORES);
  // Capitanes son SIEMPRE dos: con tres la mitad deja de ser una mitad y el
  // reparto se complica sin que nadie gane nada. Para más gente está
  // «dividir entre todos», que reparte entre los que sean.
  const entreCapitanes = modalidad === 'capitanes';
  const cuantos = entreCapitanes ? 2 : (nJugadores ?? tope);
  const reparto = repartoDeCuotas(dinero.total, cuantos) || repartoDeCuotas(dinero.total, MIN_JUGADORES);
  const divide = modalidad !== 'completa';
  const saldoCorto = divide && !!reparto && alcanzaPara(saldo, reparto.cuota) === false;
  const calza = desafio ? calzaConElPartido(desafio.horaPartido, fecha, horaInicio) : null;
  const listo = baseLista && !saldoCorto;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <Text style={styles.headerTitle}>Resumen de la reserva</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.complejoRow}>
          <Foto
            uri={cancha?.fotoUrl || complejo?.fotoUrl}
            style={styles.thumb}
            iconSize={18}
            alt={`Foto de ${complejo?.nombre || 'el recinto'}`}
          />
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

        {desafio ? (
          <NoticeCard tone="info" icon={Info}>
            Esta reserva es para <Text style={{ fontFamily: F.extraBold }}>{desafio.titulo || 'tu partido de clubes'}</Text>.
            Se divide entre los dos capitanes y {desafio.capitanRival ? `@${desafio.capitanRival}` : 'el capitán del otro club'} queda
            invitado solo. <Text
              style={styles.soltar}
              onPress={() => { olvidarIntencion(); setDesafio(null); setModalidad('completa'); }}
            >Reservar sin el partido</Text>
          </NoticeCard>
        ) : null}

        {desafio && calza === false ? (
          <NoticeCard tone="warning">
            El partido es a otra hora. Puedes reservar igual, pero después tendrás que mover el
            partido o la cancha para que coincidan.
          </NoticeCard>
        ) : null}

        <Card>
          <Text style={styles.seccion}>¿Cómo se paga?</Text>
          <View style={{ gap: 9, marginTop: 12 }}>
            <ChoiceCard
              titulo="Pago yo todo"
              descripcion={`${formatCLP(dinero.total)} con tarjeta. La hora queda tuya apenas se completa el pago.`}
              seleccionado={!divide}
              onPress={() => setModalidad('completa')}
            />
            <ChoiceCard
              titulo="Lo dividimos entre todos"
              descripcion="Cada uno pone su parte con su saldo FutFinder. No se cobra a nadie hasta que estén todos."
              seleccionado={modalidad === 'jugadores'}
              onPress={() => setModalidad('jugadores')}
            />
            <ChoiceCard
              titulo="Entre 2 capitanes"
              descripcion="Cada equipo paga el 50%. Eliges a un capitán y él pone la otra mitad."
              seleccionado={entreCapitanes}
              onPress={() => setModalidad('capitanes')}
            />
          </View>

          {divide ? (
            <View style={{ marginTop: 14, gap: 12 }}>
              {entreCapitanes ? null : (
                <View>
                  <FieldLabel>¿Entre cuántos?</FieldLabel>
                  <Stepper
                    value={cuantos}
                    onChange={setNJugadores}
                    min={MIN_JUGADORES}
                    max={MAX_JUGADORES}
                    unitLabel="jugadores"
                  />
                </View>
              )}
              <View style={styles.cuotaCaja}>
                <Text style={styles.cuotaMonto}>{formatCLP(reparto.cuota)}</Text>
                <Text style={styles.cuotaSub}>
                  {entreCapitanes ? 'cada capitán, incluidos los adicionales' : 'a cada uno, incluidos los adicionales'}
                  {reparto.excedente > 0
                    ? ` (la división no es exacta: entre todos suman ${formatCLP(reparto.suma)})`
                    : ''}
                </Text>
              </View>
              <Text style={styles.seccionAyuda}>
                {entreCapitanes
                  ? 'Creas la reserva y eliges al otro capitán. Cuando los dos pongan su mitad, la cancha queda tomada. Son dos capitanes y no más: para repartir entre más gente está la opción de arriba.'
                  : 'Creas la reserva, invitas a los demás y cada uno pone su parte. Puedes cambiar entre cuántos se divide después, mientras nadie haya puesto lo suyo.'}
              </Text>
            </View>
          ) : null}
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
          {divide
            ? 'Reservar no toma la hora todavía: sigue disponible para otros grupos hasta que TODOS pongan su parte. Si el grupo no se completa, no se le cobra nada a nadie. Y puedes cancelar con devolución hasta 12 horas antes del partido.'
            : 'Reservar no toma la hora todavía: sigue disponible para otros grupos hasta que el pago quede completo. El primero que paga se la lleva. Y puedes cancelar con devolución hasta 12 horas antes del partido.'}
        </NoticeCard>

        {!divide && pasarela === false ? (
          <NoticeCard tone="warning">
            Todavía no hay medio de pago conectado, así que esta reserva no se puede completar.
            Es lo único que falta.
          </NoticeCard>
        ) : null}

        {saldoCorto ? (
          <NoticeCard tone="warning">
            Tu parte son {formatCLP(reparto.cuota)} y tu saldo es {formatCLP(saldo)}. Cargar saldo
            todavía no está disponible — es lo único que falta para que dividir funcione de verdad.
          </NoticeCard>
        ) : null}

        {toast ? <NoticeCard tone="warning">{toast}</NoticeCard> : null}
      </ScrollView>

      <StickyFooter>
        <Button
          label={divide
            ? `${entreCapitanes ? 'Armar la reserva' : 'Armar el grupo'} · ${formatCLP(reparto.cuota)} c/u`
            : (listo ? `Continuar al pago · ${formatCLP(dinero.total)}` : 'Continuar al pago')}
          disabled={!listo || (!divide && pasarela === false)}
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
  soltar: { fontFamily: F.bold, color: C.green, textDecorationLine: 'underline' },
  cuotaCaja: {
    borderRadius: R.row, borderWidth: 1, borderColor: C.greenDeepBorder,
    backgroundColor: C.shieldBg, paddingHorizontal: 14, paddingVertical: 13,
  },
  cuotaMonto: { fontFamily: F.extraBold, fontSize: 24, color: C.green, letterSpacing: -0.5 },
  cuotaSub: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 4 },
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
  thumb: {
    width: 64, height: 64, borderRadius: 16, flexShrink: 0, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
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
