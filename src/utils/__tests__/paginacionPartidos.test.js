/**
 * Pruebas de la paginación del buscador de partidos (N07, N08 y N09 de la
 * revisión del 21 de septiembre de 2026).
 *
 * LOS TRES FALLOS SON DE LA MISMA FAMILIA: la pantalla mostraba menos de lo
 * que había y no había forma de notarlo.
 *
 *   N07  Dos partidos a la MISMA hora justo en el corte entre páginas: el
 *        segundo desaparecía para siempre, porque el cursor era sólo `hora` y
 *        la página siguiente pedía `hora > últimaHora`.
 *   N08  Si fallaba la consulta de «Ver más partidos», el botón desaparecía
 *        como si se hubieran acabado los resultados.
 *   N09  Una respuesta vieja llegaba después de la nueva y pisaba el listado,
 *        dejando los partidos de la comuna anterior bajo el filtro nuevo.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  aplicarOrdenYCursor,
  crearSecuencia,
  cursorDePagina,
  cursorDePartido,
  mezclarPagina,
  resultadoDeCargarMas,
} = require('../paginacionPartidos.js');

// ---------------------------------------------------------------------------
// N07 — el cursor compuesto
// ---------------------------------------------------------------------------

/** Doble de la consulta de Supabase: registra lo que le piden. */
function consultaFalsa(registro) {
  const cadena = {
    order(col, opts) {
      registro.order.push([col, opts]);
      return cadena;
    },
    or(filtro) {
      registro.or.push(filtro);
      return cadena;
    },
    gt(col, val) {
      registro.gt.push([col, val]);
      return cadena;
    },
  };
  return cadena;
}

function registroNuevo() {
  return { order: [], or: [], gt: [] };
}

test('el cursor de un partido es el par (hora, id), no sólo la hora', () => {
  assert.deepEqual(
    cursorDePartido({ id: 'm-2', hora: '2026-09-26T23:00:00+00:00', titulo: 'x' }),
    { hora: '2026-09-26T23:00:00+00:00', id: 'm-2' }
  );
  assert.equal(cursorDePartido(null), null);
  assert.equal(cursorDePartido({ id: 'm-1' }), null, 'sin hora no hay desde dónde seguir');
  assert.equal(cursorDePartido({ hora: '2026-09-26T23:00:00+00:00' }), null);
});

test('el cursor de una página es su último partido', () => {
  const pagina = [
    { id: 'a', hora: '2026-09-26T21:00:00+00:00' },
    { id: 'b', hora: '2026-09-26T23:00:00+00:00' },
  ];
  assert.deepEqual(cursorDePagina(pagina), { hora: '2026-09-26T23:00:00+00:00', id: 'b' });
  assert.equal(cursorDePagina([]), null);
  assert.equal(cursorDePagina(undefined), null);
});

test('la primera página ordena por (hora, id) y no filtra nada', () => {
  const reg = registroNuevo();
  aplicarOrdenYCursor(consultaFalsa(reg), null);

  assert.deepEqual(reg.order, [
    ['hora', { ascending: true }],
    ['id', { ascending: true }],
  ]);
  assert.deepEqual(reg.or, []);
});

test('LA REGRESIÓN DE N07: la página siguiente incluye a los que empatan la hora', () => {
  const reg = registroNuevo();
  const hora = '2026-09-26T23:00:00+00:00';
  aplicarOrdenYCursor(consultaFalsa(reg), { hora, id: 'm-50' });

  // Con `hora.gt` a secas, el partido 51 —misma hora que el 50— quedaba fuera
  // y no aparecía en ninguna página. La condición tiene que ser
  // «hora mayor, O misma hora con id mayor».
  assert.equal(reg.or.length, 1);
  assert.equal(reg.or[0], `hora.gt."${hora}",and(hora.eq."${hora}",id.gt."m-50")`);
  assert.deepEqual(reg.gt, [], 'el filtro ya no puede ser un gt suelto sobre la hora');
});

test('el mismo desempate en el orden y en el cursor', () => {
  const reg = registroNuevo();
  aplicarOrdenYCursor(consultaFalsa(reg), { hora: '2026-09-26T23:00:00+00:00', id: 'm-50' });

  // Si se ordenara por otra cosa que el par del cursor, la paginación volvería
  // a saltarse filas sin que nada lo denuncie.
  assert.deepEqual(reg.order, [
    ['hora', { ascending: true }],
    ['id', { ascending: true }],
  ]);
});

test('un cursor a medias no filtra: mejor repetir una página que perderla', () => {
  const reg = registroNuevo();
  aplicarOrdenYCursor(consultaFalsa(reg), { hora: '2026-09-26T23:00:00+00:00' });
  assert.deepEqual(reg.or, []);
});

test('el valor de la hora viaja entre comillas dobles', () => {
  const reg = registroNuevo();
  aplicarOrdenYCursor(consultaFalsa(reg), { hora: '2026-09-26T23:00:00+00:00', id: 'x' });
  // Dentro de un `or=(...)` la coma separa términos: comillar el valor es lo
  // que evita que un formato distinto de fecha rompa la consulta entera.
  assert.match(reg.or[0], /hora\.gt\."[^"]+"/);
});

// ---------------------------------------------------------------------------
// La mezcla de páginas
// ---------------------------------------------------------------------------

test('la página nueva se suma sin repetir lo que ya está', () => {
  const previos = [{ id: 'a' }, { id: 'b' }];
  const nuevos = [{ id: 'b' }, { id: 'c' }];
  assert.deepEqual(mezclarPagina(previos, nuevos), [{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
});

test('mezclar con listas vacías no revienta', () => {
  assert.deepEqual(mezclarPagina(undefined, undefined), []);
  assert.deepEqual(mezclarPagina([{ id: 'a' }], undefined), [{ id: 'a' }]);
});

// ---------------------------------------------------------------------------
// N08 — un error no es el final de los resultados
// ---------------------------------------------------------------------------

test('LA REGRESIÓN DE N08: si falla la página siguiente, el botón se conserva', () => {
  const previos = [{ id: 'a' }, { id: 'b' }];
  const r = resultadoDeCargarMas({
    previos,
    hayMasPrevio: true,
    res: { data: [], hayMas: false, error: { message: 'Network request failed' } },
  });

  assert.deepEqual(r.matches, previos, 'lo que ya estaba en pantalla no se toca');
  assert.equal(r.hayMas, true, 'un error no puede disfrazarse de «no hay más partidos»');
  assert.ok(r.error, 'el error tiene que llegar a la pantalla');
});

test('una excepción sin respuesta también conserva el botón', () => {
  const r = resultadoDeCargarMas({ previos: [{ id: 'a' }], hayMasPrevio: true, res: undefined });
  assert.equal(r.hayMas, true);
  assert.ok(r.error?.message);
});

test('sin error, manda el hayMas del servidor', () => {
  const r = resultadoDeCargarMas({
    previos: [{ id: 'a' }],
    hayMasPrevio: true,
    res: { data: [{ id: 'b' }], hayMas: false, error: null },
  });
  assert.deepEqual(r.matches, [{ id: 'a' }, { id: 'b' }]);
  assert.equal(r.hayMas, false);
  assert.equal(r.error, null);
});

test('la última página de verdad sí apaga el botón', () => {
  const r = resultadoDeCargarMas({
    previos: [{ id: 'a' }],
    hayMasPrevio: true,
    res: { data: [], hayMas: false, error: null },
  });
  assert.equal(r.hayMas, false);
  assert.equal(r.error, null);
});

// ---------------------------------------------------------------------------
// N09 — sólo la búsqueda vigente escribe
// ---------------------------------------------------------------------------

test('LA REGRESIÓN DE N09: la respuesta vieja ya no puede escribir', () => {
  const s = crearSecuencia();
  const comunaA = s.abrir();
  const comunaB = s.abrir();

  // B llega primero y A después, que es el orden que rompía la pantalla.
  assert.equal(s.vigente(comunaB), true);
  assert.equal(s.vigente(comunaA), false);
});

test('mientras no se abra otra, la búsqueda sigue siendo la vigente', () => {
  const s = crearSecuencia();
  const t = s.abrir();
  assert.equal(s.vigente(t), true);
  assert.equal(s.vigente(t), true);
});

test('un turno que nunca se pidió no es vigente', () => {
  const s = crearSecuencia();
  s.abrir();
  assert.equal(s.vigente(0), false);
  assert.equal(s.vigente(99), false);
});
