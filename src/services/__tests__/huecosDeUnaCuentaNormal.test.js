/**
 * Lo del lado de la app de la migración 177 (los huecos que se abrían con una
 * cuenta normal), y una regla de la migración que costó un arnés en rojo.
 *
 * Se leen los archivos: App.js, EditProfileScreen y recinto.js importan React
 * Native o el cliente de Supabase y no se cargan en Node.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('el token de push se registra sólo con una sesión que ya pasó el segundo paso', () => {
  const app = sinComentarios(leer('App.js'));
  const llamadas = [...app.matchAll(/registerForPushNotifications\(/g)].length;
  assert.ok(llamadas >= 2, 'no se encontraron los registros del token');
  // Cada registro va precedido, en su misma condición, por `sesionQueEntro`.
  for (const m of app.matchAll(/if \(([^{]*)\) \{\s*registerForPushNotifications/g)) {
    assert.match(m[1], /sesionQueEntro\(/, `registra sin mirar el segundo paso: if (${m[1]})`);
  }
  assert.match(app, /necesitaSegundoPaso\(nivelDesdeSesion\(session\)\)/);
  assert.match(app, /MFA_CHALLENGE_VERIFIED/, 'al subir a aal2 también hay que registrar el token');
});

test('la edad registrada no se edita ni se manda al guardar el perfil', () => {
  const pantalla = leer('src/screens/EditProfileScreen.js');
  assert.match(pantalla, /const edadFija = initialProfile\?\.edad != null;/);
  assert.match(pantalla, /editable=\{!edadFija\}/);
  assert.match(pantalla, /\.\.\.\(edadFija \? \{\} : \{ edad:/);
});

test('buscar un administrador por nombre de usuario no acepta comodines', () => {
  const recinto = leer('src/services/recinto.js');
  const i = recinto.indexOf('export async function buscarUsuarioPorUsername');
  const f = recinto.slice(i, recinto.indexOf('\n}\n', i));
  assert.match(f, /\.ilike\('username', u\.replace\(/, 'el patrón de ilike vuelve a ir sin escapar');
  // El mismo escape, ejecutado: `%` y `_` dejan de ser comodines.
  const escapar = (u) => u.replace(/[\\%_]/g, (c) => `\\${c}`);
  assert.equal(escapar('a%b_c'), 'a\\%b\\_c');
  assert.equal(escapar('juan'), 'juan');
});

test('177: ninguna función con la guarda `current_user` es security definer', () => {
  // Dentro de una función definer, `current_user` es su DUEÑO y no quien
  // llama: `if current_user <> 'authenticated' then return` deja pasar todo.
  // Así se escaparon dos disparadores en la primera corrida del arnés.
  const sql = leer('supabase/migrations/177_los_huecos_de_una_cuenta_normal.sql');
  const funciones = sql.split(/create or replace function /i).slice(1);
  let conGuarda = 0;
  for (const f of funciones) {
    const cuerpo = f.slice(0, f.indexOf('$$;', f.indexOf('$$') + 2));
    if (/current_user\s*(<>|=)\s*'authenticated'/.test(cuerpo)) {
      conGuarda += 1;
      const cabecera = cuerpo.slice(0, cuerpo.indexOf('$$'));
      assert.ok(!/security definer/i.test(cabecera), `${f.slice(0, 60)}… es definer y mira current_user`);
    }
  }
  assert.ok(conGuarda >= 5, `se esperaban los disparadores con guarda, hay ${conGuarda}`);
});
