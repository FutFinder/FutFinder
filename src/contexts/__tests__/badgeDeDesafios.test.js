/**
 * El badge del acceso rápido «Desafíos» cuenta lo que hay en su destino.
 *
 * POR QUÉ ESTA PRUEBA LEE ARCHIVOS. El defecto no estaba dentro de ninguna
 * función: el número era correcto —`contarPorTipo(tasks, 'desafio')` contaba
 * bien los desafíos directos recibidos— y el tile también, porque abre el
 * tablero de publicaciones abiertas. Lo que estaba mal era la PAREJA: desde
 * la migración 112 esa pantalla ya no tiene bandeja de directos, así que el
 * badge prometía trabajo pendiente y llevaba a un sitio donde no estaba. Es
 * el mismo defecto de los hallazgos 1 y 2 del informe del 22-09, y ninguna
 * prueba de lógica pura ve un número correcto apuntando a la pantalla
 * equivocada.
 *
 * Mismo patrón que `rivalesDeLaPortada.test.js` e
 * `invitacionesEnLaPortada.test.js`.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/**
 * El fuente sin comentarios: un comentario que EXPLICA el defecto cita el
 * código que lo causaba, y una prueba que busque ese texto se dispararía con
 * la explicación en vez de con el defecto.
 */
const soloCodigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CONTEXTO = soloCodigo(leer('contexts/ClubsHomeContext.js'));
const PORTADA = soloCodigo(leer('screens/ClubsScreen.js'));
const SERVICIO = leer('services/clubOpenChallenges.js');

test('el badge ya NO cuenta los desafíos directos recibidos', () => {
  // Esos tienen su propia tarjeta en «Pendiente para ti», con el destino
  // correcto desde la corrección de los hallazgos 1 y 2.
  assert.doesNotMatch(
    PORTADA,
    /badges=\{\{\s*desafios:\s*contarPorTipo/,
    'el badge volvió a contar los desafíos directos, que no están en el destino del tile'
  );
  assert.match(PORTADA, /badges=\{\{\s*desafios:\s*openChallengeReplies\s*\}\}/);
});

test('el número sale del contexto, no se recalcula en la pantalla', () => {
  // La portada no cuenta nada por su cuenta: es la misma regla que ya vale
  // para el badge de la barra inferior y «Pendiente para ti».
  assert.match(CONTEXTO, /countRespuestasPendientes/);
  assert.match(CONTEXTO, /openChallengeReplies: respuestasAbiertas/);
  assert.doesNotMatch(
    PORTADA,
    /countRespuestasPendientes/,
    'la pantalla volvió a pedir el conteo por su cuenta'
  );
});

test('el conteo es sólo lo que espera decisión, no todo el historial', () => {
  const i = SERVICIO.indexOf('export async function countRespuestasPendientes');
  assert.notEqual(i, -1, 'desapareció countRespuestasPendientes');
  const fn = SERVICIO.slice(i, SERVICIO.indexOf('\nexport ', i + 1));

  // Una respuesta aceptada o rechazada ya se decidió, y una publicación
  // cerrada o expirada no admite aceptar ninguna.
  assert.match(fn, /\.eq\('estado', 'pendiente'\)/);
  assert.match(fn, /\.eq\('estado', 'abierto'\)/);

  // `respuestasCount` de `listMyOpenChallenges` cuenta todo lo no retirado:
  // sirve para rotular «Respuestas (3)», no para prometer tres decisiones.
  assert.doesNotMatch(
    fn,
    /neq\('estado', 'retirada'\)/,
    'el badge volvió a contar respuestas ya decididas'
  );
});

test('sin la migración 112 el badge es cero, no un fallo de la portada', () => {
  const i = SERVICIO.indexOf('export async function countRespuestasPendientes');
  const fn = SERVICIO.slice(i, SERVICIO.indexOf('\nexport ', i + 1));
  assert.match(fn, /esFaltaDeEsquema/);
  assert.match(fn, /data: 0/);
});

test('el contexto tolera que el conteo falle', () => {
  // `segura()` deja la sección vacía en vez de tumbar la portada entera.
  assert.match(CONTEXTO, /segura\(\s*countRespuestasPendientes/);
});
