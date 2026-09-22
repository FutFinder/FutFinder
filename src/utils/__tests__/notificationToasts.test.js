const test = require('node:test');
const assert = require('node:assert/strict');

const {
  empujarToast, quitarToast, toastsActuales, suscribirseAToasts, limpiarToasts, DURACION_TOAST_MS,
} = require('../notificationToasts.js');

test('una notificación se encola y se puede leer', () => {
  limpiarToasts();
  const id = empujarToast({ id: 'n1', title: 'Te invitaron a un partido' });
  assert.equal(toastsActuales().length, 1);
  assert.equal(toastsActuales()[0].title, 'Te invitaron a un partido');
  quitarToast(id);
  assert.equal(toastsActuales().length, 0);
});

test('DOS NOTIFICACIONES SEGUIDAS NO SE PISAN', () => {
  limpiarToasts();
  empujarToast({ id: 'n1', title: 'Primera' });
  empujarToast({ id: 'n2', title: 'Segunda' });
  assert.deepEqual(toastsActuales().map((n) => n.title), ['Primera', 'Segunda']);
});

test('la misma notificación reentregada por Realtime no se duplica, se actualiza', () => {
  // El canal es compartido y puede reentregar el mismo INSERT — sin esto,
  // el mismo aviso aparecería dos veces apiladas.
  limpiarToasts();
  empujarToast({ id: 'n1', title: 'Primera', read: false });
  empujarToast({ id: 'n1', title: 'Primera', read: true });
  assert.equal(toastsActuales().length, 1);
  assert.equal(toastsActuales()[0].read, true);
});

test('una notificación sin id no se encola', () => {
  limpiarToasts();
  assert.equal(empujarToast({ title: 'sin id' }), null);
  assert.equal(empujarToast(null), null);
  assert.equal(toastsActuales().length, 0);
});

test('quitar una que ya no está no rompe ni avisa de más', () => {
  limpiarToasts();
  let veces = 0;
  const cortar = suscribirseAToasts(() => { veces += 1; });
  const id = empujarToast({ id: 'n1', title: 'uno' });
  quitarToast(id);
  const despues = veces;
  quitarToast(id);
  assert.equal(veces, despues);
  cortar();
});

test('quien se suscribe recibe lo que ya había', () => {
  limpiarToasts();
  empujarToast({ id: 'n1', title: 'ya estaba' });
  let visto = null;
  const cortar = suscribirseAToasts((c) => { visto = c; });
  assert.equal(visto.length, 1);
  assert.equal(visto[0].title, 'ya estaba');
  cortar();
});

test('desuscribirse deja de recibir', () => {
  limpiarToasts();
  let veces = 0;
  const cortar = suscribirseAToasts(() => { veces += 1; });
  const tras = veces;
  cortar();
  empujarToast({ id: 'n1', title: 'después' });
  assert.equal(veces, tras);
});

test('DURACION_TOAST_MS da tiempo a leer el título y el cuerpo', () => {
  assert.ok(DURACION_TOAST_MS >= 3000);
});
