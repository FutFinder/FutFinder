const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERMISOS, SIEMPRE_PUEDE, permisosCambiaron, permisosDe, puedeEn, resumenDePermisos,
} = require('../permisosAdmin.js');

test('la lista de permisos es exactamente la que conoce Postgres', () => {
  // Está duplicada en el `case` de `puede_en_complejo` (migración 83). Si acá
  // aparece una clave que el servidor no conoce, la casilla se guarda y no
  // hace nada: peor que no ofrecerla. Esta prueba obliga a cambiar los dos.
  assert.deepEqual(PERMISOS.map((p) => p.clave), ['canchas', 'cobros', 'ficha']);
  for (const p of PERMISOS) {
    assert.ok(p.campo && p.nombre && p.descripcion, p.clave);
  }
});

test('el día a día no está entre los permisos: no se puede apagar', () => {
  assert.ok(SIEMPRE_PUEDE.length >= 3);
  const claves = PERMISOS.map((p) => p.clave).join(' ');
  assert.ok(!claves.includes('agenda'));
  assert.ok(!claves.includes('bloqueo'));
});

test('el dueño se resume como «puede todo», mire lo que mire', () => {
  assert.equal(resumenDePermisos({ rol: 'dueño' }), 'Puede todo');
  // Aunque tenga las banderas apagadas: en el servidor el rol manda sobre
  // ellas, y decir otra cosa acá sería mentir.
  assert.equal(
    resumenDePermisos({ rol: 'dueño', puedeCanchas: false, puedeCobros: false, puedeFicha: false }),
    'Puede todo',
  );
});

test('sin ningún permiso, el resumen dice qué SÍ puede', () => {
  assert.equal(resumenDePermisos({ rol: 'admin' }), 'Solo el día a día');
});

test('con todos encendidos se dice entero, no enumerado', () => {
  assert.equal(
    resumenDePermisos({ rol: 'admin', puedeCanchas: true, puedeCobros: true, puedeFicha: true }),
    'Puede todo lo del recinto',
  );
});

test('con algunos, el resumen los nombra', () => {
  const r = resumenDePermisos({ rol: 'admin', puedeCanchas: true, puedeCobros: true });
  assert.match(r, /canchas/i);
  assert.match(r, /cobros/i);
  assert.ok(!/ficha/i.test(r));
});

test('los permisos se traducen al formulario por clave', () => {
  assert.deepEqual(
    permisosDe({ puedeCanchas: true, puedeCobros: false, puedeFicha: true }),
    { canchas: true, cobros: false, ficha: true },
  );
  assert.deepEqual(permisosDe(null), { canchas: false, cobros: false, ficha: false });
});

test('«guardar» se enciende solo si cambió algo de verdad', () => {
  const admin = { puedeCanchas: true, puedeCobros: false, puedeFicha: false };
  assert.equal(permisosCambiaron(admin, { canchas: true, cobros: false, ficha: false }), false);
  assert.equal(permisosCambiaron(admin, { canchas: false, cobros: false, ficha: false }), true);
  assert.equal(permisosCambiaron(admin, { canchas: true, cobros: true, ficha: false }), true);
  // Volver a dejarlo como estaba después de dos toques tampoco es un cambio.
  assert.equal(permisosCambiaron(admin, permisosDe(admin)), false);
});

// ── Qué le muestra el panel a cada quien (migración 121) ───────────
//
// `puedeEn` decide si una fila del panel se dibuja. Equivocarse tiene dos
// costos distintos y hay que elegir a cuál errar: esconder de más deja una
// fila sin usar; mostrar de más manda a alguien a llenar un formulario para
// recibir «No tienes permiso para esto en este recinto». Por eso lo que no
// se sabe se trata como que NO se puede.

const RECINTO_DUENO = { id: 'r1', rol: 'dueño', puede_canchas: false, puede_cobros: false, puede_ficha: false };
const RECINTO_ADMIN = { id: 'r1', rol: 'admin', puede_canchas: false, puede_cobros: true, puede_ficha: false };

test('el dueño puede todo aunque no tenga ninguna bandera encendida', () => {
  // El servidor decide igual: `puede_en_complejo()` devuelve true para el
  // dueño antes de mirar las banderas. Si acá se mirara solo la bandera, un
  // dueño vería medio panel escondido.
  for (const p of PERMISOS) assert.equal(puedeEn(RECINTO_DUENO, p.clave), true);
});

test('un administrador puede exactamente lo que le encendieron', () => {
  assert.equal(puedeEn(RECINTO_ADMIN, 'cobros'), true);
  assert.equal(puedeEn(RECINTO_ADMIN, 'canchas'), false);
  assert.equal(puedeEn(RECINTO_ADMIN, 'ficha'), false);
});

test('sin el dato, no se puede', () => {
  // Un recinto sin banderas —respuesta vieja, objeto a medias, null— no
  // habilita nada. El costo de equivocarse acá es una fila escondida; al
  // revés sería un error en la cara de alguien.
  assert.equal(puedeEn({ id: 'r1', rol: 'admin' }, 'canchas'), false);
  assert.equal(puedeEn(null, 'canchas'), false);
  assert.equal(puedeEn(undefined, 'ficha'), false);
});

test('un permiso que no existe nunca se puede', () => {
  // Si una pantalla pregunta por un área inventada, la respuesta es no. Al
  // revés —devolver true por no reconocerla— dibujaría una fila que el
  // servidor no tiene forma de autorizar.
  assert.equal(puedeEn(RECINTO_ADMIN, 'ingresos'), false);
  assert.equal(puedeEn(RECINTO_ADMIN, ''), false);
  // Ni siquiera para el dueño: no es que pueda, es que esa área no existe...
  // salvo que sea dueño, donde la pregunta ni se hace. Se deja escrito para
  // que el día que se agregue un permiso nuevo, se agregue en PERMISOS.
  assert.equal(puedeEn(RECINTO_DUENO, 'ingresos'), true);
});

test('también entiende el nombre que usa el formulario de administradores', () => {
  // La RPC devuelve `puede_canchas`; el formulario de Administradores maneja
  // `puedeCanchas`. La misma función sirve en las dos pantallas.
  assert.equal(puedeEn({ rol: 'admin', puedeCanchas: true }, 'canchas'), true);
  assert.equal(puedeEn({ rol: 'admin', puedeCanchas: false }, 'canchas'), false);
});

test('una bandera que no es exactamente true no habilita nada', () => {
  // `undefined`, `null`, 1, 'true': todo eso llega de un servidor que cambió
  // o de un objeto armado a mano, y ninguno es un permiso concedido.
  for (const valor of [undefined, null, 0, 1, 'true', '']) {
    assert.equal(puedeEn({ rol: 'admin', puede_canchas: valor }, 'canchas'), false);
  }
});
