/**
 * Pruebas del cliente contra la migración 148.
 *
 * La 148 le quita a `anon` y a `authenticated` el `select` de TABLA sobre
 * `profiles` y les concede sólo las columnas públicas. Un `select('*')`
 * pasa a fallar entero con «permission denied» — también para el perfil
 * propio, porque los privilegios por columna no son por fila.
 *
 * ESTAS PRUEBAS CUIDAN LAS DOS DIRECCIONES:
 *   · que no vuelva un `select('*')` sobre `profiles`, que rompería el
 *     perfil entero en cuanto la migración esté aplicada;
 *   · y que la lista de columnas públicas no se cuele una privada, que
 *     sería el mismo fallo al revés — pedir algo denegado hace fallar la
 *     consulta completa, no sólo esa columna.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (...p) => path.join(__dirname, '..', '..', ...p);
const columnas = require(src('services', 'perfilColumnas.js'));
const profileSrc = fs.readFileSync(src('services', 'profile.js'), 'utf8');
const authSrc = fs.readFileSync(src('services', 'auth.js'), 'utf8');
const migracion = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'supabase', 'migrations',
    '149_las_preferencias_no_son_publicas.sql'),
  'utf8'
);

test('ningún servicio pide `select(*)` sobre profiles', () => {
  for (const [nombre, src] of [['profile.js', profileSrc], ['auth.js', authSrc]]) {
    const bloques = [...src.matchAll(/from\('profiles'\)[\s\S]{0,80}?\.select\(([^)]*)\)/g)];
    for (const b of bloques) {
      assert.doesNotMatch(
        b[1],
        /^\s*'\*'\s*$/,
        `${nombre} pide select('*') sobre profiles: con la 148 aplicada eso falla entero`
      );
    }
  }
});

test('la lista pública y la privada no se solapan', () => {
  const publicas = columnas.COLUMNAS_PUBLICAS.split(',').map((c) => c.trim());
  const coladas = columnas.AJUSTES_PRIVADOS.filter((p) => publicas.includes(p));
  assert.deepEqual(coladas, [], `columnas privadas en la lista pública: ${coladas.join(', ')}`);
});

test('la lista privada del cliente es exactamente la que revoca la migración', () => {
  // Si se desincronizan, el cliente pide una columna denegada y la
  // consulta entera falla — o deja de pedir una que sí podía.
  const bloque = migracion.slice(migracion.indexOf("column_name not in ("));
  const enLaMigracion = [...bloque.slice(0, bloque.indexOf(');')).matchAll(/'([a-z_]+)'/g)]
    .map((m) => m[1]);
  assert.deepEqual(
    [...columnas.AJUSTES_PRIVADOS].sort(),
    [...new Set(enLaMigracion)].sort(),
    'la lista del cliente y la de la migración se separaron'
  );
});

test('las preferencias propias llegan por la RPC, no leyendo la tabla', () => {
  assert.match(profileSrc, /supabase\.rpc\('mis_ajustes'\)/);
  // Y se pegan al perfil, para que las pantallas no noten el cambio.
  assert.match(profileSrc, /\.\.\.data, \.\.\.ajustes, email: user\.email/);
  assert.match(authSrc, /\.\.\.data, \.\.\.ajustes/);
});

test('un fallo al leer los ajustes no inventa valores', () => {
  const i = profileSrc.indexOf('export async function misAjustes');
  const fn = profileSrc.slice(i, profileSrc.indexOf('\n}\n', i));
  assert.match(fn, /return \{\}/, 'ante un error devuelve vacío, no un radio que nadie eligió');
  assert.doesNotMatch(fn, /\?\?\s*10/, 'no se rellena el radio por omisión acá: eso lo decide la pantalla');
});

test('la migración deja a service_role fuera del revoke', () => {
  // `send-push` lee las preferencias de aviso con service_role para
  // decidir si manda el push. Si entrara en el revoke, dejaría de mandar.
  const i = migracion.indexOf('revoke select on public.profiles');
  assert.notEqual(i, -1);
  const linea = migracion.slice(i, migracion.indexOf('\n', i));
  assert.doesNotMatch(linea, /service_role/, 'service_role no puede entrar en el revoke');
  assert.match(linea, /from anon, authenticated/);
});
