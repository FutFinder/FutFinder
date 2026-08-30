import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Swords, CalendarClock, UserPlus, AlertTriangle, Bell } from 'lucide-react-native';

import { temaClub } from '../../theme/clubThemes';
import { clubTonos, clubSuperficies } from '../../theme/colors';
import { haceCuanto } from '../../utils/tiempoRelativo.js';

/**
 * Las últimas tres cosas que pasaron en el club.
 *
 * Es un resumen, no la bandeja de avisos: por eso son tres filas y el tiempo
 * va abreviado («3 h», no «hace 3 horas»). Quien quiera la lista completa
 * tiene «Ver toda».
 *
 * NO SE DIBUJA VACÍA. Sin actividad, la sección entera no aparece: un
 * encabezado con «Ver toda» sobre un hueco promete algo que no hay.
 *
 * El tono de cada fila es semántico y no se tematiza: una sanción es roja en
 * un club rojo y en uno azul.
 *
 * @param {Array} items      Filas de `notifications` ya filtradas por club.
 * @param {object} [tema]    Escala de `theme/clubThemes.js`.
 * @param {Date} [ahora]     Para el tiempo relativo.
 * @param {Function} [onVerToda]
 * @param {Function} [onPressItem]
 */
export default function ActivityList({ items, tema, ahora, onVerToda, onPressItem }) {
  const escala = tema || temaClub('green');
  const filas = (items || []).slice(0, 3);
  if (filas.length === 0) return null;

  return (
    <View style={styles.seccion}>
      <View style={styles.cabecera}>
        <Text style={styles.tituloSeccion}>Actividad reciente</Text>
        <Pressable
          onPress={onVerToda}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Ver toda la actividad"
        >
          <Text style={[styles.verToda, { color: escala.main }]}>Ver toda</Text>
        </Pressable>
      </View>

      <View style={styles.lista}>
        {filas.map((item, i) => {
          const tono = tonoDeAviso(item?.type);
          const Icono = ICONOS[tono.clave] || Bell;
          const cuando = haceCuanto(item?.created_at, ahora);

          return (
            <Pressable
              key={item?.id ?? i}
              onPress={onPressItem ? () => onPressItem(item) : undefined}
              accessibilityRole={onPressItem ? 'button' : 'text'}
              style={({ pressed }) => [
                styles.fila,
                i > 0 && styles.filaConSeparador,
                pressed && onPressItem && { opacity: 0.75 },
              ]}
            >
              <View style={[styles.icono, { backgroundColor: tono.soft }]}>
                <Icono size={15} color={tono.fg} strokeWidth={2.2} />
              </View>
              <Text style={styles.titulo} numberOfLines={1}>
                {item?.title || 'Aviso del club'}
              </Text>
              {cuando ? <Text style={styles.cuando}>{cuando}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/**
 * El tono se deduce del `type` del aviso, y lo desconocido cae en `info`.
 *
 * Es una pista visual, no una decisión: si un `type` nuevo no está acá, la
 * fila sale gris y sigue siendo legible. Por eso acá sí se puede mirar el
 * `type`, a diferencia de la atribución al club, donde equivocarse significa
 * enseñar actividad de otro club.
 */
function tonoDeAviso(type) {
  const t = String(type || '');
  if (t.includes('sancion') || t.includes('incomparecencia')) {
    return { clave: 'sancion', ...clubTonos.danger };
  }
  if (t.includes('cambio')) return { clave: 'cambio', ...clubTonos.warn };
  if (t.includes('desafio') || t.includes('challenge') || t.includes('propuesta')) {
    return { clave: 'desafio', ...clubTonos.info };
  }
  if (t.includes('solicitud') || t.includes('miembro') || t.includes('invitacion')) {
    return { clave: 'miembro', ...clubTonos.info };
  }
  return { clave: 'otro', ...clubTonos.info };
}

const ICONOS = {
  desafio: Swords,
  cambio: CalendarClock,
  miembro: UserPlus,
  sancion: AlertTriangle,
  otro: Bell,
};

const styles = StyleSheet.create({
  seccion: { gap: 10 },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tituloSeccion: { fontSize: 15.5, fontWeight: '800', color: '#FFFFFF' },
  verToda: { fontSize: 12.5, fontWeight: '700' },
  lista: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: clubSuperficies.borde,
    backgroundColor: clubSuperficies.card,
    overflow: 'hidden',
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  filaConSeparador: { borderTopWidth: 1, borderTopColor: clubSuperficies.separador },
  icono: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titulo: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: '600', color: '#FFFFFF' },
  cuando: { fontSize: 11, color: 'rgba(255, 255, 255, 0.35)' },
});
