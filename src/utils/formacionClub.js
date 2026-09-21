/**
 * Formación y puestos del tablero de alineación (migración 92).
 *
 * El layout (líneas, etiquetas por línea, coordenadas) es una función pura
 * de la formación elegida — nunca depende de quién está en la cancha — así
 * que vive acá y no en la pantalla, donde sería imposible de probar sin
 * montar un componente.
 *
 * LOS PUESTOS SON MÁS FINOS QUE `profiles.posicion_preferida`. La posición
 * real de un jugador es una de 7 (arquero, defensa, lateral, medio, volante,
 * delantero, sin_definir), pero un puesto en la cancha distingue lado
 * (LI/LD, MI/MD, EI/ED) y profundidad (MC/MCD, DC/MP). `fitsForMember()`
 * traduce lo real a la lista de puestos que le calzan, en vez de inventar
 * una posición más precisa que el jugador nunca declaró.
 */

/** Formaciones de fútbol 7 (10 líneas posibles, arquero aparte). */
export const F7 = ['2-3-1', '3-2-1', '2-1-3', '1-3-2', '3-1-2', '2-2-2', '1-4-1', '3-3'];

/** Formaciones de fútbol 11. */
export const F11 = [
  '4-4-2',
  '4-3-3',
  '4-2-3-1',
  '3-5-2',
  '3-4-3',
  '5-3-2',
  '4-5-1',
  '4-1-4-1',
  '5-4-1',
  '4-4-1-1',
  '4-1-2-3',
  '3-4-1-2',
];

const LINE_LABELS = {
  def: { 1: ['DFC'], 2: ['DFC', 'DFC'], 3: ['DFC', 'DFC', 'DFC'], 4: ['LI', 'DFC', 'DFC', 'LD'], 5: ['LI', 'DFC', 'DFC', 'DFC', 'LD'] },
  mid: { 1: ['MCD'], 2: ['MC', 'MC'], 3: ['MC', 'MC', 'MC'], 4: ['MI', 'MC', 'MC', 'MD'], 5: ['MI', 'MC', 'MC', 'MC', 'MD'] },
  att: { 1: ['DC'], 2: ['DC', 'DC'], 3: ['EI', 'DC', 'ED'], 4: ['EI', 'DC', 'DC', 'ED'], 5: ['EI', 'MP', 'DC', 'MP', 'ED'] },
};

function lineLabels(count, depth, total) {
  const zone = depth === 0 ? 'def' : depth === total - 1 ? 'att' : 'mid';
  return LINE_LABELS[zone][count] || new Array(count).fill(zone === 'att' ? 'DC' : 'MC');
}

/**
 * Puestos de una formación como "4-3-3": arquero + una línea por número.
 * `left`/`top` son porcentajes del contenedor de la cancha.
 */
export function layoutSlots(formation) {
  const lines = String(formation || '')
    .split('-')
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0);
  const slots = [{ key: 'gk', label: 'POR', left: 50, top: 90 }];
  lines.forEach((count, i) => {
    const top = lines.length === 1 ? 50 : 74 - i * (58 / (lines.length - 1));
    const labels = lineLabels(count, i, lines.length);
    for (let j = 0; j < count; j++) {
      slots.push({ key: `l${i}p${j}`, label: labels[j], left: 12 + (j + 1) * (76 / (count + 1)), top });
    }
  });
  return slots;
}

/**
 * A qué puesto corresponde una coordenada de la cancha, cuando se arrastra
 * un puesto a mano («alineación personalizada»). Así, mover al mediocampista
 * hacia el fondo lo vuelve DFC de verdad — deja de mostrarse como MC en una
 * zona que ya no es de mediocampo — en vez de conservar una etiqueta que ya
 * no describe dónde está parado.
 */
export function zoneLabel(left, top) {
  if (top >= 86) return 'POR';
  const lado = left < 26 ? 'I' : left > 74 ? 'D' : null;
  if (top >= 66) return lado ? `L${lado}` : 'DFC';
  if (top >= 48) return lado ? `M${lado}` : 'MCD';
  if (top >= 32) return lado ? `M${lado}` : 'MC';
  if (top >= 20) return lado ? `E${lado}` : 'MP';
  return lado ? `E${lado}` : 'DC';
}

/** A qué puestos de cancha calza cada posición real declarada. */
const REAL_POS_TO_SLOTS = {
  arquero: ['POR'],
  defensa: ['DFC', 'LI', 'LD'],
  lateral: ['LI', 'LD', 'DFC', 'MI', 'MD'],
  medio: ['MC', 'MCD'],
  volante: ['MI', 'MD', 'MC'],
  delantero: ['DC', 'EI', 'ED', 'MP'],
};

const LADO_IZQUIERDO = new Set(['LI', 'MI', 'EI']);
const LADO_DERECHO = new Set(['LD', 'MD', 'ED']);

/** Antepone los puestos del lado preferido, conservando el orden relativo. */
function priorizarLado(puestos, flanco) {
  if (flanco !== 'izquierdo' && flanco !== 'derecho') return puestos;
  const opuesto = flanco === 'izquierdo' ? LADO_DERECHO : LADO_IZQUIERDO;
  const primero = puestos.filter((p) => !opuesto.has(p));
  const segundo = puestos.filter((p) => opuesto.has(p));
  return [...primero, ...segundo];
}

/**
 * Puestos de cancha que le calzan a un integrante, del mejor al aceptable.
 * `posicion_preferida` es un arreglo: se juntan los puestos de TODAS sus
 * posiciones declaradas, sin repetir, y `flanco` sólo reordena para
 * anteponer el lado que ya declaró — no descarta el otro.
 */
export function fitsForMember(member) {
  const posiciones = (member?.posicion_preferida || []).filter((p) => p !== 'sin_definir');
  const puestos = [];
  posiciones.forEach((p) => {
    (REAL_POS_TO_SLOTS[p] || []).forEach((s) => {
      if (!puestos.includes(s)) puestos.push(s);
    });
  });
  return priorizarLado(puestos, member?.flanco);
}

/**
 * Reparte la banca en los puestos libres: primero calce exacto (primera
 * opción de `fitsForMember`), después cualquier calce, y a quien sobre sin
 * puesto compatible se le asigna igual el que quede — «autocompletar» arma
 * un plantel completo, no uno perfecto.
 */
export function autocompletarAsignaciones(puestosLibres, banca) {
  const pool = [...banca];
  const asignaciones = {};
  puestosLibres.forEach((slot) => {
    let idx = pool.findIndex((m) => fitsForMember(m)[0] === slot.label);
    if (idx < 0) idx = pool.findIndex((m) => fitsForMember(m).includes(slot.label));
    if (idx < 0 && pool.length > 0) idx = 0;
    if (idx >= 0) {
      asignaciones[slot.key] = pool[idx].member_id;
      pool.splice(idx, 1);
    }
  });
  return asignaciones;
}

/**
 * Las asignaciones que todavía corresponden a integrantes del club.
 *
 * EL FALLO QUE LA TRAJO (C09). El JSON guardado en `club_lineups.asignaciones`
 * es `{ puesto: member_id }` y sobrevive a la nómina: expulsar al arquero deja
 * su `member_id` dentro. El tablero lo dibujaba VACÍO —el render busca al
 * integrante y no lo encuentra— pero lo seguía contando como ocupado, porque
 * el contador y la búsqueda de puestos libres sólo miraban si existía la
 * clave. Resultado: «7/7» con un puesto vacío en pantalla, y «No queda banca
 * disponible» con gente en la banca.
 *
 * La regla tiene que ser UNA: un puesto está ocupado si su integrante sigue
 * en el club. Acá se aplica una vez y la pantalla la usa para contar, para
 * repartir la banca, para autocompletar y para guardar.
 *
 * No modifica el objeto recibido: devuelve uno nuevo, y el mismo si no hay
 * nada que depurar, para no disparar renders de más.
 */
export function asignacionesVigentes(asignaciones = {}, members = []) {
  const vivos = new Set((members || []).map((m) => m && m.member_id).filter(Boolean));
  const entradas = Object.entries(asignaciones || {});
  const limpias = entradas.filter(([, memberId]) => vivos.has(memberId));
  if (limpias.length === entradas.length) return asignaciones || {};
  return Object.fromEntries(limpias);
}
