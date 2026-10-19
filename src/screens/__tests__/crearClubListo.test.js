/**
 * El formulario de crear club no puede quedar en un estado que apague el
 * botón sin decir por qué.
 *
 * EL FALLO (2026-10-19, creando un club de prueba). `modalidad` empezaba en
 * `null` y es uno de los cuatro datos que exige `listo`. Región y comuna
 * traen su «Selecciona una…», pero las tres fichas de modalidad se quedan
 * quietas y no se leen como obligatorias: se llena todo, se aprieta «Crear
 * club» y **no pasa nada**. Ni un mensaje, ni una pista de qué falta. Me
 * pasó a mí y me fui a buscar un error 500 que no existía.
 *
 * Dos cambios: arranca en `futbol7` —como «Publicar partido», que es la
 * otra pantalla larga de la app— y tocar la ficha activa ya no la
 * deselecciona, porque eso devolvía el formulario al mismo pozo.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'CreateClubScreen.js'),
  'utf8'
);

test('la modalidad arranca elegida, no en null', () => {
  assert.ok(
    /useState\('futbol7'\)/.test(SRC),
    'el formulario vuelve a arrancar sin modalidad'
  );
  assert.ok(
    !/const \[modalidad, setModalidad\] = useState\(null\)/.test(SRC),
    'modalidad vuelve a empezar en null'
  );
});

test('tocar la modalidad activa no la deselecciona', () => {
  assert.ok(
    !/setModalidad\(activa \? null/.test(SRC),
    'se puede volver a dejar el formulario sin modalidad'
  );
});

test('los cuatro datos que exige el botón siguen siendo los mismos', () => {
  // Si alguien agrega un quinto requisito, que se entere de esta prueba y
  // decida si también necesita un valor de partida.
  const m = SRC.match(/const listo = ([^;]+);/);
  assert.ok(m, 'no se encontró la condición del botón');
  const requisitos = (m[1].match(/!!\w+|\w+\.trim\(\)/g) || []).length;
  assert.equal(requisitos, 4, `la condición cambió: ${m[1].trim()}`);
});
