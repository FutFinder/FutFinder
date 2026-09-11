/**
 * Reglas puras para el formulario de "Crear cuenta" (handoff
 * `Bienvenida.dc.html`, pantalla 2B): la fecha de nacimiento se pide en
 * tres campos (DD/MM/AAAA) porque así la pide el diseño, pero `profiles`
 * no tiene una columna de fecha de nacimiento — solo `edad` (entero,
 * 12–99, ver `supabase/schema.sql`). Estas funciones convierten lo que
 * escribe la persona en la edad real que se guarda, sin inventar un dato
 * que la base no tiene.
 *
 * Puro: sin React, sin Supabase, sin `new Date()` implícito en las pruebas
 * (todo recibe `hoy` para poder testear sin depender del reloj real).
 */

const EDAD_MIN = 12;
const EDAD_MAX = 99;

/**
 * Arma una fecha a partir de día/mes/año en texto, validando que sea una
 * fecha real (rechaza "31/02/2000": `Date` la aceptaría corrida a marzo,
 * por eso se comprueba que los tres campos vuelvan idénticos).
 * Devuelve `null` si falta algún campo o la fecha no existe.
 */
export function parseFechaNacimiento(dd, mm, yyyy) {
  const d = parseInt(dd, 10);
  const m = parseInt(mm, 10);
  const y = parseInt(yyyy, 10);
  if (!d || !m || !y) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (String(y).length !== 4) return null;

  const fecha = new Date(y, m - 1, d);
  if (fecha.getFullYear() !== y || fecha.getMonth() !== m - 1 || fecha.getDate() !== d) {
    return null;
  }
  return fecha;
}

/** Edad cumplida a la fecha `hoy` (por defecto, ahora). */
export function calcularEdad(fechaNacimiento, hoy = new Date()) {
  let edad = hoy.getFullYear() - fechaNacimiento.getFullYear();
  const aunNoCumple =
    hoy.getMonth() < fechaNacimiento.getMonth() ||
    (hoy.getMonth() === fechaNacimiento.getMonth() && hoy.getDate() < fechaNacimiento.getDate());
  if (aunNoCumple) edad -= 1;
  return edad;
}

/**
 * Valida la fecha completa contra las reglas de la cuenta: no puede ser
 * futura, y la edad resultante tiene que caer en el mismo rango que exige
 * `profiles.edad` (12–99) — el mismo rango que ya usa Editar perfil.
 * Devuelve `{ ok, edad, reason }`.
 */
export function validarFechaNacimiento(dd, mm, yyyy, hoy = new Date()) {
  const fecha = parseFechaNacimiento(dd, mm, yyyy);
  if (!fecha) return { ok: false, reason: 'Ingresa una fecha de nacimiento válida' };
  if (fecha > hoy) return { ok: false, reason: 'La fecha de nacimiento no puede ser futura' };

  const edad = calcularEdad(fecha, hoy);
  if (edad < EDAD_MIN || edad > EDAD_MAX) {
    return { ok: false, reason: `Debes tener entre ${EDAD_MIN} y ${EDAD_MAX} años para crear una cuenta` };
  }
  return { ok: true, edad };
}

/**
 * Sugiere un @username a partir del nombre ingresado (letras, números y
 * guión bajo, igual que valida Editar perfil) — solo una sugerencia
 * inicial: la persona lo cambia cuando quiera desde Editar perfil, igual
 * que si no hubiera puesto nombre nunca. Si el nombre no deja nada
 * utilizable, cae al mismo respaldo que ya usa `signUpWithEmail`
 * (la parte del correo antes del @).
 */
export function usernameDesdeNombre(nombre, email) {
  const base = (nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes, mismo patrón que ReservasScreen.js
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 20);
  if (base.length >= 3) return base;
  return (email || '').split('@')[0]?.slice(0, 20) || 'jugador';
}
