/**
 * Contraseña en tránsito durante el registro.
 *
 * El registro manda un código al correo ANTES de que la cuenta tenga una
 * contraseña usable: así, un correo inventado nunca recibe el código y esa
 * cuenta no sirve para entrar —ni por registro ni por login—. La contraseña
 * que la persona escribió recién se fija después de verificar el código, y
 * entre esos dos momentos hay que sostenerla en alguna parte.
 *
 * Ese lugar es solo memoria del proceso: nada de AsyncStorage, localStorage
 * ni parámetros de navegación (en web la navegación puede quedar serializada
 * y una contraseña no tiene por qué aparecer ahí). Se guarda una sola a la
 * vez, es de un solo uso y se borra al consumirla o al abandonar el flujo.
 */

let pendiente = null;

function normalizar(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function guardarPasswordPendiente(email, password) {
  const correo = normalizar(email);
  if (!correo || typeof password !== 'string' || !password) {
    pendiente = null;
    return;
  }
  pendiente = { email: correo, password };
}

/** Devuelve la contraseña una única vez y la borra de memoria. */
export function consumirPasswordPendiente(email) {
  const correo = normalizar(email);
  if (!pendiente || !correo || pendiente.email !== correo) return null;
  const { password } = pendiente;
  pendiente = null;
  return password;
}

export function olvidarPasswordPendiente() {
  pendiente = null;
}
