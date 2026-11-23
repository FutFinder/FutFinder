/**
 * Las cabeceras de seguridad de la web (`vercel.json`) y lo que las vuelve
 * inútiles sin avisar.
 *
 * POR QUÉ IMPORTA. La sesión de Supabase vive en localStorage en web: un
 * script inyectado la lee entera y se la lleva. Una CSP estricta es la
 * defensa que queda (cookies httpOnly no son viables en una SPA estática
 * sin servidor propio; ver `docs/memoria/arquitectura/seguridad-y-privacidad.md`).
 * Esa CSP se degrada con un solo valor cómodo: `'unsafe-inline'` en
 * `script-src` y listo, ya no frena nada, y la web sigue andando igual. Esta
 * prueba falla cuando eso pasa.
 *
 * También vigila el otro lado: que cada servidor al que el código web llama
 * esté permitido. Una CSP que bloquea el mapa o Supabase rompe la web en
 * producción y no hay forma de verlo desde `npm test`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(RAIZ, 'vercel.json'), 'utf8'));

function cabeceras() {
  const regla = (config.headers || []).find((h) => h.source === '/(.*)');
  if (!regla) return {};
  return Object.fromEntries(regla.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

function directivas() {
  const csp = cabeceras()['content-security-policy'] || '';
  const mapa = {};
  for (const trozo of csp.split(';')) {
    const [nombre, ...valores] = trozo.trim().split(/\s+/);
    if (nombre) mapa[nombre] = valores;
  }
  return mapa;
}

test('toda la web sale con CSP y las cabeceras básicas', () => {
  const c = cabeceras();
  for (const k of [
    'content-security-policy',
    'strict-transport-security',
    'x-content-type-options',
    'x-frame-options',
    'referrer-policy',
    'permissions-policy',
  ]) {
    assert.ok(c[k], `falta la cabecera ${k} en vercel.json`);
  }
  assert.equal(c['x-content-type-options'], 'nosniff');
  assert.equal(c['x-frame-options'], 'DENY');
});

test('script-src no admite código en línea ni eval', () => {
  const d = directivas();
  assert.ok(d['script-src'], 'falta script-src');
  for (const malo of ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:', 'data:']) {
    assert.ok(
      !d['script-src'].includes(malo),
      `script-src admite ${malo}: un script inyectado leería la sesión de localStorage`
    );
  }
});

test('nadie puede meter la web en un marco, ni cargar plugins, ni cambiar la base', () => {
  const d = directivas();
  assert.deepEqual(d['frame-ancestors'], ["'none'"]);
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'self'"]);
  assert.ok(d['default-src'] && !d['default-src'].includes('*'), 'default-src no puede ser *');
});

test('connect-src deja pasar a Supabase (HTTP y websocket) y nada genérico', () => {
  const d = directivas();
  const host = 'jvfoendzblkoxvwvommz.supabase.co';
  assert.ok(d['connect-src'].includes(`https://${host}`), 'Supabase por HTTPS no está permitido');
  assert.ok(d['connect-src'].includes(`wss://${host}`), 'el realtime de Supabase no está permitido');
  for (const malo of ['*', 'https:', 'wss:', 'http:']) {
    assert.ok(!d['connect-src'].includes(malo), `connect-src admite ${malo}: abriría la salida de datos`);
  }
});

test('el mapa web (Mapbox GL) tiene todo lo que necesita', () => {
  const d = directivas();
  assert.ok(d['script-src'].includes('https://api.mapbox.com'));
  assert.ok(d['style-src'].includes('https://api.mapbox.com'));
  assert.ok(d['connect-src'].includes('https://api.mapbox.com'));
  assert.ok(d['connect-src'].includes('https://events.mapbox.com'));
  assert.ok(d['worker-src'].includes('blob:'), 'Mapbox GL corre en un worker blob:');
});

test('las llamadas externas del código web están todas en connect-src', () => {
  const connect = directivas()['connect-src'] || [];
  const origenes = new Set();
  const visitar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__') continue;
        visitar(p);
      } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
        const texto = fs.readFileSync(p, 'utf8');
        for (const m of texto.matchAll(/fetch\(\s*[`'"](https:\/\/[^/`'"$]+)/g)) origenes.add(m[1]);
      }
    }
  };
  visitar(path.join(RAIZ, 'src'));
  for (const o of origenes) {
    assert.ok(connect.includes(o), `el código hace fetch a ${o} y la CSP lo bloquearía en producción`);
  }
});

test('el código no escribe HTML a mano ni evalúa texto', () => {
  const hallazgos = [];
  const visitar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === '__tests__') continue;
        visitar(p);
      } else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) {
        const texto = fs.readFileSync(p, 'utf8');
        if (/dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write\(|\beval\(|new Function\(/.test(texto)) {
          hallazgos.push(path.relative(RAIZ, p));
        }
      }
    }
  };
  visitar(path.join(RAIZ, 'src'));
  assert.deepEqual(hallazgos, [], 'inyección de HTML o evaluación de texto en: ' + hallazgos.join(', '));
});
