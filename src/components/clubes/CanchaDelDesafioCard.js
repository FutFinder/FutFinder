import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { MapPin, Search, CalendarPlus, Timer, CheckCircle2, Lock, TriangleAlert } from 'lucide-react-native';

import { paleta as C, radios as R, fuentes as F } from '../../theme/colors';
import { formatCLP } from '../../services/reservasRules';
import { restanteDelPlazo, formatoReloj } from '../../utils/canchaDelDesafio';

/**
 * La cancha del partido, dentro del chat del desafío (migración 202, diseño
 * «Clubes (preservas)», láminas 1, 4A, 5 y 7).
 *
 * NO DECIDE QUÉ MOSTRAR: eso lo dice `vistaDeLaCancha()`, puro y probado. Esta
 * tarjeta sólo dibuja la vista que le llega y avisa qué botón se tocó.
 *
 * EL RELOJ ES DE CORTESÍA. Cuenta hacia el `plazo_at` que calcula la base; si
 * llega a cero no suelta nada por su cuenta —eso lo hace el cron cada
 * minuto— y la pantalla vuelve a preguntar.
 *
 * Variante A: en negociación se ELIGE la cancha para la propuesta; se paga
 * después de que el rival aprueba. Por eso el botón de la negociación dice
 * «Reservar cancha para este partido» pero no cobra nada.
 */
export default function CanchaDelDesafioCard({
  info,
  vista,
  ocupado = false,
  horarioOcupado = false,
  onVerCanchas,
  onElegir,
  onReservarAhora,
  onReservar,
  onPagar,
  onVerReserva,
  onElegirOtroHorario,
  onPedirCambio,
  onVencido,
}) {
  const reserva = info?.reserva || null;
  const [ahora, setAhora] = useState(() => Date.now());
  const conReloj = vista?.tipo === 'falta_rival' || vista?.tipo === 'pagar_mi_mitad';

  useEffect(() => {
    if (!conReloj) return undefined;
    const id = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [conReloj]);

  const restante = conReloj ? restanteDelPlazo(reserva?.plazo_at, ahora) : null;

  useEffect(() => {
    if (conReloj && restante === 0) onVencido?.();
    // Sólo al cruzar el cero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conReloj, restante === 0]);

  if (!vista) return null;

  const local = info?.club_local?.nombre || 'El club local';
  const rival = info?.club_visitante?.nombre || 'el club rival';
  const elegida = info?.cancha_elegida || null;
  const lugar = reserva
    ? `${reserva.cancha_nombre} · ${reserva.complejo_nombre}`
    : elegida
    ? `${elegida.cancha_nombre} · ${elegida.complejo_nombre}`
    : null;

  if (horarioOcupado) {
    return (
      <Tarjeta tono="ambar" Icono={TriangleAlert} titulo="Horario ocupado"
        texto="Ese horario ya se ocupó: elige otro o pide un cambio.">
        <Fila>
          <Boton etiqueta="Elegir otro horario" principal onPress={onElegirOtroHorario} />
          <Boton etiqueta="Pedir un cambio" onPress={onPedirCambio} />
        </Fila>
      </Tarjeta>
    );
  }

  switch (vista.tipo) {
    case 'elegir':
      return (
        <Tarjeta Icono={MapPin} titulo="¿Dónde juegan?" texto="Vean qué canchas hay libres antes de proponer.">
          <Fila>
            <Boton etiqueta="Ver canchas" Icono={Search} onPress={onVerCanchas} />
            <Boton etiqueta="Reservar cancha para este partido" Icono={CalendarPlus} principal onPress={onElegir} />
          </Fila>
        </Tarjeta>
      );

    case 'cancha_elegida':
      return (
        <Tarjeta Icono={MapPin} titulo="Cancha elegida" chip="Sin reservar todavía" texto={lugar}
          detalle={`Nadie paga hasta que ${rival} apruebe. Después ${info?.soy_local ? 'reservas' : `${local} reserva`} con un toque.`} />
      );

    case 'reservar_ahora':
      return (
        <Tarjeta Icono={CalendarPlus} titulo="Cancha del partido" chip="Falta reservar" texto={lugar}
          detalle="Todo prellenado, con pago entre los 2 capitanes.">
          <Boton etiqueta={ocupado ? 'Buscando el horario…' : 'Reservar ahora'} principal ancho
            onPress={onReservarAhora} deshabilitado={ocupado} cargando={ocupado} />
        </Tarjeta>
      );

    case 'reservar':
      return (
        <Tarjeta Icono={MapPin} titulo="Cancha del partido" chip="Falta reservar"
          texto="Reserva en un recinto de FutFinder y se paga entre los 2 capitanes.">
          <Fila>
            <Boton etiqueta="Ver canchas" Icono={Search} onPress={onVerCanchas} />
            <Boton etiqueta="Reservar cancha" Icono={CalendarPlus} principal onPress={onReservar} />
          </Fila>
        </Tarjeta>
      );

    case 'pagar_local':
      return (
        <Tarjeta Icono={Timer} tono="ambar" titulo="Reserva de la cancha" chip="Falta tu mitad" texto={lugar}
          detalle={`Paga tu mitad para que a ${rival} le corran sus 15 minutos. Si no, la cancha se suelta.`}>
          <Boton etiqueta={`Pagar mi mitad · ${formatCLP(reserva?.mitad || 0)}`} principal ancho onPress={onPagar} />
        </Tarjeta>
      );

    case 'falta_local':
      return <Tarjeta Icono={Lock} titulo="Reserva de la cancha" texto={vista.texto} />;

    case 'falta_rival':
      return (
        <Tarjeta Icono={Timer} titulo="Reserva de la cancha"
          chip={restante ? `${rival} tiene 15 min` : 'Se acabó el tiempo'} texto={lugar}
          detalle={`${local} pagó su mitad${reserva?.mitad ? ` (${formatCLP(reserva.mitad)} apartados, sin cobrar)` : ''}. Falta ${rival}: quedan ${formatoReloj(restante)}.`}>
          <Boton etiqueta="Ver reserva" ancho onPress={onVerReserva} />
        </Tarjeta>
      );

    case 'pagar_mi_mitad':
      return (
        <Tarjeta Icono={Timer} tono="ambar" titulo={`Te quedan ${formatoReloj(restante)}`} texto={lugar}
          detalle={`${local} ya reservó y pagó su mitad. Si otro equipo reserva ese horario antes, lo pierdes.`}>
          <Boton etiqueta={`Pagar con mi balance · ${formatCLP(reserva?.mitad || 0)}`} principal ancho
            onPress={onPagar} deshabilitado={restante === 0} />
        </Tarjeta>
      );

    case 'confirmada':
      return (
        <Tarjeta Icono={CheckCircle2} tono="verde" titulo="Cancha reservada" chip="Confirmada" texto={lugar}
          detalle="Pagaron los dos capitanes. Cancelación gratis hasta 12 h antes del partido.">
          <Boton etiqueta="Ver reserva" ancho onPress={onVerReserva} />
        </Tarjeta>
      );

    case 'espera_local':
    case 'solo_lectura':
      return <Tarjeta Icono={Lock} titulo={vista.tipo === 'espera_local' ? `Reserva a cargo de ${local}` : 'Sin cancha todavía'} texto={vista.texto} />;

    default:
      return null;
  }
}

function Tarjeta({ Icono, titulo, chip, texto, detalle, tono, children }) {
  const color = tono === 'ambar' ? C.amber : tono === 'verde' ? C.green : C.textSecondary;
  return (
    <View style={styles.card}>
      <View style={styles.cabeza}>
        <View style={styles.icono}>
          <Icono color={color} size={16} strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.tituloFila}>
            <Text style={styles.titulo} numberOfLines={1}>{titulo}</Text>
            {chip ? <Text style={[styles.chip, tono === 'ambar' && styles.chipAmbar, tono === 'verde' && styles.chipVerde]} numberOfLines={1}>{chip}</Text> : null}
          </View>
          {texto ? <Text style={styles.texto}>{texto}</Text> : null}
        </View>
      </View>
      {detalle ? <Text style={styles.detalle}>{detalle}</Text> : null}
      {children ? <View style={{ marginTop: 10 }}>{children}</View> : null}
    </View>
  );
}

function Fila({ children }) {
  return <View style={styles.fila}>{children}</View>;
}

function Boton({ etiqueta, Icono, principal, ancho, onPress, deshabilitado, cargando }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado || !onPress}
      accessibilityRole="button"
      accessibilityLabel={etiqueta}
      style={({ pressed }) => [
        styles.boton,
        principal ? styles.botonPrincipal : styles.botonSecundario,
        !ancho && styles.botonFlex,
        ancho && styles.botonAncho,
        (deshabilitado || !onPress) && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {cargando ? <ActivityIndicator size="small" color={principal ? C.textOnGreen : C.textPrimary} /> : null}
      {!cargando && Icono ? <Icono color={principal ? C.textOnGreen : C.textPrimary} size={15} strokeWidth={2.2} /> : null}
      <Text style={[styles.botonTexto, principal && styles.botonTextoPrincipal]} numberOfLines={2}>{etiqueta}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  cabeza: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  icono: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surfaceAlt,
  },
  tituloFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titulo: { flexShrink: 1, color: C.textPrimary, fontSize: 14, fontFamily: F.extraBold },
  chip: {
    color: C.textSecondary,
    fontSize: 10.5,
    fontFamily: F.bold,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: R.chip,
    backgroundColor: C.surfaceAlt,
    overflow: 'hidden',
  },
  chipAmbar: { color: C.amber, backgroundColor: C.amberSoft },
  chipVerde: { color: C.green, backgroundColor: C.greenSoft },
  texto: { color: C.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  detalle: { color: C.textSecondary, fontSize: 12, lineHeight: 16, marginTop: 8 },
  fila: { flexDirection: 'row', gap: 8 },
  boton: {
    minHeight: 40,
    borderRadius: R.chip,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  botonFlex: { flex: 1 },
  botonAncho: { alignSelf: 'stretch' },
  botonPrincipal: { backgroundColor: C.green },
  botonSecundario: { backgroundColor: C.surfaceAlt, borderWidth: 1, borderColor: C.border },
  botonTexto: { color: C.textPrimary, fontSize: 13, fontFamily: F.bold, textAlign: 'center', flexShrink: 1 },
  botonTextoPrincipal: { color: C.textOnGreen },
});
