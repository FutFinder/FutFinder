/**
 * Los comentarios de `send-push` describían otra función.
 *
 *   · La cabecera decía que la llama un «Database Webhook». Desde las
 *     migraciones 117 y 118 la llama el disparador `notificar_push` con
 *     `pg_net`, autenticado con la clave PUBLICABLE guardada en Vault (no la
 *     service key).
 *   · El catch decía que un aviso en `failed` «igual es recuperable: el claim
 *     por staleness la vuelve a tomar». Falso: el reclamo sólo toma
 *     `pending` o `sending` vencido, y nadie vuelve a invocar la función
 *     para una fila vieja (el disparador es AFTER INSERT y `pg_net` no
 *     reintenta). `failed` es terminal, y se decidió dejarlo así: un barrido
 *     que reenviara `failed` podría duplicar un push que sí alcanzó a salir.
 *
 * Si algún día se agrega un reintento de verdad, esta prueba tiene que
 * cambiar junto con el reclamo.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'functions', 'send-push', 'index.ts'),
  'utf8'
);

test('la cabecera nombra el disparador notificar_push, no un webhook', () => {
  const cabecera = SRC.slice(0, SRC.indexOf('import '));
  assert.ok(!/Database Webhook/i.test(cabecera), 'la cabecera vuelve a hablar de un Database Webhook');
  assert.match(cabecera, /notificar_push/);
  assert.match(cabecera, /clave publicable/i);
});

test('ningún comentario promete que un failed se recupera, mientras el reclamo no lo tome', () => {
  const reclamo = SRC.match(/\.or\(`([^`]+)`\)/);
  assert.ok(reclamo, 'no se encontró el filtro del reclamo');
  const tomaFailed = /push_status\.eq\.failed/.test(reclamo[1]);
  if (!tomaFailed) {
    assert.ok(
      !/recuperable/i.test(SRC),
      'un comentario dice que failed es recuperable, pero el reclamo no lo toma'
    );
  }
});
