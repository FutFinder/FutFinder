import React from 'react';
import { View, Text, Pressable, ScrollView, TextInput, Linking, StyleSheet } from 'react-native';
import { Phone, MessageCircle, Lock } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasSizes as S,
  reservasFonts as F,
} from '../../theme/colors';
import { Card, Sheet } from './ui';
import { formatCLP } from '../../services/reservasRules';
import { diaCorto, numeroDeDia } from '../../utils/recintoPantallas';

/**
 * Piezas propias de las pantallas del RECINTO.
 *
 * Van aparte de `ui.js` —que es el kit compartido del vertical— porque solo
 * las usan las pantallas de administración, y son las que la nota de traspaso
 * del diseño (artboard 1t) listó como faltantes. Mismos tokens, mismos radios:
 * no hay un segundo sistema visual acá, solo componentes que el lado del
 * jugador no necesita.
 */

/* ── Skeleton ───────────────────────────────────────────────────────────── */

/**
 * Bloque de carga (artboard 1e).
 *
 * Se usa en vez de un spinner cuando ya se sabe qué forma va a tener el
 * contenido: la agenda y el panel siempre traen las mismas filas, así que
 * dibujar su silueta hace que la pantalla no salte al llegar los datos.
 */
export function Skeleton({ height = 16, width = '100%', radius = 8, style }) {
  return <View style={[{ height, width, borderRadius: radius, backgroundColor: C.surfaceAlt }, style]} />;
}

/** Varias líneas de esqueleto con la última más corta, como un párrafo real. */
export function SkeletonLineas({ lineas = 3, style }) {
  return (
    <View style={[{ gap: 8 }, style]}>
      {Array.from({ length: lineas }, (_, i) => (
        <Skeleton key={i} height={14} width={i === lineas - 1 ? '55%' : '100%'} />
      ))}
    </View>
  );
}

/* ── StatusBanner ───────────────────────────────────────────────────────── */

/**
 * Franja fija arriba del panel (artboards 4g y 4i).
 *
 * No es un `NoticeCard`: va pegada al borde y no scrollea, porque describe el
 * estado del recinto completo y no un detalle de la pantalla. Un recinto no
 * publicado tiene que notarse antes de leer nada.
 */
export function StatusBanner({ texto, tono = 'amber', onPress, accion }) {
  const map = {
    amber: { bg: C.amberSoft, border: C.amberBorder, fg: C.textAmber },
    red: { bg: 'rgba(237,107,118,0.14)', border: 'rgba(237,107,118,0.4)', fg: C.red },
  }[tono] || { bg: C.amberSoft, border: C.amberBorder, fg: C.textAmber };

  const contenido = (
    <View style={[styles.banner, { backgroundColor: map.bg, borderBottomColor: map.border }]}>
      <Text style={[styles.bannerTexto, { color: map.fg }]} numberOfLines={2}>{texto}</Text>
      {accion ? <Text style={[styles.bannerAccion, { color: map.fg }]}>{accion}</Text> : null}
    </View>
  );
  if (!onPress) return contenido;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.85 }}>
      {contenido}
    </Pressable>
  );
}

/* ── Contadores del panel ───────────────────────────────────────────────── */

/** Las tres cifras de la cabecera del panel: número grande arriba, rótulo abajo. */
export function StatTrio({ items = [] }) {
  return (
    <View style={styles.statFila}>
      {items.map((it, i) => (
        <View key={it.rotulo} style={[styles.statCelda, i > 0 && styles.statBorde]}>
          <Text style={styles.statNumero}>{it.valor}</Text>
          <Text style={styles.statRotulo} numberOfLines={2}>{it.rotulo}</Text>
        </View>
      ))}
    </View>
  );
}

/* ── WeekStrip ──────────────────────────────────────────────────────────── */

/**
 * La tira de siete días del calendario (artboard 1p).
 *
 * `marcados` son las fechas con algo cargado, que llevan un punto: sirve para
 * ver de un vistazo dónde hay bloqueos sin abrir cada día.
 */
export function WeekStrip({ dias = [], seleccionada, onSelect, marcados = [] }) {
  return (
    <View style={styles.semana}>
      {dias.map((f) => {
        const on = f === seleccionada;
        return (
          <Pressable
            key={f}
            onPress={() => onSelect?.(f)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${diaCorto(f)} ${numeroDeDia(f)}`}
            style={({ pressed }) => [styles.diaCelda, on && styles.diaCeldaOn, pressed && { opacity: 0.85 }]}
          >
            <Text style={[styles.diaCorto, on && styles.diaCortoOn]}>{diaCorto(f)}</Text>
            <Text style={[styles.diaNumero, on && styles.diaNumeroOn]}>{numeroDeDia(f)}</Text>
            <View style={[styles.diaPunto, marcados.includes(f) && styles.diaPuntoOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── ContactActions ─────────────────────────────────────────────────────── */

/**
 * Número + WhatsApp + llamar, con su línea de privacidad pegada (3a, 3b).
 *
 * Va siempre junto y nunca el número solo: la línea de privacidad no es un
 * adorno legal, es lo que le dice al recinto por qué ese dato desaparece
 * después. WhatsApp va primero porque en Chile un problema de cancha se
 * resuelve por mensaje, no marcando.
 *
 * Recibe lo que devuelve `enlacesDeContacto()`; si es `null` no dibuja nada,
 * que es el caso normal fuera de la ventana de 12 horas y no un error.
 */
export function ContactActions({ contacto, nota }) {
  if (!contacto) return null;
  const abrir = (url) => Linking.openURL(url).catch(() => {});
  return (
    <View style={styles.contacto}>
      <View style={styles.contactoFila}>
        <View style={{ flex: 1 }}>
          {contacto.nombre ? <Text style={styles.contactoNombre}>{contacto.nombre}</Text> : null}
          <Text style={styles.contactoNumero}>{contacto.telefonoLegible}</Text>
        </View>
        <Pressable
          onPress={() => abrir(contacto.whatsapp)}
          accessibilityRole="button"
          accessibilityLabel="Escribir por WhatsApp"
          style={({ pressed }) => [styles.contactoBtn, styles.contactoBtnFuerte, pressed && { opacity: 0.85 }]}
        >
          <MessageCircle color={C.textOnGreen} size={16} strokeWidth={2.4} />
          <Text style={styles.contactoBtnTextoFuerte}>WhatsApp</Text>
        </Pressable>
        <Pressable
          onPress={() => abrir(contacto.llamar)}
          accessibilityRole="button"
          accessibilityLabel="Llamar"
          style={({ pressed }) => [styles.contactoBtn, pressed && { opacity: 0.85 }]}
        >
          <Phone color={C.textPrimary} size={16} strokeWidth={2.4} />
        </Pressable>
      </View>
      {nota ? (
        <View style={styles.privacidad}>
          <Lock color={C.textSecondary} size={11} strokeWidth={2.2} />
          <Text style={styles.privacidadTexto}>{nota}</Text>
        </View>
      ) : null}
    </View>
  );
}

/* ── ChoiceCard ─────────────────────────────────────────────────────────── */

/**
 * Radio + título + la consecuencia de elegirlo (artboard 1q).
 *
 * No es un Chip ni un selector: los dos motivos por los que se ocupa una hora
 * hacen cosas distintas —uno cierra la cancha, el otro dice que va a llegar
 * gente— y esa diferencia hay que poder leerla antes de elegir.
 */
export function ChoiceCard({ titulo, descripcion, seleccionado, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!seleccionado }}
      style={({ pressed }) => [
        styles.choice,
        seleccionado && styles.choiceOn,
        pressed && { opacity: 0.9 },
      ]}
    >
      <View style={[styles.radio, seleccionado && styles.radioOn]}>
        {seleccionado ? <View style={styles.radioPunto} /> : null}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceTitulo}>{titulo}</Text>
        {descripcion ? <Text style={styles.choiceDesc}>{descripcion}</Text> : null}
      </View>
    </Pressable>
  );
}

/* ── MoneyBreakdown ─────────────────────────────────────────────────────── */

/**
 * Filas monto/etiqueta con total, comisión y neto (3b, 3m, 3n).
 *
 * Los montos llegan calculados y congelados desde el servidor: este componente
 * NO suma ni aplica porcentajes. Si alguna vez hiciera la cuenta por su lado,
 * el día que cambie la tasa las reservas viejas mostrarían un número que nunca
 * se cobró.
 */
export function MoneyBreakdown({ lineas = [], total, comision, neto, nota }) {
  return (
    <View style={{ gap: 9 }}>
      {lineas.map((l) => (
        <View key={l.etiqueta} style={styles.dineroFila}>
          <Text style={styles.dineroEtiqueta} numberOfLines={1}>{l.etiqueta}</Text>
          <Text style={styles.dineroMonto}>{formatCLP(l.monto)}</Text>
        </View>
      ))}
      {Number.isFinite(total) ? (
        <View style={[styles.dineroFila, styles.dineroTotal]}>
          <Text style={styles.dineroEtiquetaFuerte}>Total de la reserva</Text>
          <Text style={styles.dineroMontoFuerte}>{formatCLP(total)}</Text>
        </View>
      ) : null}
      {Number.isFinite(comision) ? (
        <View style={styles.dineroFila}>
          <Text style={styles.dineroEtiqueta} numberOfLines={1}>Comisión FutFinder</Text>
          <Text style={[styles.dineroMonto, { color: C.textAmber }]}>−{formatCLP(comision)}</Text>
        </View>
      ) : null}
      {Number.isFinite(neto) ? (
        <View style={[styles.dineroFila, styles.dineroTotal]}>
          <Text style={styles.dineroEtiquetaFuerte}>Recibes</Text>
          <Text style={[styles.dineroMontoFuerte, { color: C.green }]}>{formatCLP(neto)}</Text>
        </View>
      ) : null}
      {nota ? <Text style={styles.dineroNota}>{nota}</Text> : null}
    </View>
  );
}

/* ── Campos ─────────────────────────────────────────────────────────────── */

/** Etiqueta de campo, con su marca de obligatorio/opcional a la derecha. */
export function FieldLabel({ children, marca }) {
  return (
    <View style={styles.labelFila}>
      <Text style={styles.label}>{children}</Text>
      {marca ? <Text style={styles.labelMarca}>{marca}</Text> : null}
    </View>
  );
}

/** Campo de texto con el aspecto del handoff. `contador` muestra «21/300». */
export function TextField({ value, onChangeText, placeholder, multiline, maxLength, keyboardType, contador }) {
  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.textSecondary}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType}
        style={[styles.input, multiline && styles.inputMulti]}
      />
      {contador && maxLength ? (
        <Text style={styles.contador}>{String(value || '').length}/{maxLength}</Text>
      ) : null}
    </View>
  );
}

/**
 * Selector de hora (artboards 1o y 1q).
 *
 * Abre una hoja con las horas que de verdad existen ese día en esa cancha, en
 * vez de un reloj libre: el horario de atención es por cancha y por día, y
 * dejar elegir las 24 horas permitiría marcar un bloqueo fuera del horario,
 * que no rompe nada pero tampoco significa nada.
 */
export function TimeField({ valor, opciones = [], onChange, titulo = 'Elegir hora', deshabilitado }) {
  const [abierto, setAbierto] = React.useState(false);
  return (
    <>
      <Pressable
        onPress={() => !deshabilitado && setAbierto(true)}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!deshabilitado }}
        style={({ pressed }) => [styles.input, styles.timeField, deshabilitado && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
      >
        <Text style={[styles.timeValor, !valor && { color: C.textSecondary }]}>{valor || '--:--'}</Text>
      </Pressable>
      <Sheet visible={abierto} onClose={() => setAbierto(false)} title={titulo}>
        <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
          <View style={{ gap: 8, paddingBottom: 8 }}>
            {opciones.length === 0 ? (
              <Text style={styles.sinOpciones}>La cancha no atiende este día.</Text>
            ) : opciones.map((h) => (
              <Pressable
                key={h}
                onPress={() => { onChange?.(h); setAbierto(false); }}
                accessibilityRole="button"
                accessibilityState={{ selected: h === valor }}
                style={({ pressed }) => [styles.opcionHora, h === valor && styles.opcionHoraOn, pressed && { opacity: 0.85 }]}
              >
                <Text style={[styles.opcionHoraTexto, h === valor && styles.opcionHoraTextoOn]}>{h}</Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </Sheet>
    </>
  );
}

/* ── Bloque del calendario ──────────────────────────────────────────────── */

/**
 * Una fila del calendario del día (artboards 1p y 3c).
 *
 * `tono` verde = libre, ámbar = ocupado por el recinto, neutro = reservado por
 * un jugador. Es el mismo lenguaje que la nota de diseño fijó para separar lo
 * recurrente de lo puntual, y se usa igual en el calendario y en la agenda.
 */
export function BloqueFila({ hora, titulo, detalle, tono = 'neutral', accion, onAccion, onPress, continuacion }) {
  const borde = { green: C.border, amber: C.amberBorder, neutral: C.border }[tono] || C.border;
  const fondo = tono === 'amber' ? C.amberSoft : C.surface;

  const cuerpo = (
    <View style={[styles.bloque, { borderColor: borde, backgroundColor: continuacion ? 'transparent' : fondo }, continuacion && styles.bloqueCont]}>
      <Text style={[styles.bloqueHora, continuacion && { color: C.textSecondary }]}>{hora}</Text>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bloqueTitulo, continuacion && styles.bloqueTituloCont]} numberOfLines={1}>{titulo}</Text>
        {detalle ? <Text style={styles.bloqueDetalle} numberOfLines={2}>{detalle}</Text> : null}
      </View>
      {accion ? (
        <Pressable
          onPress={onAccion}
          accessibilityRole="button"
          style={({ pressed }) => [styles.bloqueAccion, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.bloqueAccionTexto}>{accion}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!onPress) return cuerpo;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.9 }}>
      {cuerpo}
    </Pressable>
  );
}

/* ── Estado vacío con pasos ─────────────────────────────────────────────── */

/** Lista numerada de pasos (artboards 1d y 4j). */
export function Pasos({ pasos = [] }) {
  return (
    <View style={{ gap: 12 }}>
      {pasos.map((p, i) => (
        <View key={p} style={styles.pasoFila}>
          <View style={styles.pasoNumero}>
            <Text style={styles.pasoNumeroTexto}>{i + 1}</Text>
          </View>
          <Text style={styles.pasoTexto}>{p}</Text>
        </View>
      ))}
    </View>
  );
}

/** Tarjeta de sección con título propio, para agrupar dentro de una pantalla. */
export function Bloque({ titulo, children, style }) {
  return (
    <Card style={style}>
      {titulo ? <Text style={styles.bloqueSeccionTitulo}>{titulo}</Text> : null}
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  banner: {
    paddingHorizontal: S.screenPadding,
    paddingVertical: 10,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bannerTexto: { flex: 1, fontFamily: F.bold, fontSize: 12.5, lineHeight: 17 },
  bannerAccion: { fontFamily: F.extraBold, fontSize: 12.5, textDecorationLine: 'underline' },

  statFila: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: R.card,
    borderWidth: 1,
    borderColor: C.border,
    paddingVertical: 14,
  },
  statCelda: { flex: 1, alignItems: 'center', paddingHorizontal: 6, gap: 3 },
  statBorde: { borderLeftWidth: 1, borderLeftColor: C.dividerInner },
  statNumero: { fontFamily: F.extraBold, fontSize: 22, color: C.textPrimary },
  statRotulo: { fontFamily: F.medium, fontSize: 11, color: C.textSecondary, textAlign: 'center', lineHeight: 14 },

  semana: { flexDirection: 'row', gap: 6 },
  diaCelda: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    gap: 2,
    borderRadius: R.chip,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  diaCeldaOn: { backgroundColor: C.green, borderColor: C.green },
  diaCorto: { fontFamily: F.semiBold, fontSize: 10.5, color: C.textSecondary, textTransform: 'lowercase' },
  diaCortoOn: { color: C.textOnGreen },
  diaNumero: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary },
  diaNumeroOn: { color: C.textOnGreen },
  diaPunto: { width: 4, height: 4, borderRadius: 2, backgroundColor: 'transparent' },
  diaPuntoOn: { backgroundColor: C.amber },

  contacto: { gap: 7 },
  contactoFila: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contactoNombre: { fontFamily: F.bold, fontSize: 13.5, color: C.textPrimary },
  contactoNumero: { fontFamily: F.semiBold, fontSize: 13, color: C.textSecondary, marginTop: 1 },
  contactoBtn: {
    height: 36,
    paddingHorizontal: 11,
    borderRadius: R.chip,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contactoBtnFuerte: { backgroundColor: C.green, borderColor: C.green },
  contactoBtnTextoFuerte: { fontFamily: F.extraBold, fontSize: 12.5, color: C.textOnGreen },
  privacidad: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  privacidadTexto: { flex: 1, fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15 },

  choice: {
    flexDirection: 'row',
    gap: 11,
    padding: 13,
    borderRadius: R.cardSm,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
  },
  choiceOn: { borderColor: C.green, backgroundColor: C.selectedBg },
  radio: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  radioOn: { borderColor: C.green },
  radioPunto: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.green },
  choiceTitulo: { fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  choiceDesc: { fontFamily: F.medium, fontSize: 12, color: C.textSecondary, marginTop: 3, lineHeight: 16 },

  dineroFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  dineroEtiqueta: { flex: 1, fontFamily: F.medium, fontSize: 13, color: C.textSecondary },
  dineroMonto: { fontFamily: F.semiBold, fontSize: 13.5, color: C.textPrimary },
  dineroTotal: { borderTopWidth: 1, borderTopColor: C.dividerInner, paddingTop: 9 },
  dineroEtiquetaFuerte: { flex: 1, fontFamily: F.bold, fontSize: 14, color: C.textPrimary },
  dineroMontoFuerte: { fontFamily: F.extraBold, fontSize: 16, color: C.textPrimary },
  dineroNota: { fontFamily: F.medium, fontSize: 11, color: C.textSecondary, lineHeight: 15.5, marginTop: 2 },

  labelFila: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 },
  label: { fontFamily: F.bold, fontSize: 12.5, color: C.textPrimary },
  labelMarca: { fontFamily: F.semiBold, fontSize: 11, color: C.textSecondary },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    fontFamily: F.medium,
    fontSize: 14.5,
    color: C.textPrimary,
  },
  inputMulti: { minHeight: 92, textAlignVertical: 'top' },
  contador: { alignSelf: 'flex-end', marginTop: 5, fontFamily: F.medium, fontSize: 11, color: C.textSecondary },
  timeField: { justifyContent: 'center' },
  timeValor: { fontFamily: F.bold, fontSize: 15, color: C.textPrimary },
  opcionHora: {
    height: 44,
    borderRadius: R.row,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  opcionHoraOn: { borderColor: C.green, backgroundColor: C.selectedBg },
  opcionHoraTexto: { fontFamily: F.bold, fontSize: 15, color: C.textPrimary },
  opcionHoraTextoOn: { color: C.green },
  sinOpciones: { fontFamily: F.medium, fontSize: 13, color: C.textSecondary, textAlign: 'center', paddingVertical: 18 },

  bloque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: R.row,
    borderWidth: 1,
  },
  bloqueCont: { borderStyle: 'dashed', paddingVertical: 9 },
  bloqueHora: { width: 46, fontFamily: F.extraBold, fontSize: 13.5, color: C.textPrimary },
  bloqueTitulo: { fontFamily: F.bold, fontSize: 13.5, color: C.textPrimary },
  bloqueTituloCont: { fontFamily: F.medium, fontSize: 12.5, color: C.textSecondary },
  bloqueDetalle: { fontFamily: F.medium, fontSize: 11.5, color: C.textSecondary, marginTop: 2, lineHeight: 15 },
  bloqueAccion: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: R.chip,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bloqueAccionTexto: { fontFamily: F.extraBold, fontSize: 11.5, color: C.textPrimary },

  pasoFila: { flexDirection: 'row', gap: 11, alignItems: 'flex-start' },
  pasoNumero: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: C.shieldBg, borderWidth: 1, borderColor: C.greenDeepBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  pasoNumeroTexto: { fontFamily: F.extraBold, fontSize: 12, color: C.green },
  pasoTexto: { flex: 1, fontFamily: F.medium, fontSize: 13, color: C.textSecondary, lineHeight: 18, paddingTop: 2 },

  bloqueSeccionTitulo: { fontFamily: F.extraBold, fontSize: 15, color: C.textPrimary, marginBottom: 11 },
});
