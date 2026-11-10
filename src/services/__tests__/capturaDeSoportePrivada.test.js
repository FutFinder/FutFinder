/**
 * La captura de «reportar un problema» se guarda por su ruta, no por una
 * dirección que cualquiera pueda abrir.
 *
 * EL FALLO QUE MOTIVA ESTO (2026-11-09). El bucket `support-screenshots`
 * nació público y la app guardaba en el ticket la dirección directa al
 * archivo. Una captura puede traer lo que la persona tenía en pantalla —un
 * chat, un cobro, un teléfono—, y además la carpeta de cada persona se podía
 * listar por la API de Storage. La migración 174 cierra el bucket; esto
 * vigila las otras dos piezas, que viven en archivos distintos y tienen que
 * seguir de acuerdo:
 *
 *   · el cliente guarda la RUTA en `screenshot_url` y no arma ninguna
 *     dirección pública para ese bucket;
 *   · la Edge Function firma el enlace con el token de quien reporta, sin
 *     la clave de servicio;
 *   · los tres —cliente, función y migración— hablan del mismo bucket.
 *
 * POR QUÉ LEE ARCHIVOS. `storage.js` importa React Native y Expo, y Node no
 * los carga. Lo que la función hace con la ruta (entender también la
 * dirección vieja, firmar, no decir «no adjuntó» si no pudo) se prueba de
 * verdad en `supabase/functions/_shared/correoReporte.test.ts`, con Deno.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..', '..');
const leer = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

/** El fuente sin comentarios: un comentario que explica el defecto lo cita. */
const soloCodigo = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const TICKETS = soloCodigo(leer('src/services/supportTickets.js'));
const STORAGE = soloCodigo(leer('src/services/storage.js'));
const FUNCION = soloCodigo(leer('supabase/functions/reportar-problema/index.ts'));
const CORREO = soloCodigo(leer('supabase/functions/_shared/correoReporte.ts'));
const MIGRACION = leer('supabase/migrations/174_las_capturas_de_soporte_son_privadas.sql')
  .replace(/^\s*--.*$/gm, '');

/** El cuerpo de una función exportada, hasta el siguiente `export`. */
function cuerpoDe(fuente, nombre) {
  const i = fuente.indexOf(`export async function ${nombre}(`);
  assert.notEqual(i, -1, `no existe ${nombre}`);
  const siguiente = fuente.indexOf('\nexport ', i + 1);
  return fuente.slice(i, siguiente === -1 ? undefined : siguiente);
}

test('el ticket guarda la ruta de la captura, no una dirección para abrirla', () => {
  const fn = cuerpoDe(TICKETS, 'submitSupportTicket');
  assert.match(fn, /screenshot_url:\s*screenshotPath\b/, 'el insert ya no guarda la ruta');
  assert.match(
    fn,
    /const \{\s*path,\s*error: uploadError\s*\}\s*=\s*await uploadSupportScreenshot\(/,
    'lo que se toma de la subida ya no es sólo la ruta'
  );
  assert.doesNotMatch(fn, /publicUrl|getPublicUrl/i, 'el servicio volvió a armar una dirección pública');
});

test('si falla guardar el ticket, la captura recién subida se borra por su ruta', () => {
  // Sin esto quedaría un archivo huérfano en un bucket que ya nadie ve.
  const fn = cuerpoDe(TICKETS, 'submitSupportTicket');
  assert.match(fn, /if \(screenshotPath\) await removeSupportScreenshotFile\(screenshotPath\)/);
});

test('la subida de la captura devuelve la ruta y ninguna dirección pública', () => {
  const fn = cuerpoDe(STORAGE, 'uploadSupportScreenshot');
  assert.match(fn, /return \{ path \};/, 'ya no devuelve sólo la ruta');
  assert.doesNotMatch(fn, /\burl\b/, 'volvió a sacar una dirección pública de un bucket privado');
});

test('cliente, función y migración hablan del mismo bucket', () => {
  const delCliente = cuerpoDe(STORAGE, 'uploadSupportScreenshot').match(/uploadToBucket\('([^']+)'/);
  assert.ok(delCliente, 'no se encontró a qué bucket sube la captura');
  const deLaFuncion = CORREO.match(/export const BUCKET_CAPTURAS = "([^"]+)"/);
  assert.ok(deLaFuncion, 'correoReporte.ts ya no exporta BUCKET_CAPTURAS');
  assert.equal(delCliente[1], deLaFuncion[1]);
  assert.match(
    MIGRACION,
    new RegExp(`update storage\\.buckets\\s+set public = false\\s+where id = '${delCliente[1]}'`),
    'la migración 174 ya no cierra ese bucket'
  );
});

test('la función firma el enlace con el token de quien reporta, sin clave de servicio', () => {
  assert.match(
    FUNCION,
    /comoUsuario\.storage\.from\(BUCKET_CAPTURAS\)\.createSignedUrl\(/,
    'el enlace ya no se firma con el cliente de quien reporta'
  );
  assert.match(FUNCION, /resolverCaptura\(fila\.screenshot_url,/, 'la columna ya no pasa por resolverCaptura');
  assert.doesNotMatch(FUNCION, /SERVICE_ROLE/, 'reportar-problema empezó a usar la clave de servicio');
  assert.doesNotMatch(
    FUNCION,
    /screenshot_url:\s*fila\.screenshot_url/,
    'el correo volvió a llevar lo que guarda la columna, sin firmar'
  );
});

test('la lectura del bucket queda sólo para quien subió el archivo, y con sesión', () => {
  assert.match(MIGRACION, /drop policy if exists "support_screenshots_public_select" on storage\.objects;/);
  const politica = MIGRACION.match(
    /create policy "support_screenshots_owner_select"[\s\S]*?;/
  );
  assert.ok(politica, 'la migración 174 ya no crea la política de lectura del dueño');
  assert.match(politica[0], /for select\s+to authenticated/);
  assert.match(politica[0], /auth\.uid\(\)\)::text = \(storage\.foldername\(name\)\)\[1\]/);
});
