/**
 * Lo que la pantalla de moderación necesita decidir, sin red.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. La pantalla muestra cuatro colas que vienen
 * en un solo `jsonb` de `moderacion_cola()` (migraciones 151 y 164) y tiene
 * que decidir
 * qué se puede resolver y qué no. Esa decisión no es cosmética: **moderar
 * reportes de usuario todavía no está diseñado** —estados, medidas y
 * apelación son una conversación pendiente— así que los reportes se muestran
 * y no se tocan. Si eso viviera dentro del JSX, el día que alguien agregue un
 * botón nadie se acordaría de por qué no estaba.
 *
 * Y la otra razón: una cola vacía y una cola que no se pudo leer se ven
 * igual en pantalla si nadie las distingue, y son cosas muy distintas cuando
 * lo que estás mirando son sanciones sin resolver.
 */

/** Las cuatro colas, en el orden en que la pantalla las muestra. */
export const COLAS = [
  {
    clave: 'revisiones_de_sancion',
    titulo: 'Revisiones de sanción',
    vacio: 'Ningún club pidió revisar una sanción.',
    accionable: true,
  },
  {
    clave: 'resultados_en_disputa',
    titulo: 'Resultados en disputa',
    vacio: 'Ningún encuentro quedó con el marcador trabado.',
    accionable: true,
  },
  {
    clave: 'reportes_sin_mirar',
    titulo: 'Reportes sin mirar',
    // No se resuelven desde acá y conviene que la pantalla lo diga, no que
    // simplemente no haya botones. Ver el P2 de `pendientes.md`.
    vacio: 'Nadie ha reportado nada.',
    accionable: false,
    nota: 'Se muestran para que no pasen desapercibidos. Resolverlos todavía no está diseñado: hace falta decidir estados, medidas y apelación.',
  },
  {
    clave: 'recintos_esperando',
    titulo: 'Recintos esperando revisión',
    // VA ÚLTIMA Y NO PRIMERA a propósito: las tres de arriba son conflictos
    // entre personas y envejecen peor. Esta es un trámite.
    vacio: 'Ningún recinto está esperando que lo miremos.',
    accionable: true,
    nota: 'Aprobar lo deja listo para que el dueño publique cuando quiera. Rechazar todavía no está: hace falta decidir el motivo, si se puede volver a pedir y qué ve el dueño.',
  },
];

/**
 * Cuántos días lleva esperando un recinto.
 *
 * Es lo que convierte la cola en algo que se mira: «hace 35 días» pesa y una
 * fecha suelta no. Se cuenta por días de calendario, no por múltiplos de 24
 * horas: pedida ayer a las 23:00 y mirada hoy a las 09:00 es «ayer», que es
 * lo que diría cualquiera.
 */
export function diasEsperando(pedidaAt, ahora = new Date()) {
  if (!pedidaAt) return null;
  const d = new Date(pedidaAt);
  if (Number.isNaN(d.getTime())) return null;
  const aMedianoche = (x) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  const dias = Math.round((aMedianoche(ahora) - aMedianoche(d)) / 86400000);
  return dias < 0 ? 0 : dias;
}

/** «hoy», «ayer», «hace 35 días». Null si no hay fecha que contar. */
export function esperaLegible(pedidaAt, ahora = new Date()) {
  const dias = diasEsperando(pedidaAt, ahora);
  if (dias === null) return null;
  if (dias === 0) return 'hoy';
  if (dias === 1) return 'ayer';
  return `hace ${dias} días`;
}

/** Una cola del jsonb, siempre como arreglo. Nunca lanza. */
export function filasDe(cola, clave) {
  const v = cola?.[clave];
  return Array.isArray(v) ? v : [];
}

/** Cuántas cosas esperan en total. Es lo que va en el distintivo. */
export function totalPendiente(cola) {
  return COLAS.reduce((n, c) => n + filasDe(cola, c.clave).length, 0);
}

/**
 * El motivo de un reporte, en español.
 *
 * Los valores vienen de `user_reports.motivo` en snake_case. Un motivo que no
 * conocemos se muestra tal cual en vez de esconderse: en una cola de
 * moderación, no enseñar algo es peor que enseñarlo feo.
 */
const MOTIVOS = {
  suplantacion: 'Suplantación de identidad',
  informacion_falsa: 'Información falsa',
  acoso: 'Acoso',
  lenguaje_ofensivo: 'Lenguaje ofensivo',
  spam: 'Spam',
  no_se_presento: 'No se presentó',
  otro: 'Otro',
};

export function motivoLegible(motivo) {
  if (!motivo) return 'Sin motivo';
  return MOTIVOS[motivo] || String(motivo).replace(/_/g, ' ');
}

/** El tipo de una revisión de sanción, en español. */
const TIPOS_SANCION = {
  incomparecencia: 'Incomparecencia',
  cancelacion_tardia: 'Cancelación tardía',
  resultado_en_disputa: 'Resultado en disputa',
};

export function tipoSancionLegible(tipo) {
  if (!tipo) return 'Sanción';
  return TIPOS_SANCION[tipo] || String(tipo).replace(/_/g, ' ');
}

/**
 * Qué mostrar en una cola: su contenido, que está vacía, o que no se pudo
 * leer. El tercer caso es el que se pierde si nadie lo separa.
 */
export function estadoDeLaCola({ cargando, error, cola, clave } = {}) {
  if (cargando) return 'cargando';
  if (error) return 'error';
  if (!cola) return 'error';
  return filasDe(cola, clave).length > 0 ? 'con-filas' : 'vacia';
}

/**
 * ¿Se puede mandar esta resolución?
 *
 * `resolver_revision_sancion` (migración 47c) sólo acepta «retirar» o
 * «mantener», y rechaza una nota de más de 1000 caracteres. Comprobarlo acá
 * evita un viaje de ida y vuelta para recibir un `ok:false` que ya sabíamos.
 */
export const NOTA_MAX = 1000;

export function puedeResolver({ decision, nota } = {}) {
  if (decision !== 'retirar' && decision !== 'mantener') return false;
  if (typeof nota === 'string' && nota.length > NOTA_MAX) return false;
  return true;
}
