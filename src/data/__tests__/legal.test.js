const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ACTUALIZADO, CORREO_PRIVACIDAD, DOCUMENTOS_LEGALES } = require('../legal.js');
const { debeMostrarseAviso, VERSION_AVISO_COOKIES } = require('../../utils/avisoCookies.js');

const RAIZ = path.join(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('los cuatro documentos existen y cada sección tiene algo que leer', () => {
  assert.deepEqual(Object.keys(DOCUMENTOS_LEGALES).sort(), ['cookies', 'eliminarCuenta', 'privacidad', 'terminos']);
  for (const [clave, doc] of Object.entries(DOCUMENTOS_LEGALES)) {
    assert.ok(doc.titulo && doc.resumen, `${clave}: falta título o resumen`);
    assert.ok(doc.secciones.length > 0, `${clave}: sin secciones`);
    for (const s of doc.secciones) {
      const textos = [...(s.parrafos || []), ...(s.lista || []), ...(s.parrafosFinales || [])];
      assert.ok(s.titulo, `${clave}: sección sin título`);
      assert.ok(textos.length > 0, `${clave} → «${s.titulo}» está vacía`);
      for (const t of textos) assert.ok(!/\bTODO\b|XXX|[Ll]orem ipsum/.test(t), `${clave}: texto de relleno en «${s.titulo}»`);
    }
  }
  assert.match(ACTUALIZADO, /\d{4}$/);
  assert.match(CORREO_PRIVACIDAD, /^[^@\s]+@[^@\s]+\.[a-z]+$/);
});

test('la política de cookies nombra cada clave que la app guarda en el dispositivo', () => {
  // Si alguien agrega algo al almacenamiento local, la política tiene que
  // decirlo. Este cruce es grueso a propósito: obliga a mirar el texto.
  const claves = {
    'src/utils/rememberedAccount.js': 'Cuenta recordada',
    'src/contexts/ClubsHomeContext.js': 'club que tenías abierto',
    'src/services/messages.js': 'mensajes de club ya leíste',
    'src/utils/avisoPanelRecinto.js': 'avisos de bienvenida',
    'src/services/connectivity.js': 'Copia temporal',
    'src/utils/avisoCookies.js': 'Aviso de cookies',
  };
  const texto = JSON.stringify(DOCUMENTOS_LEGALES.cookies);
  for (const [archivo, frase] of Object.entries(claves)) {
    assert.match(leer(archivo), /AsyncStorage\.setItem/, `${archivo} ya no guarda nada: actualiza esta prueba`);
    assert.ok(texto.includes(frase), `la política de cookies no menciona lo que guarda ${archivo}`);
  }
});

test('la app no enlaza más a términos ni políticas en una web externa que no responde', () => {
  for (const archivo of ['src/screens/SettingsScreen.js', 'src/screens/RegisterScreen.js', 'src/screens/WelcomeScreen.js']) {
    const fuente = leer(archivo);
    for (const [web, ruta] of [['futfinder.cl/privacidad', 'Privacidad'], ['futfinder.cl/terminos', 'Terminos']]) {
      assert.ok(!fuente.includes(web), `${archivo} sigue abriendo ${web}`);
      assert.ok(fuente.includes(`navigate('${ruta}')`), `${archivo} no lleva a la pantalla ${ruta}`);
    }
  }
});

test('Ajustes abre los términos para leer, no el paso del registro que marca el onboarding', () => {
  // `Terms` llama a completeOnboarding() y termina en «¡Todo listo!»: no es
  // un lugar al que se llega desde Ajustes con la cuenta ya creada.
  assert.ok(!leer('src/screens/SettingsScreen.js').includes("navigate('Terms')"));
});

test('los términos dicen las mismas reglas de reservas y clubes que el código', () => {
  const texto = JSON.stringify(DOCUMENTOS_LEGALES.terminos);
  const reglas = leer('src/services/reservasRules.js');
  const horas = reglas.match(/CANCELLATION_WINDOW_HOURS = (\d+)/)[1];
  assert.ok(texto.includes(`hasta ${horas} horas antes`), 'el plazo de cancelación de reservas no coincide');
  assert.ok(texto.includes('hasta a tres clubes') && texto.includes('26 integrantes'), 'los topes de clubes no coinciden');
});

test('el aviso de cookies se muestra hasta que se ve la versión vigente', () => {
  assert.equal(debeMostrarseAviso(null), true);
  assert.equal(debeMostrarseAviso('2020-01-01'), true);
  assert.equal(debeMostrarseAviso(VERSION_AVISO_COOKIES), false);
});

test('la página de eliminar la cuenta es pública y dice lo mismo que delete_my_account()', () => {
  // Google Play pide un enlace web para pedir el borrado sin la app.
  const nav = leer('src/navigation/AppNavigator.js');
  assert.ok(nav.includes("EliminarCuenta: 'eliminar-cuenta'"), 'falta la dirección /eliminar-cuenta');
  assert.ok(!/EliminarCuenta[^\n]*withAuthGuard/.test(nav), 'la página no puede pedir sesión');
  const texto = JSON.stringify(DOCUMENTOS_LEGALES.eliminarCuenta);
  const sql = leer('supabase/migrations/176_borrar_la_cuenta_de_verdad.sql');
  // Los tres impedimentos de la 176, uno por uno.
  assert.ok(sql.includes('de saldo a favor') && texto.includes('Saldo a favor'));
  assert.ok(sql.includes('reservas por jugar que ya pagaste') && texto.includes('Reservas por jugar que ya pagaste'));
  assert.ok(sql.includes('Administras el recinto') && texto.includes('recinto que sólo tú administras'));
  assert.ok(leer('src/screens/SettingsScreen.js').includes('>Eliminar cuenta<'), 'el botón cambió de nombre: actualiza la página');
  assert.ok(texto.includes(CORREO_PRIVACIDAD));
});

test('la política de cookies dice cuánto dura cada cosa que se guarda', () => {
  const seccion = DOCUMENTOS_LEGALES.cookies.secciones.find((s) => s.titulo === 'Qué guardamos y para qué');
  for (const item of seccion.lista) {
    assert.match(item, /dura|se borra|se mantiene/i, `sin duración: «${item.slice(0, 40)}…»`);
  }
});

test('lo que la política promete de la cuenta recordada es lo que hace el código', () => {
  // «se borra al eliminar tu cuenta»: Ajustes la olvida antes de cerrar sesión.
  const ajustes = leer('src/screens/SettingsScreen.js');
  const borrado = ajustes.slice(ajustes.indexOf('const handleDeleteAccount'), ajustes.indexOf('const openFriendRequestPicker'));
  assert.ok(borrado.includes('await forgetRememberedAccount()'), 'eliminar la cuenta tiene que olvidar el correo guardado');
  assert.ok(borrado.indexOf('forgetRememberedAccount') < borrado.indexOf('signOut'));
  // El diálogo no puede decir que se borran los clubes: sobreviven sin autor (176).
  assert.ok(!/tus amistades y tus clubes/.test(borrado));
});

test('la política de cookies nombra cada cosa con el nombre técnico que de verdad se guarda', () => {
  const texto = JSON.stringify(DOCUMENTOS_LEGALES.cookies);
  // Las claves salen del FUENTE de cada módulo: si alguien renombra una, la
  // política queda mintiendo y esto se pone rojo.
  const claveDe = (archivo, patron) => {
    const m = leer(archivo).match(patron);
    assert.ok(m, `no encontré la clave en ${archivo}`);
    return m[1];
  };
  const claves = [
    claveDe('src/utils/rememberedAccount.js', /const KEY = '([^']+)'/),
    claveDe('src/utils/avisoCookies.js', /const KEY = '([^']+)'/),
    claveDe('src/contexts/ClubsHomeContext.js', /CLUB_ACTIVO_KEY = '([^']+)'/),
    claveDe('src/utils/avisoPanelRecinto.js', /const PREFIJO = '([^']+)'/),
    claveDe('src/services/connectivity.js', /const PREFIX = '([^']+)'/),
    claveDe('src/services/messages.js', /clubReadKey = \(clubId\) => `([^$`]+)/),
  ];
  for (const c of claves) assert.ok(texto.includes(c), `la política no nombra ${c}`);
  // Lo que ponen otros: Supabase (sesión), Cloudflare y Mapbox.
  for (const c of ['auth-token', '__cf_bm', 'mapbox.eventData', 'mapbox-tiles']) {
    assert.ok(texto.includes(c), `la política no nombra ${c}`);
  }
});

test('la copia temporal y las preferencias se borran al cerrar sesión, como dice la política', () => {
  const auth = leer('src/services/auth.js');
  const salir = auth.slice(auth.indexOf('export async function signOut'), auth.indexOf('export async function getCurrentUser'));
  assert.ok(salir.includes('await olvidarDatosDeLaCuenta()'), 'signOut tiene que borrar lo de la cuenta');
  const { clavesDeLaCuenta } = require('../../utils/datosLocales.js');
  const borra = clavesDeLaCuenta([
    '@futfinder/cache/partidos/open', '@futfinder/cache/partidos/detail/x', 'futfinder:clubActivo',
    'club_chat_read:abc', 'futfinder.panelRecintoBienvenida.k1',
    'futfinder.rememberedAccount', 'futfinder.avisoCookies', 'sb-ref-auth-token', 'mapbox.eventData:x',
  ]);
  assert.deepEqual(borra, [
    '@futfinder/cache/partidos/open', '@futfinder/cache/partidos/detail/x', 'futfinder:clubActivo',
    'club_chat_read:abc', 'futfinder.panelRecintoBienvenida.k1',
  ]);
});

test('olvidarDatosDeLaCuenta borra sólo lo de la cuenta y nunca lanza', async () => {
  const { olvidarDatosDeLaCuenta } = require('../../utils/datosLocales.js');
  const datos = new Map([['@futfinder/cache/partidos/open', '1'], ['futfinder.rememberedAccount', '2'], ['club_chat_read:z', '3']]);
  const almacen = {
    getAllKeys: async () => [...datos.keys()],
    multiRemove: async (ks) => ks.forEach((k) => datos.delete(k)),
  };
  assert.equal(await olvidarDatosDeLaCuenta(almacen), 2);
  assert.deepEqual([...datos.keys()], ['futfinder.rememberedAccount']);
  assert.equal(await olvidarDatosDeLaCuenta({ getAllKeys: async () => { throw new Error('x'); } }), 0);
});

test('el mapa de la web le pide a Mapbox no recoger métricas de rendimiento', () => {
  assert.match(leer('src/components/MatchMap.web.js'), /performanceMetricsCollection: false/);
});

test('la política de cookies tiene su propia fecha y la pantalla la muestra', () => {
  assert.match(DOCUMENTOS_LEGALES.cookies.actualizado, /\d{4}$/);
  assert.ok(leer('src/screens/LegalScreen.js').includes('doc.actualizado || ACTUALIZADO'));
});
