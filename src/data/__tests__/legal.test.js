const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { ACTUALIZADO, CORREO_PRIVACIDAD, DOCUMENTOS_LEGALES } = require('../legal.js');
const { debeMostrarseAviso, VERSION_AVISO_COOKIES } = require('../../utils/avisoCookies.js');

const RAIZ = path.join(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

test('las dos políticas existen y cada sección tiene algo que leer', () => {
  assert.deepEqual(Object.keys(DOCUMENTOS_LEGALES).sort(), ['cookies', 'privacidad']);
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

test('la app no enlaza más a la política en una web externa que no responde', () => {
  for (const archivo of ['src/screens/SettingsScreen.js', 'src/screens/RegisterScreen.js', 'src/screens/WelcomeScreen.js']) {
    assert.ok(!leer(archivo).includes('futfinder.cl/privacidad'), `${archivo} sigue abriendo futfinder.cl/privacidad`);
    assert.ok(leer(archivo).includes("navigate('Privacidad')"), `${archivo} no lleva a la pantalla de privacidad`);
  }
});

test('el aviso de cookies se muestra hasta que se ve la versión vigente', () => {
  assert.equal(debeMostrarseAviso(null), true);
  assert.equal(debeMostrarseAviso('2020-01-01'), true);
  assert.equal(debeMostrarseAviso(VERSION_AVISO_COOKIES), false);
});
