import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, AppState, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, CheckCircle2, Clock, AlertTriangle, CreditCard } from 'lucide-react-native';

import { reservas as C, reservasFonts as F } from '../theme/colors';
import { IconButton, Card, Button, StickyFooter, NoticeCard } from '../components/reservas/ui';
import { iniciarPagoReserva, estadoDePago } from '../services/pagos';
import {
  faseDePago, sigueEsperando, esperaSiguiente, seAcaboLaEspera, textoDeFase, accionDeFase,
} from '../utils/pagosCliente';
import { formatCLP } from '../services/reservasRules';

/**
 * El pago de la reserva con tarjeta.
 *
 * LA PANTALLA NO SABE SI SE PAGÓ. Lo pregunta. El estado lo escribe el aviso
 * firmado del proveedor contra la base (migración 78), y acá lo único que
 * pasa es abrir la ventana de pago y después consultar cómo quedó la fila.
 * Cualquier otra cosa —creerle al navegador que volvió, o al parámetro de una
 * URL— es la manera de regalar canchas.
 *
 * LA HORA TODAVÍA NO ES SUYA MIENTRAS ESTO CORRE. Una reserva sin confirmar
 * no ocupa el bloque: otro grupo puede llevárselo justo mientras se paga, y
 * en ese caso la plata ya se movió. Eso no es un error escondido, es un
 * resultado posible del flujo, tiene su propia fase (`devolver`) y se dice
 * completo: el cobro se revierte sin descuentos.
 *
 * POR QUÉ SE VUELVE A PREGUNTAR Y NO SE ESPERA UN AVISO. Entre que alguien
 * paga y el aviso llega a la base pasan segundos, y la persona vuelve a la
 * app antes. Se consulta con una espera que arranca en 2 s y se suelta hasta
 * 10 s, y a los cinco minutos se deja de mirar — diciendo que se dejó de
 * mirar, no que el pago falló.
 */
export default function PagoReservaScreen({ navigation, route }) {
  const { reservaId, monto, resumen } = route.params || {};

  const [fase, setFase] = useState('preparando');
  const [pago, setPago] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [abandonada, setAbandonada] = useState(false);

  // En refs y no en estado: el bucle de consulta se arma una vez y no puede
  // depender de valores que se renderizan, o quedaría preguntando con datos
  // viejos.
  const timer = useRef(null);
  const intento = useRef(0);
  const desde = useRef(0);
  const vivo = useRef(true);
  const faseRef = useRef('preparando');

  const fijarFase = useCallback((f) => { faseRef.current = f; setFase(f); }, []);

  const consultar = useCallback(async () => {
    const { data } = await estadoDePago(reservaId);
    if (!vivo.current || !data) return;
    setPago(data.pago);
    setDetalle(data.reserva);
    fijarFase(faseDePago(data.pago, data.reserva));
  }, [reservaId, fijarFase]);

  /** Vuelve a preguntar hasta que la respuesta deje de poder cambiar. */
  const programar = useCallback(() => {
    clearTimeout(timer.current);
    if (!sigueEsperando(faseRef.current)) return;
    if (seAcaboLaEspera(Date.now() - desde.current)) { setAbandonada(true); return; }
    timer.current = setTimeout(async () => {
      intento.current += 1;
      await consultar();
      programar();
    }, esperaSiguiente(intento.current));
  }, [consultar]);

  // ── Arranque: armar el cobro y mandar a pagar ────────────────
  useEffect(() => {
    vivo.current = true;
    (async () => {
      const { data, error } = await iniciarPagoReserva(reservaId);
      if (!vivo.current) return;
      if (error) {
        // `configurada: false` es «la pasarela todavía no existe», que no es
        // lo mismo que «falló»: se dice distinto porque es otra cosa.
        fijarFase(data?.configurada === false ? 'nodisponible' : 'error');
        setPago({ reason: error.message });
        return;
      }
      desde.current = Date.now();
      fijarFase('pagando');
      try {
        await Linking.openURL(data.url);
      } catch {
        // No se pudo abrir la ventana. El cobro EXISTE en el proveedor, así
        // que no se declara fallido: se deja el enlace a mano.
        setPago({ url: data.url, reason: 'No pudimos abrir la ventana de pago.' });
      }
      programar();
    })();
    return () => { vivo.current = false; clearTimeout(timer.current); };
  }, [reservaId, fijarFase, programar]);

  // ── Volver a la app es la mejor señal que tenemos ────────────
  useEffect(() => {
    const sub = AppState.addEventListener('change', (estado) => {
      if (estado !== 'active' || !sigueEsperando(faseRef.current)) return;
      if (faseRef.current === 'pagando') fijarFase('esperando');
      intento.current = 0;
      setAbandonada(false);
      if (!desde.current) desde.current = Date.now();
      consultar().then(programar);
    });
    return () => sub.remove();
  }, [consultar, programar, fijarFase]);

  const texto = textoDeFase(fase);
  const accion = accionDeFase(fase);
  const esperando = sigueEsperando(fase);
  const total = detalle?.precio_total ?? monto ?? null;

  const ejecutar = () => {
    if (accion?.accion === 'inicio') navigation.navigate('Main');
    else if (accion?.accion === 'reintentar') navigation.goBack();
    else if (accion?.accion === 'buscar') navigation.navigate('Main');
    else navigation.goBack();
  };

  const Icono = fase === 'confirmada' ? CheckCircle2
    : esperando ? Clock
      : AlertTriangle;
  const color = fase === 'confirmada' ? C.green
    : esperando ? C.textSecondary
      : C.textAmber;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        {/* Mientras se espera no se ofrece volver: salir de acá no cancela
            nada y solo haría pensar que sí. */}
        {!esperando ? (
          <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        ) : <View style={{ width: 40 }} />}
        <Text style={styles.headerTitle}>Pago de la reserva</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Card>
          <View style={styles.estadoFila}>
            {esperando
              ? <ActivityIndicator color={C.green} />
              : <Icono color={color} size={26} strokeWidth={2.2} />}
            <Text style={[styles.estadoTitulo, { color }]}>{texto.titulo}</Text>
          </View>
          <Text style={styles.estadoCuerpo}>{texto.cuerpo}</Text>
          {pago?.reason && fase !== 'nodisponible' ? (
            <Text style={styles.estadoDetalle}>{pago.reason}</Text>
          ) : null}
        </Card>

        {resumen ? (
          <Card style={{ paddingVertical: 6, paddingHorizontal: 16 }}>
            {[
              ['Recinto', resumen.recinto],
              ['Cancha', resumen.cancha],
              ['Cuándo', resumen.cuando],
            ].filter(([, v]) => !!v).map(([k, v], i, xs) => (
              <View key={k} style={[styles.fila, i < xs.length - 1 && styles.filaDivider]}>
                <Text style={styles.filaK}>{k}</Text>
                <Text style={styles.filaV} numberOfLines={1}>{v}</Text>
              </View>
            ))}
            {total != null ? (
              <View style={[styles.fila, { borderTopWidth: 1, borderTopColor: C.dividerInner }]}>
                <Text style={styles.filaK}>Total</Text>
                <Text style={[styles.filaV, { color: C.green, fontSize: 16 }]}>{formatCLP(total)}</Text>
              </View>
            ) : null}
          </Card>
        ) : null}

        {esperando ? (
          <NoticeCard tone="info" icon={CreditCard}>
            Mientras esto se resuelve, la hora sigue disponible para otros grupos: se toma recién
            cuando el pago queda confirmado. Si otro grupo la confirma primero, te devolvemos el
            total.
          </NoticeCard>
        ) : null}

        {abandonada ? (
          <NoticeCard tone="warning">
            Llevamos varios minutos sin novedades del banco. Eso no quiere decir que el pago haya
            fallado: si salió, tu reserva va a aparecer confirmada igual y te avisamos. Puedes
            revisarla en «Mis reservas».
          </NoticeCard>
        ) : null}

        {fase === 'nodisponible' ? (
          <NoticeCard tone="warning">
            Tu reserva quedó guardada pero sin pagar, así que la hora no está tomada y se vence
            sola. Cuando conectemos el medio de pago vas a poder completarla.
          </NoticeCard>
        ) : null}
      </ScrollView>

      {accion ? (
        <StickyFooter>
          <Button label={accion.label} onPress={ejecutar} />
        </StickyFooter>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, letterSpacing: -0.2 },
  scroll: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 110, gap: 14 },

  estadoFila: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  estadoTitulo: { flex: 1, fontFamily: F.extraBold, fontSize: 17, letterSpacing: -0.2 },
  estadoCuerpo: { fontFamily: F.medium, fontSize: 13, lineHeight: 19.5, color: C.textSecondary, marginTop: 11 },
  estadoDetalle: { fontFamily: F.semiBold, fontSize: 12, lineHeight: 17, color: C.textMuted, marginTop: 9 },

  fila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingVertical: 13 },
  filaDivider: { borderBottomWidth: 1, borderBottomColor: C.dividerInner },
  filaK: { fontFamily: F.medium, color: C.textSecondary, fontSize: 13 },
  filaV: { flexShrink: 1, fontFamily: F.bold, color: C.textPrimary, fontSize: 14, textAlign: 'right' },
});
