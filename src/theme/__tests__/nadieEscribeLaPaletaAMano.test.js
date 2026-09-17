const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Que ningún color de las paletas BORRADAS vuelva escrito a mano.
 *
 * POR QUÉ EXISTE, y vale la pena contarlo porque nació de un error.
 *
 * Al unificar la estética (2026-09-16) se migraron los imports de tokens de
 * siete familias a una, se puso una regla de lint que prohíbe importar las
 * viejas, y se dio el trabajo por cerrado. No lo estaba: doce archivos
 * —`components/home/`, `components/notifications/`, `HomeScreen`,
 * `NotificationsScreen` y la barra de pestañas— no usan `StyleSheet` sino
 * NativeWind, con el color DENTRO del texto de la clase:
 *
 *     className="bg-[#00FF66] border-[#00FF66]/40"
 *
 * Un reemplazo de tokens no ve eso. La prueba de cobertura tampoco: mira
 * referencias `C.clave`, no cadenas. El lint tampoco: prohíbe importar, no
 * escribir. Y la comprobación visual no lo habría pillado nunca, porque esas
 * pantallas están detrás del login. Resultado: el verde flúor del rediseño
 * anterior siguió vivo en 41 lugares mientras el informe decía lo contrario.
 *
 * Esta prueba es el único chequeo que lo habría atrapado, así que va por el
 * TEXTO del archivo y no por sus imports: es el mismo criterio que
 * `importaciones.test.js` usa para los imports inexistentes.
 *
 * Y MIRA LAS DOS FORMAS, hex y `rgba()`. La primera versión de esta prueba
 * sólo miraba el hex, se puso verde, y quedaban 133 `rgba(90,224,106,…)` —el
 * mismo verde viejo con transparencia— repartidos en 38 archivos. Un color
 * escrito como tripleta decimal es el mismo color.
 *
 * SI FALLA, no hay que agregar el color a la lista de permitidos: hay que
 * sacarlo del archivo y usar el token (`reservas.*`) o, en NativeWind, la
 * clase con nombre que define `tailwind.config.js`.
 *
 * LO QUE NO CUBRE, dicho de frente: no prohíbe escribir a mano un color que SÍ
 * es de la paleta actual (`#55DF69`, `rgba(85,223,105,0.12)`). Eso sigue
 * siendo deuda —hay ~130 alfas literales que deberían salir de un token— pero
 * no es un fallo: pinta bien. Esta prueba existe para lo que pinta MAL.
 */

const RAIZ = path.resolve(__dirname, '../..');

/**
 * Los colores de las paletas que se borraron, con dónde vivía cada uno y su
 * tripleta decimal para cazarlos también en `rgba()`.
 */
const PROHIBIDOS = {
  '#00FF66': { origen: 'tactical.neon (el verde flúor de Inicio)', rgb: [0, 255, 102] },
  '#04120A': { origen: 'tactical.neonInk' },
  '#71B533': { origen: 'colors.primary (el verde oliva legado)', rgb: [113, 181, 51] },
  '#3F762F': { origen: 'colors.primaryDark' },
  '#201F1D': { origen: 'colors.background (el fondo café)' },
  '#2A2927': { origen: 'colors.surface' },
  '#E5484D': { origen: 'colors.error', rgb: [229, 72, 77] },
  '#5AE06A': { origen: 'dsColors.green', rgb: [90, 224, 106] },
  '#0B0D0C': { origen: 'dsColors.background' },
  '#E8737B': { origen: 'dsColors.loss / partidos.coral', rgb: [232, 115, 123] },
  '#FF7A6B': { origen: 'chatColors.danger', rgb: [255, 122, 107] },
  '#FF6B6B': { origen: 'tactical.danger', rgb: [255, 107, 107] },
};

/**
 * `theme/colors.js` queda fuera: es donde la paleta ÚNICA declara sus valores,
 * y alguno coincide a propósito con uno viejo. Las pruebas también: nombran
 * los colores borrados justamente para comprobar que no vuelvan.
 */
function archivosDeFuente(dir = RAIZ, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    if (entrada.isDirectory()) {
      if (entrada.name !== '__tests__' && entrada.name !== 'node_modules') {
        archivosDeFuente(completo, acc);
      }
    } else if (entrada.name.endsWith('.js') && completo !== path.join(RAIZ, 'theme', 'colors.js')) {
      acc.push(completo);
    }
  }
  return acc;
}

test('ningún color de las paletas borradas está escrito a mano en src/', () => {
  const hallazgos = [];

  for (const archivo of archivosDeFuente()) {
    const codigo = fs.readFileSync(archivo, 'utf8');
    const relativo = path.relative(RAIZ, archivo);
    for (const [hex, { origen, rgb }] of Object.entries(PROHIBIDOS)) {
      const formas = [new RegExp(hex, 'gi')];
      // `rgba( 90 , 224 , 106 , .12 )` es el mismo color que `#5AE06A`, así
      // que el patrón tolera los espacios que cada archivo escribió a su modo.
      if (rgb) {
        formas.push(new RegExp(`rgba?\\(\\s*${rgb[0]}\\s*,\\s*${rgb[1]}\\s*,\\s*${rgb[2]}\\s*[,)]`, 'gi'));
      }
      const veces = formas.reduce((n, re) => n + (codigo.match(re) || []).length, 0);
      if (veces > 0) {
        hallazgos.push(`${relativo}: ${hex} × ${veces} — era ${origen}`);
      }
    }
  }

  assert.deepEqual(
    hallazgos,
    [],
    'Hay colores de las paletas borradas escritos a mano. Usa el token de '
      + '`reservas`, o la clase con nombre de `tailwind.config.js` si es '
      + `NativeWind:\n  ${hallazgos.join('\n  ')}`
  );
});

test('tailwind expone la paleta con nombre, para que nadie escriba un hex', () => {
  // La otra mitad del arreglo: mientras `theme.extend.colors` estuviera vacío,
  // la única forma de pintar algo con NativeWind era el valor arbitrario
  // `bg-[#...]`, que es exactamente lo que se nos escapó.
  const config = require(path.resolve(RAIZ, '..', 'tailwind.config.js'));
  const colores = config.theme?.extend?.colors || {};
  const { reservas } = require('../colors.js');

  assert.equal(colores.verde, reservas.green, 'la clase `verde` debe salir del theme');
  assert.equal(colores.fondo, reservas.bg, 'la clase `fondo` debe salir del theme');
  assert.ok(
    Object.keys(colores).length >= 6,
    'tailwind tiene que exponer la paleta, no un par de colores sueltos'
  );
});
