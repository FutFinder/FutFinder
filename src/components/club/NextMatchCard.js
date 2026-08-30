import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { CalendarDays, MapPin } from 'lucide-react-native';

import { temaClub } from '../../theme/clubThemes';
import { clubSuperficies } from '../../theme/colors';
import { clubesDelPartido } from '../../services/clubMatchRules';
import ClubLogo from './ClubLogo';

/**
 * El próximo partido del club, destacado.
 *
 * Es la única tarjeta con sombra y borde de acento de toda la portada: si
 * hay un partido a la vista, es lo más importante de la pantalla.
 *
 * LOS DOS CLUBES SALEN DE `clubesDelPartido()`, que ya garantiza nombre e
 * iniciales aunque la consulta no haya traído el club: media tarjeta vacía se
 * ve rota, y ese caso pasa cuando un club se borró.
 *
 * EL PROPIO SE PINTA CON EL TEMA Y EL RIVAL EN NEUTRO. En cualquier vista con
 * dos clubes el acento sale del club del usuario, nunca del rival.
 *
 * @param {object} partido      Fila de `matches` con `club_local`/`club_visitante`.
 * @param {object} [tema]       Escala del club propio.
 * @param {object} [cupos]      `{ confirmados, cupos }`. Sin esto no se dibuja la barra.
 * @param {string} [plazo]      «EN 3 DÍAS», «HOY»… lo redacta la portada.
 * @param {string} [fecha]      Ya formateada.
 * @param {string} [lugar]      Ya formateado (`lugarLabel`).
 * @param {string} [miClubId]   Para saber cuál de los dos es el propio.
 * @param {Function} [onVerPartido]
 * @param {Function} [onNomina]
 */
export default function NextMatchCard({
  partido,
  tema,
  cupos,
  plazo,
  fecha,
  lugar,
  miClubId,
  onVerPartido,
  onNomina,
}) {
  const escala = tema || temaClub('green');
  if (!partido) return null;

  const { local, visitante } = clubesDelPartido(partido);
  const localEsMio = !!miClubId && partido.club_local_id === miClubId;

  return (
    <View style={[styles.tarjeta, { borderColor: escala.border, shadowColor: '#000' }]}>
      <View style={styles.cabecera}>
        {plazo ? (
          <View style={[styles.pill, { backgroundColor: escala.main }]}>
            <Text style={[styles.pillTexto, { color: escala.ink }]}>{plazo}</Text>
          </View>
        ) : (
          <View />
        )}
        {partido.modalidad ? (
          <Text style={styles.modalidad}>{etiquetaModalidad(partido.modalidad)}</Text>
        ) : null}
      </View>

      <View style={styles.enfrentamiento}>
        <Lado club={local} propio={localEsMio} tema={escala} />
        <Text style={styles.vs}>VS</Text>
        <Lado club={visitante} propio={!localEsMio && !!miClubId} tema={escala} />
      </View>

      <View style={styles.tiles}>
        <Tile Icono={CalendarDays} rotulo="FECHA" valor={fecha || 'Por confirmar'} />
        <Tile Icono={MapPin} rotulo="LUGAR" valor={lugar || 'Por confirmar'} />
      </View>

      {cupos && Number.isFinite(cupos.cupos) && cupos.cupos > 0 ? (
        <View style={styles.cupos}>
          <View style={styles.cuposFila}>
            <Text style={styles.cuposRotulo}>Cupos de tu club</Text>
            <Text style={styles.cuposValor}>
              {cupos.confirmados} / {cupos.cupos}
            </Text>
          </View>
          <View style={styles.pista}>
            <View
              style={[
                styles.relleno,
                {
                  backgroundColor: escala.main,
                  width: `${Math.min(100, (cupos.confirmados / cupos.cupos) * 100)}%`,
                },
              ]}
            />
          </View>
        </View>
      ) : null}

      <View style={styles.acciones}>
        <Pressable
          onPress={onVerPartido}
          accessibilityRole="button"
          accessibilityLabel="Ver partido"
          style={({ pressed }) => [
            styles.accion,
            styles.accionPrimaria,
            { backgroundColor: escala.main },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.accionTexto, { color: escala.ink }]}>Ver partido</Text>
        </Pressable>
        <Pressable
          onPress={onNomina}
          accessibilityRole="button"
          accessibilityLabel="Ver nómina"
          style={({ pressed }) => [
            styles.accion,
            styles.accionSecundaria,
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.accionTexto}>Nómina</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Lado({ club, propio, tema }) {
  return (
    <View style={styles.lado}>
      <ClubLogo
        uri={club.fotoUrl}
        size={52}
        borderRadius={17}
        tema={propio ? tema : undefined}
        style={propio ? { backgroundColor: tema.soft } : undefined}
      />
      <Text style={styles.nombreClub} numberOfLines={2}>
        {club.nombre}
      </Text>
    </View>
  );
}

function Tile({ Icono, rotulo, valor }) {
  return (
    <View style={styles.tile}>
      <View style={styles.tileCabecera}>
        <Icono size={12} color="rgba(255, 255, 255, 0.35)" strokeWidth={2.2} />
        <Text style={styles.tileRotulo}>{rotulo}</Text>
      </View>
      <Text style={styles.tileValor} numberOfLines={2}>
        {valor}
      </Text>
    </View>
  );
}

/** `matches.modalidad` guarda 'futbol7'/'futbol11'; la tarjeta los muestra. */
function etiquetaModalidad(valor) {
  if (valor === 'futbol7') return 'FÚTBOL 7';
  if (valor === 'futbol11') return 'FÚTBOL 11';
  return String(valor).toUpperCase();
}

const styles = StyleSheet.create({
  tarjeta: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 17,
    gap: 15,
    backgroundColor: clubSuperficies.cardAlta,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.45,
    shadowRadius: 34,
    elevation: 8,
  },
  cabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 9 },
  pillTexto: { fontSize: 10.5, fontWeight: '800', letterSpacing: 0.4 },
  modalidad: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.4,
    color: 'rgba(255, 255, 255, 0.35)',
  },
  enfrentamiento: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lado: { flex: 1, alignItems: 'center', gap: 8 },
  nombreClub: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  vs: {
    fontSize: 15,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.35)',
    marginTop: 18,
  },
  tiles: { flexDirection: 'row', gap: 9 },
  tile: {
    flex: 1,
    gap: 5,
    padding: 11,
    borderRadius: 13,
    backgroundColor: 'rgba(255, 255, 255, 0.045)',
  },
  tileCabecera: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  tileRotulo: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: 'rgba(255, 255, 255, 0.35)',
  },
  tileValor: { fontSize: 12.5, fontWeight: '600', color: '#FFFFFF' },
  cupos: { gap: 7 },
  cuposFila: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cuposRotulo: { fontSize: 11.5, color: 'rgba(255, 255, 255, 0.45)' },
  cuposValor: { fontSize: 12.5, fontWeight: '700', color: '#FFFFFF' },
  pista: {
    height: 6,
    borderRadius: 99,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
  },
  relleno: { height: 6, borderRadius: 99 },
  acciones: { flexDirection: 'row', gap: 9 },
  accion: {
    height: 48,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accionPrimaria: { flex: 1 },
  accionSecundaria: {
    paddingHorizontal: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.12)',
  },
  accionTexto: { fontSize: 14, fontWeight: '700', color: '#FFFFFF' },
});
