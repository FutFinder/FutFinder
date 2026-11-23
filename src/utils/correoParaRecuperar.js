/**
 * El correo con que se abre «Recuperar contraseña», en memoria.
 *
 * No viaja como parámetro de navegación a propósito: en web, React
 * Navigation escribe los parámetros en la URL (`?email=…`), y un correo en
 * la barra de direcciones queda en el historial del navegador y en lo que se
 * comparte por error. Se guarda acá justo antes de navegar y la pantalla lo
 * consume una sola vez al abrirse.
 */
let correo = '';

export function guardarCorreoParaRecuperar(valor) {
  correo = typeof valor === 'string' ? valor.trim() : '';
}

export function consumirCorreoParaRecuperar() {
  const v = correo;
  correo = '';
  return v;
}
