const test = require('node:test');
const assert = require('node:assert/strict');

const { goBackOrPartidos, irAPestana } = require('../navigation.js');

/** Una navegación de mentira que anota lo que le piden. */
function falsa({ puedeVolver = true, conPopToTop = true, conPadre = false } = {}) {
  const hechos = [];
  const nav = {
    canGoBack: () => puedeVolver,
    goBack: () => hechos.push('goBack'),
    navigate: (r, p) => hechos.push(`navigate:${r}:${p?.screen || ''}`),
    hechos,
  };
  if (conPopToTop) nav.popToTop = () => hechos.push('popToTop');
  if (conPadre) nav.getParent = () => ({ popToTop: () => hechos.push('padre.popToTop') });
  return nav;
}

test('IR A UNA PESTAÑA VACÍA LA PILA PRIMERO', () => {
  // Cambiar la pestaña dejando el detalle del partido encima hace que el
  // botón parezca no hacer nada: la pestaña cambia DEBAJO de lo que se ve.
  // Pasó tal cual con «Reservar la cancha» en un desafío de clubes.
  const nav = falsa();
  irAPestana(nav, 'ReservasTab');
  assert.deepEqual(nav.hechos, ['popToTop', 'navigate:Main:ReservasTab']);
});

test('sin pila que vaciar, solo navega', () => {
  const nav = falsa({ puedeVolver: false });
  irAPestana(nav, 'ReservasTab');
  assert.deepEqual(nav.hechos, ['navigate:Main:ReservasTab']);
});

test('si la pila está en el padre, se vacía ahí', () => {
  const nav = falsa({ conPopToTop: false, conPadre: true });
  irAPestana(nav, 'ReservasTab');
  assert.deepEqual(nav.hechos, ['padre.popToTop', 'navigate:Main:ReservasTab']);
});

test('y si no hay ninguna forma de vaciar, al menos retrocede', () => {
  // Preferible a quedarse con la pantalla vieja encima sin decir nada.
  const nav = falsa({ conPopToTop: false });
  irAPestana(nav, 'ReservasTab');
  assert.deepEqual(nav.hechos, ['goBack', 'navigate:Main:ReservasTab']);
});

test('volver atrás cae a Partidos cuando no hay historial', () => {
  // Pasa con los enlaces compartidos, que abren el detalle directamente.
  const conHistorial = falsa();
  goBackOrPartidos(conHistorial);
  assert.deepEqual(conHistorial.hechos, ['goBack']);

  const sinHistorial = falsa({ puedeVolver: false });
  goBackOrPartidos(sinHistorial);
  assert.deepEqual(sinHistorial.hechos, ['navigate:Main:SearchTab']);
});
