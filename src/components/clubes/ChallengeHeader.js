import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Swords, Clock, TriangleAlert } from 'lucide-react-native';

import {
  paleta as C,
  radios as R,
  fuentes as F,
  alfa,
} from '../../theme/colors';
import { temaDeClub } from '../../theme/clubThemes';
import { estadoLabel, esEstadoCerrado } from '../../services/clubChallengeRules';
import { challengeCountdown } from '../../utils/challengeThread';

/**
 * Barra fija sobre el compositor del hilo de negociación.
 *
 * Muestra los dos clubes, el estado del ciclo y cuánto queda de plazo. El
 * contador se calcula contra `vence_at`, que viene del servidor: un
 * teléfono con la hora desajustada no puede regalarse ni quitarse horas de
 * negociación. `ahora` entra por parámetro para que la pantalla decida cada
 * cuánto refrescarlo y para poder probar el cálculo sin congelar el reloj.
 *
 * Usa la paleta única (`reservas`) porque vive dentro del
 * módulo de chat, no en una pantalla de Clubes: mezclar las dos familias en
 * la misma vista se vería como dos verdes distintos.
 *
 * SOBRE LAS ACCIONES: se dibuja botón únicamente cuando la app sabe ejecutar
 * la acción. Con las migraciones 43 y 44 ya son reales responder la prórroga,
 * crear la propuesta oficial, revisarla —que es la puerta a aprobarla y
 * publicar el partido— y ver el partido publicado. Las de resultado llegan
 * con la 48 y hasta entonces se muestran como información. Un botón que no
 * hace nada es peor que no tener botón.
 *
 * Aprobar NO se hace desde esta barra: «Revisar propuesta» lleva a
 * `ClubProposalScreen`, donde están la cancha, la hora, los cupos y la cuota.
 * Publicar un partido de un toque, sin haber leído lo que se publica, sería
 * un botón demasiado fácil de pulsar por accidente.
 *
 * DOS ACCIONES CON DOS SALIDAS, no una. La prórroga se responde «Sí» o «No»,
 * y aceptar o rechazar un desafío recibido es exactamente la misma forma: dos
 * respuestas y ninguna principal. No caben en el botón único, así que las dos
 * comparten el mismo par de botones.
 *
 * RESPONDER EL DESAFÍO SE HACE ACÁ DESDE QUE LA PORTADA TRAE A ESTE HILO.
 * `getChallengeCta` devolvía «Responder desafío» en `pendiente` desde
 * siempre, pero la pantalla no sabía ejecutarlo: la barra dibujaba un rótulo
 * muerto y la única forma de aceptar era la tarjeta de Avisos. Con la tarea
 * de «Pendiente para ti» abriendo el hilo, este era el callejón sin salida al
 * final del camino corregido.
 */
export default function ChallengeHeader({
  challenge,
  cta,
  ahora = new Date(),
  onPressCta,
  onResponderProrroga,
  onResponderDesafio,
  ocupado = false,
  // Sin club propio resuelto todavía (o un caso sin membresía reconocible),
  // `temaDeClub()` cae sola al verde de siempre.
  tema = temaDeClub(),
}) {
  if (!challenge) return null;

  const cuenta = challengeCountdown(
    {
      estado: challenge.estado,
      vence_at: challenge.prorroga_vence_at || challenge.negociacion_vence_at,
      prorroga_abierta: !!challenge.prorroga_abierta_at,
    },
    ahora
  );

  const cerrado = esEstadoCerrado(challenge.estado);
  const dobles = dosSalidas(cta, { onResponderProrroga, onResponderDesafio });
  const accionable = !dobles && !!onPressCta && !!cta && !cta.disabled;

  return (
    <View style={[styles.bar, cerrado && styles.barCerrado]}>
      <View style={styles.row}>
        <Swords
          color={cerrado ? C.textGhost : C.neon}
          size={16}
          strokeWidth={2.2}
        />
        <Text style={styles.estado} numberOfLines={1}>
          {estadoLabel(challenge.estado)}
        </Text>

        {cuenta && (
          <View style={[styles.plazo, cuenta.vencido && styles.plazoVencido]}>
            {cuenta.vencido ? (
              <TriangleAlert color={C.amber} size={12} strokeWidth={2.2} />
            ) : (
              <Clock color={C.textSecondary} size={12} strokeWidth={2} />
            )}
            <Text style={[styles.plazoText, cuenta.vencido && styles.plazoTextVencido]}>
              {cuenta.prorroga ? `Prórroga · ${cuenta.label}` : cuenta.label}
            </Text>
          </View>
        )}
      </View>

      {dobles ? (
        <>
          <Text style={styles.pregunta}>{cta.label}</Text>
          <View style={styles.dosBotones}>
            <Pressable
              onPress={() => dobles.onElegir(true)}
              disabled={ocupado}
              accessibilityRole="button"
              accessibilityLabel={dobles.etiquetaSi}
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: tema.main },
                styles.ctaMitad,
                pressed && { opacity: 0.85 },
                ocupado && styles.ctaOcupado,
              ]}
            >
              <Text style={[styles.ctaText, { color: tema.ink }]}>{dobles.si}</Text>
            </Pressable>
            <Pressable
              onPress={() => dobles.onElegir(false)}
              disabled={ocupado}
              accessibilityRole="button"
              accessibilityLabel={dobles.etiquetaNo}
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: tema.main },
                styles.ctaMitad,
                styles.ctaNo,
                pressed && { opacity: 0.85 },
                ocupado && styles.ctaOcupado,
              ]}
            >
              <Text style={[styles.ctaText, { color: tema.ink }, styles.ctaTextNo]}>{dobles.no}</Text>
            </Pressable>
          </View>
          {!!cta.hint && (
            <Text style={styles.hint} numberOfLines={2}>
              {cta.hint}
            </Text>
          )}
        </>
      ) : accionable ? (
        <Pressable
          onPress={onPressCta}
          disabled={ocupado}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: tema.main },
            pressed && { opacity: 0.85 },
            ocupado && styles.ctaOcupado,
          ]}
        >
          <Text style={[styles.ctaText, { color: tema.ink }]}>{cta.label}</Text>
        </Pressable>
      ) : cta?.hint ? (
        <Text style={styles.hint} numberOfLines={2}>
          {cta.hint}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Las dos salidas de la acción actual, o `null` si la acción tiene una sola.
 *
 * Se devuelve el par ya rotulado —y con su etiqueta de accesibilidad— para
 * que el render no tenga que preguntar de qué acción se trata en cada botón.
 * El handler ausente cuenta como «la app todavía no sabe hacerlo»: en ese
 * caso no hay botones, igual que con el CTA único.
 */
function dosSalidas(cta, { onResponderProrroga, onResponderDesafio }) {
  if (cta?.kind === 'responder_prorroga' && onResponderProrroga) {
    return {
      onElegir: onResponderProrroga,
      si: 'Sí, se juega',
      no: 'No se juega',
      etiquetaSi: 'Sí, el partido se disputará',
      etiquetaNo: 'No, el partido no se disputará',
    };
  }
  if (cta?.kind === 'responder' && onResponderDesafio) {
    return {
      onElegir: onResponderDesafio,
      si: 'Aceptar',
      no: 'Rechazar',
      etiquetaSi: 'Aceptar el desafío',
      etiquetaNo: 'Rechazar el desafío',
    };
  }
  return null;
}

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: C.cardChallenge,
    borderTopWidth: 1,
    borderTopColor: C.challengeBorder,
  },
  barCerrado: {
    backgroundColor: C.composerBar,
    borderTopColor: alfa(C.tinta, 0.07),
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  estado: {
    flex: 1,
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },

  plazo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: R.chip,
    backgroundColor: alfa(C.tinta, 0.06),
  },
  plazoVencido: { backgroundColor: C.amberSoft },
  plazoText: {
    color: C.textDim,
    fontSize: 11,
    fontFamily: F.bold,
    includeFontPadding: false,
  },
  plazoTextVencido: { color: C.amber },

  cta: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: R.row,
    // El fondo es el acento del club: sale por estilo en línea en el JSX.
    paddingHorizontal: 14,
  },
  ctaText: {
    // La tinta es el acento del club: sale por estilo en línea en el JSX.
    fontSize: 14,
    fontFamily: F.extraBold,
    includeFontPadding: false,
  },
  ctaOcupado: { opacity: 0.6 },

  pregunta: {
    color: C.textPrimary,
    fontSize: 13,
    fontFamily: F.bold,
    includeFontPadding: false,
  },
  dosBotones: { flexDirection: 'row', gap: 8 },
  ctaMitad: { flex: 1 },
  // El «No» cierra el desafío: se ve como lo que es, no como la otra
  // mitad de un par de botones equivalentes.
  ctaNo: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.challengeBorder,
  },
  ctaTextNo: { color: C.textPrimary },

  hint: {
    color: C.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: F.medium,
  },
});
