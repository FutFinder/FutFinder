/**
 * Calendario de partidos de un club: pasados (con resultado confirmado) y
 * futuros (programados desde un desafío aceptado), combinados en una sola
 * lista para pintar en una grilla mensual.
 *
 * Puro: sin React, sin Supabase. Combina lo que ya devuelven dos servicios
 * que no se tocan entre sí —`listPartidosDeClub()` para lo que viene y
 * `getClubMatchHistory()` para lo ya jugado y confirmado— porque no existe
 * una sola consulta que traiga las dos cosas: un partido programado no tiene
 * resultado que confirmar, y `historial_club()` exige justamente eso.
 *
 * QUÉ QUEDA AFUERA, Y ES A PROPÓSITO. Un partido `finalizado` sin resultado
 * confirmado (nadie cargó el marcador, o está en disputa) no aparece en
 * ninguna de las dos listas: no es "por venir" porque ya pasó su hora, y no
 * es "jugado" porque `historial_club()` sólo publica marcadores confirmados.
 * Inventarle una fila sería mostrar un partido sin marcador como si lo
 * tuviera, o como si todavía fuera a jugarse.
 */

import { esPartidoDeClubes, miLadoEnPartido, clubesDelPartido } from '../services/clubMatchRules.js';

/**
 * 'YYYY-MM-DD' de una fecha, en la hora LOCAL del dispositivo.
 *
 * `toISOString().slice(0,10)` no sirve: convierte a UTC primero, y en Chile
 * (UTC-3/-4) un partido de las 21:00 o más tarde se corre al día siguiente.
 * Mismo motivo que documenta `formatHora()` en `historialClub.js`.
 */
function fechaLocalISO(fechaComoDate) {
  const d = fechaComoDate instanceof Date ? fechaComoDate : new Date(fechaComoDate);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Una fila de `listPartidosDeClub()` (con `club_local`/`club_visitante` ya resueltos) → entrada de calendario. */
function entradaDesdeProximo(match, clubId) {
  if (!esPartidoDeClubes(match) || !match?.hora) return null;
  const lado = miLadoEnPartido(match, [clubId]);
  if (!lado) return null;

  const fecha = fechaLocalISO(match.hora);
  if (!fecha) return null;

  const { local, visitante } = clubesDelPartido(match);
  const esLocal = lado === 'local';
  const rival = esLocal ? visitante : local;

  return {
    id: match.id,
    fecha,
    jugado: false,
    rivalNombre: rival.nombre,
    rivalLogoUrl: rival.fotoUrl,
    esLocal,
    resultado: null,
    resultadoNombre: null,
    miMarcador: null,
    suMarcador: null,
  };
}

/** Una fila ya normalizada de `getClubMatchHistory()` → entrada de calendario. */
function entradaDesdeHistorial(partido) {
  if (!partido?.fecha) return null;
  return {
    id: partido.id,
    fecha: partido.fecha,
    jugado: true,
    rivalNombre: partido.rivalNombre,
    rivalLogoUrl: partido.rivalLogoUrl,
    esLocal: partido.esLocal,
    resultado: partido.resultado,
    resultadoNombre: partido.resultadoNombre,
    miMarcador: partido.miMarcador,
    suMarcador: partido.suMarcador,
    // Sólo un integrante puede abrir el detalle — ver `clubMatchRules.js`.
    soyIntegrante: partido.soyIntegrante === true,
  };
}

/**
 * Combina próximos + historial en una sola lista, de más antiguo a más
 * nuevo. `proximos` es lo que devuelve `listPartidosDeClub()`; `historial`
 * lo que devuelve `getClubMatchHistory()` (ya normalizado).
 */
export function calendarioDePartidos({ proximos, historial } = {}, clubId) {
  const entradas = [
    ...(Array.isArray(proximos) ? proximos : []).map((m) => entradaDesdeProximo(m, clubId)),
    ...(Array.isArray(historial) ? historial : []).map(entradaDesdeHistorial),
  ].filter(Boolean);

  entradas.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
  return entradas;
}

/** Agrupa las entradas por fecha ('YYYY-MM-DD'), para marcar los días con partido. */
export function agruparPorFecha(entradas) {
  const mapa = new Map();
  for (const e of Array.isArray(entradas) ? entradas : []) {
    if (!e?.fecha) continue;
    if (!mapa.has(e.fecha)) mapa.set(e.fecha, []);
    mapa.get(e.fecha).push(e);
  }
  return mapa;
}

const DOW_LUNES_PRIMERO = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const ETIQUETAS_SEMANA = DOW_LUNES_PRIMERO;

/**
 * Los días a pintar en la grilla de un mes (año/mes en base 1: enero = 1),
 * completando con los días de los meses vecinos que caen en la misma
 * semana, para que la grilla siempre tenga columnas completas de lunes a
 * domingo. `enMes: false` marca esos días de relleno, que se pintan
 * apagados y no llevan marca de partido aunque la tuvieran.
 */
export function diasDelMes(anio, mes) {
  // `getDay()`: domingo = 0 … sábado = 6. Se convierte a lunes = 0 … domingo = 6.
  const primerDia = new Date(anio, mes - 1, 1);
  const offsetInicio = (primerDia.getDay() + 6) % 7;

  const ultimoDia = new Date(anio, mes, 0);
  const offsetFin = (7 - ((ultimoDia.getDay() + 6) % 7) - 1) % 7;

  // Se recorre día a día con `setDate()`, no con aritmética de milisegundos:
  // Chile cambia de horario en el año, y eso incluye días de este mismo
  // rango casi cualquier mes. A medianoche el cambio puede saltarse esa
  // hora exacta: `new Date(...)` la corrige a la 01:00, y `setDate()`
  // arrastra esa 1 hora de más en todos los días siguientes hasta que la
  // comparación `cursor <= finalCursor` (medianoche, sin el corrimiento)
  // corta un día antes de tiempo. Al mediodía el cambio de hora nunca cae,
  // así que ancla ahí y el corrimiento no puede pasar.
  const dias = [];
  const cursor = new Date(anio, mes - 1, 1 - offsetInicio, 12);
  const finalCursor = new Date(anio, mes - 1, ultimoDia.getDate() + offsetFin, 12);
  while (cursor <= finalCursor) {
    dias.push({
      fecha: fechaLocalISO(cursor),
      dia: cursor.getDate(),
      enMes: cursor.getMonth() === mes - 1,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

/** Nombre del mes en español, con mayúscula inicial: 'septiembre' → 'Septiembre'. */
export function nombreMes(anio, mes) {
  const texto = new Date(anio, mes - 1, 1).toLocaleDateString('es-CL', { month: 'long' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
