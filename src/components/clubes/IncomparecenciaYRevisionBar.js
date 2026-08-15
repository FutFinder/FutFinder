import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { UserX, Scale, TriangleAlert } from 'lucide-react-native';

import { chatColors, dsRadius } from '../../theme/colors';
import {
  MOTIVO_INCOMPARECENCIA_MAX,
  MOTIVO_REVISION_MAX,
  validarMotivoIncomparecencia,
  validarMotivoRevision,
  textoEstadoRevision,
} from '../../utils/revisionSancion';

/**
 * «Informar incomparecencia» y «Solicitar revisión», debajo de la barra de
 * cancelación del hilo.
 *
 * DOS ACCIONES DISTINTAS QUE VIVEN JUNTAS porque son las dos salidas de un
 * encuentro que salió mal: una acusa al rival de no haber llegado, la otra
 * reclama contra una medida propia. Separarlas en dos barras dejaría el hilo
 * con cuatro cabeceras y ninguna clara.
 *
 * NO SE DIBUJA «POR SI ACASO». Cada mitad aparece sólo cuando se puede usar o
 * cuando hay algo que contar: un encuentro que todavía no empieza no necesita
 * leer «podrás informar la incomparecencia después de la hora». Lo que decide
 * es `accionesDeIncomparecencia()` y `accionesDeRevision()`, que son puras y
 * están probadas; quién puede de verdad lo vuelven a comprobar
 * `reportar_incomparecencia` y `solicitar_revision_sancion` con las membresías
 * y el `now()` de PostgreSQL. Esconder un botón es cortesía, no seguridad.
 *
 * LA OTRA MITAD DE LA REVISIÓN NO ESTÁ ACÁ Y NO ES UN OLVIDO. Resolverla es
 * `resolver_revision_sancion`, revocada de `authenticated`: hoy la ejecuta una
 * persona con `service_role` desde el panel de Supabase. Ver
 * `docs/memoria/operacion/pendientes.md`.
 */
export default function IncomparecenciaYRevisionBar({
  incomparecencia,
  revision,
  reporte = null,
  ocupado = false,
  error = null,
  onInformar,
  onSolicitar,
}) {
  const [abierto, setAbierto] = useState(null); // 'incomparecencia' | 'revision' | null
  const [texto, setTexto] = useState('');

  const puedeInformar = !!incomparecencia?.puedeInformar;
  const yaInformada = !!incomparecencia?.yaInformada;
  const puedeSolicitar = !!revision?.puedeSolicitar;
  const revisionEnCurso = revision?.revision || null;

  const muestraIncomparecencia = puedeInformar || yaInformada;
  const muestraRevision = puedeSolicitar || !!revisionEnCurso;

  if (!muestraIncomparecencia && !muestraRevision) return null;

  const esRevision = abierto === 'revision';
  const revisado = esRevision ? validarMotivoRevision(texto) : validarMotivoIncomparecencia(texto);

  const cerrar = () => {
    setAbierto(null);
    setTexto('');
  };

  const confirmar = () => {
    if (!revisado.ok) return;
    if (esRevision) onSolicitar?.(revisado.motivo, revision?.sancionId || null);
    else onInformar?.(revisado.motivo);
    cerrar();
  };

  return (
    <View style={styles.bar}>
      {abierto === null ? (
        <>
          {muestraIncomparecencia && (
            puedeInformar ? (
              <Pressable
                onPress={() => setAbierto('incomparecencia')}
                disabled={ocupado}
                accessibilityRole="button"
                accessibilityLabel="Informar que el club rival no se presentó"
                style={({ pressed }) => [styles.row, styles.tocable, pressed && styles.pressed]}
              >
                <UserX color={chatColors.warn} size={15} strokeWidth={2.2} />
                <Text style={styles.accionTxt}>Informar incomparecencia</Text>
              </Pressable>
            ) : (
              <View style={styles.row}>
                <UserX color="rgba(255,255,255,0.4)" size={15} strokeWidth={2.2} />
                <Text style={styles.hint} numberOfLines={3}>
                  {reporte?.motivo
                    ? `Ya se informó una incomparecencia: «${reporte.motivo}».`
                    : incomparecencia?.bloqueo}
                </Text>
              </View>
            )
          )}

          {muestraRevision && (
            puedeSolicitar ? (
              <Pressable
                onPress={() => setAbierto('revision')}
                disabled={ocupado}
                accessibilityRole="button"
                accessibilityLabel="Solicitar una revisión de la medida"
                style={({ pressed }) => [styles.row, styles.tocable, pressed && styles.pressed]}
              >
                <Scale color={chatColors.textPrimary} size={15} strokeWidth={2.2} />
                <Text style={styles.accionTxt}>Solicitar revisión</Text>
              </Pressable>
            ) : (
              <View style={styles.row}>
                <Scale color="rgba(255,255,255,0.4)" size={15} strokeWidth={2.2} />
                <Text style={styles.hint} numberOfLines={4}>
                  {textoEstadoRevision(revisionEnCurso) || revision?.bloqueo}
                </Text>
              </View>
            )
          )}
        </>
      ) : (
        <>
          <View style={styles.avisoBox}>
            <TriangleAlert color={chatColors.warn} size={13} strokeWidth={2.2} />
            <View style={styles.avisoTexto}>
              <Text style={styles.avisoTitulo}>
                {esRevision ? 'Cuenta qué pasó' : 'Esto sanciona al club rival'}
              </Text>
              <Text style={styles.avisoDetalle}>
                {esRevision
                  ? 'Es lo único que va a leer quien revise la medida. Cuenta qué pasó, con horas y detalles: no hay una segunda oportunidad para explicarlo.'
                  : 'El club rival quedará 14 días sin poder crear ni aceptar desafíos, de forma provisional, hasta que alguien revise lo que informes. Lo que escribas lo va a leer ese club.'}
              </Text>
            </View>
          </View>

          <TextInput
            style={styles.input}
            placeholder={esRevision
              ? 'Ej: sí llegamos, el club rival fue a otra cancha'
              : 'Ej: esperamos media hora y no llegó nadie'}
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={texto}
            onChangeText={setTexto}
            multiline
            maxLength={esRevision ? MOTIVO_REVISION_MAX : MOTIVO_INCOMPARECENCIA_MAX}
            editable={!ocupado}
            accessibilityLabel={esRevision
              ? 'Motivo de la revisión, obligatorio'
              : 'Qué pasó en el partido, obligatorio'}
          />

          {!!error && (
            <View style={styles.errorBox}>
              <TriangleAlert color={chatColors.warn} size={13} strokeWidth={2.2} />
              <Text style={styles.errorTxt}>{error}</Text>
            </View>
          )}

          {ocupado ? (
            <View style={styles.cargando}>
              <ActivityIndicator size="small" color={chatColors.warn} />
              <Text style={styles.hint}>
                {esRevision ? 'Enviando la revisión…' : 'Informando la incomparecencia…'}
              </Text>
            </View>
          ) : (
            <View style={styles.dosBotones}>
              <Pressable
                onPress={cerrar}
                accessibilityRole="button"
                accessibilityLabel="Volver sin enviar"
                style={({ pressed }) => [styles.btn, styles.btnMitad, pressed && styles.pressed]}
              >
                <Text style={styles.btnTxt}>Volver</Text>
              </Pressable>
              <Pressable
                onPress={confirmar}
                disabled={!revisado.ok}
                accessibilityRole="button"
                accessibilityLabel={esRevision
                  ? 'Enviar la solicitud de revisión'
                  : 'Confirmar el informe de incomparecencia'}
                style={({ pressed }) => [
                  styles.btn,
                  styles.btnMitad,
                  styles.btnGrave,
                  !revisado.ok && styles.btnInactivo,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.btnGraveTxt}>
                  {esRevision ? 'Enviar revisión' : 'Informar y sancionar'}
                </Text>
              </Pressable>
            </View>
          )}

          {!revisado.ok && !ocupado && (
            <Text style={styles.hint} numberOfLines={2}>
              {revisado.error}
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
    backgroundColor: chatColors.composerBar,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.07)',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tocable: { minHeight: 44 },
  pressed: { opacity: 0.85 },

  accionTxt: {
    flex: 1,
    color: chatColors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    includeFontPadding: false,
  },
  hint: {
    flex: 1,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '600',
  },

  avisoBox: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    borderRadius: dsRadius.chip,
    backgroundColor: 'rgba(245,196,81,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,196,81,0.26)',
  },
  avisoTexto: { flex: 1, gap: 2 },
  avisoTitulo: { color: chatColors.warn, fontSize: 12, fontWeight: '800' },
  avisoDetalle: { color: 'rgba(255,255,255,0.7)', fontSize: 11.5, lineHeight: 15, fontWeight: '600' },

  input: {
    minHeight: 64,
    maxHeight: 140,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: dsRadius.chip,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    color: chatColors.textPrimary,
    fontSize: 13,
    textAlignVertical: 'top',
  },

  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorTxt: { flex: 1, color: chatColors.warn, fontSize: 11.5, fontWeight: '700' },

  cargando: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },

  dosBotones: { flexDirection: 'row', gap: 8 },
  btn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: dsRadius.chip,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  btnMitad: { flex: 1 },
  btnGrave: {
    backgroundColor: 'rgba(245,196,81,0.14)',
    borderColor: 'rgba(245,196,81,0.4)',
  },
  btnInactivo: { opacity: 0.45 },
  btnTxt: { color: chatColors.textPrimary, fontSize: 12.5, fontWeight: '800' },
  btnGraveTxt: { color: chatColors.warn, fontSize: 12.5, fontWeight: '800' },
});
