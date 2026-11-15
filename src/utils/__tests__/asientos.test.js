/**
 * Pruebas de los asientos de partido (migración 182): el contador público,
 * la lista que se dibuja y las validaciones del armado.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  asientosDelBorrador,
  asientosDelPartido,
  contadorDeJugadores,
  limpiarNombre,
  linkDeInvitacion,
  mensajeDelLink,
  nombresVigentes,
  payloadDeAsientos,
  reservasDisponibles,
  resumenDeJugadores,
  tokenDeInvitacion,
  traducirErrorDeAsiento,
  validarArmado,
} = require('../asientos.js');

test('el contador muestra confirmados sobre el total, con el organizador adentro', () => {
  // Partido de 14: 13 plazas aparte del organizador, 4 libres.
  const c = contadorDeJugadores({ cupos_totales: 13, cupos_disponibles: 4 });
  assert.equal(c.texto, '10/14');
  assert.equal(c.resto, 'quedan 4 cupos');
  assert.equal(c.completo, false);
  assert.equal(resumenDeJugadores({ cupos_totales: 13, cupos_disponibles: 4 }), '10/14 · quedan 4 cupos');
});

test('un partido antiguo de «falta 1» se lee 1/2 y no cambia de datos', () => {
  const c = contadorDeJugadores({ cupos_totales: 1, cupos_disponibles: 1 });
  assert.equal(c.texto, '1/2');
  assert.equal(c.resto, 'queda 1 cupo');
});

test('sin libres el partido está completo', () => {
  const c = contadorDeJugadores({ cupos_totales: 9, cupos_disponibles: 0 });
  assert.equal(c.texto, '10/10');
  assert.equal(c.resto, 'Completo');
  assert.equal(c.completo, true);
});

test('los partidos de clubes no usan este contador', () => {
  assert.equal(contadorDeJugadores({ cupos_totales: 10, cupos_disponibles: 3, challenge_proposal_id: 'x' }), null);
  assert.equal(contadorDeJugadores({ cupos_totales: 10, cupos_disponibles: 3, cupos_por_club: 5 }), null);
  assert.equal(contadorDeJugadores(null), null);
});

test('unos libres fuera de rango no producen números imposibles', () => {
  assert.equal(contadorDeJugadores({ cupos_totales: 5, cupos_disponibles: 9 }).texto, '1/6');
  assert.equal(contadorDeJugadores({ cupos_totales: 5, cupos_disponibles: -2 }).texto, '6/6');
});

test('el armado exige que el total sea mayor que lo ocupado', () => {
  const r = { tipo: 'reservado' };
  assert.equal(validarArmado(14, [r, r, r]), null);
  // 3 jugadores: creador + 2 reservados no deja ningún libre.
  assert.match(validarArmado(3, [r, r]), /mayor que los jugadores/);
  // Con uno libre sí.
  assert.equal(validarArmado(4, [r, r]), null);
  assert.match(validarArmado(1, []), /al menos 2/);
  assert.match(validarArmado(40, []), /máximo/);
});

test('un mismo perfil no ocupa dos asientos', () => {
  const a = { tipo: 'amigo', user_id: 'u1' };
  assert.match(validarArmado(10, [a, { ...a }]), /dos asientos/);
  assert.equal(validarArmado(10, [a, { tipo: 'amigo', user_id: 'u2' }]), null);
});

test('los nombres se limpian y se validan', () => {
  assert.equal(limpiarNombre('  Johan   Pérez '), 'Johan Pérez');
  assert.equal(limpiarNombre('   '), null);
  assert.equal(limpiarNombre('x'.repeat(41)), null);
  assert.match(validarArmado(10, [{ tipo: 'nombre', nombre: ' ' }]), /nombre/);
});

test('el payload lleva sólo lo que el servidor espera', () => {
  assert.deepEqual(
    payloadDeAsientos([
      { tipo: 'amigo', user_id: 'u1', username: 'tomas', foto_url: 'x' },
      { tipo: 'nombre', nombre: ' Mario ' },
      { tipo: 'reservado' },
    ]),
    [{ tipo: 'amigo', user_id: 'u1' }, { tipo: 'nombre', nombre: 'Mario' }, { tipo: 'reservado' }]
  );
});

test('el borrador se dibuja creador, ocupados y libres', () => {
  const lista = asientosDelBorrador(5, [{ tipo: 'amigo', user_id: 'u1' }, { tipo: 'reservado' }], { username: 'vicente' });
  assert.deepEqual(lista.map((a) => a.tipo), ['creador', 'cuenta', 'reservado', 'libre', 'libre']);
  assert.equal(lista[1].indice, 0);
});

test('el partido publicado se dibuja en orden fijo y con todos sus asientos', () => {
  const match = { id_organizador: 'org', cupos_totales: 6, cupos_disponibles: 3 };
  const nomina = [
    { user_id: 'j1', estado: 'inscrito', origen: 'asiento_asignado' },
    { user_id: 'org', estado: 'inscrito', is_organizer: true },
    { user_id: 'p1', estado: 'pendiente' },
  ];
  const sinCuenta = [
    { id: 's1', tipo: 'reservado' },
    { id: 's2', tipo: 'nombre', nombre: 'Johan' },
  ];
  const lista = asientosDelPartido(match, nomina, sinCuenta);
  assert.deepEqual(lista.map((a) => a.tipo), ['creador', 'cuenta', 'nombre', 'reservado', 'libre', 'libre', 'libre']);
  // 7 jugadores en total: la lista tiene 7 asientos y la solicitud pendiente no ocupa ninguno.
  assert.equal(lista.length, 7);
  assert.equal(lista[1].asignado, true);
  assert.equal(reservasDisponibles(sinCuenta), 1);
});

test('la lista de un partido de 14 con 10 confirmados tiene 14 asientos', () => {
  const match = { id_organizador: 'org', cupos_totales: 13, cupos_disponibles: 4 };
  const nomina = [
    { user_id: 'org', estado: 'inscrito', is_organizer: true },
    { user_id: 'tomas', estado: 'inscrito' },
  ];
  const sinCuenta = [
    { id: 'n1', tipo: 'nombre', nombre: 'Johan' },
    { id: 'n2', tipo: 'nombre', nombre: 'Mario' },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ id: `r${i}`, tipo: 'reservado' })),
  ];
  const lista = asientosDelPartido(match, nomina, sinCuenta);
  assert.equal(lista.length, 14);
  assert.equal(lista.filter((a) => a.tipo === 'libre').length, 4);
});

test('el período de nombres termina por fecha aunque los ajustes estén guardados', () => {
  const ahora = Date.parse('2026-12-01T00:00:00Z');
  assert.equal(nombresVigentes({ asientos_por_nombre: true, asientos_por_nombre_termina: '2026-12-20T00:00:00Z' }, ahora), true);
  assert.equal(nombresVigentes({ asientos_por_nombre: true, asientos_por_nombre_termina: '2026-11-20T00:00:00Z' }, ahora), false);
  assert.equal(nombresVigentes({ asientos_por_nombre: true, asientos_por_nombre_termina: null }, ahora), true);
  assert.equal(nombresVigentes({ asientos_por_nombre: false }, ahora), false);
  assert.equal(nombresVigentes(null, ahora), false);
});

test('el link de invitación lleva el token y sólo se acepta un token con forma de token', () => {
  const t = '3f2b8c1e-6a4d-4e2b-9c1a-7d5e8f0a1b2c';
  assert.equal(linkDeInvitacion('abc', t), `https://www.futfinder.cl/p/abc?inv=${t}`);
  assert.equal(linkDeInvitacion('abc', null), null);
  assert.equal(tokenDeInvitacion(t), t);
  assert.equal(tokenDeInvitacion('cualquier-cosa'), null);
  assert.equal(tokenDeInvitacion(undefined), null);
});

test('el link sin reservas lo dice, y no lo confunde con un error', () => {
  assert.equal(mensajeDelLink({ ok: false, reason: 'SIN_RESERVAS' }).tono, 'aviso');
  assert.match(mensajeDelLink({ ok: false, reason: 'SIN_RESERVAS' }).texto, /no quedan asientos reservados/i);
  assert.equal(mensajeDelLink({ ok: true, ya_estaba: false }).tono, 'ok');
  assert.match(mensajeDelLink({ ok: true, ya_estaba: true }).texto, /Ya tienes/);
  assert.equal(mensajeDelLink({ ok: false, reason: 'CHOQUE_HORARIO' }).tono, 'error');
  assert.equal(mensajeDelLink(null).reintentar, true);
});

test('los errores del servidor se traducen y nunca se muestra el código', () => {
  assert.match(traducirErrorDeAsiento({ message: 'ASIENTO_SIN_LIBRES' }), /No quedan asientos libres/);
  assert.match(traducirErrorDeAsiento({ message: 'CUPOS_MENOR_QUE_CONFIRMADOS:5:9' }), /no puede ser menor/);
  const desconocido = traducirErrorDeAsiento({ message: 'relation "x" does not exist' });
  assert.doesNotMatch(desconocido, /relation/);
});
