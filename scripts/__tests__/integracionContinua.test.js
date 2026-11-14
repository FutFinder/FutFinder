/**
 * La integración continua tiene que correr lo mismo que `npm run verify`, y
 * no puede dar por buenas las pruebas de Deno sin haberlas corrido.
 * Se ejecutan con: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RAIZ = path.join(__dirname, '..', '..');
const SCRIPT = path.join(RAIZ, 'scripts', 'pruebas-edge.mjs');

// Un PATH sin nada: `deno` no se encuentra, pase lo que pase en esta máquina.
function sinDeno(extra) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { PATH: path.join(RAIZ, 'no-existe'), ...extra },
    encoding: 'utf8',
  });
}

test('sin Deno y sin exigirlo, las pruebas de Edge avisan y no bloquean', () => {
  const r = sinDeno({});
  assert.equal(r.status, 0);
  assert.match(r.stdout, /DENO NO ESTÁ INSTALADO/);
});

test('con EXIGIR_DENO=1, la falta de Deno es un fallo', () => {
  const r = sinDeno({ EXIGIR_DENO: '1' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /DENO NO ESTÁ INSTALADO/);
});

test('el workflow corre lint, pruebas, Deno obligatorio y build web, sin secretos', () => {
  const yml = fs.readFileSync(path.join(RAIZ, '.github', 'workflows', 'ci.yml'), 'utf8');
  const pasos = yml.replace(/^\s*#.*$/gm, '');
  for (const comando of ['npm ci', 'npm run lint', 'npm test', 'npm run test:edge', 'npm run build:web']) {
    assert.ok(pasos.includes(`run: ${comando}`), `falta el paso «${comando}»`);
  }
  assert.match(pasos, /EXIGIR_DENO:\s*'1'/);
  assert.match(pasos, /denoland\/setup-deno/);
  assert.doesNotMatch(pasos, /secrets\./);
});
