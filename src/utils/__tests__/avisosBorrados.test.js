/**
 * C09 de la auditoría de chats y avisos (2026-09-23): borrar avisos no
 * actualizaba la campana ya montada.
 *
 * EL FALLO. El canal de avisos escucha INSERT y UPDATE; un borrado no llega
 * por ningún lado, y `useUnreadNotifications` sólo recargaba al montar o al
 * recibir un evento. Se borraban los avisos en la bandeja y la campana seguía
 * diciendo «3» hasta que llegara otra cosa.
 *
 * POR QUÉ NO SE ESCUCHA EL DELETE DE REALTIME. Supabase no deja filtrar los
 * DELETE de postgres_changes (no hay fila sobre la que aplicar
 * `user_id=eq.…` ni la RLS), así que escucharlos sería recibir los borrados
 * de TODOS los usuarios; y además `notifications` tendría que estar en la
 * publicación con REPLICA IDENTITY FULL, que es una migración. El arreglo es
 * de cliente: quien borra lo difunde por el mismo canal compartido, y la
 * campana recarga también al volver la app a primer plano (que es cuando un
 * borrado hecho en otro dispositivo puede importar).
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSharedChannel } = require('../chatMeta.js');
const { fusionarAvisoEnVivo } = require('../notificationInbox.js');

const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

test('C09: difundir llega a todos los suscriptores del canal compartido', () => {
  let aperturas = 0;
  const canal = createSharedChannel({
    open: () => { aperturas += 1; return {}; },
    close: () => {},
  });
  const recibidos = [];
  const fuera1 = canal.subscribe((p) => recibidos.push(['campana', p]));
  const fuera2 = canal.subscribe((p) => recibidos.push(['bandeja', p]));
  canal.difundir({ id: 'a', _eventType: 'DELETE' });
  assert.deepEqual(recibidos, [
    ['campana', { id: 'a', _eventType: 'DELETE' }],
    ['bandeja', { id: 'a', _eventType: 'DELETE' }],
  ]);
  assert.equal(aperturas, 1, 'difundir no abre canales');
  fuera1();
  fuera2();
});

test('C09: difundir sin suscriptores no abre el canal ni revienta', () => {
  let aperturas = 0;
  const canal = createSharedChannel({ open: () => { aperturas += 1; return {}; }, close: () => {} });
  canal.difundir({ id: 'a', _eventType: 'DELETE' });
  assert.equal(aperturas, 0);
});

test('C09: un DELETE saca el aviso de la bandeja; «todos» la vacía', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(fusionarAvisoEnVivo(items, { id: 'a', _eventType: 'DELETE' }), [{ id: 'b' }]);
  assert.deepEqual(fusionarAvisoEnVivo(items, { id: null, todos: true, _eventType: 'DELETE' }), []);
  assert.deepEqual(
    fusionarAvisoEnVivo(items, { id: 'zz', _eventType: 'DELETE' }),
    items,
    'un DELETE de algo que no está no agrega nada'
  );
});

test('C09: los dos borrados del servicio difunden después de borrar bien', () => {
  const src = leer('services', 'notifications.js');
  for (const fn of ['deleteNotification', 'deleteAllNotifications']) {
    const ini = src.indexOf(`export async function ${fn}(`);
    assert.ok(ini > 0, `no se encontró ${fn}`);
    const cuerpo = src.slice(ini, src.indexOf('\n}\n', ini));
    assert.match(cuerpo, /if \(!error\) difundirBorrado\(/, `${fn} no avisa a la campana`);
  }
});

test('C09: la campana recarga al volver la app a primer plano', () => {
  const src = leer('utils', 'useUnreadNotifications.js');
  assert.match(src, /AppState\.addEventListener\('change'/);
});

test('C09: el popup de un aviso borrado se va', () => {
  const src = leer('components', 'NotificationToastHost.js');
  assert.match(src, /notif\._eventType === 'DELETE'/);
});
