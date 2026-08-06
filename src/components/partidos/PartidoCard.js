import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { MapPin, ShieldCheck, Users, Zap, Swords } from 'lucide-react-native';

import { Avatar, Tag } from './ui';
import { partidos as P, partidosRadius as R } from '../../theme/colors';
import {
  cuotaLabel,
  edadLabel,
  estadoLabel,
  modalidadLabel,
  nivelLabel,
} from '../../services/matchRules';

/**
 * Tarjeta del listado «Descubrir partidos» (variante 1a del handoff).
 *
 * Muestra solo lo que existe: si el partido no trae modalidad, rango de edad,
 * distancia o Trust Score mínimo, esas piezas simplemente no se dibujan. Nada
 * se inventa ni se rellena con datos de ejemplo.
 */
export default function PartidoCard({ match, onPress, isMine, distanceKm }) {
  const libres = match.cupos_disponibles ?? 0;
  const totales = match.cupos_totales ?? 0;
  const full = libres <= 0;
  const pocos = !full && libres <= 2;
  const estado = estadoLabel(match);
  const manual = match.aprobacion === 'manual';
  const modalidad = modalidadLabel(match);
  const edad = match.edad_min != null || match.edad_max != null ? edadLabel(match) : null;

  // Espontáneo: empieza en menos de 1 h y es gratis.
  const minutosHasta = (new Date(match.hora).getTime() - Date.now()) / 60000;
  const espontaneo = minutosHasta >= 0 && minutosHasta < 60 && Number(match.precio_cuota) === 0;

  const cta = isMine
    ? 'Gestionar'
    : match.estado === 'cancelado'
    ? 'Cancelado'
    : full
    ? 'Lista de espera'
    : manual
    ? 'Solicitar'
    : 'Ver partido';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${match.titulo}. ${whenLabel(match.hora)}. ${match.cancha_nombre || ''} ${match.comuna || ''}`}
      style={({ pressed }) => [
        styles.card,
        isMine && styles.cardMine,
        pressed && { opacity: 0.9 },
      ]}
    >
      {/* Fila 1 · cuándo + tipo de inscripción */}
      <View style={styles.topRow}>
        <View style={styles.whenPill}>
          <Text style={styles.whenText}>{whenLabel(match.hora)}</Text>
        </View>
        <View style={{ flex: 1 }} />
        {match.club_local_id ? (
          <View style={styles.clubBadge}>
            <Swords color={P.green} size={11} strokeWidth={2.4} />
            <Text style={styles.clubBadgeText}>CLUBES</Text>
          </View>
        ) : null}
        <View style={styles.aprobRow}>
          <ShieldCheck color={manual ? P.gold : P.textFaint} size={12} strokeWidth={2} />
          <Text style={[styles.aprobText, manual && { color: P.gold }]}>
            {manual ? 'Con aprobación' : 'Inmediata'}
          </Text>
        </View>
      </View>

      {/* Fila 2 · título + lugar */}
      <View>
        <Text numberOfLines={2} style={styles.title}>
          {match.titulo}
        </Text>
        <View style={styles.placeRow}>
          <MapPin color={P.textFaint} size={12.5} strokeWidth={2} />
          <Text numberOfLines={1} style={styles.placeText}>
            {[match.cancha_nombre, match.comuna].filter(Boolean).join(' · ')}
            {distanceKm != null ? ` · ${fmtKm(distanceKm)}` : ''}
          </Text>
        </View>
      </View>

      {/* Fila 3 · metadatos */}
      <View style={styles.tags}>
        {modalidad ? <Tag label={modalidad} /> : null}
        {match.nivel ? <Tag label={nivelLabel(match.nivel)} /> : null}
        {match.duracion_min ? <Tag label={`${match.duracion_min}'`} /> : null}
        {edad ? <Tag label={edad} /> : null}
        {match.min_trust_score > 0 ? (
          <Tag label={`Trust ${match.min_trust_score}+`} tone="green" />
        ) : null}
        {estado.label !== 'Abierto' ? (
          <Tag
            label={estado.label}
            tone={estado.tone === 'danger' ? 'danger' : estado.tone === 'gold' ? 'gold' : 'neutral'}
          />
        ) : null}
        {espontaneo ? <Tag label="Espontáneo" tone="green" /> : null}
      </View>

      <View style={styles.divider} />

      {/* Fila 4 · cupos, cuota y CTA */}
      <View style={styles.bottomRow}>
        <View style={styles.cuposRow}>
          <Users
            color={full ? P.textMuted : pocos ? P.gold : P.green}
            size={13}
            strokeWidth={2}
          />
          <Text
            style={[
              styles.cupos,
              { color: full ? P.textMuted : pocos ? P.gold : P.green },
            ]}
          >
            {full ? 'Sin cupos' : `${libres} de ${totales} cupos`}
          </Text>
          <View style={styles.dot} />
          <Text style={styles.cuota}>{cuotaLabel(match.precio_cuota)}</Text>
        </View>
        <View style={styles.ctaBtn}>
          <Text style={styles.ctaText}>{cta}</Text>
        </View>
      </View>

      {/* Fila 5 · organizador */}
      <View style={styles.orgRow}>
        <Avatar name={match.organizador?.username || (isMine ? 'Tú' : 'FF')} size={22} url={match.organizador?.foto_url} />
        <Text style={styles.orgName} numberOfLines={1}>
          {isMine ? 'Organizas tú' : match.organizador?.username ? `@${match.organizador.username}` : 'Organizador'}
        </Text>
        {match.organizador?.trust_score != null ? (
          <View style={styles.tsBadge}>
            <Text style={styles.tsText}>TS {match.organizador.trust_score}</Text>
          </View>
        ) : null}
        {espontaneo ? (
          <>
            <View style={{ flex: 1 }} />
            <Zap color={P.green} size={12} strokeWidth={2.4} />
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

/** «Hoy 20:00» / «Mañana 10:30» / «Jue 6 ago · 20:00». */
export function whenLabel(iso) {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    if (sameDay) return `Hoy ${hh}:${mm}`;
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const isTomorrow =
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate();
    if (isTomorrow) return `Mañana ${hh}:${mm}`;
    return (
      d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' }) +
      ` ${hh}:${mm}`
    );
  } catch {
    return '';
  }
}

export function fmtKm(km) {
  if (km == null) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace('.', ',')} km`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: P.surface,
    borderWidth: 1,
    borderColor: P.border,
    borderRadius: R.list,
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 11,
    gap: 9,
  },
  cardMine: { borderColor: P.greenBorder },

  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  whenPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: R.chip,
    backgroundColor: 'rgba(90,224,106,0.11)',
  },
  whenText: { fontSize: 11.5, fontWeight: '700', color: P.green, letterSpacing: -0.2 },
  clubBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: R.chipSm,
    backgroundColor: P.greenSoft,
  },
  clubBadgeText: { fontSize: 9.5, fontWeight: '800', color: P.green, letterSpacing: 0.4 },
  aprobRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  aprobText: { fontSize: 10.5, fontWeight: '600', color: P.textFaint },

  title: { fontSize: 16.5, fontWeight: '700', color: P.text, letterSpacing: -0.25 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  placeText: { flex: 1, fontSize: 12.5, fontWeight: '500', color: P.textMuted },

  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  divider: { height: 1, backgroundColor: P.hairline },

  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  cuposRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  cupos: { fontSize: 13, fontWeight: '700' },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#434A44' },
  cuota: { fontSize: 13, fontWeight: '700', color: P.text },
  ctaBtn: {
    height: 34,
    paddingHorizontal: 15,
    borderRadius: R.control,
    backgroundColor: P.chip,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { fontSize: 12.5, fontWeight: '700', color: P.textStrong },

  orgRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  orgName: { fontSize: 11.5, fontWeight: '600', color: P.textMuted, maxWidth: '55%' },
  tsBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: P.chip },
  tsText: { fontSize: 10, fontWeight: '700', color: P.textMuted },
});
