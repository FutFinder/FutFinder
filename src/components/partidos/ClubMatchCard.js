import React from 'react';
import { View, Text, Image, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MapPin, Users, Swords, Wallet } from 'lucide-react-native';

import { partidos as P, partidosRadius as R } from '../../theme/colors';
import { cuotaLabel } from '../../services/matchRules';
import {
  cuposLabel,
  clubesDelPartido,
  lugarLabel,
  esUbicacionAproximada,
} from '../../services/clubMatchRules';
import { whenLabel } from './PartidoCard';

/**
 * Tarjeta del partido entre clubes.
 *
 * Tiene que destacar sobre un partido normal sin salirse de la estética de
 * FutFinder, así que la jerarquía se construye con lo que ya existe —el verde
 * `P.green` y la familia `partidos`— llevado al máximo: borde verde marcado,
 * un halo verde contenido alrededor y una franja superior con degradado. Nada
 * de rojo: ese color está reservado a lo que necesita atención (una
 * negociación trabada) y este partido es una buena noticia.
 *
 * LOS CUPOS NO SE MUESTRAN COMO COMPARTIDOS. Un 9 por club da
 * `cupos_totales = 18`, y «18 de 18 cupos» haría creer que cualquiera puede
 * quedarse con los 18. La etiqueta la decide `cuposLabel`, que sabe si quien
 * mira pertenece a alguno de los dos clubes.
 *
 * LA UBICACIÓN DE ESTA TARJETA ES APROXIMADA, siempre. La exacta vive en
 * `club_match_locations` y pedirla aquí sería una consulta por tarjeta; en la
 * lista, entonces, ni los integrantes la tienen. Por eso el aviso no depende
 * de quién mire: describe el dato que hay, y el dato es una celda de ~1 km.
 * La dirección exacta y el «Cómo llegar» están en el detalle.
 *
 * `variant="compacta"` es la de Inicio: mismo lenguaje visual, menos alto.
 */
export default function ClubMatchCard({ match, misClubIds = [], onPress, variant = 'completa' }) {
  const compacta = variant === 'compacta';
  const { local, visitante } = clubesDelPartido(match);
  const cancelado = match?.estado === 'cancelado';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Partido de clubes. ${local.nombre} contra ${visitante.nombre}. ${whenLabel(
        match?.hora
      )}. ${cuposLabel(match, misClubIds)}.`}
      style={({ pressed }) => [
        styles.glow,
        compacta && styles.glowCompacta,
        cancelado && styles.glowApagado,
        pressed && { opacity: 0.92 },
      ]}
    >
      <View style={[styles.card, cancelado && styles.cardCancelado]}>
        {/* Franja superior: es lo que separa de un vistazo este partido de
            una pichanga cualquiera. */}
        <LinearGradient
          colors={[P.greenSoftStrong, 'rgba(90,224,106,0.02)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.franja}
        >
          <Swords color={P.green} size={13} strokeWidth={2.6} />
          <Text style={styles.franjaText}>PARTIDO DE CLUBES</Text>
          <View style={{ flex: 1 }} />
          {cancelado ? <Text style={styles.canceladoText}>CANCELADO</Text> : null}
        </LinearGradient>

        {/* Los dos escudos con el VS al medio. */}
        <View style={[styles.enfrentamiento, compacta && styles.enfrentamientoCompacto]}>
          <Escudo club={local} compacta={compacta} />
          <View style={styles.vsCol}>
            <Text style={styles.vs}>VS</Text>
          </View>
          <Escudo club={visitante} compacta={compacta} alineadoDerecha />
        </View>

        {/* Cuándo, con más peso que en la tarjeta normal: en un partido de
            clubes la fecha es el dato que la gente busca primero. */}
        <View style={styles.cuandoRow}>
          <Text style={[styles.cuando, compacta && styles.cuandoCompacta]} numberOfLines={1}>
            {whenLabel(match?.hora)}
          </Text>
          {match?.duracion_min ? (
            <Text style={styles.duracion}>{`${match.duracion_min}'`}</Text>
          ) : null}
        </View>

        <View style={styles.lugarRow}>
          <MapPin color={P.textFaint} size={12.5} strokeWidth={2} />
          <Text numberOfLines={compacta ? 1 : 2} style={styles.lugarText}>
            {lugarLabel(match, misClubIds)}
          </Text>
        </View>
        {esUbicacionAproximada(match) ? (
          <Text style={styles.aproximada}>Ubicación aproximada</Text>
        ) : null}

        <View style={styles.divider} />

        <View style={styles.bottomRow}>
          <View style={styles.datoRow}>
            <Users color={P.green} size={13} strokeWidth={2} />
            <Text style={styles.cupos} numberOfLines={1}>
              {cuposLabel(match, misClubIds)}
            </Text>
          </View>
          {!compacta && match?.precio_cuota != null ? (
            <View style={styles.datoRow}>
              <Wallet color={P.textFaint} size={12.5} strokeWidth={2} />
              <Text style={styles.cuota} numberOfLines={1}>
                {cuotaLabel(match.precio_cuota)}
              </Text>
            </View>
          ) : null}
          <View style={styles.cta}>
            <Text style={styles.ctaText}>Ver partido</Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Escudo + nombre de un club.
 *
 * Sin escudo se dibujan las iniciales, no un hueco: media tarjeta vacía se ve
 * rota. El nombre se recorta a dos líneas —`flexShrink` para que el VS del
 * medio nunca se lo coma— porque los nombres largos son la norma, no la
 * excepción.
 */
function Escudo({ club, compacta, alineadoDerecha }) {
  const lado = compacta ? 34 : 44;
  return (
    <View style={[styles.clubCol, alineadoDerecha && styles.clubColDerecha]}>
      <View style={[styles.escudo, { width: lado, height: lado, borderRadius: lado / 2 }]}>
        {club.fotoUrl ? (
          <Image
            source={{ uri: club.fotoUrl }}
            style={{ width: lado, height: lado, borderRadius: lado / 2 }}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <Text style={[styles.inicialesText, compacta && { fontSize: 12 }]}>{club.iniciales}</Text>
        )}
      </View>
      <Text
        numberOfLines={2}
        style={[
          styles.clubNombre,
          compacta && styles.clubNombreCompacto,
          alineadoDerecha && { textAlign: 'right' },
        ]}
      >
        {club.nombre}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // El halo va en un contenedor aparte para no recortarlo con el
  // `overflow: hidden` que necesita la franja superior.
  // Sin margen propio: el espaciado lo pone la lista que la contiene, igual
  // que `PartidoCard`. Si la tarjeta trajera el suyo, en una lista con `gap`
  // quedaría separada del resto.
  glow: {
    borderRadius: R.card + 2,
    shadowColor: P.green,
    shadowOpacity: 0.34,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 7,
  },
  glowCompacta: { shadowOpacity: 0.26, shadowRadius: 12, elevation: 5 },
  glowApagado: { shadowOpacity: 0, elevation: 0 },

  card: {
    backgroundColor: P.surface,
    borderRadius: R.card,
    borderWidth: 1.5,
    borderColor: P.greenBorderStrong,
    overflow: 'hidden',
  },
  cardCancelado: { borderColor: P.border, opacity: 0.72 },

  franja: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: P.greenBorder,
  },
  franjaText: {
    color: P.green,
    fontSize: 10.5,
    fontWeight: '900',
    letterSpacing: 1.1,
  },
  canceladoText: { color: P.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },

  // `maxWidth` + centrado: sin tope, en web los escudos se van a los
  // extremos de la tarjeta y dejan un vacío enorme entre ellos y el VS. El
  // enfrentamiento se lee mejor compacto, y en móvil el tope no llega a
  // aplicarse nunca.
  enfrentamiento: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    alignSelf: 'center',
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 13,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 8,
  },
  enfrentamientoCompacto: { paddingTop: 11, paddingBottom: 8 },

  // `flex: 1` + `minWidth: 0` es lo que deja que un nombre largo se recorte
  // en vez de empujar al VS fuera de la tarjeta en pantallas estrechas.
  clubCol: { flex: 1, minWidth: 0, alignItems: 'center', gap: 7 },
  clubColDerecha: { alignItems: 'center' },

  escudo: {
    backgroundColor: P.chip,
    borderWidth: 1,
    borderColor: P.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  inicialesText: { color: P.green, fontSize: 15, fontWeight: '900', letterSpacing: 0.5 },

  clubNombre: {
    color: P.textStrong,
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
    lineHeight: 17,
  },
  clubNombreCompacto: { fontSize: 12, lineHeight: 15 },

  vsCol: { width: 34, alignItems: 'center', paddingTop: 12 },
  vs: {
    color: P.green,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
  },

  cuandoRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 13,
  },
  cuando: { color: P.text, fontSize: 19, fontWeight: '900', letterSpacing: 0.2, flexShrink: 1 },
  cuandoCompacta: { fontSize: 16.5 },
  duracion: { color: P.textFaint, fontSize: 12, fontWeight: '700' },

  lugarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingTop: 5,
  },
  lugarText: { color: P.textDim, fontSize: 12.5, flex: 1, minWidth: 0 },
  aproximada: {
    color: P.textFaint,
    fontSize: 11,
    fontStyle: 'italic',
    paddingHorizontal: 13,
    paddingTop: 3,
  },

  divider: {
    height: 1,
    backgroundColor: P.divider,
    marginHorizontal: 13,
    marginTop: 11,
  },

  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  datoRow: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0, flexShrink: 1 },
  cupos: { color: P.green, fontSize: 12.5, fontWeight: '800', flexShrink: 1 },
  cuota: { color: P.textDim, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },

  cta: {
    // `marginLeft: 'auto'` y no un separador flexible: con `flexWrap`, cuando
    // el CTA no cabe y baja a su propia línea, un separador lo dejaba pegado
    // a la izquierda. Así queda a la derecha quepa o no quepa.
    marginLeft: 'auto',
    height: 34,
    paddingHorizontal: 16,
    borderRadius: R.pill,
    backgroundColor: P.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: P.greenInk, fontSize: 12.5, fontWeight: '900', letterSpacing: 0.2 },
});
