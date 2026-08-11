import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Swords, Clock, TriangleAlert } from 'lucide-react-native';

import { chatColors, dsRadius } from '../../theme/colors';
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
 * SOBRE LAS ACCIONES: en esta fase las únicas transiciones implementadas son
 * aceptar (que es lo que crea este hilo) y ver el partido cuando ya existe.
 * Las demás — crear propuesta, responder la prórroga, aprobar, registrar
 * resultado — llegan con las migraciones siguientes. Hasta entonces el
 * estado se muestra como información y NO como un botón: un botón que no
 * hace nada es peor que no tener botón.
 */
export default function ChallengeHeader({ challenge, cta, ahora = new Date(), onPressCta }) {
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
  const accionable = !!onPressCta && !!cta && !cta.disabled;

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

      {accionable ? (
        <Pressable
          onPress={onPressCta}
          accessibilityRole="button"
          accessibilityLabel={cta.label}
          style={({ pressed }) => [styles.cta, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.ctaText}>{cta.label}</Text>
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
    backgroundColor: chatColors.green,
    paddingHorizontal: 14,
  },
  ctaText: {
    color: chatColors.inkOnGreen,
    fontSize: 14,
    fontWeight: '800',
    includeFontPadding: false,
  },

  hint: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
});
