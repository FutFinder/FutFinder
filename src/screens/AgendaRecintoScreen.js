import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { ArrowLeft, ChevronRight, AlertTriangle, Lock, Wrench, ExternalLink } from 'lucide-react-native';

import { reservas as C, reservasRadius as R, reservasSizes as S, reservasFonts as F } from '../theme/colors';
import { Card, IconButton, Chip, Badge, NoticeCard } from '../components/reservas/ui';
import { Skeleton, ContactActions, WeekStrip } from '../components/reservas/recintoUi';
import NotificationBell from '../components/NotificationBell';
import { agendaDelDia } from '../services/recinto';
import {
  intercalarAgenda, estadoOperativo, avancePago, enlacesDeContacto, terminoLocal,
} from '../utils/recintoAgenda';
import {
  hoyISO, sumarDias, fechaRelativa, resumenDeAgenda, etiquetaDeReserva,
  duracionEnMinutos, etiquetaDuracion, semanaDe, haceCuanto,
} from '../utils/recintoPantallas';
import { formatCLP } from '../services/reservasRules';

const NOTA_PRIVACIDAD =
  'El nombre y el número son solo de esta reserva. No se guardan en una lista de contactos ni se '
  + 'pueden exportar. Doce horas después del partido, la persona vuelve a ser su @usuario.';

/**
 * Agenda del día del recinto completo (artboard 3a).
 *
 * DOS COSAS QUE NO SE PUEDEN CONTAR MAL ACÁ:
 *
 * · Una reserva SIN CONFIRMAR no ocupa la hora. Se dibuja con borde punteado y
 *   el texto dice explícitamente que la hora sigue disponible para otros
 *   grupos. El diseño lo contó al revés dos veces («la hora queda tomada») y
 *   es la regla central del vertical.
 *
 * · Una hora arrendada por fuera NO es lo mismo que una hora cerrada. La
 *   primera significa que va a llegar gente, y quien abre el recinto necesita
 *   saberlo; la segunda que la cancha no se usa. Por eso llevan icono, color y
 *   texto distintos, aunque para el jugador las dos se vean igual.
 */
export default function AgendaRecintoScreen({ navigation, route }) {
  const { complejoId } = route.params || {};
  const hoy = hoyISO();
  const [fecha, setFecha] = useState(hoy);
  const [otroDia, setOtroDia] = useState(false);
  const [agenda, setAgenda] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const { data, error: err } = await agendaDelDia(complejoId, fecha);
    setAgenda(data);
    setError(err?.message || null);
    setCargando(false);
  }, [complejoId, fecha]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const items = useMemo(
    () => intercalarAgenda(agenda?.reservas, agenda?.bloqueos),
    [agenda],
  );

  return (
    <SafeAreaView edges={['top']} style={styles.root}>
      <View style={styles.header}>
        <IconButton icon={ArrowLeft} onPress={() => navigation.goBack()} accessibilityLabel="Volver" />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Agenda</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {fechaRelativa(fecha)} · {resumenDeAgenda(agenda)}
          </Text>
        </View>
        <NotificationBell />
      </View>

      <View style={styles.filtros}>
        <Chip label="Hoy" active={fecha === hoy && !otroDia} onPress={() => { setOtroDia(false); setFecha(hoy); }} />
        <Chip
          label="Mañana"
          active={fecha === sumarDias(hoy, 1) && !otroDia}
          onPress={() => { setOtroDia(false); setFecha(sumarDias(hoy, 1)); }}
        />
        <Chip label="Otro día" active={otroDia} onPress={() => setOtroDia((v) => !v)} />
      </View>

      {otroDia ? (
        <View style={styles.semanaWrap}>
          <WeekStrip dias={semanaDe(fecha)} seleccionada={fecha} onSelect={setFecha} />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={false} onRefresh={cargar} tintColor={C.green} />}
      >
        {cargando ? (
          <View style={{ gap: S.cardGap }}>
            {[0, 1, 2].map((i) => (
              <Card key={i}><Skeleton height={16} width="55%" /><Skeleton height={12} width="75%" style={{ marginTop: 9 }} /></Card>
            ))}
          </View>
        ) : error ? (
          <NoticeCard tone="warning" icon={AlertTriangle}>{error}</NoticeCard>
        ) : items.length === 0 ? (
          <Card>
            <Text style={styles.vacioTitulo}>Nada agendado {fechaRelativa(fecha).toLowerCase()}</Text>
            <Text style={styles.vacioTexto}>
              Cuando alguien reserve una cancha, o cuando marques una hora como ocupada, aparece acá.
            </Text>
          </Card>
        ) : (
          <View style={{ gap: S.cardGap }}>
            {items.map((it) =>
              it.tipo === 'reserva' ? (
                <FilaReserva
                  key={`r-${it.dato.id}`}
                  reserva={it.dato}
                  onPress={() => navigation.navigate('ReservaRecinto', { reservaId: it.dato.id })}
                />
              ) : (
                <FilaBloqueo key={`b-${it.dato.id}`} bloqueo={it.dato} />
              ),
            )}
            <Text style={styles.pie}>{NOTA_PRIVACIDAD}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/* ── Una reserva ────────────────────────────────────────────────────────── */

function FilaReserva({ reserva, onPress }) {
  const estado = estadoOperativo(reserva);
  const rotulo = etiquetaDeReserva(estado);
  const enCurso = estado === 'en_curso';
  const cancelada = estado === 'cancelada';
  const pago = avancePago(reserva);
  const contacto = enlacesDeContacto(reserva);
  const cobros = reserva.cobros || [];
  const duracion = etiquetaDuracion(duracionEnMinutos(reserva.hora_inicio, reserva.hora_fin));
  const fin = terminoLocal(reserva);

  return (
    <Card onPress={onPress} style={enCurso ? styles.tarjetaPunteada : undefined}>
      <View style={styles.filaCabecera}>
        <View style={styles.horaBloque}>
          <Text style={styles.hora}>{reserva.hora_inicio}</Text>
          {duracion ? <Text style={styles.duracion}>{duracion}</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.quien} numberOfLines={1}>
            {reserva.contacto_nombre
              ? `${reserva.contacto_nombre} · @${reserva.organizador_username}`
              : `@${reserva.organizador_username}`}
          </Text>
          <Text style={styles.donde} numberOfLines={1}>
            {reserva.cancha_nombre} · {String(reserva.cancha_tipo || '').replace('_', ' ')}
            {estado === 'jugada' && fin ? ` · terminó ${haceCuanto(fin)}` : ''}
          </Text>
        </View>
        <Badge label={rotulo.texto} tone={rotulo.tono} />
      </View>

      {enCurso && pago ? (
        <View style={styles.avisoEnCurso}>
          <Text style={styles.avisoEnCursoTexto}>
            Están juntando el pago dividido: {pago.aceptados} de {pago.total} pagaron.{' '}
            <Text style={styles.avisoEnCursoFuerte}>Esta hora sigue disponible</Text> — si otro grupo
            completa el pago primero, se la lleva.
          </Text>
        </View>
      ) : null}

      {cobros.length > 0 && !cancelada ? (
        <View style={styles.preparar}>
          <Text style={styles.prepararTitulo}>Tienes que preparar</Text>
          <View style={styles.prepararChips}>
            {cobros.map((c) => (
              <View key={c.nombre} style={styles.prepararChip}>
                <Text style={styles.prepararChipTexto}>{c.nombre}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {contacto ? (
        <View style={{ marginTop: 12 }}>
          <ContactActions contacto={contacto} nota="Contacto de esta reserva" />
        </View>
      ) : enCurso ? (
        <Text style={styles.sinContacto}>
          Sin nombre ni teléfono todavía: se muestran cuando la reserva quede confirmada.
        </Text>
      ) : null}

      <View style={styles.filaPie}>
        <Text style={styles.monto}>{formatCLP(reserva.precio_total)}</Text>
        <ChevronRight color={C.textSecondary} size={16} strokeWidth={2.2} />
      </View>
    </Card>
  );
}

/* ── Una hora ocupada por el recinto ────────────────────────────────────── */

function FilaBloqueo({ bloqueo }) {
  const externo = bloqueo.tipo === 'externo';
  const contacto = externo && bloqueo.contacto_telefono
    ? enlacesDeContacto({ contacto_nombre: bloqueo.contacto_nombre, contacto_telefono: bloqueo.contacto_telefono })
    : null;
  const Icono = externo ? ExternalLink : Wrench;

  return (
    <Card style={styles.tarjetaAmbar}>
      <View style={styles.filaCabecera}>
        <View style={styles.horaBloque}>
          <Text style={styles.hora}>{bloqueo.hora_inicio}</Text>
          <Text style={styles.duracion}>a {bloqueo.hora_fin}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.bloqueoTituloFila}>
            <Icono color={C.textAmber} size={14} strokeWidth={2.2} />
            <Text style={styles.bloqueoTitulo} numberOfLines={1}>
              {externo ? (bloqueo.contacto_nombre || 'Arriendo por fuera') : 'Cancha cerrada'}
            </Text>
          </View>
          <Text style={styles.donde} numberOfLines={2}>
            {bloqueo.cancha_nombre}
            {bloqueo.motivo ? ` · ${bloqueo.motivo}` : ''}
          </Text>
        </View>
        <Badge label={externo ? 'Fuera de la app' : 'Cerrada'} tone="amber" />
      </View>

      {contacto ? (
        <View style={{ marginTop: 12 }}>
          <ContactActions contacto={contacto} nota="Lo anotaste tú al marcar la hora" />
        </View>
      ) : null}

      <View style={styles.bloqueoNota}>
        <Lock color={C.textSecondary} size={11} strokeWidth={2.2} style={{ marginTop: 2 }} />
        <Text style={styles.bloqueoNotaTexto}>
          {externo
            ? 'No pasa por FutFinder: no hay pago ni comisión. Está acá para que sepas que la cancha se ocupa.'
            : 'Los jugadores solo ven esa hora como no disponible. El motivo no lo ve nadie más que tú.'}
        </Text>
      </View>
    </Card>
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
  filtros: { flexDirection: 'row', gap: 8, paddingHorizontal: S.screenPadding, paddingBottom: 10 },
  semanaWrap: { paddingHorizontal: S.screenPadding, paddingBottom: 12 },
  scroll: { paddingHorizontal: S.screenPadding, paddingBottom: 40 },

  tarjetaPunteada: { borderStyle: 'dashed', borderColor: C.dashedBorderStrong },
  tarjetaAmbar: { borderColor: C.amberBorder, backgroundColor: C.amberSoft },

  filaCabecera: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  horaBloque: { width: 54 },
  hora: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  duracion: { fontFamily: F.medium, fontSize: 11, color: C.textSecondary, marginTop: 2 },
  quien: { fontFamily: F.bold, fontSize: 14.5, color: C.textPrimary },
  donde: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 3, lineHeight: 16.5 },

  avisoEnCurso: {
    marginTop: 11,
    padding: 11,
    borderRadius: R.cardSm,
    backgroundColor: C.surfaceAlt,
    borderWidth: 1,
    borderColor: C.border,
  },
  avisoEnCursoTexto: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  avisoEnCursoFuerte: { fontFamily: F.extraBold, color: C.green },

  preparar: { marginTop: 12 },
  prepararTitulo: {
    fontFamily: F.extraBold, fontSize: 10.5, letterSpacing: 0.8,
    color: C.textAmber, textTransform: 'uppercase', marginBottom: 7,
  },
  prepararChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  prepararChip: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: R.pill, borderWidth: 1,
    borderColor: C.amberBorder, backgroundColor: C.amberSoft,
  },
  prepararChipTexto: { fontFamily: F.bold, fontSize: 11.5, color: C.textAmber },

  sinContacto: {
    marginTop: 11, fontFamily: F.medium, fontSize: 11.5,
    color: C.textSecondary, lineHeight: 16,
  },

  filaPie: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: C.dividerInner,
  },
  monto: { fontFamily: F.extraBold, fontSize: 14.5, color: C.textPrimary },

  bloqueoTituloFila: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bloqueoTitulo: { flexShrink: 1, fontFamily: F.bold, fontSize: 14.5, color: C.textPrimary },
  bloqueoNota: { flexDirection: 'row', gap: 6, marginTop: 11 },
  bloqueoNotaTexto: { flex: 1, fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15.5 },

  vacioTitulo: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  vacioTexto: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary, lineHeight: 18.5, marginTop: 7 },
  pie: { fontFamily: F.medium, fontSize: 11, color: C.textMuted, lineHeight: 16, marginTop: 6 },
});
