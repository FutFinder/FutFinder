/**
 * Lógica pura del tablero abierto de desafíos (migración 112): validar la
 * fecha/hora de una publicación, ordenar/filtrar la lista de publicaciones de
 * otros clubes, el «Cierra en…» de cada tarjeta y si vale la pena marcarla
 * «Cerca» (umbral de distancia, nunca inventado como «0 km» sin dato).
 *
 * Mismo estilo de validación que `ClubChallengeScreen.js` (fecha DD/MM/AAAA
 * + hora HH:MM en texto simple, validadas al enviar) — no la máscara en vivo
 * del mockup de referencia, para no duplicar dos maneras distintas de
 * escribir la misma fecha en la misma app.
 */

import { EXPIRACION_PENDIENTE_DIAS, plazoRestante } from '../services/clubChallengeRules.js';

const DIA_MS = 24 * 3600 * 1000;

/**
 * «Cierra en 3 h» / «Cierra en 2 días» / «Expiró», a partir de cuándo se
 * publicó. Mismo plazo que el desafío 1 a 1 (`EXPIRACION_PENDIENTE_DIAS`,
 * 7 días): es el mismo tipo de ventana —«pendiente sin que nadie la haya
 * tomado»— aplicado a una publicación en vez de a un desafío directo, así
 * que se reutiliza la misma constante en vez de inventar una nueva.
 */
export function cierraEnLabel(createdAtIso, ahora = new Date()) {
  if (!createdAtIso) return '';
  const creado = new Date(createdAtIso);
  if (Number.isNaN(creado.getTime())) return '';
  const vence = new Date(creado.getTime() + EXPIRACION_PENDIENTE_DIAS * DIA_MS);
  const { vencido, label } = plazoRestante(vence, ahora);
  return vencido ? 'Expiró' : `Cierra en ${label}`;
}

const CERCA_KM = 5;

/** ¿Vale la pena marcar la tarjeta con la etiqueta «Cerca»? Distancia real, sin dato = no. */
export function esCerca(distanciaKm) {
  return typeof distanciaKm === 'number' && Number.isFinite(distanciaKm) && distanciaKm <= CERCA_KM;
}

/** ¿A la publicación le queda menos de 24 h antes de expirar? Para resaltarla. */
export function cierraPronto(createdAtIso, ahora = new Date()) {
  if (!createdAtIso) return false;
  const creado = new Date(createdAtIso);
  if (Number.isNaN(creado.getTime())) return false;
  const vence = new Date(creado.getTime() + EXPIRACION_PENDIENTE_DIAS * DIA_MS);
  const msRestante = vence.getTime() - ahora.getTime();
  return msRestante > 0 && msRestante < 24 * 3600 * 1000;
}

/** DD/MM/AAAA + HH:MM → Date, o null si no se puede interpretar. */
export function parseFechaHora(fechaStr, horaStr) {
  const dParts = (fechaStr || '').split('/');
  const tParts = (horaStr || '').split(':');
  if (dParts.length !== 3 || tParts.length !== 2) return null;
  const [dd, mm, yyyy] = dParts.map((s) => parseInt(s.trim(), 10));
  const [hh, mi] = tParts.map((s) => parseInt(s.trim(), 10));
  if ([dd, mm, yyyy, hh, mi].some(Number.isNaN)) return null;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || hh > 23 || mi > 59) return null;
  const d = new Date(yyyy, mm - 1, dd, hh, mi, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  // Rechaza fechas imposibles como 31/02: Date normaliza en vez de fallar,
  // así que hay que comprobar que el día siga siendo el que se escribió.
  if (d.getDate() !== dd || d.getMonth() !== mm - 1 || d.getFullYear() !== yyyy) return null;
  return d;
}

/** `dd/mm/aaaa` en dos dígitos, a partir de un Date. */
export function formatFecha(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** `hh:mm` en dos dígitos, a partir de un Date. */
export function formatHora(d) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

/**
 * ¿El borrador de publicación está listo para enviarse?
 * `modalidad` ya viene siempre puesta (chip con valor por defecto), así que
 * lo único que puede faltar es una fecha/hora futura válida.
 */
export function borradorListo({ fechaStr, horaStr }, ahora = new Date()) {
  const fecha = parseFechaHora(fechaStr, horaStr);
  if (!fecha) return false;
  return fecha.getTime() > ahora.getTime();
}

/**
 * Ordena y filtra las publicaciones abiertas de otros clubes.
 *
 * `sort`: 'cerca' (distancia real, sin dato al final) | 'pronto' (fecha
 * propuesta más próxima primero). No hay orden por nivel: no existe el dato.
 *
 * `modalidad`: si viene puesta, sólo deja pasar publicaciones de esa
 * modalidad; vacío/null = todas.
 */
export function ordenarPublicaciones(rows, { modalidad = null, sort = 'cerca' } = {}) {
  const filtradas = (rows || []).filter((r) => !modalidad || r.modalidad === modalidad);
  const conIndice = filtradas.map((r, i) => ({ r, i }));

  conIndice.sort((a, b) => {
    if (sort === 'pronto') {
      const ta = new Date(a.r.fecha_propuesta).getTime();
      const tb = new Date(b.r.fecha_propuesta).getTime();
      if (ta !== tb) return ta - tb;
      return a.i - b.i;
    }
    // 'cerca': sin distancia conocida va al final, no se muestra como "0 km".
    const da = a.r.distanciaKm;
    const db = b.r.distanciaKm;
    const aSinDato = da === null || da === undefined;
    const bSinDato = db === null || db === undefined;
    if (aSinDato && bSinDato) return a.i - b.i;
    if (aSinDato) return 1;
    if (bSinDato) return -1;
    if (da !== db) return da - db;
    return a.i - b.i;
  });

  return conIndice.map((x) => x.r);
}
