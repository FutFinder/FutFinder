import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Swords, Clock, TriangleAlert } from 'lucide-react-native';

import { chatColors, dsRadius } from '../../theme/colors';
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
 * Usa `chatColors` (que ya extiende `dsColors`) porque vive dentro del
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
 * La prórroga es la única acción con DOS salidas, y por eso no cabe en el
 * botón único: se responde «Sí» o «No», y el «No» cierra el desafío en el
 * acto. Por lo mismo lleva confirmación aparte en la pantalla.
 */
export default function ChallengeHeader({
  challenge,
  cta,
  ahora = new Date(),
  onPressCta,
  onResponderProrroga,
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
  const esProrroga = cta?.kind === 'responder_prorroga' && !!onResponderProrroga;
  const accionable = !esProrroga && !!onPressCta && !!cta && !cta.disabled;

  return (
    <View style={[styles.bar, cerrado && styles.barCerrado]}>
      <View style={styles.row}>
        <Swords
          color={cerrado ? 'rgba(255,255,255,0.4)' : chatColors.neon}
          size={16}
          strokeWidth={2.2}
        />
        <Text style={styles.estado} numberOfLines={1}>
          {estadoLabel(challenge.estado)}
        </Text>

        {cuenta && (
          <View style={[styles.plazo, cuenta.vencido && styles.plazoVencido]}>
            {cuenta.vencido ? (
              <TriangleAlert color={chatColors.warn} size={12} strokeWidth={2.2} />
            ) : (
              <Clock color="rgba(255,255,255,0.55)" size={12} strokeWidth={2} />
            )}
            <Text style={[styles.plazoText, cuenta.vencido && styles.plazoTextVencido]}>
              {cuenta.prorroga ? `Prórroga · ${cuenta.label}` : cuenta.label}
            </Text>
          </View>
        )}
      </View>

      {esProrroga ? (
        <>
          <Text style={styles.pregunta}>{cta.label}</Text>
          <View style={styles.dosBotones}>
            <Pressable
              onPress={() => onResponderProrroga(true)}
              disabled={ocupado}
              accessibilityRole="button"
              accessibilityLabel="Sí, el partido se disputará"
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: tema.main },
                styles.ctaMitad,
                pressed && { opacity: 0.85 },
                ocupado && styles.ctaOcupado,
              ]}
            >
              <Text style={[styles.ctaText, { color: tema.ink }]}>Sí, se juega</Text>
            </Pressable>
            <Pressable
              onPress={() => onResponderProrroga(false)}
              disabled={ocupado}
              accessibilityRole="button"
              accessibilityLabel="No, el partido no se disputará"
              style={({ pressed }) => [
                styles.cta,
                { backgroundColor: tema.main },
                styles.ctaMitad,
                styles.ctaNo,
                pressed && { opacity: 0.85 },
                ocupado && styles.ctaOcupado,
              ]}
            >
              <Text style={[styles.ctaText, { color: tema.ink }, styles.ctaTextNo]}>No se juega</Text>
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

const styles = StyleSheet.create({
  bar: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: chatColors.cardChallenge,
    borderTopWidth: 1,
    borderTopColor: chatColors.challengeBorder,
  },
  barCerrado: {
    backgroundColor: chatColors.composerBar,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  estado: {
    flex: 1,
    color: chatColors.textPrimary,
    fontSize: 13,
    fontWeight: '800',
    includeFontPadding: false,
  },

  plazo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: dsRadius.chip,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  plazoVencido: { backgroundColor: chatColors.warnSoft },
  plazoText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
    fontWeight: '700',
    includeFontPadding: false,
  },
  plazoTextVencido: { color: chatColors.warn },

  cta: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: dsRadius.lg,
    // El fondo es el acento del club: sale por estilo en línea en el JSX.
    paddingHorizontal: 14,
  },
  ctaText: {
    // La tinta es el acento del club: sale por estilo en línea en el JSX.
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
  },
  ctaOcupado: { opacity: 0.6 },

  pregunta: {
    color: chatColors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
  },
  dosBotones: { flexDirection: 'row', gap: 8 },
  ctaMitad: { flex: 1 },
  // El «No» cierra el desafío: se ve como lo que es, no como la otra
  // mitad de un par de botones equivalentes.
  ctaNo: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: chatColors.challengeBorder,
  },
  ctaTextNo: { color: chatColors.textPrimary },

  hint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
});
