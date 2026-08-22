const test = require('node:test');
const assert = require('node:assert/strict');

const E = require('../clubEdit.js');

/**
 * «Editar club»: qué se manda a la base de datos y quién puede mandarlo.
 *
 * LO QUE DE VERDAD SE PROTEGE ACÁ:
 *
 *   · UN CAMPO QUE NO SE TOCÓ NO VIAJA. `undefined` es «no lo edité» y
 *     `null` es «lo borré». Confundirlos borra la comuna de un club porque
 *     el formulario no la traía cargada.
 *
 *   · EL TEMA ES UNA CLAVE, NO UN COLOR. Un HEX no llega a la base de
 *     datos ni siquiera intentándolo: se rechaza antes de salir del
 *     teléfono, y la migración 53 lo vuelve a rechazar en el servidor.
 *
 *   · EL NOMBRE Y EL SLUG VAN JUNTOS. Cambiar el nombre sin recalcular el
 *     slug deja la futura URL pública apuntando al nombre viejo.
 *
 *   · SIN PERMISO NO SE OFRECE. «No administro este club» y «no pude
 *     averiguarlo» esconden los dos el formulario, pero no son lo mismo:
 *     la pantalla tiene que poder explicar el segundo.
 */

// ── slug ─────────────────────────────────────────────────────────────

test('el slug baja a minúsculas y une con guiones', () => {
  assert.equal(E.slugClub('Club Prueba'), 'club-prueba');
});

test('el slug saca las tildes y la eñe queda sin virgulilla', () => {
  assert.equal(E.slugClub('Atlético La Reina'), 'atletico-la-reina');
  assert.equal(E.slugClub('Deportivo Ñuñoa'), 'deportivo-nunoa');
});

test('el slug descarta los signos que no valen en una URL', () => {
  assert.equal(E.slugClub('¡Los Cracks! (2024)'), 'los-cracks-2024');
});

test('el slug no deja espacios en los extremos ni dobles adentro', () => {
  assert.equal(E.slugClub('  Los   Tigres  '), 'los-tigres');
});

// ── buildClubPatch: solo viaja lo que se editó ───────────────────────

test('un formulario sin cambios no manda ningún campo', () => {
  const { patch, error } = E.buildClubPatch({});
  assert.equal(error, null);
  assert.deepEqual(patch, {});
});

test('cambiar el nombre manda nombre y slug juntos', () => {
  const { patch, error } = E.buildClubPatch({ nombre: '  Atlético La Reina  ' });
  assert.equal(error, null);
  assert.deepEqual(patch, { nombre: 'Atlético La Reina', slug: 'atletico-la-reina' });
});

test('un nombre demasiado corto se rechaza y no manda nada', () => {
  const { patch, error } = E.buildClubPatch({ nombre: 'ab' });
  assert.equal(patch, null);
  assert.match(error.message, /entre 3 y 40/);
});

test('un nombre demasiado largo se rechaza', () => {
  const { error } = E.buildClubPatch({ nombre: 'x'.repeat(41) });
  assert.match(error.message, /entre 3 y 40/);
});

test('un nombre de solo espacios se rechaza', () => {
  const { error } = E.buildClubPatch({ nombre: '     ' });
  assert.match(error.message, /entre 3 y 40/);
});

test('una descripción vacía se guarda como nula, no como cadena vacía', () => {
  assert.deepEqual(E.buildClubPatch({ descripcion: '   ' }).patch, { descripcion: null });
});

test('la descripción se guarda recortada', () => {
  assert.deepEqual(E.buildClubPatch({ descripcion: '  hola  ' }).patch, { descripcion: 'hola' });
});

test('región y comuna viajan tal cual, incluso al borrarlas', () => {
  assert.deepEqual(
    E.buildClubPatch({ region: 'Región de Arica y Parinacota', comuna: null }).patch,
    { region: 'Región de Arica y Parinacota', comuna: null }
  );
});

test('una modalidad conocida viaja; una inventada se rechaza', () => {
  assert.deepEqual(E.buildClubPatch({ modalidad: 'futbol7' }).patch, { modalidad: 'futbol7' });
  assert.match(E.buildClubPatch({ modalidad: 'futbol5' }).error.message, /Modalidad/);
});

test('deseleccionar la modalidad la deja nula', () => {
  assert.deepEqual(E.buildClubPatch({ modalidad: null }).patch, { modalidad: null });
});

// ── buildClubPatch: el tema ──────────────────────────────────────────

test('los cuatro temas viajan como clave estable', () => {
  for (const tema of ['green', 'blue', 'red', 'yellow']) {
    assert.deepEqual(E.buildClubPatch({ tema }).patch, { tema });
  }
});

test('un HEX nunca llega a la base de datos', () => {
  const { patch, error } = E.buildClubPatch({ tema: '#FF0000' });
  assert.equal(patch, null);
  assert.match(error.message, /[Tt]ema/);
});

test('un tema inventado se rechaza en vez de guardarse', () => {
  assert.match(E.buildClubPatch({ tema: 'purple' }).error.message, /[Tt]ema/);
  assert.match(E.buildClubPatch({ tema: 'GREEN' }).error.message, /[Tt]ema/);
});

test('no elegir tema no manda la columna: un club antiguo se queda como está', () => {
  assert.deepEqual(E.buildClubPatch({ nombre: 'Club prueba' }).patch, {
    nombre: 'Club prueba',
    slug: 'club-prueba',
  });
});

test('el tema tampoco se puede borrar poniéndolo nulo', () => {
  assert.match(E.buildClubPatch({ tema: null }).error.message, /[Tt]ema/);
});

test('un formulario completo manda todos sus campos de una vez', () => {
  const { patch, error } = E.buildClubPatch({
    nombre: 'Club prueba',
    descripcion: 'hola',
    region: 'Región de Arica y Parinacota',
    comuna: 'Arica',
    modalidad: 'ambos',
    tema: 'blue',
  });
  assert.equal(error, null);
  assert.deepEqual(patch, {
    nombre: 'Club prueba',
    slug: 'club-prueba',
    descripcion: 'hola',
    region: 'Región de Arica y Parinacota',
    comuna: 'Arica',
    modalidad: 'ambos',
    tema: 'blue',
  });
});

test('si un campo es inválido no se guarda ninguno de los otros', () => {
  const { patch } = E.buildClubPatch({ nombre: 'Club prueba', tema: '#00FF00' });
  assert.equal(patch, null);
});

// ── Quién puede editar ───────────────────────────────────────────────

test('el administrador del club puede editarlo', () => {
  assert.equal(E.puedeEditarClub({ clubesAdmin: ['c1', 'c2'], clubId: 'c1' }), true);
});

test('un integrante que no administra el club no puede editarlo', () => {
  assert.equal(E.puedeEditarClub({ clubesAdmin: [], clubId: 'c1' }), false);
});

test('administrar OTRO club no da permiso sobre este', () => {
  assert.equal(E.puedeEditarClub({ clubesAdmin: ['c2'], clubId: 'c1' }), false);
});

test('«no se pudo averiguar» (null) no se toma como permiso', () => {
  assert.equal(E.puedeEditarClub({ clubesAdmin: null, clubId: 'c1' }), false);
  assert.equal(E.puedeEditarClub({ clubId: 'c1' }), false);
  assert.equal(E.puedeEditarClub(), false);
});

test('sin club no hay permiso', () => {
  assert.equal(E.puedeEditarClub({ clubesAdmin: ['c1'], clubId: null }), false);
});

// ── Estado de la pantalla ────────────────────────────────────────────

test('mientras se comprueba el permiso no se muestra ni el formulario ni el candado', () => {
  assert.equal(E.getEditClubStatus({ loading: true, clubesAdmin: null }), 'loading');
});

test('si no se pudo comprobar el permiso, la pantalla lo dice', () => {
  assert.equal(E.getEditClubStatus({ loading: false, clubesAdmin: null, clubId: 'c1' }), 'error');
});

test('sin permiso se muestra el aviso, no el formulario', () => {
  assert.equal(E.getEditClubStatus({ loading: false, clubesAdmin: [], clubId: 'c1' }), 'denied');
});

test('con permiso se muestra el formulario', () => {
  assert.equal(E.getEditClubStatus({ loading: false, clubesAdmin: ['c1'], clubId: 'c1' }), 'ready');
});
