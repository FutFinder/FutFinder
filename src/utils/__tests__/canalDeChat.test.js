/**
 * El canal privado del chat por persona (migración 175).
 *
 * Lo que se prueba: que el canal se pida con el topic `chat:<id>` y como
 * privado DESPUÉS de preparar el token; que reabrir espere a que el canal
 * anterior termine de salir (el topic es fijo: si no, supabase-js devuelve
 * el viejo); que un canal ya cerrado no toque el estado del siguiente; y que
 * lo que llega por Broadcast salga con la forma que ya leían las pantallas.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { canalDeChatPorUsuario, createSharedChannel } = require('../chatMeta.js');

const esperar = () => new Promise((r) => setTimeout(r, 0));

function piezas({ usuario = 'u1', retiroLento = false } = {}) {
  const log = [];
  const canales = [];
  let soltarRetiro = null;
  return {
    log,
    canales,
    soltar: () => soltarRetiro && soltarRetiro(),
    deps: {
      obtenerUsuario: async () => usuario,
      prepararAuth: async () => {
        log.push('auth');
      },
      crearCanal: (topic, alRecibir, alCambiarEstado) => {
        // Como supabase-js: un topic que sigue en la lista devuelve el mismo.
        if (canales.some((c) => c.topic === topic && !c.fuera)) {
          throw new Error(`canal ${topic} todavía en la lista`);
        }
        const c = { topic, alRecibir, alCambiarEstado, fuera: false };
        canales.push(c);
        log.push(`crear ${topic}`);
        return c;
      },
      quitarCanal: (c) => {
        log.push(`quitar ${c.topic}`);
        if (!retiroLento) {
          c.fuera = true;
          return Promise.resolve('ok');
        }
        return new Promise((r) => {
          soltarRetiro = () => {
            c.fuera = true;
            r('ok');
          };
        });
      },
    },
  };
}

test('pide `chat:<mi id>` después de preparar el token', async () => {
  const p = piezas();
  const canal = createSharedChannel(canalDeChatPorUsuario(p.deps));
  canal.subscribe(() => {});
  await esperar();
  assert.deepEqual(p.log, ['auth', 'crear chat:u1']);
});

test('lo que llega por Broadcast sale con la forma de siempre', async () => {
  const p = piezas();
  const recibidos = [];
  const canal = createSharedChannel(canalDeChatPorUsuario(p.deps));
  canal.subscribe((payload) => recibidos.push(payload));
  await esperar();
  const fila = { id: 'm1', content: 'hola' };
  p.canales[0].alRecibir({ event: 'INSERT', payload: { eventType: 'INSERT', new: fila, old: { id: 'm1' } } });
  p.canales[0].alRecibir({ event: 'otro', payload: { cualquiera: true } }); // sin eventType: se ignora
  assert.equal(recibidos.length, 1);
  assert.equal(recibidos[0].eventType, 'INSERT');
  assert.equal(recibidos[0].new, fila);
});

test('reabrir espera a que salga el canal anterior (el topic es fijo)', async () => {
  const p = piezas({ retiroLento: true });
  const canal = createSharedChannel(canalDeChatPorUsuario(p.deps));
  const salir = canal.subscribe(() => {});
  await esperar();
  salir(); // removeChannel queda en vuelo
  await esperar();
  canal.subscribe(() => {}); // vuelve a montarse una pantalla al tiro
  await esperar();
  assert.deepEqual(p.log, ['auth', 'crear chat:u1', 'quitar chat:u1'], 'no pide el canal mientras el viejo sigue');
  p.soltar();
  await esperar();
  await esperar();
  assert.deepEqual(p.log.slice(-2), ['auth', 'crear chat:u1']);
});

test('cerrar antes de que termine de abrir no deja un canal colgando', async () => {
  const p = piezas();
  const canal = createSharedChannel(canalDeChatPorUsuario(p.deps));
  const salir = canal.subscribe(() => {});
  salir(); // antes de que llegue la sesión
  await esperar();
  await esperar();
  assert.equal(p.canales.length, 0);
});

test('un canal ya cerrado no le cambia el estado al siguiente', async () => {
  const p = piezas();
  const estados = [];
  const canal = createSharedChannel(canalDeChatPorUsuario(p.deps));
  const salir = canal.subscribe(() => {}, { onStatus: (s) => estados.push(`a:${s}`) });
  await esperar();
  const viejo = p.canales[0];
  salir();
  await esperar();
  canal.subscribe(() => {}, { onStatus: (s) => estados.push(`b:${s}`) });
  await esperar();
  viejo.alCambiarEstado('CLOSED'); // llega tarde, del canal que ya salió
  viejo.alRecibir({ payload: { eventType: 'INSERT', new: { id: 'x' } } });
  p.canales[1].alCambiarEstado('SUBSCRIBED');
  assert.deepEqual(estados, ['b:SUBSCRIBED']);
});

test('sin sesión no pide ningún canal y avisa el error', async () => {
  const p = piezas({ usuario: null });
  const estados = [];
  const canal = createSharedChannel(canalDeChatPorUsuario(p.deps));
  canal.subscribe(() => {}, { onStatus: (s) => estados.push(s) });
  await esperar();
  assert.equal(p.canales.length, 0);
  assert.deepEqual(estados, ['CHANNEL_ERROR']);
});
