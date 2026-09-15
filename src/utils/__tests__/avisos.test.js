const test = require('node:test');
const assert = require('node:assert/strict');

const {
  avisosActuales, duracionDeAviso, empujarAviso, limpiarAvisos, quitarAviso, suscribirseAAvisos,
} = require('../avisos.js');

test('un aviso se encola y se puede leer', () => {
  limpiarAvisos();
  const id = empujarAviso('No pudimos cargar más', 'Intenta de nuevo', 'error');
  assert.equal(avisosActuales().length, 1);
  assert.equal(avisosActuales()[0].titulo, 'No pudimos cargar más');
  assert.equal(avisosActuales()[0].tono, 'error');
  quitarAviso(id);
  assert.equal(avisosActuales().length, 0);
});

test('DOS ERRORES SEGUIDOS NO SE PISAN', () => {
  // Pasa cuando algo de red falla: con un solo hueco, el segundo tapaba al
  // primero y el primero no se leía nunca.
  limpiarAvisos();
  empujarAviso('Primero');
  empujarAviso('Segundo');
  assert.deepEqual(avisosActuales().map((a) => a.titulo), ['Primero', 'Segundo']);
});

test('un aviso sin título no se encola', () => {
  // Sería un rectángulo vacío encima de la pantalla.
  limpiarAvisos();
  assert.equal(empujarAviso(''), null);
  assert.equal(empujarAviso(null), null);
  assert.equal(empujarAviso('   '), null);
  assert.equal(avisosActuales().length, 0);
});

test('cada aviso tiene su propio id, aunque digan lo mismo', () => {
  // Sin esto, quitar uno se llevaría al otro y el segundo error desaparecería
  // sin que nadie lo leyera.
  limpiarAvisos();
  const a = empujarAviso('Mismo texto');
  const b = empujarAviso('Mismo texto');
  assert.notEqual(a, b);
  quitarAviso(a);
  assert.equal(avisosActuales().length, 1);
  assert.equal(avisosActuales()[0].id, b);
});

test('quitar uno que ya no está no rompe ni avisa de más', () => {
  limpiarAvisos();
  let veces = 0;
  const cortar = suscribirseAAvisos(() => { veces += 1; });
  const id = empujarAviso('uno');
  quitarAviso(id);
  const despues = veces;
  quitarAviso(id);
  assert.equal(veces, despues);
  cortar();
});

test('quien se suscribe recibe lo que ya había', () => {
  // Si el anfitrión se monta después de que algo falló, ese error igual se ve.
  limpiarAvisos();
  empujarAviso('ya estaba');
  let visto = null;
  const cortar = suscribirseAAvisos((c) => { visto = c; });
  assert.equal(visto.length, 1);
  assert.equal(visto[0].titulo, 'ya estaba');
  cortar();
});

test('desuscribirse deja de recibir', () => {
  limpiarAvisos();
  let veces = 0;
  const cortar = suscribirseAAvisos(() => { veces += 1; });
  const tras = veces;
  cortar();
  empujarAviso('después');
  assert.equal(veces, tras);
});

test('un error dura más en pantalla que un «listo»', () => {
  // Hay que leerlo y a veces decidir qué hacer.
  assert.ok(duracionDeAviso('error') > duracionDeAviso('info'));
  assert.ok(duracionDeAviso('info') >= 3000);
});
