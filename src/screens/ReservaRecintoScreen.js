import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, AlertTriangle, RotateCcw, BellRing, Receipt } from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Badge, Sheet, NoticeCard } from '../components/reservas/ui';
import {
  Skeleton, SkeletonLineas, ContactActions, MoneyBreakdown, FieldLabel, TextField,
} from '../components/reservas/recintoUi';
import { detalleDeReserva, cancelarReserva } from '../services/recinto';
import { estadoOperativo, desgloseComision, enlacesDeContacto, avancePago } from '../utils/recintoAgenda';
import {
  fechaLarga, etiquetaDeReserva, duracionEnMinutos, etiquetaDuracion,
  motivoDeCancelacionValido, MINIMO_MOTIVO,
} from '../utils/recintoPantallas';
import { formatCLP } from '../services/reservasRules';

const NOTA_CONTACTO =
  'Los dejó al reservar y los ves solo tú, hasta 12 horas después del partido. No quedan guardados '
  + 'en el recinto: después queda solo el @usuario.';

/**
 * Detalle de una reserva desde el recinto (artboard 3b), con la hoja de
 * cancelación (3l).
 *
 * EL DESGLOSE SE LEE, NO SE CALCULA. Bruto, comisión y neto vienen congelados
 * por reserva desde la migración 62: el día que la tasa cambie, esta pantalla
 * tiene que seguir mostrando lo que de verdad se cobró.
 *
 * CANCELAR ES CARO Y LA PANTALLA LO DICE. El jugador pierde la cancha por una
 * decisión que no tomó, así que el motivo es obligatorio —lo lee tal cual— y
 * la devolución es total. Las dos reglas las impone el servidor; acá solo se
 * explican antes de apretar.
 */
export default function ReservaRecintoScreen({ navigation, route }) {
  const { reservaId } = route.params || {};
  const [reserva, setReserva] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const [hoja, setHoja] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorCancelar, setErrorCancelar] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await detalleDeReserva(reservaId);
    setReserva(data);
    setError(err?.message || null);
    setCargando(false);
  }, [reservaId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const cancelar = async () => {
    setEnviando(true);
    setErrorCancelar(null);
    const { error: err } = await cancelarReserva(reservaId, motivo);
    setEnviando(false);
    if (err) {
      // El mensaje del servidor va tal cual: ya viene redactado en español y
      // sabe cosas que la pantalla no, como que el partido ya empezó.
      setErrorCancelar(err.message);
      return;
    }
    setHoja(false);
    setMotivo('');
    cargar();
  };

  if (cargando) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Cabecera navigation={navigation} />
        <View style={styles.scroll}>
          <Card><Skeleton height={20} width="50%" /><SkeletonLineas lineas={2} style={{ marginTop: 12 }} /></Card>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !reserva) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <Cabecera navigation={navigation} />
        <View style={styles.scroll}>
          <NoticeCard tone="warning" icon={AlertTriangle}>
            {error || 'No pudimos cargar esta reserva.'}
          </NoticeCard>
        </View>
      </SafeAreaView>
    );
  }

  const estado = estadoOperativo(reserva);
  const rotulo = etiquetaDeReserva(estado);
  const dinero = desgloseComision(reserva);
  const contacto = enlacesDeContacto(reserva);
  const pago = avancePago(reserva);
  const cobros = reserva.cobros || [];
  const duracion = etiquetaDuracion(duracionEnMinutos(reserva.hora_inicio, reserva.hora_fin));
  // El servidor rechaza cancelar un partido ya empezado; se anticipa acá solo
  // para no ofrecer el botón, no para reemplazar esa validación.
  const sePuedeCancelar = estado === 'confirmada' || estado === 'en_curso';

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <Cabecera navigation={navigation} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 16 }}>
          <Card>
            <View style={styles.horaFila}>
              <Text style={styles.hora}>{reserva.hora_inicio}–{reserva.hora_fin}</Text>
              <Badge label={rotulo.texto} tone={rotulo.tono} />
            </View>
            <Text style={styles.subtitulo}>
              {fechaLarga(reserva.fecha)} · {reserva.cancha_nombre}
              {reserva.cancha_tipo ? ` · ${String(reserva.cancha_tipo).replace('_', ' ')}` : ''}
              {duracion ? ` · ${duracion}` : ''}
            </Text>
          </Card>

          <Card>
            <View style={styles.organizador}>
              <View style={styles.avatar}>
                <Text style={styles.avatarTexto}>
                  {String(reserva.contacto_nombre || reserva.organizador_username || '?').slice(0, 2).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                {reserva.contacto_nombre ? (
                  <Text style={styles.organizadorNombre}>{reserva.contacto_nombre}</Text>
                ) : null}
                <Text style={styles.organizadorUsuario}>
                  @{reserva.organizador_username} · organiza la reserva
                </Text>
              </View>
            </View>
            {contacto ? (
              <View style={{ marginTop: 14 }}>
                <ContactActions contacto={{ ...contacto, nombre: null }} nota={NOTA_CONTACTO} />
              </View>
            ) : (
              <Text style={styles.sinContacto}>
                {estado === 'jugada'
                  ? 'El teléfono dejó de mostrarse: pasaron más de 12 horas desde el partido.'
                  : 'Todavía no hay teléfono de contacto: se muestra cuando la reserva quede confirmada.'}
              </Text>
            )}
          </Card>

          {cobros.length > 0 ? (
            <Card>
              <Text style={styles.seccionTitulo}>Qué hay que preparar</Text>
              <View style={{ gap: 9 }}>
                {cobros.map((c) => (
                  <View key={c.nombre} style={styles.cobroFila}>
                    <Text style={styles.cobroNombre}>{c.nombre}</Text>
                    <Text style={styles.cobroPrecio}>{formatCLP(c.precio)}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}

          <Card>
            <Text style={styles.seccionTitulo}>Cuánto recibes</Text>
            <MoneyBreakdown
              lineas={[
                { etiqueta: `${reserva.cancha_nombre}${duracion ? ` · ${duracion}` : ''}`, monto: reserva.precio_cancha },
                ...(cobros.length > 0
                  ? [{ etiqueta: `Adicionales (${cobros.length})`, monto: reserva.total_cobros }]
                  : []),
              ]}
              total={dinero.bruto}
              comision={dinero.cobrada ? dinero.comision : undefined}
              neto={dinero.neto}
              nota={
                dinero.cobrada
                  ? 'Montos con IVA incluido; la comisión también lo lleva dentro. Te lo pagamos de 1 a 2 días '
                    + 'hábiles después de que se jugó el partido. Si la reserva se cancela, no cobramos comisión.'
                  : 'Esta reserva no paga comisión.'
              }
            />
            <Text style={styles.pagoNota}>
              {reserva.modalidad === 'jugadores' && pago
                ? `Pago dividido entre ${pago.total}: ${pago.aceptados} ya pagaron su parte con su balance FutFinder.`
                : reserva.medio_pago === 'tarjeta'
                  ? 'Pago único con tarjeta.'
                  : 'Pago único con balance FutFinder.'}
            </Text>
          </Card>

          {sePuedeCancelar ? (
            <Card>
              <Button
                label="Cancelar esta reserva"
                variant="destructive"
                onPress={() => { setErrorCancelar(null); setHoja(true); }}
              />
              <Text style={styles.cancelarNota}>
                Solo si la cancha de verdad no se puede usar. Al jugador se le devuelve todo lo que pagó.
              </Text>
            </Card>
          ) : estado === 'cancelada' ? (
            <NoticeCard tone="warning" icon={AlertTriangle}>
              Esta reserva está cancelada. Se le devolvió al jugador todo lo que había pagado y no se
              cobró comisión.
            </NoticeCard>
          ) : null}
        </View>
      </ScrollView>

      <HojaCancelar
        visible={hoja}
        reserva={reserva}
        dinero={dinero}
        motivo={motivo}
        setMotivo={setMotivo}
        enviando={enviando}
        error={errorCancelar}
        onCerrar={() => setHoja(false)}
        onConfirmar={cancelar}
      />
    </SafeAreaView>
  );
}

function Cabecera({ navigation }) {
  return (
    <View style={styles.header}>
      <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
      <Text style={styles.headerTitle}>Reserva</Text>
    </View>
  );
}

/** Artboard 3l: la hoja que pide el motivo y explica qué pasa al confirmar. */
function HojaCancelar({ visible, reserva, dinero, motivo, setMotivo, enviando, error, onCerrar, onConfirmar }) {
  const listo = motivoDeCancelacionValido(motivo);
  const faltan = MINIMO_MOTIVO - String(motivo || '').trim().length;

  return (
    <Sheet visible={visible} onClose={onCerrar} title={`¿Cancelar la reserva de @${reserva.organizador_username}?`}>
      <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 460 }}>
        <View style={{ gap: 15, paddingBottom: 6 }}>
          <Text style={styles.hojaIntro}>
            {fechaLarga(reserva.fecha)}, {reserva.hora_inicio} · {reserva.cancha_nombre}. Cancela solo si la
            cancha de verdad no se puede usar: al jugador le queda la hora libre encima.
          </Text>

          <View style={{ gap: 11 }}>
            <Consecuencia icon={RotateCcw}>
              Se le devuelven los <Text style={styles.fuerte}>{formatCLP(dinero.bruto)}</Text> completos,
              cancha y adicionales.
            </Consecuencia>
            <Consecuencia icon={Receipt}>
              No te cobramos comisión y esta reserva sale de tu liquidación.
            </Consecuencia>
            <Consecuencia icon={BellRing}>
              Le avisamos al jugador con tu motivo. La hora vuelve a quedar libre.
            </Consecuencia>
          </View>

          <View>
            <FieldLabel marca="obligatorio">Motivo</FieldLabel>
            <TextField
              value={motivo}
              onChangeText={setMotivo}
              placeholder="Se cortó la luz del sector y la cancha no tiene iluminación"
              multiline
              maxLength={300}
              contador
            />
            <Text style={styles.hojaAyuda}>
              {listo
                ? 'Esto lo lee el jugador tal cual lo escribas. Es lo único que va a saber.'
                : `Escribe al menos ${faltan} ${faltan === 1 ? 'carácter' : 'caracteres'} más: es lo único que el jugador va a saber.`}
            </Text>
          </View>

          {error ? <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard> : null}

          <View style={{ gap: 9 }}>
            <Button
              label="Cancelar reserva"
              variant="destructive"
              disabled={!listo}
              loading={enviando}
              onPress={onConfirmar}
            />
            <Button label="No cancelar" variant="secondary" onPress={onCerrar} />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}

function Consecuencia({ icon: Icon, children }) {
  return (
    <View style={styles.consecuencia}>
      <Icon color={C.textSecondary} size={15} strokeWidth={2.2} style={{ marginTop: 1 }} />
      <Text style={styles.consecuenciaTexto}>{children}</Text>
    </View>
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
    paddingBottom: 12,
  },
  headerTitle: { flex: 1, fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 40 },

  horaFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  hora: { fontFamily: F.extraBold, fontSize: 22, color: C.textPrimary },
  subtitulo: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18, marginTop: 7 },

  organizador: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTexto: { fontFamily: F.extraBold, fontSize: 14, color: C.green },
  organizadorNombre: { fontFamily: F.bold, fontSize: 15, color: C.textPrimary },
  organizadorUsuario: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, marginTop: 2 },
  sinContacto: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17, marginTop: 12 },

  seccionTitulo: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary, marginBottom: 12 },
  cobroFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  cobroNombre: { flex: 1, fontFamily: F.medium, fontSize: 13.5, color: C.textPrimary },
  cobroPrecio: { fontFamily: F.semiBold, fontSize: 13.5, color: C.textAmber },

  pagoNota: {
    fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16,
    marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: C.dividerInner,
  },
  cancelarNota: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16, marginTop: 10 },

  hojaIntro: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary, lineHeight: 19 },
  consecuencia: { flexDirection: 'row', gap: 9 },
  consecuenciaTexto: { flex: 1, fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, lineHeight: 18 },
  fuerte: { fontFamily: F.extraBold, color: C.textPrimary },
  hojaAyuda: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, lineHeight: 16, marginTop: 7 },
});
