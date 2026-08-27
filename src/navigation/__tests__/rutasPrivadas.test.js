/**
 * Pruebas estructurales de la protección de rutas.
 *
 * No montan React Navigation: leen el código de `AppNavigator.js` y verifican
 * que toda pantalla que no sea parte del flujo público de entrada pase por
 * `withAuthGuard`. Así, si mañana alguien agrega una pantalla con datos de
 * usuario (perfil, partidos, clubes, reservas, pagos) y olvida envolverla,
 * esta prueba falla en vez de dejar una ruta abierta.
 *
 * Cubre además el caso de escribir la URL a mano en web: todo destino
 * alcanzable por deep link tiene que estar protegido.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FUENTE = fs.readFileSync(
  path.join(__dirname, '..', 'AppNavigator.js'),
  'utf8'
);

/**
 * Rutas públicas a propósito: son el flujo de entrada y el onboarding que
 * ocurre justo después de registrarse. Ninguna muestra datos de otra persona
 * y ninguna está expuesta como URL en la config de deep links. Guardarlas
 * dejaría a alguien recién registrado sin poder terminar su propio registro.
 */
const PUBLICAS = new Set([
  'Splash',
  'Welcome',
  'Login',
  'Verification',
  'LocationPermission',
  'Terms',
  'Success',
  // Galería interna de QA de las primitivas de Reservas: no importa ningún
  // servicio ni el cliente de Supabase, no lee datos de nadie y no está en la
  // config de deep links. Excepción a propósito, documentada en la pantalla.
  'ReservasUiGallery',
]);

/** Nombres de ruta envueltos con `withAuthGuard(Pantalla, 'Ruta')`. */
function rutasGuardadas() {
  const guardadas = new Map(); // componente -> nombre de ruta
  const re = /const\s+(\w+)\s*=\s*withAuthGuard\(\s*\w+\s*,\s*'([^']+)'\s*\)/g;
  let m;
  while ((m = re.exec(FUENTE)) !== null) {
    guardadas.set(m[1], m[2]);
  }
  return guardadas;
}

/** Pares `name` → `component` de cada `<Stack.Screen>`. */
function pantallasDelStack() {
  const pantallas = [];
  const re = /<Stack\.Screen\s+name="(\w+)"\s+component=\{(\w+)\}/g;
  let m;
  while ((m = re.exec(FUENTE)) !== null) {
    pantallas.push({ name: m[1], component: m[2] });
  }
  return pantallas;
}

/** Nombres de ruta alcanzables escribiendo una URL (bloque `const linking`). */
function rutasConDeepLink(nombresDelStack) {
  const inicio = FUENTE.indexOf('const linking = {');
  assert.ok(inicio > -1, 'debe existir la config de deep links');
  const fin = FUENTE.indexOf('\n};', inicio);
  const bloque = FUENTE.slice(inicio, fin);
  const claves = new Set();
  const re = /(\w+)\s*:/g;
  let m;
  while ((m = re.exec(bloque)) !== null) {
    if (nombresDelStack.has(m[1])) claves.add(m[1]);
  }
  return claves;
}

test('el navegador declara pantallas y guardas reconocibles (si esto falla, el resto no prueba nada)', () => {
  const pantallas = pantallasDelStack();
  const guardadas = rutasGuardadas();
  assert.ok(pantallas.length >= 40, `se esperaban 40+ pantallas, se leyeron ${pantallas.length}`);
  assert.ok(guardadas.size >= 30, `se esperaban 30+ guardas, se leyeron ${guardadas.size}`);
});

test('toda pantalla que no sea del flujo público pasa por withAuthGuard', () => {
  const guardadas = rutasGuardadas();
  const sinProteger = pantallasDelStack()
    .filter((p) => !PUBLICAS.has(p.name))
    .filter((p) => !guardadas.has(p.component))
    .map((p) => `${p.name} (component=${p.component})`);

  assert.deepEqual(
    sinProteger,
    [],
    `estas rutas privadas quedaron sin withAuthGuard: ${sinProteger.join(', ')}`
  );
});

test('un visitante sin sesión no puede abrir por URL ninguna ruta con deep link', () => {
  const pantallas = pantallasDelStack();
  const guardadas = rutasGuardadas();
  const nombres = new Set(pantallas.map((p) => p.name));
  const conDeepLink = rutasConDeepLink(nombres);

  assert.ok(conDeepLink.size > 0, 'la config de deep links debe mapear al menos una ruta');

  const porNombre = new Map(pantallas.map((p) => [p.name, p.component]));
  const expuestas = [...conDeepLink].filter((ruta) => {
    if (PUBLICAS.has(ruta)) return false;
    return !guardadas.has(porNombre.get(ruta));
  });

  assert.deepEqual(
    expuestas,
    [],
    `estas rutas se pueden abrir por URL sin sesión: ${expuestas.join(', ')}`
  );
});

test('el nombre que recibe la guarda coincide con el de la ruta (si no, el destino pendiente vuelve mal)', () => {
  const guardadas = rutasGuardadas();
  const desalineadas = pantallasDelStack()
    .filter((p) => guardadas.has(p.component))
    .filter((p) => guardadas.get(p.component) !== p.name)
    .map((p) => `${p.name} → guarda dice '${guardadas.get(p.component)}'`);

  assert.deepEqual(desalineadas, [], desalineadas.join(', '));
});

test('las pantallas con datos de usuario, partidos, clubes y reservas están entre las guardadas', () => {
  const guardadas = new Set(rutasGuardadas().values());
  // Un recordatorio explícito: si alguna de estas sale de la lista de guardas,
  // se está exponiendo información de una persona.
  for (const ruta of [
    'Main',
    'UserProfile',
    'EditProfile',
    'Settings',
    'Friends',
    'Notifications',
    'ChatThread',
    'ChatDetails',
    'MatchDetail',
    'ManageMatch',
    'MatchSpot',
    'CreateMatch',
    'ClubDetail',
    'ClubMembers',
    'ClubPlans',
    'Resumen',
    'ElegirCancha',
    'BlockedUsers',
    'TrustScoreHistory',
  ]) {
    assert.ok(guardadas.has(ruta), `la ruta privada ${ruta} debe estar protegida`);
  }
});
