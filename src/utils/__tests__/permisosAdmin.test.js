const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PERMISOS, SIEMPRE_PUEDE, permisosCambiaron, permisosDe, resumenDePermisos,
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
