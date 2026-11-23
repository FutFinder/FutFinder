/**
 * A02 (pendientes de calidad del 2026-09-23): dos cambios rápidos de un
 * interruptor de Ajustes podían resolverse fuera de orden, y el rollback de
 * la primera petición pisaba la segunda elección.
 *
 * Y al revisarlo apareció otro: el rollback volvía a `!value`. Para el
 * selector de solicitudes de amistad (`'everyone'` / `'nobody'`) eso dejaba
 * `false`, un valor que la columna ni admite.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { crearGuardadoDeAjustes } = require('../guardadoDeAjustes.js');

function pendiente() {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
}

/** Estado de la pantalla y respuestas del servidor que la prueba controla. */
function montaje(inicial) {
  const estado = { perfil: { ...inicial } };
  const respuestas = [];
  const guardado = crearGuardadoDeAjustes({
    leer: (campo) => estado.perfil[campo],
    escribir: (campo, valor) => { estado.perfil = { ...estado.perfil, [campo]: valor }; },
    guardar: () => {
      const p = pendiente();
      respuestas.push(p);
      return p.promesa;
    },
  });
  return { estado, respuestas, guardado };
}

test('A02: la primera falla DESPUÉS de que la segunda salió bien: queda la segunda', async () => {
  const { estado, respuestas, guardado } = montaje({ notif_chat: true });
  const a = guardado.cambiar('notif_chat', false); // primer toque
  const b = guardado.cambiar('notif_chat', true);  // segundo toque
  respuestas[1].resolver({ error: null });          // la segunda sale bien
  await b;
  respuestas[0].resolver({ error: { message: 'sin red' } }); // la primera falla tarde
  const ra = await a;
  assert.equal(estado.perfil.notif_chat, true, 'el rollback de la primera pisó la segunda elección');
  assert.equal(ra.error, null, 'una respuesta vieja no tiene por qué avisar de un error');
});

test('A02: si la última falla, vuelve al valor de antes de esa última', async () => {
  const { estado, respuestas, guardado } = montaje({ notif_chat: true });
  const a = guardado.cambiar('notif_chat', false);
  respuestas[0].resolver({ error: { message: 'sin red' } });
  const r = await a;
  assert.equal(estado.perfil.notif_chat, true);
  assert.equal(r.error.message, 'sin red');
});

test('A02: el rollback de un selector de texto vuelve a su texto, no a false', async () => {
  const { estado, respuestas, guardado } = montaje({ privacy_friend_requests: 'everyone' });
  const a = guardado.cambiar('privacy_friend_requests', 'nobody');
  assert.equal(estado.perfil.privacy_friend_requests, 'nobody', 'el cambio no se ve al toque');
  respuestas[0].resolver({ error: { message: 'sin red' } });
  await a;
  assert.equal(estado.perfil.privacy_friend_requests, 'everyone');
});

test('A02: campos distintos no se pisan entre sí', async () => {
  const { estado, respuestas, guardado } = montaje({ notif_chat: true, notif_clubs: true });
  const a = guardado.cambiar('notif_chat', false);
  const b = guardado.cambiar('notif_clubs', false);
  respuestas[1].resolver({ error: null });
  respuestas[0].resolver({ error: { message: 'x' } });
  await Promise.all([a, b]);
  assert.deepEqual(estado.perfil, { notif_chat: true, notif_clubs: false });
});

test('A02: Ajustes usa el guardado por campo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'SettingsScreen.js'), 'utf8');
  const ini = src.indexOf('const toggleField = async (field, value) => {');
  assert.ok(ini > 0, 'no se encontró toggleField');
  const cuerpo = src.slice(ini, src.indexOf('\n  };\n', ini));
  assert.ok(!/\[field\]: !value/.test(cuerpo), 'el rollback vuelve a usar !value');
  assert.match(cuerpo, /guardadoDeAjustes\.cambiar\(field, value\)/);
});
