/**
 * Columnas que una migración agregó después de crear la tabla y que, por lo
 * tanto, pueden no existir todavía en un entorno concreto.
 *
 * EL PROBLEMA QUE RESUELVE. Si el código pide `clubs.tema` y la migración 53
 * no está aplicada, Postgres responde 42703 y la consulta se cae entera: el
 * club deja de cargar por una columna de color. Acá la consulta se rehace sin
 * esa columna y la pantalla sigue funcionando —el club se ve verde, que es el
 * default— hasta que la migración llegue.
 *
 * PERO NO PUEDE MENTIR. Al ESCRIBIR es distinto que al leer: si el color no
 * viajó, decir «guardado» es falso. `escribirTolerandoColumnas()` devuelve
 * `omitidas`, y la pantalla avisa de lo que se quedó fuera.
 *
 * Es puro a propósito: la operación de base de datos llega inyectada, así se
 * prueba el control de flujo —cuántas veces se reintenta, qué se saca, qué se
 * recuerda, qué error se devuelve tal cual— sin tocar la red. Mismo patrón
 * que `profileEdit.js`.
 *
 * Todo esto es temporal por naturaleza: cuando las migraciones estén
 * aplicadas en todos los entornos, el registro se puede borrar.
 */

/** Código de Postgres para «esta columna no existe». */
const COLUMNA_INEXISTENTE = '42703';

/**
 * Registro por proceso de qué columnas opcionales existen. Se descubre una
 * vez y no se vuelve a preguntar en toda la sesión.
 */
export function crearRegistroDeColumnas(nombres) {
  const disponible = new Map(nombres.map((n) => [n, true]));
  return {
    nombres: [...nombres],
    esDisponible: (nombre) => disponible.get(nombre) !== false,
    marcarAusente: (nombre) => disponible.set(nombre, false),
  };
}

/**
 * `true` si el error es exactamente «la columna <columna> no existe».
 *
 * El límite de palabra importa: sin él, «column sistema does not exist» se
 * leería como que falta `tema`.
 */
export function esColumnaInexistente(error, columna) {
  if (error?.code !== COLUMNA_INEXISTENTE) return false;
  return new RegExp(`\\b${columna}\\b`, 'i').test(error.message || '');
}

/** La lista de columnas pedida, sin las opcionales que este entorno no tiene. */
export function columnasDisponibles(registro, columnas) {
  return columnas
    .split(',')
    .map((c) => c.trim())
    .filter((c) => !registro.nombres.includes(c) || registro.esDisponible(c))
    .join(', ');
}

/** La primera columna opcional que este error señala como ausente, o `null`. */
function faltanteEn(registro, error) {
  return (
    registro.nombres.find(
      (c) => registro.esDisponible(c) && esColumnaInexistente(error, c)
    ) || null
  );
}

/**
 * Lee reintentando sin las columnas opcionales que resulten no existir.
 *
 * @param {object} registro   de `crearRegistroDeColumnas()`
 * @param {string} columnas   lista completa deseada, separada por comas
 * @param {(cols: string) => Promise<{data, error}>} leer
 */
export async function leerTolerandoColumnas({ registro, columnas, leer }) {
  // Un intento inicial más uno por cada columna que pueda faltar.
  for (let intento = 0; intento <= registro.nombres.length; intento++) {
    const respuesta = await leer(columnasDisponibles(registro, columnas));
    if (!respuesta.error) return respuesta;

    const faltante = faltanteEn(registro, respuesta.error);
    // Cualquier otro error —red, permisos— se devuelve tal cual: disfrazarlo
    // de «falta una columna» escondería el problema de verdad.
    if (!faltante) return respuesta;

    console.warn(`[FutFinder] falta la columna ${faltante}: aplica su migración.`);
    registro.marcarAusente(faltante);
  }
  return { data: null, error: { message: 'No se pudo completar la consulta.' } };
}

/**
 * Escribe reintentando sin las columnas opcionales que resulten no existir, y
 * cuenta cuáles se quedaron fuera.
 *
 * @returns {{data, error, omitidas: string[]}}
 */
export async function escribirTolerandoColumnas({ registro, patch, escribir }) {
  const omitidas = [];
  const intento = { ...patch };

  // Lo que este entorno ya demostró no tener no se vuelve a intentar.
  for (const columna of registro.nombres) {
    if (!registro.esDisponible(columna) && columna in intento) {
      delete intento[columna];
      omitidas.push(columna);
    }
  }

  for (let vuelta = 0; vuelta <= registro.nombres.length; vuelta++) {
    // Un `update({})` es un error de PostgREST, no un guardado vacío: si lo
    // único que se editaba era una columna ausente, no hay nada que mandar.
    if (Object.keys(intento).length === 0) {
      return { data: null, error: null, omitidas };
    }

    const respuesta = await escribir(intento);
    if (!respuesta.error) return { ...respuesta, omitidas };

    const faltante = faltanteEn(registro, respuesta.error);
    if (!faltante || !(faltante in intento)) return { ...respuesta, omitidas };

    console.warn(`[FutFinder] falta la columna ${faltante}: aplica su migración.`);
    registro.marcarAusente(faltante);
    delete intento[faltante];
    omitidas.push(faltante);
  }

  return { data: null, error: { message: 'No se pudo guardar.' }, omitidas };
}
