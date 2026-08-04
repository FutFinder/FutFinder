/**
 * Reglas de presentación del perfil de jugador: modalidad, nivel, posición,
 * valoración, tasa de asistencia y estado de participaciones.
 *
 * Vive fuera de los componentes visuales para que la decisión de "qué se
 * muestra cuando el dato no existe" esté en un solo lugar.
 *
 * TRES CASOS DISTINTOS, no los mezcles:
 *   - N.A.        → todavía no hay datos suficientes para calcularlo
 *   - 0 real      → el dato existe y vale cero
 *   - vacío/CTA   → el jugador debe completar algo
 */

/** Valores válidos de `profiles.modalidad` (migración 30). */
export const MODALIDADES = {
  FUTBOL_7: 'futbol7',
  FUTBOL_11: 'futbol11',
  AMBOS: 'ambos',
};

export const OPCIONES_MODALIDAD = [
  { value: MODALIDADES.FUTBOL_7, label: 'Fútbol 7' },
  { value: MODALIDADES.FUTBOL_11, label: 'Fútbol 11' },
  { value: MODALIDADES.AMBOS, label: 'Fútbol 7 y Fútbol 11' },
];

/** Valores válidos de `profiles.nivel` (migración 30). Autodeclarado. */
export const OPCIONES_NIVEL = [
  { value: 'A', label: 'Nivel A', hint: 'Competitivo' },
  { value: 'B', label: 'Nivel B', hint: 'Intermedio alto' },
  { value: 'C', label: 'Nivel C', hint: 'Intermedio' },
  { value: 'D', label: 'Nivel D', hint: 'Recreativo' },
];

export const POSICION_LABEL = {
  arquero: 'Arquero',
  defensa: 'Defensa',
  medio: 'Mediocampista',
  delantero: 'Delantero',
  lateral: 'Lateral',
  volante: 'Volante',
  sin_definir: 'Sin definir',
};

export function esModalidadValida(v) {
  return Object.values(MODALIDADES).includes(v);
}

export function esNivelValido(v) {
  return OPCIONES_NIVEL.some((o) => o.value === v);
}

/**
 * Chips del banner del perfil: modalidad + posiciones + nivel.
 * Cada chip trae `{ label, placeholder }`; `placeholder: true` significa que
 * el dato no existe y debe dibujarse con borde discontinuo y texto apagado.
 */
export function playerBadges(profile) {
  const badges = [];

  const mod = modalidadInline(profile?.modalidad);
  badges.push({ key: 'mod', label: mod.toUpperCase(), placeholder: !profile?.modalidad });

  const pos = posicionesReales(profile?.posicion_preferida);
  if (pos.length > 0) {
    for (const p of pos) {
      badges.push({ key: `pos-${p}`, label: (POSICION_LABEL[p] || p).toUpperCase(), placeholder: false });
    }
  } else {
    badges.push({ key: 'pos', label: 'POSICIÓN N.A.', placeholder: true });
  }

  badges.push({
    key: 'niv',
    label: profile?.nivel ? `NIVEL ${profile.nivel}` : 'NIVEL N.A.',
    placeholder: !profile?.nivel,
  });

  return badges;
}

/**
 * Posiciones realmente declaradas. Tolera el formato antiguo (string) y
 * descarta el centinela 'sin_definir', que no es una posición.
 */
export function posicionesReales(pref) {
  if (!pref) return [];
  const arr = Array.isArray(pref) ? pref : [pref];
  return arr.filter((p) => p && p !== 'sin_definir');
}

/** 'futbol7' → 'Fútbol 7'. Sin modalidad → 'Fútbol N.A.'. */
export function modalidadInline(modalidad) {
  if (modalidad === MODALIDADES.FUTBOL_7) return 'Fútbol 7';
  if (modalidad === MODALIDADES.FUTBOL_11) return 'Fútbol 11';
  if (modalidad === MODALIDADES.AMBOS) return 'Fútbol 7 y Fútbol 11';
  return 'Fútbol N.A.';
}

/**
 * Valoración media del jugador.
 * @returns {{ value: string, hasRatings: boolean, count: number, filled: number }}
 *   value: '4,6' | 'N.A.'   filled: estrellas llenas (0 si no hay evaluaciones)
 */
export function ratingDisplay(summary) {
  const count = summary?.count ?? 0;
  const overall = Number(summary?.overall ?? 0);
  if (!count || !Number.isFinite(overall) || overall <= 0) {
    return { value: 'N.A.', hasRatings: false, count: 0, filled: 0 };
  }
  return {
    value: overall.toFixed(1).replace('.', ','),
    hasRatings: true,
    count,
    filled: Math.round(overall),
  };
}

/**
 * Trust Score. Es 100 por defecto en la BD, así que sin partidos confirmados
 * no significa nada todavía: en ese caso se muestra N.A. en vez de un 100
 * que el jugador no se ha ganado.
 *
 * @returns {{ value: string, pct: number|null, hint: string }}
 */
export function trustDisplay(profile) {
  const confirmadas = profile?.asistencias_confirmadas ?? 0;
  const score = profile?.trust_score;

  if (confirmadas <= 0 || score === null || score === undefined) {
    return { value: 'N.A.', pct: null, hint: 'Se calcula tras tus primeros partidos' };
  }
  const n = Number(score);
  return {
    value: String(n),
    pct: Math.max(0, Math.min(100, n)),
    hint: n >= 85 ? 'Jugador confiable' : n >= 60 ? 'Reputación en construcción' : 'Reputación baja',
  };
}

/**
 * Tasa de asistencia sobre el historial cargado.
 * Sin participaciones cerradas no se puede calcular → N.A. (nunca 100 %).
 *
 * "Cerrada" = el partido ya ocurrió desde la óptica del jugador: asistió
 * (confirmado_gps) o no asistió (no_asistio). Las inscripciones futuras y
 * las canceladas no cuentan en el denominador.
 *
 * @returns {{ value: string, pct: number|null, hint: string, confirmadas: number, cerradas: number }}
 */
export function attendanceDisplay(history) {
  const rows = history || [];
  const confirmadas = rows.filter((h) => h.estado === 'confirmado_gps').length;
  const ausencias = rows.filter((h) => h.estado === 'no_asistio').length;
  const cerradas = confirmadas + ausencias;

  if (cerradas === 0) {
    return {
      value: 'N.A.',
      pct: null,
      hint: 'Aún sin partidos suficientes para calcularla',
      confirmadas,
      cerradas,
    };
  }

  const pct = Math.round((confirmadas / cerradas) * 100);
  const hint =
    `${pct >= 90 ? 'Excelente asistencia' : pct >= 70 ? 'Buena asistencia' : 'Asistencia baja'}` +
    ` · ${confirmadas} de ${cerradas} partidos confirmados`;

  return { value: `${pct} %`, pct, hint, confirmadas, cerradas };
}

/**
 * Estado visual de una participación.
 * Los colores vienen del diseño: verde jugado/confirmado, amarillo pendiente,
 * coral ausente, gris cancelado.
 *
 * `attendees.estado` ∈ inscrito | pendiente | confirmado_gps | no_asistio | cancelado
 * Se cruza con la hora del partido para distinguir "inscrito a futuro" de
 * "jugado" (un inscrito cuyo partido ya pasó, sin GPS, no es una ausencia
 * confirmada: se muestra como jugado sin verificar).
 */
export const PARTICIPACION_ESTADO = {
  jugado: { label: 'Jugado', tone: 'green' },
  confirmado: { label: 'Confirmado', tone: 'green' },
  pendiente: { label: 'Pendiente', tone: 'yellow' },
  ausente: { label: 'Ausente', tone: 'coral' },
  cancelado: { label: 'Cancelado', tone: 'muted' },
  sinVerificar: { label: 'Sin verificar', tone: 'muted' },
};

export function participacionEstado(row) {
  const estado = row?.estado;
  const hora = row?.match?.hora ? new Date(row.match.hora).getTime() : null;
  const yaPaso = hora !== null && Number.isFinite(hora) && hora < Date.now();

  if (estado === 'confirmado_gps') return PARTICIPACION_ESTADO.jugado;
  if (estado === 'no_asistio') return PARTICIPACION_ESTADO.ausente;
  if (estado === 'cancelado') return PARTICIPACION_ESTADO.cancelado;
  if (estado === 'pendiente') return PARTICIPACION_ESTADO.pendiente;
  if (estado === 'inscrito') {
    return yaPaso ? PARTICIPACION_ESTADO.sinVerificar : PARTICIPACION_ESTADO.confirmado;
  }
  return PARTICIPACION_ESTADO.cancelado;
}

/**
 * '2026-07-28T21:00:00Z' → '28 jul'.
 *
 * `toLocaleDateString` con es-CL devuelve "28-jul" en algunos motores (y
 * "28 jul." en otros), así que normalizamos guiones y el punto de la
 * abreviatura para que la fecha se vea igual en web y en nativo.
 */
export function fechaCorta(iso) {
  if (!iso) return '';
  try {
    return new Date(iso)
      .toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })
      .replace(/-/g, ' ')
      .replace('.', '')
      .trim();
  } catch {
    return '';
  }
}

/**
 * Línea secundaria de una participación: '28 jul · Cancha Los Robles'.
 * Se omiten los tramos vacíos en vez de dejar separadores colgando.
 */
export function metaParticipacion(row) {
  return [fechaCorta(row?.match?.hora), row?.match?.cancha_nombre || row?.match?.comuna]
    .filter(Boolean)
    .join(' · ');
}

/** 'Ñuñoa · 12 partidos' — omite lo que no exista. */
export function metaJugador(profile, partidosJugados) {
  const partes = [];
  partes.push(profile?.comuna || 'Comuna no indicada');
  if (partidosJugados > 0) {
    partes.push(`${partidosJugados} ${partidosJugados === 1 ? 'partido' : 'partidos'}`);
  } else {
    partes.push('Sin partidos');
  }
  return partes.join(' · ');
}

/** Inicial para el avatar sin foto. '@vicente22' → 'V'. */
export function inicialDe(profile) {
  const base = (profile?.username || '').trim();
  return base ? base[0].toUpperCase() : '?';
}

/**
 * ¿El perfil está "recién creado"? Se deriva de los datos reales, no de una
 * bandera manual: sin foto, sin bio, sin posición, sin partidos y sin fotos.
 */
export function perfilIncompleto({ profile, history, photos }) {
  if (!profile) return false;
  const sinFoto = !profile.foto_url;
  const sinBio = !profile.bio || !profile.bio.trim();
  const sinPosicion = posicionesReales(profile.posicion_preferida).length === 0;
  const sinActividad = (history || []).length === 0;
  const sinFotos = (photos || []).length === 0;
  return sinFoto && sinBio && sinPosicion && sinActividad && sinFotos;
}
