/**
 * El hilo de negociación de un desafío entre clubes.
 *
 * Es un TIPO DE HILO NUEVO (`challenge:<id>`), no un DM ampliado: el chat
 * de negociación lo comparten TODOS los administradores de ambos clubes y
 * tiene que poder existir en paralelo al mensaje privado que dos de esos
 * administradores puedan tener entre ellos. Son dos conversaciones
 * distintas y ninguna pisa a la otra.
 *
 * Puro a propósito — sin React, sin Supabase y sin colores literales: las
 * funciones devuelven el NOMBRE del acento, y el componente decide con qué
 * token lo pinta. Ese es el punto donde más adelante entrará el color
 * temático de cada club sin tocar este archivo.
 *
 * La autoridad sobre quién ve el hilo es la RLS (migración 42,
 * `chat_puede_ver_desafio` / `chat_puede_escribir_desafio`), nunca esto.
 */

// La extensión explícita es a propósito: estas funciones se prueban con
// `node --test`, que resuelve ESM sin las extensiones implícitas de Metro.
import { estadoLabel, esEstadoCerrado, plazoRestante } from '../services/clubChallengeRules.js';

/** Prefijo del hilo. Hermano de 'dm:', 'match:' y 'club:'. */
export const CHALLENGE_THREAD_PREFIX = 'challenge:';

/**
 * `chat_reads.thread_key` tiene `check (length between 3 and 120)`. Con el
 * prefijo y un uuid son 46 caracteres, pero la comprobación se deja
 * explícita para que un cambio de formato no rompa la lectura en silencio.
 */
export const THREAD_KEY_MIN = 3;
export const THREAD_KEY_MAX = 120;

/** 'challenge:<uuid>' a partir del id del desafío. */
export function challengeThreadKey(challengeId) {
  if (!challengeId) return null;
  const key = `${CHALLENGE_THREAD_PREFIX}${challengeId}`;
  if (key.length < THREAD_KEY_MIN || key.length > THREAD_KEY_MAX) return null;
  return key;
}

/** ¿Esta clave de hilo es la de un desafío? */
export function isChallengeThreadKey(key) {
  return typeof key === 'string' && key.startsWith(CHALLENGE_THREAD_PREFIX);
}

/**
 * Devuelve `{ challengeId }` o null. Se valida que quede algo después del
 * prefijo: 'challenge:' a secas no es un hilo.
 */
export function parseChallengeThread(key) {
  if (!isChallengeThreadKey(key)) return null;
  const challengeId = key.slice(CHALLENGE_THREAD_PREFIX.length);
  if (!challengeId) return null;
  return { challengeId };
}

/**
 * «Club Retante vs Club Retado» — siempre en ese orden, sin importar desde
 * qué club se mire. Que el título no dependa del lector es lo que hace que
 * los dos administradores estén hablando del mismo desafío.
 */
export function challengeThreadTitle(thread) {
  const retador = thread?.club_retador?.nombre;
  const retado = thread?.club_retado?.nombre;
  if (retador && retado) return `${retador} vs ${retado}`;
  return 'Desafío entre clubes';
}

/** Subtítulo de la bandeja: el estado del ciclo, en español. */
export function challengeThreadSubtitle(thread) {
  return estadoLabel(thread?.estado);
}

/**
 * Cuenta atrás de la negociación.
 *
 * `ahora` se recibe como argumento y `vence_at` viene del servidor: el
 * reloj del teléfono no puede regalar ni quitar horas de negociación.
 * Devuelve null cuando el desafío ya está cerrado o no hay plazo abierto.
 */
export function challengeCountdown(thread, ahora = new Date()) {
  if (!thread?.vence_at || esEstadoCerrado(thread?.estado)) return null;
  const plazo = plazoRestante(thread.vence_at, ahora);
  if (plazo.vencido) {
    return { vencido: true, label: 'Plazo vencido', prorroga: !!thread.prorroga_abierta };
  }
  return {
    vencido: false,
    label: `Quedan ${plazo.label}`,
    prorroga: !!thread.prorroga_abierta,
  };
}

/**
 * Arma el contexto que espera `getChallengeCta`.
 *
 * Existe como función pura por una razón concreta: la pantalla lo armaba
 * a mano y nombraba la variable local en español (`miClubId`) mientras que
 * el contrato de `getChallengeCta` usa la clave en inglés (`myClubId`).
 * Con la forma abreviada de objeto, ese desajuste no producía una clave
 * mal puesta —que sería un fallo silencioso— sino una referencia a un
 * identificador inexistente, y el hilo reventaba en cada render.
 *
 * Acá la traducción entre el nombre local y la clave del contrato ocurre
 * en un solo lugar, cubierto por pruebas que fijan el nombre de la clave.
 *
 * `misClubIds` son los clubes donde el usuario es administrador vigente.
 */
export function challengeCtaContext({
  challenge = null,
  misClubIds = [],
  online = true,
  sancion = null,
} = {}) {
  const clubes = Array.isArray(misClubIds) ? misClubIds.filter(Boolean) : [];
  const delDesafio = [challenge?.club_retador_id, challenge?.club_retado_id].filter(Boolean);

  return {
    challenge: challenge || {},
    myClubId: clubes.find((id) => delDesafio.includes(id)) || null,
    soyAdmin: clubes.length > 0,
    online,
    sancion,
  };
}

/**
 * Qué acento lleva la tarjeta de la bandeja.
 *
 * Devuelve el NOMBRE del acento, no un color: el componente lo traduce a
 * tokens. Los valores posibles son 'important', 'neon', 'challenge',
 * 'club' y null.
 *
 * El rojo neón ('neon') marca un desafío recién aceptado y se apaga POR
 * ADMINISTRADOR: `abierto_alguna_vez` sale de `chat_reads`, que es por
 * usuario, así que a un administrador se le apaga sin apagárselo al resto.
 */
export function resolveThreadAccent(thread) {
  if (!thread) return null;

  // El aviso /importante manda sobre todo lo demás: es el único mensaje
  // que atraviesa el silencio. Hoy solo existe en el chat de club.
  if (thread.has_important) return 'important';

  if (thread.type === 'challenge') {
    return thread.abierto_alguna_vez ? 'challenge' : 'neon';
  }

  if (thread.type === 'club') return 'club';

  return null;
}

/**
 * Texto de la píldora inferior de la tarjeta de desafío.
 *
 * Mientras no se haya abierto dice que hay un desafío nuevo; después baja
 * el tono a una etiqueta discreta con el estado real del ciclo, que es lo
 * que de verdad importa a partir del segundo vistazo.
 */
export function challengeCardLabel(thread) {
  if (!thread?.abierto_alguna_vez) return 'Nuevo desafío aceptado';
  if (esEstadoCerrado(thread?.estado)) return estadoLabel(thread.estado);
  if (thread?.estado === 'negociacion') return 'Negociación activa';
  return estadoLabel(thread?.estado);
}
