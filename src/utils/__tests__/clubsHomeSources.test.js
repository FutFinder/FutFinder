/**
 * Pruebas de las reglas puras que alimentan la portada de Clubes.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. `useClubsHome` es un hook y el repo no tiene
 * infraestructura de pruebas de render, así que todo lo que decida algo se
 * saca del hook y se prueba acá. Lo que queda en el hook es atar servicios y
 * llamar a estas funciones.
 *
 * Se ejecutan con: npm test
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const S = require('../clubsHomeSources.js');

// ── A qué club pertenece un aviso ───────────────────────────────────
//
// Las tres claves salen de las migraciones que crean los avisos:
//   clubId                       → 13, 14, 16 (membresía) y 47, 47c (sanción)
//   clubRetadorId / clubRetadoId → 26, 28, 42, 43 (cualquier desafío)

test('un aviso de membresía se atribuye por clubId', () => {
  assert.equal(S.avisoDelClub({ data: { clubId: 'c1' } }, 'c1'), true);
  assert.equal(S.avisoDelClub({ data: { clubId: 'c2' } }, 'c1'), false);
});

test('un aviso de desafío se atribuye por cualquiera de los dos clubes', () => {
  const aviso = { data: { clubRetadorId: 'c1', clubRetadoId: 'c2' } };
  assert.equal(S.avisoDelClub(aviso, 'c1'), true);
  assert.equal(S.avisoDelClub(aviso, 'c2'), true);
  assert.equal(S.avisoDelClub(aviso, 'c3'), false);
});

test('un aviso que solo lleva matchId no se atribuye a ningún club', () => {
  // A propósito: una lista corta y cierta es mejor que una completa y
  // adivinada. Un partido normal no es actividad del club.
  assert.equal(S.avisoDelClub({ data: { matchId: 'm1' } }, 'c1'), false);
});

test('un aviso sin data no revienta', () => {
  assert.equal(S.avisoDelClub({}, 'c1'), false);
  assert.equal(S.avisoDelClub(null, 'c1'), false);
});

test('sin club activo ningún aviso se atribuye', () => {
  // Si `clubId` viniera nulo, `d.clubId === clubId` sería verdadero para
  // todo aviso sin club y la actividad se llenaría de cosas ajenas.
  assert.equal(S.avisoDelClub({ data: {} }, null), false);
  assert.equal(S.avisoDelClub({ data: { clubId: null } }, null), false);
});

// ── Qué club queda activo ───────────────────────────────────────────

const CLUBES = [
  { club: { id: 'c1', nombre: 'primero' }, miRol: 'admin' },
  { club: { id: 'c2', nombre: 'segundo' }, miRol: 'jugador' },
];

test('sin clubes no hay club activo', () => {
  assert.equal(S.elegirClubActivo([], 'c1'), null);
  assert.equal(S.elegirClubActivo(undefined, 'c1'), null);
});

test('el club guardado manda si todavía pertenezco a él', () => {
  assert.equal(S.elegirClubActivo(CLUBES, 'c2'), 'c2');
});

test('si el club guardado ya no es mío, cae al primero por fecha de ingreso', () => {
  // `getMyClubs` ordena por `joined_at`, así que el primero es el más antiguo.
  assert.equal(S.elegirClubActivo(CLUBES, 'club-del-que-me-fui'), 'c1');
});

test('sin nada guardado, el primero', () => {
  assert.equal(S.elegirClubActivo(CLUBES, null), 'c1');
});

test('una membresía sin club no se elige ni rompe la elección', () => {
  assert.equal(S.elegirClubActivo([{ miRol: 'admin' }, ...CLUBES], null), 'c1');
});

// ── Miembro, pendiente o nada ───────────────────────────────────────

test('con clubes soy miembro, aunque además tenga invitaciones', () => {
  assert.equal(
    S.derivarMembresia({ clubes: CLUBES, invitaciones: [{ id: 'i1' }], solicitudes: [] }),
    'member'
  );
});

test('sin clubes y con una invitación, quedo pendiente', () => {
  assert.equal(
    S.derivarMembresia({ clubes: [], invitaciones: [{ id: 'i1' }], solicitudes: [] }),
    'pending'
  );
});

test('sin clubes y con una solicitud enviada, también quedo pendiente', () => {
  // El caso que antes era inalcanzable: dependía de un id guardado en
  // AsyncStorage de una membresía anterior, así que quien postulaba a su
  // primer club veía «Aún sin club».
  assert.equal(
    S.derivarMembresia({ clubes: [], invitaciones: [], solicitudes: [{ id: 'r1' }] }),
    'pending'
  );
});

test('sin clubes, sin invitaciones y sin solicitudes, no hay nada', () => {
  assert.equal(S.derivarMembresia({ clubes: [], invitaciones: [], solicitudes: [] }), 'none');
});

test('la membresía no revienta con fuentes ausentes', () => {
  assert.equal(S.derivarMembresia({}), 'none');
  assert.equal(S.derivarMembresia(), 'none');
});

// ── Qué partido puede tener un cambio pendiente ─────────────────────

test('un partido nacido de una propuesta admite cambio', () => {
  assert.equal(
    S.partidoAdmiteCambio({ id: 'm1', challenge_proposal_id: 'p1', cupos_por_club: 11 }),
    true
  );
});

test('sin cupos por club el partido SIGUE admitiendo cambio', () => {
  // El acople que había: la consulta del cambio colgaba de
  // `usaNominaPorClub()`, que además exige `cupos_por_club != null`.
  // `responder_cambio_partido` (migración 46:395) solo exige la propuesta,
  // así que un partido sin cupos nunca mostraba su cambio pendiente.
  assert.equal(
    S.partidoAdmiteCambio({ id: 'm1', challenge_proposal_id: 'p1', cupos_por_club: null }),
    true
  );
});

test('un partido normal no admite cambio de partido de clubes', () => {
  assert.equal(S.partidoAdmiteCambio({ id: 'm1', challenge_proposal_id: null }), false);
  assert.equal(S.partidoAdmiteCambio(null), false);
});
