import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, AlertTriangle, MapPin, CalendarDays } from 'lucide-react-native';

import { reservas as C, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Button, Badge, NoticeCard, Sheet, Foto } from '../components/reservas/ui';
import { Skeleton } from '../components/reservas/recintoUi';
import { misReservas, cancelarMiReserva } from '../services/reservas';
import {
  accionesDeReserva, enlaceDeMapa, etiquetaDeEstado, separaReservas, textoDeCancelacion,
} from '../utils/misReservas';
import { formatCLP } from '../services/reservasRules';
import { fechaLarga } from '../utils/recintoPantallas';

/**
 * Mis reservas (migración 86).
 *
 * ES EL HUECO MÁS GRANDE QUE TENÍA EL FLUJO: se podía buscar, elegir, pagar
 * — y después no había ninguna pantalla donde ver lo que uno había comprado.
 *
 * DOS LISTAS Y NO UNA. «Próximas» es lo que todavía va a pasar: a eso hay
 * que ir. El historial es todo lo demás, incluida una cancelada de la semana
 * que viene — no es una próxima, y ponerla ahí haría que alguien cuente con
 * una cancha que no tiene.
 *
 * LO QUE SE PUEDE HACER LO DICE EL SERVIDOR. `puede_cancelar` llega
 * calculado y no se vuelve a derivar acá: la ventana de 12 horas es una
 * regla de plata que ya se movió de lugar una vez por un error de huso
 * (migración 70), y dos copias es garantizar que un día digan cosas
 * distintas.
 */
export default function MisReservasScreen({ navigation }) {
  const [lista, setLista] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);
  const [porCancelar, setPorCancelar] = useState(null);
  const [cancelando, setCancelando] = useState(false);
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    const { data, error: err } = await misReservas();
    setLista(data || []);
    setError(err?.message || null);
    setCargando(false);
  }, []);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const { proximas, historial } = separaReservas(lista);

  const confirmarCancelar = async () => {
    setCancelando(true);
    const { data, error: err } = await cancelarMiReserva(porCancelar.id, null);
    setCancelando(false);
    if (err || !data?.ok) {
      setError(err?.message || data?.reason || 'No pudimos cancelar la reserva.');
      setPorCancelar(null);
      return;
    }
    setAviso(data.cancelacion_estado === 'solicitada'
      ? 'Pedimos la cancelación al otro club. Te avisamos en cuanto responda.'
      : 'Reserva cancelada.');
    setPorCancelar(null);
    cargar();
  };

  const ejecutar = (reserva, clave) => {
    if (clave === 'cancelar') { setPorCancelar(reserva); return; }
    if (clave === 'pagar') {
      navigation.navigate('PagoReserva', {
        reservaId: reserva.id,
        monto: reserva.precioTotal,
        resumen: {
          recinto: reserva.complejoNombre,
          cancha: reserva.canchaNombre,
          cuando: `${fechaLarga(reserva.fecha)} · ${reserva.horaInicio}–${reserva.horaFin}`,
        },
      });
    }
  };

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <Text style={styles.headerTitle}>Mis reservas</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: 12 }}>
            {[0, 1].map((i) => <Skeleton key={i} height={120} radius={20} />)}
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : lista.length === 0 ? (
          <Vacio navigation={navigation} />
        ) : (
          <View style={{ gap: 20 }}>
            {aviso ? <NoticeCard tone="info">{aviso}</NoticeCard> : null}

            {proximas.length ? (
              <View style={{ gap: 12 }}>
                <Text style={styles.seccion}>PRÓXIMAS · {proximas.length}</Text>
                {proximas.map((r) => (
                  <Tarjeta key={r.id} reserva={r} onAccion={ejecutar} />
                ))}
              </View>
            ) : (
              <NoticeCard tone="info" icon={CalendarDays}>
                No tienes reservas por jugar. Las que hiciste antes están más abajo.
              </NoticeCard>
            )}

            {historial.length ? (
              <View style={{ gap: 12 }}>
                <Text style={styles.seccion}>ANTES · {historial.length}</Text>
                {historial.map((r) => (
                  <Tarjeta key={r.id} reserva={r} onAccion={ejecutar} />
                ))}
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Sheet
        visible={!!porCancelar}
        onClose={() => setPorCancelar(null)}
        title="¿Cancelar la reserva?"
      >
        <Text style={styles.hojaTexto}>
          {porCancelar?.estado === 'confirmada'
            ? 'Te devolvemos lo que pagaste y la hora vuelve a quedar disponible para otros grupos.'
            : 'Todavía no pagaste nada, así que no se devuelve ni se cobra nada.'}
        </Text>
        <Button
          label="Sí, cancelar"
          variant="destructive"
          style={{ marginTop: 16 }}
          loading={cancelando}
          onPress={confirmarCancelar}
        />
        <Button
          label="Mejor no"
          variant="secondary"
          style={{ marginTop: 9 }}
          disabled={cancelando}
          onPress={() => setPorCancelar(null)}
        />
      </Sheet>
    </SafeAreaView>
  );
}

/** Una reserva. Todo lo que hace falta saber sin abrir otra pantalla. */
function Tarjeta({ reserva, onAccion }) {
  const etiqueta = etiquetaDeEstado(reserva);
  const acciones = accionesDeReserva(reserva);
  const nota = textoDeCancelacion(reserva);
  const mapa = enlaceDeMapa(reserva);

  return (
    <Card padded={false}>
      <Foto uri={reserva.fotoUrl} style={styles.foto} alt={`Foto de ${reserva.complejoNombre}`}>
        <View style={styles.fotoBadge}>
          <Badge label={etiqueta.texto} tone={etiqueta.tono} />
        </View>
      </Foto>

      <View style={styles.cuerpo}>
        <Text style={styles.complejo} numberOfLines={1}>{reserva.complejoNombre}</Text>
        <Text style={styles.cancha} numberOfLines={1}>
          {[reserva.canchaNombre, reserva.canchaTipo].filter(Boolean).join(' · ')}
        </Text>

        <Text style={styles.cuando}>
          {fechaLarga(reserva.fecha)} · {reserva.horaInicio}–{reserva.horaFin}
        </Text>

        {reserva.cobros.length ? (
          <Text style={styles.cobros}>
            Con {reserva.cobros.map((c) => c.nombre.toLowerCase()).join(', ')}
          </Text>
        ) : null}

        <View style={styles.totalFila}>
          <Text style={styles.totalK}>
            {reserva.soyOrganizador ? 'Total' : 'Total del partido'}
          </Text>
          <Text style={styles.totalV}>{formatCLP(reserva.precioTotal)}</Text>
        </View>

        {!reserva.soyOrganizador ? (
          <Text style={styles.nota}>Te invitaron a este partido: lo organiza otra persona.</Text>
        ) : nota ? (
          <Text style={styles.nota}>{nota}</Text>
        ) : null}

        {mapa || acciones.length ? (
          <View style={styles.acciones}>
            {mapa ? (
              <Button
                label="Cómo llegar"
                variant="secondary"
                icon={MapPin}
                style={{ flex: 1 }}
                onPress={() => Linking.openURL(mapa)}
              />
            ) : null}
            {acciones.map((a) => (
              <Button
                key={a.clave}
                label={a.label}
                variant={a.clave === 'cancelar' ? 'secondary' : 'primary'}
                style={{ flex: 1 }}
                onPress={() => onAccion(reserva, a.clave)}
              />
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function Vacio({ navigation }) {
  return (
    <View style={{ gap: 16 }}>
      <Card>
        <Text style={styles.vacioTitulo}>Todavía no has reservado nada</Text>
        <Text style={styles.vacioTexto}>
          Cuando reserves una cancha va a aparecer acá: a qué hora, dónde queda y cuánto pagaste.
        </Text>
      </Card>
      <Button label="Buscar una cancha" onPress={() => navigation.goBack()} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: S.screenPadding, paddingTop: 6, paddingBottom: 12,
  },
  headerTitle: { flex: 1, fontFamily: F.extraBold, fontSize: 20, color: C.textPrimary },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 40 },

  seccion: { fontFamily: F.extraBold, fontSize: 11.5, letterSpacing: 0.8, color: C.textMuted },

  foto: {
    width: '100%', aspectRatio: 16 / 9, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceAlt,
  },
  fotoBadge: { position: 'absolute', left: 12, top: 12 },

  cuerpo: { padding: 16 },
  complejo: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  cancha: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, marginTop: 3 },
  cuando: { fontFamily: F.bold, fontSize: 13.5, color: C.green, marginTop: 10 },
  cobros: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 5 },

  totalFila: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 13, paddingTop: 13, borderTopWidth: 1, borderTopColor: C.dividerInner,
  },
  totalK: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary },
  totalV: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary },

  nota: { fontFamily: F.medium, fontSize: 11.5, lineHeight: 16.5, color: C.textMuted, marginTop: 11 },
  acciones: { flexDirection: 'row', gap: 9, marginTop: 13 },

  hojaTexto: { fontFamily: F.medium, fontSize: 13, lineHeight: 19.5, color: C.textSecondary },
  vacioTitulo: { fontFamily: F.extraBold, fontSize: 17, color: C.textPrimary },
  vacioTexto: { fontFamily: F.medium, fontSize: 13.5, lineHeight: 19.5, color: C.textSecondary, marginTop: 8 },
});
