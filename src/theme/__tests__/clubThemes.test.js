const test = require('node:test');
const assert = require('node:assert/strict');

const T = require('../clubThemes.js');
const { dsColors } = require('../colors.js');

/**
 * Tema de color del club.
 *
 * LO QUE DE VERDAD SE PROTEGE ACÁ:
 *
 *   · SON CUATRO CLAVES ESTABLES, NO COLORES LIBRES. Lo que viaja a la base
 *     de datos es 'green' | 'blue' | 'red' | 'yellow'. Un HEX escrito a mano
 *     no es un tema válido, ni siquiera el HEX del verde corporativo.
 *
 *   · UN CLUB SIN TEMA ES VERDE. Los clubes creados antes de la migración 53
 *     no tienen columna que leer, y la pantalla no puede quedarse sin color.
 *
 *   · CADA TEMA ES UNA ESCALA, NO UN COLOR. Principal, fondo suave, borde,
 *     presionado, resplandor y tinta de contraste salen todos del mismo
 *     lugar, así ningún componente inventa su propio `rgba(...)`.
 *
 *   · EL CONTRASTE SE MIDE, NO SE SUPONE. El texto sobre el color principal
 *     y el color principal sobre el fondo oscuro cumplen 4,5:1 de la WCAG.
 *
 *   · UN TEMA NO PUEDE DISFRAZARSE DE SEMÁNTICA. El rojo del club no puede
 *     confundirse con la derrota, ni el amarillo con el empate o con el
 *     dorado de Premium: se exige distancia de color, no solo hex distinto.
 */

// ── Utilidades de color, solo para las pruebas ────────────────────────

function aRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** Luminancia relativa WCAG 2.1. */
function luminancia(hex) {
  const [r, g, b] = aRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razón de contraste WCAG entre dos colores opacos. */
function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  const [claro, oscuro] = la > lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Distancia euclídea en RGB: sirve para «no se parecen». */
function distancia(a, b) {
  const [r1, g1, b1] = aRgb(a);
  const [r2, g2, b2] = aRgb(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

const CLAVES = ['green', 'blue', 'red', 'yellow'];

// ── Catálogo ──────────────────────────────────────────────────────────

test('el catálogo ofrece exactamente cuatro temas, en español', () => {
  assert.deepEqual(
    T.TEMAS_CLUB.map((t) => t.value),
    CLAVES
  );
  assert.deepEqual(
    T.TEMAS_CLUB.map((t) => t.label),
    ['Verde', 'Azul', 'Rojo', 'Amarillo']
  );
});

test('el tema por defecto es el verde', () => {
  assert.equal(T.TEMA_CLUB_POR_DEFECTO, 'green');
});

test('cada opción del catálogo trae su color principal para pintar el círculo', () => {
  for (const opcion of T.TEMAS_CLUB) {
    assert.equal(opcion.main, T.temaClub(opcion.value).main);
  }
});

// ── Validación: claves estables, nunca HEX ───────────────────────────

test('solo las cuatro claves son válidas', () => {
  for (const clave of CLAVES) {
    assert.equal(T.esTemaClubValido(clave), true, clave);
  }
});

test('un HEX escrito a mano NO es un tema válido', () => {
  assert.equal(T.esTemaClubValido('#5AE06A'), false);
  assert.equal(T.esTemaClubValido('5AE06A'), false);
  assert.equal(T.esTemaClubValido('rgb(90,224,106)'), false);
});

test('un color inventado, vacío o ausente tampoco es válido', () => {
  for (const malo of ['purple', 'verde', 'GREEN', '', null, undefined, 0, {}]) {
    assert.equal(T.esTemaClubValido(malo), false, String(malo));
  }
});

test('normalizar deja pasar las claves buenas y devuelve verde para el resto', () => {
  assert.equal(T.normalizarTemaClub('blue'), 'blue');
  assert.equal(T.normalizarTemaClub('yellow'), 'yellow');
  assert.equal(T.normalizarTemaClub('purple'), 'green');
  assert.equal(T.normalizarTemaClub('#FF0000'), 'green');
  assert.equal(T.normalizarTemaClub(null), 'green');
  assert.equal(T.normalizarTemaClub(undefined), 'green');
});

// ── Club antiguo sin tema ────────────────────────────────────────────

test('un club sin tema guardado se muestra en verde', () => {
  assert.equal(T.temaDeClub({ id: 'c1', nombre: 'Club viejo' }).clave, 'green');
  assert.equal(T.temaDeClub({ tema: null }).clave, 'green');
  assert.equal(T.temaDeClub(null).clave, 'green');
  assert.equal(T.temaDeClub(undefined).clave, 'green');
});

test('un club con tema guardado se muestra con ese tema', () => {
  assert.equal(T.temaDeClub({ tema: 'red' }).clave, 'red');
  assert.equal(T.temaDeClub({ tema: 'red' }).main, T.temaClub('red').main);
});

test('un tema desconocido en la base de datos no deja la pantalla sin color', () => {
  assert.equal(T.temaDeClub({ tema: 'fucsia' }).clave, 'green');
});

// ── Escala de tonos ──────────────────────────────────────────────────

const TONOS = ['main', 'pressed', 'soft', 'softStrong', 'border', 'glow', 'ink'];

test('cada tema es una escala completa, no un solo color', () => {
  for (const clave of CLAVES) {
    const escala = T.temaClub(clave);
    for (const tono of TONOS) {
      assert.equal(typeof escala[tono], 'string', `${clave}.${tono}`);
      assert.ok(escala[tono].length > 0, `${clave}.${tono} vacío`);
    }
    assert.equal(escala.clave, clave);
    assert.equal(typeof escala.nombre, 'string');
  }
});

test('el fondo suave, el borde y el resplandor se derivan del color principal', () => {
  for (const clave of CLAVES) {
    const escala = T.temaClub(clave);
    const [r, g, b] = aRgb(escala.main);
    for (const tono of ['soft', 'softStrong', 'border', 'glow']) {
      assert.ok(
        escala[tono].startsWith(`rgba(${r}, ${g}, ${b},`),
        `${clave}.${tono} debería derivar de ${escala.main}, es ${escala[tono]}`
      );
    }
  }
});

test('el fondo suave presionado es más opaco que el de reposo', () => {
  for (const clave of CLAVES) {
    const escala = T.temaClub(clave);
    const alfa = (c) => Number(c.match(/,\s*([\d.]+)\)$/)[1]);
    assert.ok(alfa(escala.softStrong) > alfa(escala.soft), clave);
  }
});

test('el estado presionado es más oscuro que el principal', () => {
  for (const clave of CLAVES) {
    const escala = T.temaClub(clave);
    assert.ok(
      luminancia(escala.pressed) < luminancia(escala.main),
      `${clave}: ${escala.pressed} debería ser más oscuro que ${escala.main}`
    );
  }
});

test('los cuatro temas tienen colores principales distintos', () => {
  const mains = CLAVES.map((c) => T.temaClub(c).main);
  assert.equal(new Set(mains).size, 4);
});

// ── Contraste ────────────────────────────────────────────────────────

test('el texto sobre el color principal cumple 4,5:1', () => {
  for (const clave of CLAVES) {
    const { main, ink } = T.temaClub(clave);
    const razon = contraste(ink, main);
    assert.ok(razon >= 4.5, `${clave}: contraste ${razon.toFixed(2)} entre ${ink} y ${main}`);
  }
});

test('el color principal sobre el fondo oscuro cumple 4,5:1', () => {
  for (const clave of CLAVES) {
    const { main } = T.temaClub(clave);
    const razon = contraste(main, dsColors.background);
    assert.ok(
      razon >= 4.5,
      `${clave}: contraste ${razon.toFixed(2)} de ${main} sobre ${dsColors.background}`
    );
  }
});

// ── El tema no puede disfrazarse de color semántico ──────────────────

test('ningún tema se confunde con derrota, empate ni con el dorado de Premium', () => {
  const SEMANTICOS = {
    derrota: dsColors.loss,
    empate: dsColors.draw,
    premium: dsColors.gold,
  };
  for (const clave of CLAVES) {
    const { main } = T.temaClub(clave);
    for (const [nombre, hex] of Object.entries(SEMANTICOS)) {
      const d = distancia(main, hex);
      assert.ok(
        d >= 50,
        `el tema ${clave} (${main}) queda a ${d.toFixed(1)} del color de ${nombre} (${hex})`
      );
    }
  }
});

test('el verde del club sigue siendo el verde corporativo de la app', () => {
  assert.equal(T.temaClub('green').main, dsColors.green);
  assert.equal(T.temaClub('green').ink, dsColors.greenInk);
});

// ── Banner del encabezado ────────────────────────────────────────────

test('cada tema trae la base del banner en rgb crudo, para las bandas', () => {
  for (const clave of CLAVES) {
    const escala = T.temaClub(clave);
    assert.match(escala.bannerRgb, /^\d{1,3}, \d{1,3}, \d{1,3}$/, clave);
  }
});

test('la base del banner es oscura: es un fondo, no un acento', () => {
  for (const clave of CLAVES) {
    const [r, g, b] = T.temaClub(clave).bannerRgb.split(',').map((n) => Number(n.trim()));
    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    assert.ok(
      luminancia(hex) < luminancia(T.temaClub(clave).main) / 4,
      `${clave}: ${hex} no es lo bastante oscuro para un banner`
    );
  }
});

// ── Sin contaminación entre clubes ───────────────────────────────────

test('resolver el tema de un club no altera el de otro', () => {
  const rojo = T.temaDeClub({ id: 'a', tema: 'red' });
  const azul = T.temaDeClub({ id: 'b', tema: 'blue' });
  const rojoOtraVez = T.temaDeClub({ id: 'a', tema: 'red' });

  assert.notEqual(rojo.main, azul.main);
  assert.equal(rojo.main, rojoOtraVez.main);
  assert.equal(T.temaClub('green').main, dsColors.green);
});

test('la escala que se entrega no puede modificar el catálogo', () => {
  const escala = T.temaClub('blue');
  const original = escala.main;

  assert.equal(Object.isFrozen(escala), true, 'la escala debería estar congelada');
  try {
    escala.main = '#000000';
  } catch {
    // En módulo estricto la asignación lanza; en sloppy se ignora. Da igual
    // cuál de las dos: lo que importa es que el catálogo no se movió.
  }

  assert.equal(escala.main, original);
  assert.equal(T.temaClub('blue').main, original);
});

test('los alfas del acento son los que fija el handoff de la portada', () => {
  // Estos tres números son una decisión, no un detalle: el handoff los pide
  // así y `dsColors.winSoft` ya usa .14. Sin esta prueba, el próximo retoque
  // de color los pierde en silencio y la portada deja de calzar con el resto.
  const alfa = (c) => Number(c.match(/,\s*([\d.]+)\)$/)[1]);
  for (const clave of CLAVES) {
    const escala = T.temaClub(clave);
    assert.equal(alfa(escala.soft), 0.14, `${clave}.soft`);
    assert.equal(alfa(escala.border), 0.42, `${clave}.border`);
    assert.equal(alfa(escala.glow), 0.3, `${clave}.glow`);
  }
});
