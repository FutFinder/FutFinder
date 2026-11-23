const test = require('node:test');
const assert = require('node:assert/strict');

const {
  empujarToast, quitarToast, toastsActuales, suscribirseAToasts, limpiarToasts, DURACION_TOAST_MS,
  toastsDelUsuario,
  avisoSilenciado,
} = require('../notificationToasts.js');

test('una notificación se encola y se puede leer', () => {
  limpiarToasts();
  const id = empujarToast({ id: 'n1', title: 'Te invitaron a un partido' });
  assert.equal(toastsActuales().length, 1);
  assert.equal(toastsActuales()[0].title, 'Te invitaron a un partido');
  quitarToast(id);
  assert.equal(toastsActuales().length, 0);
});

test('DOS NOTIFICACIONES SEGUIDAS NO SE PISAN', () => {
  limpiarToasts();
  empujarToast({ id: 'n1', title: 'Primera' });
  empujarToast({ id: 'n2', title: 'Segunda' });
  assert.deepEqual(toastsActuales().map((n) => n.title), ['Primera', 'Segunda']);
});

test('la misma notificación reentregada por Realtime no se duplica, se actualiza', () => {
  // El canal es compartido y puede reentregar el mismo INSERT — sin esto,
  // el mismo aviso aparecería dos veces apiladas.
  limpiarToasts();
  empujarToast({ id: 'n1', title: 'Primera', read: false });
  empujarToast({ id: 'n1', title: 'Primera', read: true });
  assert.equal(toastsActuales().length, 1);
  assert.equal(toastsActuales()[0].read, true);
});

test('una notificación sin id no se encola', () => {
  limpiarToasts();
  assert.equal(empujarToast({ title: 'sin id' }), null);
  assert.equal(empujarToast(null), null);
  assert.equal(toastsActuales().length, 0);
});

test('quitar una que ya no está no rompe ni avisa de más', () => {
  limpiarToasts();
  let veces = 0;
  const cortar = suscribirseAToasts(() => { veces += 1; });
  const id = empujarToast({ id: 'n1', title: 'uno' });
  quitarToast(id);
  const despues = veces;
  quitarToast(id);
  assert.equal(veces, despues);
  cortar();
});

test('quien se suscribe recibe lo que ya había', () => {
  limpiarToasts();
  empujarToast({ id: 'n1', title: 'ya estaba' });
  let visto = null;
  const cortar = suscribirseAToasts((c) => { visto = c; });
  assert.equal(visto.length, 1);
  assert.equal(visto[0].title, 'ya estaba');
  cortar();
});

test('desuscribirse deja de recibir', () => {
  limpiarToasts();
  let veces = 0;
  const cortar = suscribirseAToasts(() => { veces += 1; });
  const tras = veces;
  cortar();
  empujarToast({ id: 'n1', title: 'después' });
  assert.equal(veces, tras);
});

test('DURACION_TOAST_MS da tiempo a leer el título y el cuerpo', () => {
  assert.ok(DURACION_TOAST_MS >= 3000);
});

// ---------------------------------------------------------------------------
// C10 (auditoría de chats y avisos, 2026-09-23): la cola es global al módulo
// y `limpiarToasts` sólo la llamaban estas pruebas. Un popup recibido justo
// antes de cerrar sesión seguía en la pantalla de acceso hasta expirar, con
// el título y el cuerpo de la cuenta anterior.
// ---------------------------------------------------------------------------

test('C10: sin sesión no se muestra ningún popup', () => {
  const cola = [{ id: 'n1', user_id: 'u1', title: 'De la cuenta anterior' }];
  assert.deepEqual(toastsDelUsuario(cola, null), []);
  assert.deepEqual(toastsDelUsuario(cola, undefined), []);
});

test('C10: sólo se muestran los avisos de la cuenta actual', () => {
  const cola = [
    { id: 'n1', user_id: 'u1', title: 'Mío' },
    { id: 'n2', user_id: 'u2', title: 'De otra cuenta' },
  ];
  assert.deepEqual(toastsDelUsuario(cola, 'u1').map((n) => n.id), ['n1']);
});

test('C10: el host limpia la cola al cerrar o cambiar de sesión', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'NotificationToastHost.js'),
    'utf8'
  );
  const ini = src.indexOf('useEffect(() => {');
  const efecto = src.slice(ini, src.indexOf('}, [user?.id]);', ini));
  assert.ok(efecto.length > 0, 'no se encontró el efecto que depende de la sesión');
  // Al entrar al efecto (cambio de cuenta o cierre) y en su limpieza.
  assert.match(
    efecto,
    /limpiarToasts\(\);\s*if \(!user\?\.id\) return undefined;/,
    'cerrar sesión no limpia la cola de popups'
  );
  assert.match(
    efecto,
    /return \(\) => \{[^}]*limpiarToasts\(\);/,
    'cambiar de cuenta no limpia la cola de la anterior'
  );
  assert.match(src, /toastsDelUsuario\(toasts, user\?\.id\)/, 'el host pinta avisos sin mirar de quién son');
});

// ---------------------------------------------------------------------------
// C05, parte de cliente: silenciar un hilo no frenaba el popup. Los avisos
// de chat de un hilo silenciado no se abren arriba; el resto, sí. (El push
// y el aviso en la base son del servidor: siguen pendientes.)
// ---------------------------------------------------------------------------

test('C05: un aviso de chat de un hilo silenciado no abre popup', () => {
  const silenciados = new Set(['dm:u2', 'club:c1']);
  assert.equal(avisoSilenciado({ type: 'message_new', data: { threadKey: 'dm:u2' } }, silenciados), true);
  assert.equal(avisoSilenciado({ type: 'chat_mention_all', data: { threadKey: 'club:c1' } }, silenciados), true);
});

test('C05: lo que no es de un hilo silenciado sigue abriendo popup', () => {
  const silenciados = new Set(['dm:u2']);
  assert.equal(avisoSilenciado({ type: 'message_new', data: { threadKey: 'dm:u3' } }, silenciados), false);
  assert.equal(avisoSilenciado({ type: 'match_join', data: { threadKey: 'dm:u2' } }, silenciados), false,
    'el silencio es del chat, no de los avisos de partidos');
  assert.equal(avisoSilenciado({ type: 'message_new', data: {} }, silenciados), false);
  assert.equal(avisoSilenciado({ type: 'message_new', data: { threadKey: 'dm:u2' } }, new Set()), false);
  assert.equal(avisoSilenciado({ type: 'message_new', data: { threadKey: 'dm:u2' } }, null), false);
});

test('C05: un aviso marcado importante atraviesa el silencio', () => {
  const silenciados = new Set(['club:c1']);
  assert.equal(
    avisoSilenciado({ type: 'chat_mention_all', data: { threadKey: 'club:c1', important: true } }, silenciados),
    false
  );
});

test('C05: el host consulta el silencio antes de encolar un popup de chat', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', '..', 'components', 'NotificationToastHost.js'),
    'utf8'
  );
  assert.match(src, /listMutedThreads\(\)/, 'el popup no pregunta qué hilos están silenciados');
  const ini = src.indexOf('avisoSilenciado(');
  assert.ok(ini > 0, 'el popup no mira si el hilo está silenciado');
  assert.ok(ini < src.lastIndexOf('empujarToast(notif)'), 'el silencio se mira después de encolar');
});
