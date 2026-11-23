/**
 * Lo que la pantalla de moderación necesita decidir, sin red.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. La pantalla muestra cuatro colas que vienen
 * en un solo `jsonb` de `moderacion_cola()` (migraciones 151, 164 y 194) y
 * tiene que decidir qué se puede resolver y cómo. Los reportes de usuario se
 * resuelven desde la 194 con cuatro decisiones (descartar, advertir, quitar
 * el contenido, suspender), y lo que cada una significa vive acá y no en el
 * JSX, junto con lo que se valida antes de mandarla.
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
    // Apple y Google piden actuar sobre lo reportado dentro de 24 horas: ver
    // `docs/memoria/operacion/revision-diaria.md`.
    vacio: 'Nadie ha reportado nada.',
    accionable: true,
    nota: 'Revísalos dentro de 24 horas. La persona reportada recibe un aviso con lo que decidas, salvo si descartas.',
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
  // Los que acepta hoy `user_reports_motivo_check`.
  suplantacion: 'Suplantación de identidad',
  informacion_falsa: 'Información falsa',
  contenido_ofensivo: 'Contenido ofensivo',
  foto_inapropiada: 'Foto inapropiada',
  conducta_antideportiva: 'Conducta antideportiva',
  // Nombres viejos que pueden quedar en reportes anteriores.
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

/**
 * Resolver un reporte (migración 194).
 *
 * Las cuatro decisiones que acepta `moderacion_resolver_reporte()`, con el
 * texto que ve quien modera antes de confirmar. `avisa` dice si la persona
 * reportada recibe un aviso: descartar no avisa, porque no hay nada que
 * contarle y le revelaría que alguien la reportó.
 */
export const DECISIONES_REPORTE = {
  descartar: {
    etiqueta: 'Descartar',
    titulo: 'Descartar el reporte',
    avisa: false,
  },
  advertir: {
    etiqueta: 'Advertir',
    titulo: 'Advertir a la persona',
    avisa: true,
  },
  quitar_contenido: {
    etiqueta: 'Quitar contenido',
    titulo: 'Quitar el contenido',
    avisa: true,
  },
  suspender: {
    etiqueta: 'Suspender',
    titulo: 'Suspender la cuenta',
    avisa: true,
  },
};

/** Los días de suspensión que ofrece la pantalla. El servidor acepta 1 a 365. */
export const DIAS_SUSPENSION = [7, 30];
export const NOTA_REPORTE_MAX = 600;

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** `2026-11-15T23:00:00Z` → `15-nov`, en hora de Chile (donde se juega). */
function diaDelPartido(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Santiago', day: 'numeric', month: 'numeric',
  }).formatToParts(d);
  const dia = partes.find((p) => p.type === 'day')?.value;
  const mes = Number(partes.find((p) => p.type === 'month')?.value);
  return dia && mes ? `${dia}-${MESES[mes - 1]}` : null;
}

/**
 * Qué se reportó, en español. `elemento` es `tipo:uuid` o null cuando se
 * reportó a la persona (su perfil).
 *
 * `nombre` y `hora` los trae la cola desde la migración 196
 * (`elemento_nombre`, `elemento_hora`): el nombre del club, el de la foto
 * del club o el título del partido. `null` es que ya no existe (se borró
 * después del reporte); `undefined` es una cola sin la 196, y entonces se
 * dice lo genérico de antes.
 */
export function elementoLegible(elemento, nombre, hora) {
  const tipo = typeof elemento === 'string' && elemento.includes(':')
    ? elemento.split(':')[0]
    : null;
  const conNombre = typeof nombre === 'string' && nombre.trim() !== '';
  if (tipo === 'club' && conNombre) return `El club «${nombre}»`;
  if (tipo === 'foto_club' && conNombre) return `Una foto del club «${nombre}»`;
  if (tipo === 'partido' && conNombre) {
    const dia = hora ? diaDelPartido(hora) : null;
    return dia ? `El partido «${nombre}» del ${dia}` : `El partido «${nombre}»`;
  }
  if (nombre === null) {
    if (tipo === 'club') return 'Un club que ya no existe';
    if (tipo === 'foto_club') return 'Una foto de club que ya no existe';
    if (tipo === 'partido') return 'Un partido que ya no existe';
  }
  switch (tipo) {
    case 'foto_club': return 'Una foto de un club';
    case 'foto': return 'Una foto de su perfil';
    case 'club': return 'Un club';
    case 'partido': return 'Un partido';
    case null: return 'Su perfil';
    default: return String(elemento);
  }
}

/** Lo que borra «Quitar contenido» según lo reportado, para confirmarlo. */
export function queQuitaElContenido(elemento) {
  const tipo = typeof elemento === 'string' && elemento.includes(':')
    ? elemento.split(':')[0]
    : null;
  switch (tipo) {
    case 'foto_club': return 'Se borra la foto del club.';
    case 'foto': return 'Se borra esa foto de su perfil.';
    case 'club': return 'Se quitan el escudo, la portada y la descripción del club.';
    case 'partido': return 'Se quitan la descripción y la portada del partido.';
    default: return 'Se quitan su foto, su portada y su bio.';
  }
}

/** ¿Se puede mandar esta resolución? Lo mismo que valida el servidor. */
export function puedeResolverReporte({ decision, dias, nota } = {}) {
  if (!DECISIONES_REPORTE[decision]) return false;
  if (decision === 'suspender' && !(Number.isInteger(dias) && dias >= 1 && dias <= 365)) return false;
  if (typeof nota === 'string' && nota.length > NOTA_REPORTE_MAX) return false;
  return true;
}
