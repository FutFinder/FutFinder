const test = require('node:test');
const assert = require('node:assert/strict');
const { bloqueadosDentro, avisoDeBloqueados } = require('../bloqueadosEnPartido.js');

const lista = [
  { user_id: 'a', username: 'ana' },
  { user_id: 'b', username: 'beto' },
  { user_id: 'c', username: 'caro' },
  { nombre: 'Tomás' },
  { user_id: 'b', username: 'beto' },
];

test('sin bloqueos no marca a nadie', () => {
  assert.deepEqual(bloqueadosDentro(lista, new Set()), []);
  assert.deepEqual(bloqueadosDentro(lista, null), []);
  assert.equal(avisoDeBloqueados([]), null);
});

test('marca sólo a los bloqueados con cuenta, una vez cada uno', () => {
  const r = bloqueadosDentro(lista, new Set(['b', 'zz']));
  assert.deepEqual(r.map((j) => j.user_id), ['b']);
});

test('el aviso nombra al único bloqueado', () => {
  assert.equal(avisoDeBloqueados([{ user_id: 'b', username: 'beto' }]), '@beto está en este partido. Lo bloqueaste antes.');
});

test('con varios, el aviso los cuenta', () => {
  const r = bloqueadosDentro(lista, new Set(['a', 'c']));
  assert.equal(avisoDeBloqueados(r), '2 jugadores que bloqueaste están en este partido.');
});
