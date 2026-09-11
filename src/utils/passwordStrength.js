/**
 * Fuerza de contraseña para el medidor de 3 barras de "Crear cuenta"
 * (pantalla 2B de `Bienvenida.dc.html`). El mockup dibuja el medidor
 * siempre en 2 de 3 barras fijas — acá se calcula de verdad a partir de lo
 * que la persona escribió, para no mostrar un dato que no depende de su
 * contraseña real.
 *
 * Devuelve 0-3. El mínimo de 8 caracteres ya lo exige la validación del
 * formulario por separado; esto solo puntúa qué tan reforzada está.
 */
export function passwordStrength(password) {
  const p = password || '';
  if (p.length < 8) return 0;

  let puntos = 1;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) puntos += 1;
  if (/[0-9]/.test(p) || /[^A-Za-z0-9]/.test(p)) puntos += 1;
  return puntos;
}
