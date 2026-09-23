import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Info, UserPlus, BellRing, Check, X } from 'lucide-react-native';

import { paleta as C, fuentes as F } from '../theme/colors';
import {
  IconButton, Card, NoticeCard, StickyFooter, Button, Badge, Foto, SectionLabel,
} from '../components/reservas/ui';
import {
  detalleReserva, autorizarMiParte, quitarJugador, recordarPago,
  rechazarInvitacion, getMiBalance,
} from '../services/reservas';
import {
  avanceDeGrupo, etiquetaDeParticipante, miAccion, motivoLegible, puedeQuitar, puedeRecordar,
  textosDeModalidad,
} from '../utils/pagoDividido';
import { alcanzaPara } from '../utils/saldo';
import { formatCLP } from '../services/reservasRules';
// `Alert.alert` no abre NADA en la app web: sacar a alguien y salirse de la
// reserva no hacían absolutamente nada ahí, en silencio. Ver la cabecera de
// `useConfirmacion`, que existe por esto mismo.
import useConfirmacion from '../components/useConfirmacion';

/**
 * El grupo de una reserva dividida: quién va, quién ya puso su parte.
 *
 * UNA SOLA PANTALLA PARA LOS DOS LADOS. El organizador y el invitado ven lo
 * mismo; lo único que cambia es la acción de abajo y si aparecen los botones
 * de invitar, empujar y sacar. Hacer dos pantallas habría significado dos
 * copias de la nómina y del avance, que es justo lo que se desincroniza.
 *
 * LO QUE ESTA PANTALLA NO PUEDE PROMETER. Mientras el grupo se arma, la hora
 * SIGUE LIBRE para otros grupos: el índice único del slot solo protege las
 * reservas confirmadas (migración 55). Por eso el aviso de arriba no dice
 * «tu hora está reservada» sino lo contrario, y por eso el texto de «ocupado»
 * empieza diciendo que no se cobró nada.
 *
 * NADIE PAGA HASTA EL FINAL. Poner la parte es AUTORIZAR un cobro del
 * Balance, no moverlo. El cobro ocurre entero, a todos a la vez, cuando entra
 * el último — y si nunca entra, no hay una sola devolución que hacer. Eso es
 * lo que hace que el pago dividido sea solo con Balance.
 *
 * EL SALDO AJENO NO SE MUESTRA NUNCA. La nómina dice «falta que confirme», no
 * «no le alcanza», aunque el servidor sepa la diferencia: `balance_movimientos`
 * solo deja ver lo propio y esa promesa no se rompe para pintar una lista.
 */
export default function ArmarReservaScreen({ navigation, route }) {
  const { reservaId } = route.params || {};
  const { confirmar, dialogo } = useConfirmacion();
  const [detalle, setDetalle] = useState(null);
  const [saldo, setSaldo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    const [{ data, error: e }, { data: s }] = await Promise.all([
      detalleReserva(reservaId),
      getMiBalance(),
    ]);
    if (e) setError(e.message);
    else { setDetalle(data); setError(null); }
    setSaldo(s?.saldo ?? null);
    setLoading(false);
  }, [reservaId]);

  useEffect(() => { load(); }, [load]);
  // Al volver de invitar, la nómina cambió.
  useEffect(() => navigation.addListener('focus', load), [navigation, load]);

  const poneMiParte = async () => {
    setOcupado(true);
    setAviso(null);
    const { data, error: e } = await autorizarMiParte(reservaId, detalle.cuota);
    setOcupado(false);

    if (e || !data?.ok) {
      setAviso({ tono: 'warning', texto: motivoLegible(data?.reason) || e?.message || 'No se pudo.' });
      return;
    }
    if (data.confirmada) {
      setAviso({ tono: 'success', texto: '¡Listo! Entraste último y la cancha quedó reservada.' });
    } else if (data.confirmacion && !data.confirmacion.ok) {
      // Estaban todos, pero la confirmación no pasó. Lo que la persona
      // necesita saber es que SU parte quedó dada y que no le cobraron.
      setAviso({ tono: 'warning', texto: motivoLegible(data.confirmacion.reason) });
    } else {
      setAviso({ tono: 'success', texto: 'Tu parte quedó puesta. Se cobra cuando estén todos.' });
    }
    load();
  };

  const sacar = (p) => {
    confirmar(
      `¿Sacar a ${p.nombre}?`,
      'Queda fuera de la reserva y se le avisa. Puedes invitar a otra persona en su lugar.',
      async () => {
        // Mismo guardia que `poneMiParte`: sin esto, un doble toque sobre el
        // botón de «Sacar» (a diferencia del diálogo, que sólo protege UN
        // toque) podía mandar dos llamadas seguidas.
        if (ocupado) return;
        setOcupado(true);
        const { data, error: e } = await quitarJugador(reservaId, p.userId);
        setOcupado(false);
        if (e || !data?.ok) setAviso({ tono: 'warning', texto: data?.reason || e?.message });
        load();
      },
      { confirmar: 'Sacar', cancelar: 'No' }
    );
  };

  const empujar = async () => {
    if (ocupado) return;
    setOcupado(true);
    const { data, error: e } = await recordarPago(reservaId);
    setOcupado(false);
    setAviso(data?.ok
      ? { tono: 'success', texto: `Les avisamos a ${data.avisados}.` }
      : { tono: 'warning', texto: data?.reason || e?.message || 'No se pudo avisar.' });
  };

  const salirme = () => {
    confirmar(
      '¿Salirte de esta reserva?',
      'Le avisamos al organizador para que invite a alguien más. No pagaste nada, así que no hay nada que devolver.',
      async () => {
        const { data } = await rechazarInvitacion(reservaId);
        if (data?.ok) navigation.goBack();
        else setAviso({ tono: 'warning', texto: data?.reason || 'No se pudo.' });
      },
      { confirmar: 'Salirme', cancelar: 'Me quedo' }
    );
  };

  if (loading) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.center}><ActivityIndicator color={C.green} /></View>
      </SafeAreaView>
    );
  }

  if (!detalle) {
    return (
      <SafeAreaView edges={['top']} style={styles.root}>
        <View style={styles.header}>
          <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
          <Text style={styles.headerTitle}>El grupo</Text>
        </View>
        <View style={{ padding: 20 }}>
          <NoticeCard tone="warning">{error || 'No pudimos abrir esta reserva.'}</NoticeCard>
        </View>
      </SafeAreaView>
    );
  }

  const avance = avanceDeGrupo(detalle);
  const accion = miAccion(detalle);
  const textos = textosDeModalidad(detalle.modalidad);
  const aInvitar = {
    reservaId,
    faltan: detalle.faltanInvitar,
    yaEstan: detalle.participantes.map((p) => p.userId),
    modalidad: detalle.modalidad,
  };
  const armando = detalle.estado === 'armando';
  // El saldo propio sí se puede mirar, y es la única forma de avisarle a
  // alguien ANTES de que apriete que no le va a alcanzar. `alcanzaPara`
  // devuelve null cuando no se sabe, y eso NO bloquea: un error de red no
  // tiene por qué apagar el botón de pagar.
  const saldoCorto = accion?.clave === 'autorizar' && alcanzaPara(saldo, detalle.cuota) === false;

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>El grupo</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {detalle.complejoNombre} · {detalle.canchaNombre}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Card>
          <View style={styles.avanceRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.avanceTexto}>{avance.texto}</Text>
              <Text style={styles.avanceSub}>
                {detalle.horaInicio}–{detalle.horaFin} · {formatCLP(detalle.cuota)} cada uno
              </Text>
            </View>
            <Badge
              label={detalle.estado === 'confirmada' ? 'Confirmada' : `${avance.listos}/${avance.cupos}`}
              tone={detalle.estado === 'confirmada' ? 'green' : 'amber'}
            />
          </View>
          <View style={styles.barra}>
            <View style={[styles.barraLlena, { width: `${Math.min(100, (avance.listos / Math.max(1, avance.cupos)) * 100)}%` }]} />
          </View>
          <Text style={styles.totalNota}>
            Total de la cancha {formatCLP(detalle.precioTotal)}, dividido entre {avance.cupos}.
          </Text>
        </Card>

        {armando ? (
          <NoticeCard tone="info" icon={Info}>
            La hora todavía no es del grupo: sigue disponible para otros hasta que estén todos.
            Nadie paga hasta ese momento — si el grupo no se completa, no se cobra nada a nadie.
          </NoticeCard>
        ) : null}

        {aviso ? <NoticeCard tone={aviso.tono}>{aviso.texto}</NoticeCard> : null}

        {saldoCorto ? (
          <NoticeCard tone="warning">
            Tu saldo es {formatCLP(saldo)} y tu parte son {formatCLP(detalle.cuota)}. Cargar saldo
            todavía no está disponible: es lo único que falta para que esto funcione de verdad.
          </NoticeCard>
        ) : null}

        <SectionLabel>{textos.quienes}</SectionLabel>
        <Card padded={false} style={{ paddingVertical: 4 }}>
          {detalle.participantes.map((p) => {
            const et = etiquetaDeParticipante(p);
            return (
              <View key={p.userId} style={styles.fila}>
                <Foto uri={p.fotoUrl} style={styles.avatar} iconSize={16} alt={`Foto de ${p.nombre}`} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.nombre} numberOfLines={1}>
                    {p.nombre}{p.soyYo ? ' · tú' : ''}
                  </Text>
                  <Text style={styles.rol}>
                    {p.rol === 'organizador' ? 'Organiza' : p.rol === 'capitan' ? 'Capitán' : 'Jugador'}
                  </Text>
                </View>
                <Badge label={et.texto} tone={et.tono} />
                {puedeQuitar(detalle, p) ? (
                  <IconButton
                    icon={X}
                    size={30}
                    onPress={() => sacar(p)}
                    accessibilityLabel={`Sacar a ${p.nombre}`}
                  />
                ) : null}
              </View>
            );
          })}
        </Card>

        {detalle.soyOrganizador && armando ? (
          <View style={{ gap: 10 }}>
            {detalle.faltanInvitar > 0 ? (
              <Button
                variant="secondary"
                icon={UserPlus}
                label={detalle.modalidad === 'capitanes'
                  ? textos.invitar
                  : `Invitar ${detalle.faltanInvitar} ${detalle.faltanInvitar === 1 ? 'jugador' : 'jugadores'}`}
                onPress={() => navigation.navigate('InvitarJugadores', aInvitar)}
              />
            ) : null}
            {puedeRecordar(detalle) ? (
              <Button variant="secondary" icon={BellRing} label="Recordarles a los que faltan" onPress={empujar} disabled={ocupado} />
            ) : null}
          </View>
        ) : null}

        {!detalle.soyOrganizador && armando && detalle.miEstado !== 'rechazado' ? (
          <Button variant="secondary" label="Salirme de esta reserva" onPress={salirme} />
        ) : null}
      </ScrollView>

      {accion && accion.clave !== 'listo' ? (
        <StickyFooter>
          <Button
            label={accion.label}
            icon={accion.clave === 'autorizar' ? Check : undefined}
            disabled={accion.clave === 'esperar' || saldoCorto}
            loading={ocupado}
            onPress={accion.clave === 'autorizar'
              ? poneMiParte
              : () => navigation.navigate('InvitarJugadores', aInvitar)}
          />
        </StickyFooter>
      ) : null}
      {dialogo}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontFamily: F.extraBold, color: C.textPrimary, fontSize: 17, letterSpacing: -0.2 },
  headerSub: { fontFamily: F.medium, color: C.textSecondary, fontSize: 12, marginTop: 2 },

  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 130, gap: 14 },

  avanceRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avanceTexto: { fontFamily: F.extraBold, fontSize: 18, color: C.textPrimary, letterSpacing: -0.3 },
  avanceSub: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary, marginTop: 4 },
  barra: { height: 6, borderRadius: 999, backgroundColor: C.surfaceAlt, marginTop: 14, overflow: 'hidden' },
  barraLlena: { height: '100%', borderRadius: 999, backgroundColor: C.green },
  totalNota: { fontFamily: F.medium, fontSize: 11.5, color: C.textMuted, marginTop: 10 },

  fila: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11 },
  avatar: {
    width: 38, height: 38, borderRadius: 999, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border,
  },
  nombre: { fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  rol: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, marginTop: 2 },
});
