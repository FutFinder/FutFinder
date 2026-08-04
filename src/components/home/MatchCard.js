import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import StatusPill from './StatusPill';
import { tactical as t } from '../../theme/colors';

function formatHora(iso) {
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const isTomorrow =
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate();
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    if (sameDay) return `Hoy ${hh}:${mm}`;
    if (isTomorrow) return `Mañana ${hh}:${mm}`;
    return (
      d.toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' }) +
      ` ${hh}:${mm}`
    );
  } catch {
    return iso;
  }
}

function nivelLabel(n) {
  return { recreativo: 'Recreativo', intermedio: 'Intermedio', competitivo: 'Competitivo' }[n] || n;
}

function distanceLabel(km) {
  if (km == null) return null;
  return `${km.toFixed(1).replace('.', ',')} KM`;
}

function Meta({ label, value, tone }) {
  return (
    <View className={`flex-1 rounded-xl border px-2.5 py-2 ${tone === 'neon' ? 'border-[#00FF66]/15 bg-[#00FF66]/6' : 'border-white/8 bg-white/5'}`}>
      <Text className="text-[9.5px] font-bold tracking-[0.18em] text-white/40">{label}</Text>
      <Text className={`mt-0.5 text-[14px] font-bold ${tone === 'neon' ? 'text-[#00FF66]' : 'text-white'}`}>{value}</Text>
    </View>
  );
}

export default function MatchCard({ match: m, onJoin, onPress, width = 238 }) {
  const cuposLeft = m.cupos_disponibles ?? 0;
  const full = cuposLeft <= 0;
  const joined = !!m._joined;
  const manual = m.aprobacion === 'manual';

  const status = full ? 'COMPLETO' : joined ? 'INSCRITO' : 'ABIERTO';
  const cta = full ? 'Lista de espera' : joined ? 'Inscrito ✓' : manual ? 'Solicitar unirme' : 'Unirme al partido';
  const ctaClass = full
    ? 'border-white/12 bg-white/5'
    : joined
      ? 'border-[#00FF66]/40 bg-[#00FF66]/14'
      : 'border-[#00FF66] bg-[#00FF66]';
  const ctaText = full ? 'text-white/70' : joined ? 'text-[#00FF66]' : 'text-[#04120A]';
  const dist = distanceLabel(m._distanciaKm);

  return (
    <Pressable onPress={() => onPress?.(m.id)} style={{ width }}>
      <LinearGradient colors={[t.surface, t.surfaceAlt]} className="gap-3 rounded-[20px] border border-white/8 p-3.5">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-1.5">
            <StatusPill label={status} tone={full ? 'danger' : 'neon'} dot />
            {m.club_local_id ? <StatusPill label="CLUBES" tone="neutral" /> : null}
          </View>
          {dist ? <Text className="text-[11px] font-bold tracking-[0.14em] text-white/45">{dist}</Text> : null}
        </View>

        <View>
          <Text numberOfLines={1} className="text-[17px] font-extrabold tracking-tight text-white">{m.cancha_nombre}</Text>
          <Text className="mt-0.5 text-[13px] text-white/50">{nivelLabel(m.nivel || 'recreativo')} · {m.comuna}</Text>
        </View>

        <View className="flex-row gap-1.5">
          <Meta label="HORA" value={formatHora(m.hora)} />
          <Meta label="CUPOS" value={full ? 'Completo' : `${cuposLeft} de ${m.cupos_totales}`} tone={full ? undefined : 'neon'} />
        </View>

        <Pressable
          onPress={() => onJoin?.(m.id)}
          disabled={full || joined}
          className={`h-[42px] items-center justify-center rounded-[13px] border active:opacity-80 ${ctaClass}`}
        >
          <Text className={`text-[13.5px] font-bold ${ctaText}`}>{cta}</Text>
        </Pressable>
      </LinearGradient>
    </Pressable>
  );
}
