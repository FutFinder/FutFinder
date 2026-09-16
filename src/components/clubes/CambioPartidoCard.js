import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { ArrowRight, RefreshCw, TriangleAlert } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasFonts as F,
} from '../../theme/colors';
import { temaDeClub } from '../../theme/clubThemes';
import { filasDeComparacion, mensajeDeEspera } from '../../utils/cambioPartido';

/**
 * La solicitud de cambio que está esperando respuesta, dentro del hilo.
 *
 * LO QUE ESTA TARJETA TIENE QUE DEJAR CLARO ES QUE EL PARTIDO NO CAMBIÓ.
 * Mientras la solicitud está pendiente, la hora, la cancha y la cuota
 * vigentes siguen siendo las de la izquierda: por eso cada fila muestra el
 * valor actual y el propuesto uno al lado del otro, y por eso el subtítulo lo
 * dice con todas sus letras. Una tarjeta que sólo mostrara el valor nuevo
 * haría creer que el cambio ya se aplicó, que es exactamente el malentendido
 * que esta unidad viene a evitar.
 *
 * NO DECIDE NADA. Qué botones se dibujan sale de `accionesDeCambio()`, que es
 * puro y está probado, y quién puede de verdad responder lo vuelve a
 * comprobar `responder_cambio_partido` con las membresías de PostgreSQL.
 * Esconder un botón es cortesía, no seguridad.
 *
 * El motivo del rechazo es OPCIONAL: «Rechazar» abre el campo, y «Confirmar
 * rechazo» funciona con el campo vacío. Obligarlo sólo conseguiría motivos
 * escritos para poder pulsar el botón.
 */
export default function CambioPartidoCard({
  cambio,
  acciones,
  clubProponenteNombre,
  clubContrarioNombre,
  ocupado = false,
  error = null,
  onAceptar,
  onRechazar,
  // Sin club propio resuelto todavía (o un caso sin membresía reconocible),
  // `temaDeClub()` cae sola al verde de siempre.
  tema = temaDeClub(),
}) {
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');

  if (!cambio) return null;

  const filas = filasDeComparacion(cambio);
  const club = clubProponenteNombre || 'El club rival';
  const puedeResponder = !!acciones?.puedeResponder && !!onAceptar && !!onRechazar;

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <RefreshCw color={C.neon} size={15} strokeWidth={2.2} />
        <Text style={styles.titulo} numberOfLines={2}>
          {acciones?.esMiSolicitud ? 'Pediste un cambio' : `${club} pide un cambio`}
        </Text>
      </View>

      <Text style={styles.aviso}>
        El partido sigue con los valores de la izquierda hasta que el club contrario acepte.
      </Text>

      <View style={styles.filas}>
        {filas.map((f) => (
          <View key={f.campo} style={styles.fila}>
            <Text style={styles.etiqueta}>{f.etiqueta}</Text>
            <View style={styles.valores}>
              <Text style={styles.antes} numberOfLines={2}>
                {f.antes}
              </Text>
              <ArrowRight color="rgba(255,255,255,0.45)" size={13} strokeWidth={2.4} />
              <Text style={styles.despues} numberOfLines={2}>
                {f.despues}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {!!error && (
        <View style={styles.errorBox}>
          <TriangleAlert color={C.amber} size={13} strokeWidth={2.2} />
          <Text style={styles.errorTxt}>{error}</Text>
        </View>
      )}

      {ocupado ? (
        <View style={styles.cargando}>
          <ActivityIndicator size="small" color={C.neon} />
          <Text style={styles.hint}>Enviando la respuesta…</Text>
        </View>
      ) : puedeResponder ? (
        rechazando ? (
          <>
            <Text style={styles.label}>Motivo del rechazo (opcional)</Text>
            <TextInput
              style={styles.input}
              placeholder="Ej: ese día no tenemos arquero"
              placeholderTextColor="rgba(255,255,255,0.35)"
              value={motivo}
              onChangeText={setMotivo}
              multiline
              maxLength={300}
              accessibilityLabel="Motivo del rechazo, opcional"
            />
            <View style={styles.dosBotones}>
              <Pressable
                onPress={() => {
                  setRechazando(false);
                  setMotivo('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Volver sin rechazar el cambio"
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: tema.main },
                  styles.btnMitad,
                  styles.btnGhost,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.btnGhostTxt}>Volver</Text>
              </Pressable>
              <Pressable
                onPress={() => onRechazar(motivo)}
                accessibilityRole="button"
                accessibilityLabel="Confirmar el rechazo del cambio"
                style={({ pressed }) => [
                  styles.btn,
                  { backgroundColor: tema.main },
                  styles.btnMitad,
                  styles.btnGhost,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.btnGhostTxt}>Confirmar rechazo</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <View style={styles.dosBotones}>
            <Pressable
              onPress={onAceptar}
              accessibilityRole="button"
              accessibilityLabel="Aceptar el cambio y actualizar el partido"
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: tema.main },
                styles.btnMitad,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.btnTxt, { color: tema.ink }]}>Aceptar cambio</Text>
            </Pressable>
            <Pressable
              onPress={() => setRechazando(true)}
              accessibilityRole="button"
              accessibilityLabel="Rechazar el cambio"
              style={({ pressed }) => [
                styles.btn,
                { backgroundColor: tema.main },
                styles.btnMitad,
                styles.btnGhost,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.btnGhostTxt}>Rechazar</Text>
            </Pressable>
          </View>
        )
      ) : (
        // Quien pidió el cambio no está bloqueado: está esperando. La
        // distinción la hace `mensajeDeEspera`, que está probada — mostrarle
        // «No puedes responder tu propia solicitud» hacía pensar que algo
        // había fallado.
        <Text style={styles.hint} numberOfLines={3}>
          {mensajeDeEspera(acciones, clubContrarioNombre) || `Esperando la respuesta de ${club}.`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    marginBottom: 8,
    padding: 12,
    gap: 8,
    borderRadius: R.row,
    backgroundColor: C.cardChallenge,
    borderWidth: 1,
    borderColor: C.challengeBorder,
    // En web, sin tope, la tarjeta se estira hasta dejar el «actual → nuevo»
    // separado por medio monitor.
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titulo: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 14,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },
  aviso: { color: 'rgba(255,255,255,0.6)', fontSize: 12, lineHeight: 16 },

  filas: { gap: 6, marginTop: 2 },
  fila: { gap: 3 },
  etiqueta: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontFamily: F.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  // Envuelve en pantallas angostas en vez de recortar: el valor propuesto es
  // justamente lo que hay que poder leer entero antes de aceptar.
  valores: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  antes: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    fontFamily: F.semiBold,
    textDecorationLine: 'line-through',
    flexShrink: 1,
  },
  despues: { color: C.textPrimary, fontSize: 14, fontFamily: F.extraBold, flexShrink: 1 },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 8,
    borderRadius: R.chip,
    backgroundColor: C.amberSoft,
  },
  errorTxt: { flex: 1, color: C.amber, fontSize: 12, lineHeight: 16, fontFamily: F.semiBold },

  cargando: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },

  label: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    fontFamily: F.bold,
    marginTop: 2,
  },
  input: {
    minHeight: 60,
    borderRadius: R.chip,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: C.textPrimary,
    fontSize: 13,
    textAlignVertical: 'top',
  },

  dosBotones: { flexDirection: 'row', gap: 8 },
  btn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.row,
    // El fondo es el acento del club: sale por estilo en línea en el JSX.
    paddingHorizontal: 12,
  },
  btnMitad: { flex: 1 },
  btnTxt: {
    // La tinta es el acento del club: sale por estilo en línea en el JSX.
    fontSize: 13,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.challengeBorder,
  },
  btnGhostTxt: {
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },
  pressed: { opacity: 0.85 },

  hint: { color: 'rgba(255,255,255,0.5)', fontSize: 12, lineHeight: 16, fontFamily: F.medium },
});
