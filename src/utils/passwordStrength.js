/**
 * Mínimo de caracteres de una contraseña, en UN SOLO SITIO.
 *
 * Vivía duplicado y en desacuerdo: "Crear cuenta" exigía 8 y "Cambiar
 * contraseña" en Ajustes exigía 6, así que alguien se registraba con 8 y al
 * día siguiente se la bajaba a 6 por la otra puerta. El medidor de acá
 * asumía 8 por su cuenta. Ahora los tres leen este número, y
 * `unSoloMinimoDeContrasena.test.js` falla si vuelve a aparecer escrito a
 * mano en cualquier parte.
 *
 * Vive en `utils/` y no en `services/authPolicy` porque en este proyecto los
 * servicios importan utilidades, no al revés.
 *
 * OJO: esto es la validación del cliente. La que manda de verdad es la de
 * Supabase Auth (panel → Authentication → Providers → Email), que tiene su
 * propio mínimo y hay que subirla ahí también.
 */
export const MIN_PASSWORD = 8;

/**
 * Los tipos de carácter que exige Supabase Auth, ESPEJADOS ACÁ A MANO.
 *
 * El 2026-09-18 se activó «Letters, digits and symbols» en el panel y el
 * registro se rompió de la peor forma posible: la app aceptaba la
 * contraseña, creaba la cuenta, mandaba el código, la persona verificaba su
 * correo… y RECIÉN AHÍ el servidor rechazaba la contraseña, dejando una
 * cuenta confirmada y sin contraseña usable, sin forma de reintentar. La
 * validación tiene que ocurrir ANTES de crear nada.
 *
 * Esta lista es una copia manual de lo que dice el panel, y no hay forma de
 * leerla desde la app. SI SE CAMBIA ALLÁ, HAY QUE CAMBIARLA ACÁ. Lo que sí
 * está cubierto es equivocarse: `describeAuthError` traduce el motivo real
 * que devuelve el servidor (`length` o `characters`) en vez de inventar uno,
 * así que un desajuste se ve en el mensaje en lugar de mentir.
 *
 * El juego de símbolos es el que Supabase acepta, copiado de su respuesta:
 * !@#$%^&*()_+-=[]{};'\:"|<>?,./`~
 */
const SIMBOLOS = /[!@#$%^&*()_+\-=[\]{};'\\:"|<>?,./`~]/;

function enumerar(cosas) {
  if (cosas.length === 1) return cosas[0];
  return `${cosas.slice(0, -1).join(', ')} y ${cosas[cosas.length - 1]}`;
}

/**
 * ¿Sirve esta contraseña? Devuelve `{ valid, message }` con el mensaje ya
 * escrito para mostrar, diciendo QUÉ falta y no sólo que está mal.
 */
export function validarPassword(password) {
  const p = typeof password === 'string' ? password : '';

  if (p.length < MIN_PASSWORD) {
    return { valid: false, message: `Usa al menos ${MIN_PASSWORD} caracteres.` };
  }

  const faltan = [];
  if (!/[a-z]/.test(p)) faltan.push('una minúscula');
  if (!/[A-Z]/.test(p)) faltan.push('una mayúscula');
  if (!/[0-9]/.test(p)) faltan.push('un número');
  if (!SIMBOLOS.test(p)) faltan.push('un símbolo (por ejemplo ! @ # $)');

  if (faltan.length > 0) {
    return { valid: false, message: `Te falta ${enumerar(faltan)}.` };
  }

  return { valid: true, message: null };
}

/**
 * Fuerza de contraseña para el medidor de 3 barras de "Crear cuenta"
 * (pantalla 2B de `Bienvenida.dc.html`). El mockup dibuja el medidor
 * siempre en 2 de 3 barras fijas — acá se calcula de verdad a partir de lo
 * que la persona escribió, para no mostrar un dato que no depende de su
 * contraseña real.
 *
 * Devuelve 0-3. El mínimo lo exige la validación del formulario por
 * separado; esto solo puntúa qué tan reforzada está.
 */
export function passwordStrength(password) {
  const p = password || '';
  if (p.length < MIN_PASSWORD) return 0;

  let puntos = 1;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) puntos += 1;
  if (/[0-9]/.test(p) || /[^A-Za-z0-9]/.test(p)) puntos += 1;
  return puntos;
}
