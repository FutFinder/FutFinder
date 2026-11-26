/**
 * Vocabulario de la modalidad del club (columna `clubs.modalidad`,
 * migración 29).
 *
 * Está separado de `clubMeta.js` por una razón práctica: `clubMeta`
 * calcula distancias y para eso importa `services/matches`, que arrastra
 * Supabase. Las reglas de «qué modalidad es válida» tienen que poder
 * probarse y reutilizarse sin encender la red, y `utils/clubEdit.js` —que
 * valida el formulario— las necesita.
 *
 * `clubMeta.js` las vuelve a exportar, así que nadie tuvo que cambiar de
 * import por esto.
 */

/** Modalidades sueltas (y valores históricos de `clubs.modalidad`). */
export const MODALIDADES = {
  FUTBOL_5: 'futbol5',
  FUTBOL_7: 'futbol7',
  FUTBOL_11: 'futbol11',
  AMBOS: 'ambos',
};

/**
 * VARIAS MODALIDADES (migración 201, pedido de Vicente del 2026-11-26).
 * Un club puede jugar Fútbol 5, 7 y 11 en cualquier combinación, y se muestran
 * juntas: «Fútbol 5, 7», «Fútbol 5, 7, 11».
 *
 * Se guarda en la MISMA columna de texto con un valor canónico por
 * combinación, en vez de pasarla a un arreglo: la columna es descriptiva
 * (ninguna función de la base la lee, comprobado en `pg_proc`) y así no hay
 * que tocar ningún `select` ni las versiones anteriores de la app, que con un
 * valor que no conocen simplemente no muestran la modalidad.
 *
 * 7 y 11 SIGUE GUARDÁNDOSE COMO 'ambos': es lo que ya tienen los clubes que
 * la eligieron y lo que entienden las versiones anteriores.
 */
const ORDEN = ['futbol5', 'futbol7', 'futbol11'];
const NUMERO = { futbol5: '5', futbol7: '7', futbol11: '11' };

const COMBINACIONES = {
  futbol5: ['futbol5'],
  futbol7: ['futbol7'],
  futbol11: ['futbol11'],
  futbol5_7: ['futbol5', 'futbol7'],
  futbol5_11: ['futbol5', 'futbol11'],
  ambos: ['futbol7', 'futbol11'],
  futbol5_7_11: ['futbol5', 'futbol7', 'futbol11'],
};

/** Opciones del selector de crear/editar club: se marcan una o varias. */
export const OPCIONES_MODALIDAD = [
  { value: MODALIDADES.FUTBOL_5, label: 'Fútbol 5' },
  { value: MODALIDADES.FUTBOL_7, label: 'Fútbol 7' },
  { value: MODALIDADES.FUTBOL_11, label: 'Fútbol 11' },
];

/** `true` si el valor es una modalidad o combinación conocida. */
export function esModalidadValida(valor) {
  return Object.prototype.hasOwnProperty.call(COMBINACIONES, valor);
}

/** Lista de modalidades sueltas de un valor guardado, en orden 5 · 7 · 11. */
export function modalidadesDe(valor) {
  return esModalidadValida(valor) ? [...COMBINACIONES[valor]] : [];
}

/** Valor canónico de una lista de modalidades sueltas; `null` si no hay ninguna. */
export function valorDeModalidades(lista) {
  const marcadas = ORDEN.filter((m) => (lista || []).includes(m));
  if (marcadas.length === 0) return null;
  const valor = Object.keys(COMBINACIONES).find(
    (k) => COMBINACIONES[k].join() === marcadas.join()
  );
  return valor || null;
}

/**
 * Etiquetas de modalidad para el banner del club (MAYÚSCULAS), una por
 * modalidad. Sin modalidad → `[]`, y no se dibuja ninguna.
 */
export function modalidadBadges(modalidad) {
  return modalidadesDe(modalidad).map((m) => `FÚTBOL ${NUMERO[m]}`);
}

/**
 * Modalidad en línea, para la ficha y las tarjetas.
 * Ej: 'Fútbol 5' · 'Fútbol 5, 7' · 'Fútbol 5, 7, 11'.
 * Sin modalidad declarada devuelve `null`: quien llama la omite.
 */
export function modalidadInline(modalidad) {
  const lista = modalidadesDe(modalidad);
  if (lista.length === 0) return null;
  return `Fútbol ${lista.map((m) => NUMERO[m]).join(', ')}`;
}

/**
 * Marca o desmarca una modalidad suelta sobre el valor guardado y devuelve el
 * nuevo valor canónico (o `null` si no queda ninguna). Lo usan los selectores
 * de crear y editar club.
 */
export function alternarModalidad(valor, modalidad) {
  const lista = modalidadesDe(valor);
  const nueva = lista.includes(modalidad)
    ? lista.filter((m) => m !== modalidad)
    : [...lista, modalidad];
  return valorDeModalidades(nueva);
}
