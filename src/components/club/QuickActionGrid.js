import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Rows3, Swords, Search, CalendarDays, Users, ShieldCheck } from 'lucide-react-native';

import { temaClub } from '../../theme/clubThemes';
import { paleta as C, clubSuperficies, fuentes as F } from '../../theme/colors';

/**
 * Los accesos rápidos del club, en grilla de tres.
 *
 * El orden es fijo y no depende del rol: mover los tiles según quién mira
 * obliga a leer la grilla entera cada vez. Lo que cambia es qué se puede
 * tocar.
 *
 * INTEGRANTES LO VEN TODOS. Un jugador tiene derecho a saber quiénes son sus
 * compañeros; lo que no puede es gestionarlos, y de eso se ocupa la pantalla
 * de destino. Solo «Permisos de club» desaparece sin `can.gestionarPermisos`,
 * porque repartir permisos es del administrador y no se delega — ni siquiera
 * a quien tenga otros permisos concedidos.
 *
 * LA NOTA DEL JUGADOR NO ES UNA DISCULPA, ES UNA EXPLICACIÓN. Sin ella, un
 * jugador ve tareas que no puede resolver y no entiende por qué. Con ella
 * sabe que está informado a propósito y quién actúa.
 *
 * @param {object} [tema]   Escala de `theme/clubThemes.js`.
 * @param {object} [can]    Permisos de `permisosDeClub()`.
 * @param {object} [badges] `{ desafios: n }` — contadores por clave.
 * @param {Function} onPress Recibe la clave del tile.
 */
export default function QuickActionGrid({ tema, can, badges, onPress }) {
  const escala = tema || temaClub('green');
  const permisos = can || {};
  const esJugador = !permisos.gestionarPermisos;

  const tiles = ACCIONES.filter((a) => !a.requiere || permisos[a.requiere]);

  return (
    <View style={styles.envoltorio}>
      <View style={styles.grilla}>
        {tiles.map(({ clave, etiqueta, Icono }) => {
          const badge = badges?.[clave] || 0;
          return (
            <Pressable
              key={clave}
              onPress={() => onPress?.(clave)}
              accessibilityRole="button"
              accessibilityLabel={badge > 0 ? `${etiqueta}, ${badge} pendientes` : etiqueta}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.75 }]}
            >
              <View style={[styles.icono, { backgroundColor: escala.soft }]}>
                <Icono size={17} color={escala.main} strokeWidth={2.2} />
              </View>
              <Text style={styles.etiqueta}>{etiqueta}</Text>
              {badge > 0 ? (
                <View style={[styles.badge, { backgroundColor: escala.main }]}>
                  <Text style={[styles.badgeTexto, { color: escala.ink }]}>
                    {badge > 9 ? '9+' : String(badge)}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      {esJugador ? (
        <Text style={styles.nota}>
          Ves los integrantes y todo lo pendiente; responder desafíos, cambios y ajustes
          queda en manos de un administrador.
        </Text>
      ) : null}
    </View>
  );
}

const ACCIONES = [
  { clave: 'alineacion', etiqueta: 'Alineación', Icono: Rows3 },
  { clave: 'desafios', etiqueta: 'Desafíos', Icono: Swords },
  { clave: 'rivales', etiqueta: 'Buscar rivales', Icono: Search },
  { clave: 'partido', etiqueta: 'Próximo partido', Icono: CalendarDays },
  { clave: 'integrantes', etiqueta: 'Integrantes', Icono: Users },
  { clave: 'permisos', etiqueta: 'Permisos de club', Icono: ShieldCheck, requiere: 'gestionarPermisos' },
];

const styles = StyleSheet.create({
  envoltorio: { gap: 10 },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  tile: {
    // Tres columnas con dos huecos de 9: cada una ocupa un tercio del ancho
    // menos su parte proporcional de los huecos.
    width: '31.5%',
    flexGrow: 1,
    gap: 9,
    paddingVertical: 12,
    paddingHorizontal: 11,
    borderRadius: 17,
    backgroundColor: clubSuperficies.card,
  },
  icono: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  etiqueta: { fontSize: 12.5, fontFamily: F.bold, color: '#FFFFFF' },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    minWidth: 19,
    height: 19,
    borderRadius: 7,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeTexto: { fontSize: 11, fontFamily: F.extraBold },
  nota: {
    fontSize: 11.5,
    lineHeight: 16,
    color: C.textMuted,
  },
});
