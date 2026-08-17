import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

import { chatColors, dsRadius } from '../../theme/colors';
import { hourLabel } from '../../utils/chatMeta';
import { textoCambioPropuesto, textoCambioRespondido } from '../../utils/cambioPartido';
import {
  textoEncuentroCancelado,
  textoSancionAplicada,
} from '../../utils/cancelacionEncuentro';
import {
  textoIncomparecenciaReportada,
  textoRevisionSolicitada,
  textoRevisionResuelta,
} from '../../utils/revisionSancion';
import {
  textoResultadoPropuesto,
  textoResultadoConfirmado,
  textoResultadoDisputado,
} from '../../utils/resultadoRpc';

/**
 * Burbuja de sistema dentro del hilo de negociación.
 *
 * Un evento de `club_challenge_events` no es de nadie: no lleva avatar ni
 * nombre, va centrado y no se puede responder ni borrar. Se distingue así
 * de los mensajes que se escriben entre administradores, que siguen
 * ocupando su lado de la conversación sin desplazarse.
 *
 * El texto se arma acá y no en la base a propósito: la fila guarda `tipo` y
 * `payload` (datos), no una frase. Así se puede corregir la redacción sin
 * migrar filas, y el mismo evento puede leerse distinto en otro contexto.
 */
export default function ChallengeEventBubble({ event }) {
  if (!event) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.bubble}>
        <Text style={styles.text}>{textoDelEvento(event)}</Text>
        {!!event.created_at && (
          <Text style={styles.hora}>{hourLabel(event.created_at)}</Text>
        )}
      </View>
    </View>
  );
}

/** Frase en español de cada tipo de evento del ciclo. */
export function textoDelEvento(event) {
  const p = event?.payload || {};

  switch (event?.tipo) {
    case 'aceptado':
      return p.horas
        ? `Desafío aceptado. Quedan ${p.horas} horas para acordar los detalles.`
        : 'Desafío aceptado.';
    case 'rechazado':
      return 'El desafío fue rechazado.';
    case 'cancelado':
      return p.motivo ? `Desafío cancelado: ${p.motivo}` : 'El desafío fue cancelado.';
    case 'expirado':
      return 'El desafío expiró sin respuesta.';
    case 'prorroga_abierta':
      return 'Se abrió una prórroga de 24 horas. ¿Este partido se disputará?';
    case 'prorroga_respondida':
      return p.respuesta === false
        ? 'Un club respondió que el partido no se disputará.'
        : 'Un club confirmó que el partido se disputará.';
    case 'sin_acuerdo':
      return 'La negociación se cerró sin acuerdo.';
    case 'propuesta_creada':
      return 'Se envió una propuesta oficial.';
    case 'propuesta_aprobada':
      return 'La propuesta oficial fue aprobada.';
    case 'propuesta_rechazada':
      return p.motivo
        ? `La propuesta fue rechazada: ${p.motivo}`
        : 'La propuesta oficial fue rechazada.';
    case 'partido_publicado':
      return 'El partido quedó publicado.';
    // Migración 46. El texto sale de `cambios` —campo, valor anterior y valor
    // propuesto— y se arma en `utils/cambioPartido.js`, que es puro y está
    // probado: «Deportivo propone cambiar la hora de 17:00 a 18:00». El
    // servidor guarda datos, no frases, así que la redacción se corrige acá
    // sin migrar ninguna fila.
    case 'cambio_propuesto':
      return textoCambioPropuesto(p);
    case 'cambio_respondido':
      return textoCambioRespondido(p);
    // Migración 47. Igual que los cambios: el servidor guarda quién canceló,
    // con qué motivo y si hubo sanción, y la frase se arma en
    // `utils/cancelacionEncuentro.js`, que es puro y está probado.
    case 'encuentro_cancelado':
      return textoEncuentroCancelado(p);
    case 'sancion_aplicada':
      return textoSancionAplicada(p);
    case 'sancion_retirada':
      return 'Se retiró la sanción.';
    // Migración 47c. El informe nombra a los dos clubes y el motivo; la
    // solicitud, sólo quién la pidió —lo que se le dijo a quien modera no es
    // del hilo—; y la resolución, en qué terminó.
    case 'incomparecencia_reportada':
      return textoIncomparecenciaReportada(p);
    case 'revision_solicitada':
      return textoRevisionSolicitada(p);
    case 'revision_resuelta':
      return textoRevisionResuelta(p);
    // Migraciones 48 y 48b. Como los cambios y las sanciones: el club, el
    // `username` y el MARCADOR salen del payload y la frase se arma en
    // `utils/resultadoRpc.js`. Antes las tres decían sólo que «hubo un
    // resultado», mientras el push del mismo evento sí traía el 3-1.
    case 'resultado_propuesto':
      return textoResultadoPropuesto(p);
    case 'resultado_confirmado':
      return textoResultadoConfirmado(p);
    case 'resultado_disputado':
      return textoResultadoDisputado(p);
    default:
      // Un tipo que este cliente todavía no conoce (una migración más nueva
      // en el servidor) no debe romper la conversación ni mostrar el valor
      // crudo de la columna.
      return 'Hubo una novedad en el desafío.';
  }
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 6 },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    maxWidth: '92%',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: dsRadius.chip,
    backgroundColor: chatColors.neonSoft,
    borderWidth: 1,
    borderColor: chatColors.challengeBorder,
  },
  text: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  hora: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
