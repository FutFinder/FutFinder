import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { CalendarX, TriangleAlert, ShieldAlert } from 'lucide-react-native';

import {
  reservas as C,
  reservasRadius as R,
  reservasFonts as F,
  alfa,
} from '../../theme/colors';
import {
  MOTIVO_MAX,
  avisoDeCancelacion,
  validarMotivoCancelacion,
  textoDeSancion,
} from '../../utils/cancelacionEncuentro';

/**
 * «Cancelar encuentro», ARRIBA del hilo.
 *
 * POR QUÉ ARRIBA Y NO EN UN MENÚ. Cancelar es la acción que se busca con
 * urgencia —se inundó la cancha, no llegó el equipo— y normalmente con el
 * partido cerca. Enterrarla en un menú de tres puntos hace que se resuelva por
 * WhatsApp, que es exactamente lo que deja al club rival organizando gente para
 * un partido que ya no existe. Va arriba, siempre visible, y separada de la
 * barra del ciclo de abajo: aquella lleva la acción que toca ahora; ésta, la
 * salida de emergencia.
 *
 * NO DECIDE NADA. Qué se dibuja sale de `accionesDeCancelacion()`, que es puro
 * y está probado, y quién puede cancelar de verdad lo vuelve a comprobar
 * `cancelar_encuentro_club` con las membresías y el `now()` de PostgreSQL.
 * Esconder un botón es cortesía, no seguridad.
 *
 * EL MOTIVO ES OBLIGATORIO, al revés que el del rechazo de un cambio. Un
 * cambio rechazado deja el partido como estaba; una cancelación lo termina, y
 * el club rival y los jugadores inscritos tienen derecho a saber por qué. El
 * botón de confirmar queda inactivo hasta que hay texto.
 *
 * LA ADVERTENCIA DE LA SANCIÓN SE LEE ANTES DE CONFIRMAR, no después: quien
 * cancela a una hora del partido tiene que saber que su club queda 14 días sin
 * poder abrir desafíos, y poder decidir con eso a la vista.
 */
export default function CancelarEncuentroBar({
  acciones,
  partido,
  sancion = null,
  ahora = new Date(),
  ocupado = false,
  error = null,
  onCancelar,
}) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');

  // Sin encuentro publicado no hay nada que cancelar y tampoco nada que
  // explicar: la barra no existe. Un aviso acá sería ruido en un hilo que
  // todavía está negociando la fecha.
  if (!acciones?.esDeClubes) return null;

  // Un club sancionado conserva sus partidos ya publicados (decisión C3), así
  // que la barra sigue en pie; lo que se le muestra es hasta cuándo dura.
  const aviso = avisoDeCancelacion({ partido, ahora });
  const revision = validarMotivoCancelacion(motivo);

  return (
    <View style={styles.bar}>
      {!!sancion && (
        <View style={styles.sancionBox}>
          <ShieldAlert color={C.amber} size={13} strokeWidth={2.2} />
          <Text style={styles.sancionTxt} numberOfLines={3}>
            {textoDeSancion(sancion)}
          </Text>
        </View>
      )}

      {!acciones.puedeCancelar ? (
        <View style={styles.row}>
          <CalendarX color={C.textGhost} size={15} strokeWidth={2.2} />
          <Text style={styles.hint} numberOfLines={2}>
            {acciones.bloqueo}
          </Text>
        </View>
      ) : !abierto ? (
        <Pressable
          onPress={() => setAbierto(true)}
          disabled={ocupado}
          accessibilityRole="button"
          accessibilityLabel="Cancelar el encuentro"
          style={({ pressed }) => [styles.row, styles.tocable, pressed && styles.pressed]}
        >
          <CalendarX color={C.amber} size={15} strokeWidth={2.2} />
          <Text style={styles.accionTxt}>Cancelar encuentro</Text>
          {aviso.sanciona && <Text style={styles.chip}>sanciona</Text>}
        </Pressable>
      ) : (
        <>
          <View style={[styles.avisoBox, aviso.sanciona && styles.avisoBoxGrave]}>
            <TriangleAlert
              color={aviso.sanciona ? C.amber : C.textSecondary}
              size={13}
              strokeWidth={2.2}
            />
            <View style={styles.avisoTexto}>
              <Text style={[styles.avisoTitulo, aviso.sanciona && styles.avisoTituloGrave]}>
                {aviso.titulo}
              </Text>
              <Text style={styles.avisoDetalle}>{aviso.detalle}</Text>
            </View>
          </View>

          <Text style={styles.label}>Motivo de la cancelación (obligatorio)</Text>
          <TextInput
            style={styles.input}
            placeholder="Ej: se nos inundó la cancha"
            placeholderTextColor={C.textMuted}
            value={motivo}
            onChangeText={setMotivo}
            multiline
            maxLength={MOTIVO_MAX}
            editable={!ocupado}
            accessibilityLabel="Motivo de la cancelación, obligatorio"
          />

          {!!error && (
            <View style={styles.errorBox}>
              <TriangleAlert color={C.amber} size={13} strokeWidth={2.2} />
              <Text style={styles.errorTxt}>{error}</Text>
            </View>
          )}

          {ocupado ? (
            <View style={styles.cargando}>
              <ActivityIndicator size="small" color={C.amber} />
              <Text style={styles.hint}>Cancelando el encuentro…</Text>
            </View>
          ) : (
            <View style={styles.dosBotones}>
              <Pressable
                onPress={() => {
                  setAbierto(false);
                  setMotivo('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Volver sin cancelar el encuentro"
                style={({ pressed }) => [styles.btn, styles.btnMitad, pressed && styles.pressed]}
              >
                <Text style={styles.btnTxt}>Volver</Text>
              </Pressable>
              <Pressable
                onPress={() => onCancelar?.(revision.motivo)}
                disabled={!revision.ok}
                accessibilityRole="button"
                accessibilityLabel="Confirmar la cancelación del encuentro"
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnMitad,
                  styles.btnGrave,
                  !revision.ok && styles.btnInactivo,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.btnGraveTxt}>
                  {aviso.sanciona ? 'Cancelar y asumir la sanción' : 'Confirmar cancelación'}
                </Text>
              </Pressable>
            </View>
          )}

          {!revision.ok && !ocupado && (
            <Text style={styles.hint} numberOfLines={2}>
              {revision.error}
            </Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: C.composerBar,
    borderBottomWidth: 1,
    borderBottomColor: alfa(C.tinta, 0.07),
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tocable: { minHeight: 44 },
  pressed: { opacity: 0.85 },

  accionTxt: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },
  // Se avisa YA en el botón, sin abrir nada: quien llega con el partido encima
  // merece saber lo que va a costarle antes de tocarlo.
  chip: {
    color: C.amber,
    fontSize: 10,
    fontFamily: F.extraBold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: R.chip,
    backgroundColor: C.amberSoft,
    overflow: 'hidden',
  },

  sancionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 8,
    borderRadius: R.chip,
    backgroundColor: C.amberSoft,
  },
  sancionTxt: { flex: 1, color: C.amber, fontSize: 12, lineHeight: 16, fontFamily: F.bold },

  avisoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    padding: 8,
    borderRadius: R.chip,
    backgroundColor: alfa(C.tinta, 0.06),
  },
  avisoBoxGrave: { backgroundColor: C.amberSoft },
  avisoTexto: { flex: 1, gap: 2 },
  avisoTitulo: { color: C.textPrimary, fontSize: 12, fontFamily: F.extraBold },
  avisoTituloGrave: { color: C.amber },
  avisoDetalle: { color: C.textDim, fontSize: 12, lineHeight: 16 },

  label: { color: C.textDim, fontSize: 12, fontFamily: F.bold },
  input: {
    minHeight: 60,
    borderRadius: R.chip,
    backgroundColor: alfa(C.tinta, 0.06),
    borderWidth: 1,
    borderColor: alfa(C.tinta, 0.12),
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: C.textPrimary,
    fontSize: 13,
    textAlignVertical: 'top',
  },

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

  dosBotones: { flexDirection: 'row', gap: 8 },
  btn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.row,
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.challengeBorder,
  },
  btnMitad: { flex: 1 },
  btnTxt: {
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },
  // Cancelar no se ve como el resto de las acciones: termina el encuentro.
  btnGrave: { borderColor: C.amber },
  btnGraveTxt: {
    color: C.amber,
    fontSize: 13,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },
  btnInactivo: { opacity: 0.45 },

  hint: { flex: 1, color: C.textSecondary, fontSize: 12, lineHeight: 16, fontFamily: F.medium },
});
