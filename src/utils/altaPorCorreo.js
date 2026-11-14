/**
 * Lo que pasa entre «te mandamos un código» y «ya tienes cuenta».
 *
 * La pantalla de verificación hacía tres cosas seguidas —verificar el código,
 * fijar la contraseña y guardar la edad— y sólo miraba el resultado de la
 * primera. Si la tercera fallaba nadie se enteraba, y si la segunda fallaba
 * la contraseña ya se había borrado de memoria: quedaba una cuenta creada,
 * verificada y sin contraseña, sin forma de reintentar.
 *
 * Acá vive la decisión de qué falta, para probarla sin React Native. La
 * pantalla sólo ejecuta el paso que esta función le dice.
 */

/**
 * Segundos entre un envío de código y el siguiente. Es el `max_frequency` de
 * Auth (`supabase/config.toml`: "1m0s"; en el panel, «Minimum interval per
 * user»). Con 42 —el valor anterior— el botón se encendía 18 segundos antes
 * de que el servidor aceptara el reenvío, y el rechazo se tragaba en silencio.
 */
export const ESPERA_REENVIO = 60;

export const MENSAJES_ALTA = {
  edadNoGuardada:
    'Tu cuenta ya está creada, pero no pudimos guardar tu fecha de nacimiento. Revisa tu conexión y toca «Reintentar».',
  passwordNoGuardada: (motivo) =>
    `Tu correo quedó verificado, pero no pudimos guardar tu contraseña${motivo ? `: ${motivo}` : '.'} Toca «Reintentar».`,
  reenviado: 'Te enviamos un código nuevo. El anterior ya no sirve.',
  esperaParaReenviar: (segundos) =>
    `Ya te enviamos un código hace poco. Podrás pedir otro en ${segundos} s.`,
  reenvioFallido: 'No pudimos reenviar el código. Revisa tu conexión e intenta de nuevo.',
};

/** `75` → `1:15`. Nunca negativo. */
export function formatoEspera(segundos) {
  const s = Math.max(0, Math.floor(Number(segundos) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * ¿El servidor rechazó el envío por ir muy seguido? Devuelve cuántos segundos
 * hay que esperar, o 0 si el error es otra cosa.
 *
 * Auth contesta 429 `over_email_send_rate_limit` con el texto «For security
 * purposes, you can only request this after N seconds.»; cuando no trae el
 * número se asume la espera completa.
 */
export function segundosDeEspera(error) {
  if (!error) return 0;
  const codigo = error.code || error.error_code || '';
  const texto = String(error.message || '');
  const porFrecuencia =
    codigo === 'over_email_send_rate_limit' ||
    /only request this after/i.test(texto);
  if (!porFrecuencia) return 0;
  const m = texto.match(/after\s+(\d+)\s+seconds?/i);
  const n = m ? Number(m[1]) : ESPERA_REENVIO;
  return Math.min(Math.max(1, n), 3600);
}

/**
 * Con el código ya verificado (hay sesión), ¿qué falta?
 *
 * - `password`: hay una contraseña esperando en memoria y todavía no se fijó.
 * - `edad`: la fecha de nacimiento del registro todavía no se guardó.
 * - `crearPassword`: es un registro, la contraseña no se fijó y ya no está en
 *   memoria (la página se recargó, o el servidor la rechazó). No se puede
 *   reintentar con algo que no existe: hay que pedirle una nueva, con la
 *   sesión recién abierta por el código.
 * - `listo`: se sigue al onboarding.
 *
 * Quien llega desde Iniciar sesión (`esRegistro: false`) ya tiene contraseña:
 * a esa persona nunca se le pide crear una.
 */
export function siguientePasoDelAlta({
  esRegistro = false,
  passwordFijada = false,
  hayPasswordPendiente = false,
  edad = null,
  edadGuardada = false,
} = {}) {
  if (!passwordFijada && hayPasswordPendiente) return 'password';
  if (edad != null && !edadGuardada) return 'edad';
  if (esRegistro && !passwordFijada) return 'crearPassword';
  return 'listo';
}

/**
 * Lo que queda en las casillas del código después de escribir `texto` en la
 * casilla `idx`. Devuelve las casillas nuevas y cuál debe recibir el foco.
 *
 * Con una casilla por dígito y `maxLength={1}`, pegar el código entero —o el
 * autocompletado del teclado, que lo entrega de una vez— dejaba sólo el
 * primer dígito. Ahora lo pegado se reparte desde la casilla donde cayó.
 * Escribir un dígito sobre una casilla ya ocupada la reemplaza.
 */
export function repartirCodigo(casillas, idx, texto, largo = casillas.length) {
  const limpio = String(texto ?? '').replace(/\D/g, '');
  const nuevas = casillas.slice(0, largo);
  while (nuevas.length < largo) nuevas.push('');

  const reemplazo = limpio.length <= 1 || (limpio.length === 2 && nuevas[idx] !== '');
  if (reemplazo) {
    const digito = limpio.slice(-1);
    nuevas[idx] = digito;
    return { casillas: nuevas, foco: digito && idx < largo - 1 ? idx + 1 : idx };
  }

  let i = idx;
  for (const d of limpio) {
    if (i >= largo) break;
    nuevas[i] = d;
    i += 1;
  }
  return { casillas: nuevas, foco: Math.min(i, largo - 1) };
}
