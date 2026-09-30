/**
 * Pruebas de los dos textos que la migración 143 dejaba mintiendo.
 *
 * EL PROBLEMA ERA DE VOCABULARIO, no de carga. `getProfileById()`
 * devolvía `null` por tres motivos distintos —la cuenta no existe, existe
 * pero no la puedo leer, o falló la consulta— y `ProfileScreen` los
 * contaba los tres como «Este jugador no existe». Con la 143, el segundo
 * caso pasó a ser normal: un desconocido que apagó «Visible en
 * búsquedas» es privado, no inexistente.
 *
 * Lo que estas pruebas fijan:
 *   · el servicio separa el fallo de carga de la ausencia;
 *   · «cero filas» de `.single()` (PGRST116) NO es un fallo de carga;
 *   · la pantalla dejó de afirmar que la cuenta no existe;
 *   · un fallo de red lleva a «Reintentar» y no a «Volver».
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (...p) => path.join(__dirname, '..', '..', ...p);
const profileSrc = fs.readFileSync(src('services', 'profile.js'), 'utf8');
const screenSrc = fs.readFileSync(src('screens', 'ProfileScreen.js'), 'utf8');
const matchesSrc = fs.readFileSync(src('services', 'matches.js'), 'utf8');

// ── El servicio ──────────────────────────────────────────────────────

test('getProfileById devuelve { data, error }, no un null que mezcla tres casos', () => {
  const cuerpo = profileSrc.slice(profileSrc.indexOf('export async function getProfileById'));
  const fin = cuerpo.indexOf('\n}\n');
  const fn = cuerpo.slice(0, fin);
  assert.match(fn, /return \{ data: null, error \}/, 'un fallo de consulta tiene que viajar como error');
  assert.match(fn, /return \{ data: data \|\| null, error: null \}/, 'la ausencia viaja como data null SIN error');
});

test('«cero filas» no se confunde con un fallo de carga', () => {
  const cuerpo = profileSrc.slice(profileSrc.indexOf('export async function getProfileById'));
  assert.match(
    cuerpo.slice(0, cuerpo.indexOf('\n}\n')),
    /PGRST116/,
    'PGRST116 es la fila ausente de .single(): tratarla como error mandaría a «Reintentar» para siempre'
  );
});

// ── La pantalla ──────────────────────────────────────────────────────

test('la pantalla ya no afirma que el jugador no existe', () => {
  assert.doesNotMatch(screenSrc, /Este jugador no existe/);
  assert.doesNotMatch(
    screenSrc,
    /La cuenta pudo haberse eliminado\./,
    'tampoco el subtítulo: no se sabe si se eliminó o si es privada'
  );
});

test('el texto nuevo cubre los dos casos que no se pueden distinguir', () => {
  assert.match(screenSrc, /Este perfil no está disponible/);
  assert.match(screenSrc, /Puede ser un perfil privado o una cuenta que ya no existe\./);
});

test('un fallo de carga lleva a Reintentar, no a Volver', () => {
  // El estado 'perfil' es el de error y conserva el reintento; el de
  // 'no-disponible' ofrece volver. Si los dos cayeran en el mismo estado,
  // un corte de red dejaría al usuario sin forma de reintentar.
  assert.match(screenSrc, /if \(errorPerfil\) \{\s*setLoadError\('perfil'\);/);
  assert.match(screenSrc, /setLoadError\(propio \? 'perfil' : 'no-disponible'\);/);
  assert.doesNotMatch(screenSrc, /'no-existe'/, 'el estado viejo no puede quedar suelto');
});

// ── La tarjeta del partido ───────────────────────────────────────────

test('withOrganizers pide la identidad por RPC y no leyendo profiles', () => {
  const cuerpo = matchesSrc.slice(matchesSrc.indexOf('export async function withOrganizers'));
  const fn = cuerpo.slice(0, cuerpo.indexOf('\n}\n'));
  assert.match(fn, /supabase\.rpc\('organizadores_publicos'/);
  assert.doesNotMatch(
    fn,
    /from\('profiles'\)/,
    'leyendo profiles, un organizador que se ocultó dejaba la tarjeta sin nombre'
  );
});

test('withOrganizers manda ids de PARTIDO, que es lo que la RPC verifica', () => {
  const cuerpo = matchesSrc.slice(matchesSrc.indexOf('export async function withOrganizers'));
  const fn = cuerpo.slice(0, cuerpo.indexOf('\n}\n'));
  // Mandar `id_organizador` haría que la función no pudiera comprobar si
  // quien mira tiene derecho a ver ese partido.
  assert.match(fn, /list\.map\(\(m\) => m\.id\)/);
  assert.match(fn, /p_match_ids: ids/);
});
