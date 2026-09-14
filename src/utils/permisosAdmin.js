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
