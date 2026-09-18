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
