/**
 * Un cambio en una Edge Function NO está en producción hasta redesplegarla,
 * y nada avisaba.
 *
 * EL FALLO QUE MOTIVA ESTO (2026-10-16). `send-push` llevaba **dos meses**
 * corriendo una versión anterior de `pushLogic.ts`: el commit del 17 de
 * agosto le agregó `club_resultado_propuesto`, `club_resultado_confirmado`
 * y `club_resultado_disputado` al mapa de preferencias, y el último
 * despliegue era del 15. `getPreferenceColumn` devolvía null para esos tres
 * tipos, la comprobación de preferencia se saltaba entera y **el push salía
 * aunque la persona tuviera los avisos de clubes apagados**. No se notaba:
 * la función «falla abierto» a propósito, así que el síntoma es un push de
 * más, no un error.
 *
 * Ya había una prueba —`avisosCompletos.test.js`— que compara el mapa de la
 * app con el de `pushLogic.ts`. Pasaba: los dos ARCHIVOS del repositorio
 * estaban de acuerdo. Lo que nadie miraba era el tercero, el que corre.
 *
 * POR HASH Y NO POR FECHA. La primera versión de esto comparaba el último
 * commit del archivo contra la fecha del despliegue, y daba falso positivo
 * en cinco de seis: el patrón normal es desplegar y commitear un minuto
 * después, así que el commit siempre es más nuevo. Lo que de verdad dice si
 * lo desplegado es lo del repositorio es el CONTENIDO.
 *
 * `npm test` no sale a la red, así que el hash de lo desplegado lo lleva
 * `supabase/functions/despliegues.json` y actualizarlo es parte de
 * desplegar. Es a propósito: obliga a pasar por acá.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const DIR = path.join(RAIZ, 'supabase', 'functions');
const registro = JSON.parse(fs.readFileSync(path.join(DIR, 'despliegues.json'), 'utf8'));

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

test('el registro nombra todas las carpetas de funciones que hay, y sólo ésas', () => {
  const carpetas = fs
    .readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== '_shared')
    .map((d) => d.name)
    .sort();
  assert.deepEqual(Object.keys(registro.funciones).sort(), carpetas);
});

test('cada función registra su index.ts y TODO lo que importa de _shared', () => {
  // Si un `_shared/` no está en la lista, un cambio en ese archivo no haría
  // fallar nada — que es exactamente el modo de fallo que esto persigue.
  for (const [nombre, info] of Object.entries(registro.funciones)) {
    const propio = `${nombre}/index.ts`;
    assert.ok(info.archivos[propio], `${nombre}: falta ${propio}`);
    const fuente = fs.readFileSync(path.join(DIR, nombre, 'index.ts'), 'utf8');
    for (const m of fuente.matchAll(/from\s+"\.\.\/_shared\/([\w.-]+)"/g)) {
      const esperado = `_shared/${m[1]}`;
      assert.ok(
        info.archivos[esperado],
        `${nombre}: importa ${esperado} y no está en despliegues.json`
      );
    }
  }
});

test('ninguna función desplegada quedó atrás de su código', () => {
  const atrasadas = [];
  for (const [nombre, info] of Object.entries(registro.funciones)) {
    for (const [rel, hash] of Object.entries(info.archivos)) {
      const completo = path.join(DIR, rel);
      if (!fs.existsSync(completo)) {
        atrasadas.push(`${nombre}: ${rel} ya no existe en el repositorio`);
        continue;
      }
      const ahora = sha(completo);
      if (ahora !== hash) {
        atrasadas.push(
          `${nombre}: ${rel} cambió desde la versión ${info.version} (${info.desplegada})`
        );
      }
    }
  }
  assert.deepEqual(
    atrasadas,
    [],
    'hay Edge Functions corriendo código viejo. Redespliega y actualiza ' +
      `supabase/functions/despliegues.json:\n  ${atrasadas.join('\n  ')}`
  );
});
