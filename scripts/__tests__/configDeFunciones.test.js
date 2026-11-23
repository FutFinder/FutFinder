/**
 * Cada Edge Function declara su `verify_jwt` en `supabase/config.toml`, y
 * los comentarios de ese archivo dicen la verdad sobre quién la llama.
 *
 *   · `reportar-problema` no estaba: quedaba con el valor por omisión
 *     (true) sin que nadie lo hubiera decidido. Una función que se agrega
 *     sin pasar por acá es una puerta que nadie miró.
 *   · El comentario de `send-push` decía que la dispara un Database Webhook
 *     «que sí manda la service key». Desde la 118 la llama el disparador
 *     `notificar_push` con la clave PUBLICABLE de Vault.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const CONFIG = fs.readFileSync(path.join(RAIZ, 'supabase', 'config.toml'), 'utf8');
const FUNCIONES = fs
  .readdirSync(path.join(RAIZ, 'supabase', 'functions'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
  .map((d) => d.name);

/** El bloque `[functions.x]` hasta el próximo encabezado. */
function bloque(nombre) {
  const ini = CONFIG.indexOf(`[functions.${nombre}]`);
  if (ini < 0) return null;
  const resto = CONFIG.slice(ini + 1);
  const fin = resto.search(/\n\[|\n# ──/);
  return fin < 0 ? resto : resto.slice(0, fin);
}

for (const f of FUNCIONES) {
  test(`${f} declara verify_jwt explícito`, () => {
    const b = bloque(f);
    assert.ok(b, `[functions.${f}] no está en config.toml`);
    assert.match(b, /^verify_jwt = (true|false)$/m, `[functions.${f}] no dice verify_jwt`);
  });
}

test('reportar-problema exige sesión', () => {
  assert.match(bloque('reportar-problema') || '', /^verify_jwt = true$/m);
});

test('el comentario de send-push no habla de webhook ni de service key', () => {
  const b = bloque('send-push') || '';
  assert.ok(!/webhook/i.test(b), 'vuelve a decir que la dispara un webhook');
  assert.ok(!/manda la service key/i.test(b), 'vuelve a decir que manda la service key');
  assert.match(b, /clave PUBLICABLE/i);
  assert.match(b, /notificar_push/);
});
