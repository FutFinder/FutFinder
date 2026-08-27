/**
 * Pruebas del cableado de sesión.
 *
 * Verifican, leyendo el código fuente, las conexiones de las que depende la
 * seguridad de la sesión y que no se ven en una prueba de lógica pura:
 * que la sesión se restaure al recargar, que cerrar sesión se propague, que
 * nadie vuelva a tratar "sin configuración" como "autenticado" y que no se
 * escriban contraseñas ni tokens en la consola.
 *
 * Son pruebas de regresión del fallo que originó este archivo: un login que
 * caía a `signUp` dejaba entrar con cualquier correo inventado, y
 * `isAuthenticated` daba true sin sesión cuando faltaban las variables de
 * entorno.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');

function leer(relativo) {
  return fs.readFileSync(path.join(RAIZ, relativo), 'utf8');
}

/** Todos los archivos .js de src/, sin las pruebas. */
function fuentesDeLaApp() {
  const salida = [];
  (function recorrer(dir) {
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name !== '__tests__') recorrer(completo);
      } else if (entrada.name.endsWith('.js')) {
        salida.push({ ruta: path.relative(RAIZ, completo), texto: fs.readFileSync(completo, 'utf8') });
      }
    }
  })(RAIZ);
  return salida;
}

// --- Restauración de sesión ----------------------------------------------

test('el cliente de Supabase persiste y refresca la sesión (se recupera al recargar)', () => {
  const fuente = leer('services/supabase.js');
  assert.match(fuente, /persistSession:\s*true/, 'persistSession debe estar activo');
  assert.match(fuente, /autoRefreshToken:\s*true/, 'autoRefreshToken debe estar activo');
  assert.match(fuente, /AsyncStorage/, 'en nativo la sesión se guarda en AsyncStorage');
});

test('el contexto pide la sesión guardada al montar y escucha los cambios', () => {
  const fuente = leer('contexts/AuthContext.js');
  assert.match(fuente, /supabase\.auth\.getSession\(\)/, 'debe restaurar la sesión guardada');
  assert.match(fuente, /onAuthStateChange/, 'debe escuchar cambios de sesión');
  assert.match(fuente, /unsubscribe/, 'debe soltar la suscripción al desmontar');
});

test('la navegación no se monta hasta que la sesión esté resuelta (no se filtra contenido privado)', () => {
  const fuente = leer('navigation/AppNavigator.js');
  assert.match(fuente, /if\s*\(!isReady\)/, 'debe esperar isReady antes de montar el navegador');
});

// --- El bypass que causaba el fallo --------------------------------------

test('isAuthenticated exige una sesión usable, no la ausencia de configuración', () => {
  const fuente = leer('contexts/AuthContext.js');
  assert.match(
    fuente,
    /const\s+isAuthenticated\s*=\s*isSessionUsable\(session\)/,
    'isAuthenticated debe calcularse con isSessionUsable(session)'
  );
  assert.doesNotMatch(
    fuente,
    /isAuthenticated\s*=\s*!isSupabaseConfigured/,
    'sin configuración NO se puede considerar autenticado'
  );
});

test('ningún archivo trata "sin Supabase configurado" como sesión válida', () => {
  const sospechosos = fuentesDeLaApp()
    .filter(({ texto }) => /!isSupabaseConfigured\s*\|\|\s*(!!)?session/.test(texto))
    .map(({ ruta }) => ruta);
  assert.deepEqual(sospechosos, [], `reintroducen el bypass de modo demo: ${sospechosos.join(', ')}`);
});

test('el login ya no existe como "inicia sesión o registra" (signInOrUp)', () => {
  const usos = fuentesDeLaApp()
    .filter(({ texto }) => /signInOrUp/.test(texto))
    .map(({ ruta }) => ruta);
  assert.deepEqual(usos, [], `signInOrUp reintroducido en: ${usos.join(', ')}`);
});

test('la pantalla de login no registra usuarios al iniciar sesión', () => {
  const fuente = leer('screens/LoginScreen.js');
  assert.match(fuente, /loginWithEmail/, 'debe usar loginWithEmail');
  // El registro solo se llama en el modo explícito de registro.
  const llamadasARegistro = fuente.match(/registerWithEmail\(/g) || [];
  assert.equal(llamadasARegistro.length, 1, 'registerWithEmail se llama una sola vez, en el modo registro');
  assert.match(
    fuente,
    /isSignUp\s*\n?\s*\?\s*await registerWithEmail/,
    'el registro debe estar detrás del modo explícito isSignUp'
  );
});

test('el registro no usa auth.signUp en ninguna parte (dejaría cuentas usables sin verificar)', () => {
  const usos = fuentesDeLaApp()
    .filter(({ texto }) => /\bauth\.signUp\(|authClient\.signUp\(/.test(soloCodigo(texto)))
    .map(({ ruta }) => ruta);
  assert.deepEqual(
    usos,
    [],
    `signUp crea una cuenta con contraseña que, con la autoconfirmación activa, sirve para iniciar sesión sin haber demostrado el correo: ${usos.join(', ')}`
  );
});

test('el registro manda un código con signInWithOtp y no crea contraseña usable antes de verificar', () => {
  const politica = leer('services/authPolicy.js');
  assert.match(politica, /authClient\.signInWithOtp\(/, 'performSignUp debe usar signInWithOtp');
  assert.match(politica, /shouldCreateUser:\s*true/, 'el registro sí crea la cuenta, pero sin contraseña');
});

test('la contraseña en tránsito vive solo en memoria, nunca en disco ni en la navegación', () => {
  const holder = soloCodigo(leer('services/pendingSignUp.js'));
  assert.doesNotMatch(holder, /AsyncStorage|localStorage|sessionStorage/, 'no se persiste');
  assert.match(holder, /pendiente = null/, 'se borra al consumirla');

  // La contraseña no puede viajar como parámetro de navegación.
  const login = leer('screens/LoginScreen.js');
  assert.doesNotMatch(
    login,
    /navigation\.navigate\('Verification',\s*\{[^}]*password/,
    'la contraseña no se pasa por parámetros de navegación'
  );
});

test('el login solo navega a una ruta privada usando decideAuthDestination', () => {
  const fuente = leer('screens/LoginScreen.js');
  assert.match(fuente, /decideAuthDestination/, 'el destino lo decide la política, no la pantalla');
  assert.match(fuente, /destino === 'login'/, 'sin sesión usable no se entra');
});

// --- Cierre de sesión ----------------------------------------------------

test('cerrar sesión llama al proveedor y saca al usuario del área privada', () => {
  const settings = leer('screens/SettingsScreen.js');
  assert.match(settings, /import\s+\{\s*signOut\s*\}/, 'Ajustes importa signOut');
  assert.match(settings, /await\s+signOut\(\)/, 'Ajustes llama a signOut');

  const auth = leer('services/auth.js');
  assert.match(auth, /supabase\.auth\.signOut\(\)/, 'signOut debe llamar al proveedor');

  // La guarda reacciona a la pérdida de sesión con un reset: sin historial que
  // permita volver atrás a una pantalla privada.
  const guarda = leer('navigation/withAuthGuard.js');
  assert.match(guarda, /reset\(\{/, 'debe usar reset, no navigate, al perder la sesión');
  assert.match(guarda, /routes:\s*\[\{\s*name:\s*'Login'\s*\}\]/, 'el reset deja solo Login en el historial');
  assert.match(guarda, /if\s*\(!isAuthenticated\)/, 'sin sesión no se renderiza la pantalla privada');
});

// --- Secretos y registros ------------------------------------------------

test('no se escriben contraseñas ni tokens en la consola', () => {
  const filtraciones = [];
  for (const { ruta, texto } of fuentesDeLaApp()) {
    const lineas = texto.split('\n');
    lineas.forEach((linea, i) => {
      if (!/console\.(log|warn|error|info|debug)/.test(linea)) return;
      if (/\b(password|contrasena|contraseña|access_token|refresh_token|anon_key|apiKey|secret)\b/i.test(linea)) {
        filtraciones.push(`${ruta}:${i + 1}`);
      }
    });
  }
  assert.deepEqual(filtraciones, [], `posibles filtraciones en consola: ${filtraciones.join(', ')}`);
});

/** Quita comentarios: varias notas del repo mencionan `service_role` justamente
 *  para documentar que esa operación NO se hace desde el cliente. */
function soloCodigo(texto) {
  return texto
    .split('\n')
    .filter((linea) => {
      const t = linea.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

test('no hay claves de servicio ni secretos administrativos en el código cliente', () => {
  const sospechosos = fuentesDeLaApp()
    .filter(({ texto }) =>
      /service_role|SERVICE_ROLE|SUPABASE_SERVICE|secret_key|SECRET_KEY/.test(soloCodigo(texto))
    )
    .map(({ ruta }) => ruta);
  assert.deepEqual(sospechosos, [], `claves administrativas en cliente: ${sospechosos.join(', ')}`);
});

test('no hay tokens JWT escritos a mano en el código', () => {
  const sospechosos = fuentesDeLaApp()
    .filter(({ texto }) => /['"`]eyJ[A-Za-z0-9_-]{10,}/.test(soloCodigo(texto)))
    .map(({ ruta }) => ruta);
  assert.deepEqual(sospechosos, [], `tokens escritos a mano en: ${sospechosos.join(', ')}`);
});

test('las credenciales del cliente vienen de variables de entorno EXPO_PUBLIC, no escritas a mano', () => {
  const fuente = leer('services/supabase.js');
  assert.match(fuente, /process\.env\.EXPO_PUBLIC_SUPABASE_URL/);
  assert.match(fuente, /process\.env\.EXPO_PUBLIC_SUPABASE_ANON_KEY/);
  // Una URL de proyecto real escrita en el código sería un secreto versionado.
  assert.doesNotMatch(
    fuente.replace(/placeholder\.supabase\.co/g, ''),
    /https:\/\/[a-z0-9]{20}\.supabase\.co/,
    'no debe haber una URL de proyecto real en el código'
  );
});
