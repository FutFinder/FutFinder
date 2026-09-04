import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  Swords,
  FileText,
  CalendarClock,
  Users,
  UserPlus,
  AlertTriangle,
  Trophy,
  Check,
} from 'lucide-react-native';

import { temaClub } from '../../theme/clubThemes';
import { clubTonos, clubSuperficies } from '../../theme/colors';

/**
 * Una tarea de «Pendiente para ti».
 *
 * Recibe la tarea ya redactada por `utils/clubsHomeTasks.js` —título,
 * subtítulo, CTA y estado— y solo la pinta. Acá no se decide qué dice ni si
 * el usuario puede accionarla: eso está resuelto y probado allá, y
 * recalcularlo en la vista es cómo dos partes de la misma pantalla terminan
 * diciendo cosas distintas.
 *
 * `esPrimaria` es la primera de la lista y la única con el acento sólido: si
 * todas gritan, ninguna se oye.
 *
 * El tono sale de `clubTonos[tarea.tone]`, salvo `'accent'`, que sale del
 * tema del club. Los tres tonos semánticos no se tematizan.
 *
 * DOS ACCIONES EN VEZ DE UNA. Casi todas las tareas llevan un `cta` y llevan
 * a una pantalla; la invitación a un club se resuelve en la propia tarjeta y
 * tiene DOS salidas —aceptar y rechazar— sin que ninguna sea la principal.
 * Cuando la tarea trae `acciones`, se dibujan esos botones en lugar del CTA y
 * la tarjeta deja de navegar al pulsarla: con un destino y dos botones
 * encima, un toque a un lado del botón haría algo que nadie pidió.
 *
 * @param {object} tarea        `{ type, tone, title, subtitle, cta, status }`,
 *                              y opcionalmente `acciones: [{clave, label}]`.
 * @param {object} [tema]       Escala de `theme/clubThemes.js`.
 * @param {boolean} [esPrimaria]
 * @param {Function} [onPress]
 * @param {Function} [onAccion] `(clave)` de `tarea.acciones`.
 * @param {boolean} [ocupado]   Deshabilita las acciones mientras responde.
 */
export default function PendingTaskCard({
  tarea,
  tema,
  esPrimaria = false,
  onPress,
  onAccion,
  ocupado = false,
}) {
  const escala = tema || temaClub('green');
  if (!tarea) return null;

  const resuelta = tarea.status === 'resuelta';
  const vencida = tarea.status === 'vencida';
  const inerte = resuelta || vencida;
  const acciones = !inerte && tarea.acciones?.length ? tarea.acciones : null;

  const tono = resuelta ? acento(escala) : tonoDe(tarea.tone, escala);
  const Icono = resuelta ? Check : ICONOS[tarea.type] || Trophy;

  const subtitulo = resuelta ? 'Resuelto hace un momento' : tarea.subtitle;

  return (
    <Pressable
      onPress={inerte || acciones ? undefined : onPress}
      disabled={inerte || !!acciones}
      accessibilityRole="button"
      accessibilityLabel={`${tarea.title}. ${subtitulo || ''}`}
      accessibilityState={{ disabled: inerte }}
      style={({ pressed }) => [
        styles.tarjeta,
        { borderColor: esPrimaria && !inerte ? escala.border : clubSuperficies.borde },
        inerte && styles.inerte,
        pressed && !inerte && !acciones && styles.press,
      ]}
    >
      <View style={[styles.icono, { backgroundColor: tono.soft }]}>
        <Icono size={18} color={tono.fg} strokeWidth={2.2} />
      </View>

      <View style={styles.textos}>
        <Text style={styles.titulo} numberOfLines={1}>
          {tarea.title}
        </Text>
        {subtitulo ? (
          <Text
            style={[styles.subtitulo, resuelta && { color: escala.main }]}
            numberOfLines={1}
          >
            {subtitulo}
          </Text>
        ) : null}
      </View>

      {resuelta ? (
        <Chip texto="Listo ✓" />
      ) : vencida ? (
        <Chip texto="Expiró" />
      ) : acciones ? (
        <View style={styles.acciones}>
          {acciones.map((a, i) => {
            // La primera es la afirmativa y lleva el acento del club; la
            // segunda descarta y va en gris. No son un par simétrico.
            const principal = i === 0;
            return (
              <Pressable
                key={a.clave}
                onPress={() => onAccion?.(a.clave)}
                disabled={ocupado}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`${a.label}: ${tarea.title}. ${tarea.subtitle || ''}`}
                style={({ pressed }) => [
                  styles.boton,
                  principal ? { backgroundColor: escala.main } : styles.botonSecundario,
                  ocupado && { opacity: 0.5 },
                  pressed && !ocupado && { opacity: 0.8 },
                ]}
              >
                <Text style={[styles.botonTexto, principal && { color: escala.ink }]}>
                  {a.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View
          style={[
            styles.boton,
            esPrimaria
              ? { backgroundColor: escala.main }
              : styles.botonSecundario,
          ]}
        >
          <Text style={[styles.botonTexto, esPrimaria && { color: escala.ink }]}>
            {tarea.cta}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

/** Chip neutro: marca un desenlace, no ofrece una acción. */
function Chip({ texto }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipTexto}>{texto}</Text>
    </View>
  );
}

const acento = (escala) => ({ soft: escala.soft, fg: escala.main });

function tonoDe(tone, escala) {
  if (tone === 'accent') return acento(escala);
  return clubTonos[tone] || clubTonos.info;
}

/**
 * Un icono por tipo de tarea. Son los siete tipos que produce
 * `normalizarTareas`; cualquier otro cae en el trofeo antes que dejar el
 * hueco vacío.
 */
const ICONOS = {
  desafio: Swords,
  propuesta: FileText,
  cambio: CalendarClock,
  nomina: Users,
  solicitud: UserPlus,
  sancion: AlertTriangle,
  partido: Trophy,
};

const styles = StyleSheet.create({
  tarjeta: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 17,
    borderWidth: 1,
    backgroundColor: clubSuperficies.card,
  },
  acciones: { flexDirection: 'row', gap: 6 },
  inerte: { opacity: 0.55 },
  press: { opacity: 0.8 },
  icono: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textos: { flex: 1, minWidth: 0, gap: 2 },
  titulo: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
  subtitulo: { fontSize: 12, color: 'rgba(255, 255, 255, 0.5)' },
  boton: {
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 12,
  },
  botonSecundario: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  botonTexto: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF' },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 11,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  chipTexto: { fontSize: 11.5, fontWeight: '600', color: 'rgba(255, 255, 255, 0.6)' },
});
