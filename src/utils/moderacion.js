/**
 * Lo que la pantalla de moderación necesita decidir, sin red.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. La pantalla muestra tres colas que vienen en
 * un solo `jsonb` de `moderacion_cola()` (migración 151) y tiene que decidir
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

/** Las tres colas, en el orden en que la pantalla las muestra. */
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
];

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
