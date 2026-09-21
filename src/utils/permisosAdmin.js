/**
 * Los permisos que el dueño reparte entre sus administradores (migración 83).
 *
 * TRES PERMISOS Y NO MÁS, y la lista está acá y en el `case` de
 * `puede_en_complejo` en Postgres. Los dos se cambian juntos: si acá aparece
 * uno que el servidor no conoce, la casilla se guarda y no hace nada — que es
 * peor que no ofrecerla. Hay una prueba que fija la lista exacta.
 *
 * LO QUE NO ES PERMISO: el día a día. Ver la agenda, abrir el calendario,
 * ocupar una hora por fuera y cancelar una reserva los puede hacer cualquier
 * administrador, siempre. Es para lo que se suma a alguien, y si eso también
 * se pudiera apagar, un administrador sin permisos no serviría de nada.
 */

export const PERMISOS = [
  {
    clave: 'canchas',
    campo: 'puedeCanchas',
    nombre: 'Canchas, horarios y tarifas',
    descripcion: 'Crear y editar canchas, sus horarios de atención y los precios por franja.',
  },
  {
    clave: 'cobros',
    campo: 'puedeCobros',
    nombre: 'Cobros adicionales',
    descripcion: 'El balón, los petos, el árbitro: crearlos, cambiarles el precio y apagarlos.',
  },
  {
    clave: 'ficha',
    campo: 'puedeFicha',
    nombre: 'Ficha del recinto',
    descripcion: 'Nombre, descripción, dirección, fotos y servicios — lo que ve el jugador.',
  },
];

/** Lo que cualquier administrador puede hacer sin ningún permiso encendido. */
export const SIEMPRE_PUEDE = [
  'Ver la agenda y las reservas del día',
  'Abrir el calendario de cada cancha',
  'Ocupar una hora por fuera de la app',
  'Cancelar una reserva y ver a quién llamar',
];

/**
 * ¿Puede quien mira el panel hacer algo de esta área en ESTE recinto?
 *
 * Responde lo mismo que `puede_en_complejo()` en el servidor, y ésa es toda
 * su razón de existir: sirve para NO OFRECER lo que el servidor va a
 * rechazar, nunca para autorizar nada. Quien decide sigue siendo la base —
 * siete disparadores sobre las tablas, migración 83.
 *
 * El recinto viene de `admin_mis_complejos()`, que desde la migración 121
 * devuelve las tres banderas ya resueltas (el dueño llega con las tres en
 * `true`). Igual se mira el rol acá: es la misma regla escrita dos veces a
 * propósito, porque un dueño al que se le esconda media pantalla por una
 * bandera ausente es un fallo mudo y difícil de encontrar.
 *
 * SIN EL DATO, NO. Un recinto sin banderas —una respuesta vieja, un objeto a
 * medias— devuelve `false` para un administrador. Esconder de más deja una
 * fila sin usar; mostrar de más manda a alguien a chocar con un error.
 */
export function puedeEn(recinto, clave) {
  if (!recinto) return false;
  if (recinto.rol === 'dueño') return true;
  const campo = PERMISOS.find((p) => p.clave === clave);
  if (!campo) return false;
  // Se acepta `puede_canchas` (como llega de la RPC) y `puedeCanchas` (como
  // lo nombra el formulario de administradores), para que la misma función
  // sirva en las dos pantallas.
  return recinto[`puede_${clave}`] === true || recinto[campo.campo] === true;
}

/** `{ puedeCanchas, puedeCobros, puedeFicha }` → resumen de una línea. */
export function resumenDePermisos(admin) {
  if (admin?.rol === 'dueño') return 'Puede todo';
  const encendidos = PERMISOS.filter((p) => admin?.[p.campo]);
  if (encendidos.length === 0) return 'Solo el día a día';
  if (encendidos.length === PERMISOS.length) return 'Puede todo lo del recinto';
  return `También ${encendidos.map((p) => p.nombre.toLowerCase()).join(' y ')}`;
}

/** Los permisos de una fila, listos para el formulario. */
export function permisosDe(admin) {
  return Object.fromEntries(PERMISOS.map((p) => [p.clave, !!admin?.[p.campo]]));
}

/** ¿Cambió algo respecto de lo que estaba guardado? */
export function permisosCambiaron(admin, elegidos) {
  return PERMISOS.some((p) => !!admin?.[p.campo] !== !!elegidos?.[p.clave]);
}
