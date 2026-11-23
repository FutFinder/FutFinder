/**
 * `cancelMatchWithReason` dejaba el motivo huérfano.
 *
 * EL FALLO. El motivo se escribe en `matches.motivo_cancelacion` ANTES de
 * llamar a `cancel_match`, y tiene que ser así: la RPC lo lee para el aviso
 * a los jugadores («fue cancelado. Motivo: …»). Pero si la RPC fallaba (no
 * eres el organizador, es un encuentro entre clubes, sin red…) el motivo se
 * quedaba escrito en un partido que seguía vivo, y su detalle mostraba
 * «Motivo del organizador». Tampoco se miraba si esa escritura había fallado.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { cancelarConMotivo } = require('../motivoDeCancelacion.js');

/** Un partido en memoria y el registro de lo que se le hizo. */
function partido({ motivo = null, falla = {} } = {}) {
  const p = { motivo, estado: 'abierto', llamadas: [] };
  return {
    p,
    leerMotivo: async () => {
      p.llamadas.push('leer');
      if (falla.leer) return { data: null, error: { message: 'sin red' } };
      return { data: p.motivo, error: null };
    },
    escribirMotivo: async (valor) => {
      p.llamadas.push(['escribir', valor]);
      if (falla.escribir) return { error: { message: 'sin permiso' } };
      p.motivo = valor;
      return { error: null };
    },
    cancelar: async () => {
      p.llamadas.push(['cancelar', p.motivo]);
      if (falla.cancelar) return { ok: false, reason: 'Solo el organizador puede cancelar el partido' };
      p.estado = 'cancelado';
      return { ok: true, penalty: 0 };
    },
  };
}

test('si la cancelación falla, el motivo vuelve a como estaba', async () => {
  const f = partido({ falla: { cancelar: true } });
  const res = await cancelarConMotivo({ motivo: 'Llueve', ...f });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'Solo el organizador puede cancelar el partido');
  assert.equal(f.p.estado, 'abierto');
  assert.equal(f.p.motivo, null, 'quedó «Motivo del organizador» en un partido que no se canceló');
});

test('el motivo está escrito cuando la RPC cancela (lo usa el aviso)', async () => {
  const f = partido();
  const res = await cancelarConMotivo({ motivo: 'Llueve', ...f });
  assert.equal(res.ok, true);
  const cancelar = f.p.llamadas.find((l) => Array.isArray(l) && l[0] === 'cancelar');
  assert.deepEqual(cancelar, ['cancelar', 'Llueve']);
  assert.equal(f.p.motivo, 'Llueve');
});

test('si no se pudo guardar el motivo, no se cancela a medias', async () => {
  const f = partido({ falla: { escribir: true } });
  const res = await cancelarConMotivo({ motivo: 'Llueve', ...f });
  assert.equal(res.ok, false);
  assert.match(res.reason, /motivo/i);
  assert.equal(f.p.estado, 'abierto', 'se canceló sin el motivo que el organizador escribió');
});

test('si no se pudo leer el motivo anterior, tampoco se arriesga', async () => {
  const f = partido({ falla: { leer: true } });
  const res = await cancelarConMotivo({ motivo: 'Llueve', ...f });
  assert.equal(res.ok, false);
  assert.equal(f.p.estado, 'abierto');
  assert.equal(f.p.motivo, null);
});

test('un motivo anterior se restaura tal cual', async () => {
  const f = partido({ motivo: 'Cancha cerrada', falla: { cancelar: true } });
  await cancelarConMotivo({ motivo: 'Llueve', ...f });
  assert.equal(f.p.motivo, 'Cancha cerrada');
});

test('sin motivo, se cancela directo y no se toca la columna', async () => {
  const f = partido();
  const res = await cancelarConMotivo({ motivo: '', ...f });
  assert.equal(res.ok, true);
  assert.deepEqual(f.p.llamadas, [['cancelar', null]]);
});

test('una RPC que revienta también deshace el motivo', async () => {
  const f = partido();
  f.cancelar = async () => { throw new Error('Network request failed'); };
  const res = await cancelarConMotivo({ motivo: 'Llueve', ...f });
  assert.equal(res.ok, false);
  assert.equal(f.p.motivo, null);
});

test('el servicio usa cancelarConMotivo', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'matches.js'), 'utf8');
  const ini = src.indexOf('export async function cancelMatchWithReason(');
  const cuerpo = src.slice(ini, src.indexOf('\n}\n', ini));
  assert.match(cuerpo, /cancelarConMotivo\(\{/);
  assert.ok(!/update\(\{ motivo_cancelacion: motivo \}\)/.test(cuerpo.split('cancelarConMotivo')[0]),
    'vuelve a escribir el motivo sin poder deshacerlo');
});
