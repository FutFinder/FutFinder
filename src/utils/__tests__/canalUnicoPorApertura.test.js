/**
 * «cannot add `postgres_changes` callbacks for realtime:notif-… after
 * `subscribe()`» al volver a montar el popup de avisos.
 *
 * EL FALLO. Los canales compartidos (`createSharedChannel`) se cierran con
 * el último suscriptor llamando `supabase.removeChannel`, que es ASÍNCRONO:
 * el canal sigue en la lista del cliente hasta que el servidor confirma la
 * salida. Si en ese intervalo se suscribe alguien de nuevo —el popup que se
 * vuelve a montar siendo el único que escuchaba, una pantalla que sale y
 * entra—, `open` pide `supabase.channel('notif-<id>')`, y supabase-js
 * DEVUELVE EL CANAL VIEJO, ya suscrito; el `.on(...)` revienta. Pasa con
 * cualquier canal de nombre fijo: avisos, `messages-shared` y `nomina:`.
 *
 * EL ARREGLO. `createSharedChannel` le pasa a `open` un número de apertura
 * que sube cada vez que el canal se vuelve a abrir, y los tres lo ponen en
 * el nombre. Es lo que `friends.js` ya hacía con su correlativo.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSharedChannel } = require('../chatMeta.js');

/**
 * Un cliente Realtime falso que se porta como supabase-js en lo que importa:
 * `channel(tema)` devuelve el que ya existe con ese tema; `on` después de
 * `subscribe` lanza; `removeChannel` saca el canal de la lista DESPUÉS
 * (asíncrono).
 */
function clienteFalso() {
  const canales = [];
  return {
    channel(tema) {
      const existe = canales.find((c) => c.tema === tema);
      if (existe) return existe;
      const c = {
        tema,
        suscrito: false,
        on() {
          if (this.suscrito) {
            throw new Error(`cannot add \`postgres_changes\` callbacks for realtime:${tema} after \`subscribe()\`.`);
          }
          return this;
        },
        subscribe() {
          this.suscrito = true;
          return this;
        },
      };
      canales.push(c);
      return c;
    },
    removeChannel(c) {
      return Promise.resolve().then(() => {
        const i = canales.indexOf(c);
        if (i >= 0) canales.splice(i, 1);
      });
    },
  };
}

function compartido(cliente, tema) {
  return createSharedChannel({
    open: ({ apertura }) => cliente.channel(tema(apertura)).on().subscribe(),
    close: (c) => { cliente.removeChannel(c); },
  });
}

test('con nombre fijo, volver a suscribirse antes de que se cierre revienta (el fallo)', () => {
  const cliente = clienteFalso();
  const canal = compartido(cliente, () => 'notif-u1');
  const salir = canal.subscribe(() => {});
  salir(); // el último se va: removeChannel queda en vuelo
  assert.throws(() => canal.subscribe(() => {}), /after `subscribe\(\)`/);
});

test('con el número de apertura en el nombre, se puede volver a abrir al tiro', () => {
  const cliente = clienteFalso();
  const canal = compartido(cliente, (n) => `notif-u1-${n}`);
  const salir = canal.subscribe(() => {});
  salir();
  assert.doesNotThrow(() => canal.subscribe(() => {}));
});

test('la apertura sube en cada reapertura y no cambia mientras siga abierto', () => {
  const aperturas = [];
  const canal = createSharedChannel({
    open: ({ apertura }) => { aperturas.push(apertura); return {}; },
    close: () => {},
  });
  const a = canal.subscribe(() => {});
  const b = canal.subscribe(() => {});
  a(); b();
  const c = canal.subscribe(() => {});
  c();
  assert.deepEqual(aperturas, [1, 2]);
});

test('los tres canales de nombre fijo ponen la apertura en el tema', () => {
  const leer = (...p) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
  assert.match(leer('services', 'notifications.js'), /\.channel\(`notif-\$\{userId\}-\$\{apertura\}`\)/);
  assert.match(leer('services', 'messages.js'), /\.channel\(`messages-shared-\$\{apertura\}`\)/);
  assert.match(leer('services', 'clubRoster.js'), /\.channel\(`nomina:\$\{matchId\}:\$\{apertura\}`\)/);
});
