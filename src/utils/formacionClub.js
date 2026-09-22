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
 * Qué pasó de verdad al autocompletar, ya redactado.
 *
 * EL MENSAJE MENTÍA. «Alineación completada» salía siempre que se colocara a
 * alguien: con un solo integrante y siete puestos, el contador quedaba en 1/7
 * y el aviso decía que estaba completa. Y los dos motivos para no hacer nada
 * —la cancha llena y la banca vacía— compartían el mismo texto, «No queda
 * banca disponible», que sólo es cierto en uno de los dos.
 *
 * Se calcula con las tres cuentas reales y devuelve también los números, para
 * que la pantalla no tenga que deducirlos del texto.
 */
export function resumenAutocompletar({ puestosLibres = 0, jugadoresEnBanca = 0, ubicados = 0 } = {}) {
  const faltan = Math.max(0, puestosLibres - ubicados);
  const resumen = { ubicados, faltan };

  if (puestosLibres === 0) {
    return { ...resumen, mensaje: 'Todos los puestos están ocupados' };
  }
  if (jugadoresEnBanca === 0) {
    return { ...resumen, mensaje: 'No quedan jugadores en la banca' };
  }
  if (ubicados === 0) {
    return { ...resumen, mensaje: 'No se pudo ubicar a nadie' };
  }
  if (faltan === 0) {
    return { ...resumen, mensaje: 'Alineación completada' };
  }
  const gente = ubicados === 1 ? '1 jugador ubicado' : `${ubicados} jugadores ubicados`;
  const huecos = faltan === 1 ? 'falta 1 puesto' : `faltan ${faltan} puestos`;
  return { ...resumen, mensaje: `${gente}; ${huecos}` };
}

/**
 * Traslada las asignaciones a otra formación, conservando lo que calza.
 *
 * CAMBIAR DE FORMACIÓN VACIABA EL TABLERO. Tocar un chip para ver cómo se
 * vería un 3-2-1 borraba las siete asignaciones sin preguntar, así que
 * explorar una alternativa costaba el trabajo entero.
 *
 * LA REGLA ES EL PUESTO, NO LA COORDENADA. Un DFC del 3-2-1 sigue siendo un
 * DFC en el 2-3-1, aunque esté en otro sitio de la cancha; un puesto que la
 * formación nueva no tiene deja a su jugador en la banca, que es donde de
 * verdad queda. Los puestos de la formación nueva que nadie ocupaba se
 * quedan libres: rellenarlos sería inventar una decisión.
 *
 * Reparte en el orden del tablero anterior, así que con dos DFC y un solo
 * puesto de DFC se queda el primero — un desempate fijo, no al azar, para
 * que ir y volver entre dos formaciones no baraje el equipo.
 */
export function conservarAsignaciones(asignaciones = {}, slotsAntes = [], slotsDespues = []) {
  const porPuesto = new Map();
  for (const slot of slotsAntes) {
    const memberId = asignaciones?.[slot?.key];
    if (!memberId) continue;
    if (!porPuesto.has(slot.label)) porPuesto.set(slot.label, []);
    porPuesto.get(slot.label).push(memberId);
  }

  const usados = new Set();
  const nuevas = {};
  for (const slot of slotsDespues) {
    const cola = porPuesto.get(slot?.label);
    while (cola && cola.length > 0) {
      const memberId = cola.shift();
      if (usados.has(memberId)) continue;
      nuevas[slot.key] = memberId;
      usados.add(memberId);
      break;
    }
  }
  return nuevas;
}

/**
 * ¿El borrador dice algo distinto de lo guardado?
 *
 * DE ACÁ SALE LA ADVERTENCIA AL SALIR. Autocompletar dejaba el contador en
 * 1/7, un gesto de volver atrás lo devolvía a 0/7 y nadie preguntaba nada:
 * el trabajo se perdía sin un solo aviso.
 *
 * Los dos lados llegan con la MISMA forma —`{ modo, formacion, personalizado,
 * asignaciones, custom }`— y la pantalla se encarga de que lo guardado venga
 * ya depurado con `asignacionesVigentes()`. Si no, un integrante expulsado
 * hace tiempo bastaría para declarar cambios en cuanto se abre la pantalla, y
 * una advertencia que salta siempre se aprende a ignorar.
 *
 * `guardada` en `null` es «este club todavía no tiene alineación»: entonces
 * sólo cuenta como cambio haber puesto o arrastrado algo. Haber mirado otra
 * formación sin colocar a nadie no es trabajo que perder.
 */
export function hayCambiosSinGuardar(borrador, guardada) {
  const b = borrador || {};
  const puestos = b.asignaciones || {};
  const arrastrados = b.custom || {};

  if (!guardada) {
    return Object.keys(puestos).length > 0 || Object.keys(arrastrados).length > 0;
  }

  if (b.modo !== guardada.modo) return true;
  if (b.formacion !== guardada.formacion) return true;
  if (!!b.personalizado !== !!guardada.personalizado) return true;
  if (!mismasAsignaciones(puestos, guardada.asignaciones || {})) return true;
  return !mismosPuestosPersonalizados(arrastrados, guardada.custom || {});
}

function mismasAsignaciones(a, b) {
  const clavesA = Object.keys(a);
  if (clavesA.length !== Object.keys(b).length) return false;
  return clavesA.every((k) => a[k] === b[k]);
}

/**
 * Las coordenadas se comparan redondeadas al entero: son porcentajes que
 * nacen de un gesto, y el ida y vuelta por JSON puede devolver 41.99999 donde
 * había 42. Un decimal de diferencia no es trabajo sin guardar.
 */
function mismosPuestosPersonalizados(a, b) {
  const clavesA = Object.keys(a);
  if (clavesA.length !== Object.keys(b).length) return false;
  return clavesA.every((k) => {
    const x = a[k];
    const y = b[k];
    if (!x || !y) return false;
    return (
      Math.round(x.left) === Math.round(y.left) &&
      Math.round(x.top) === Math.round(y.top) &&
      x.label === y.label
    );
  });
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
