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
 * sacarlo del archivo y usar el token (`paleta.*`) o, en NativeWind, la
 * clase con nombre que define `tailwind.config.js`.
 *
 * Y DESDE QUE EXISTE `alfa()` TAMPOCO SE ESCRIBE LA PALETA ACTUAL A MANO.
 * Había ~150 `rgba(85,223,105,0.35)` con cuarenta opacidades distintas: el
 * color correcto, pero escrito de nuevo en cada sitio, así que el día que el
 * verde cambie ninguno lo sigue. Ahora se escribe `alfa(C.green, 0.35)` y el
 * color tiene un solo dueño. La segunda prueba de este archivo lo vigila.
 */

const RAIZ = path.resolve(__dirname, '../..');
const RAIZ_REPO = path.resolve(RAIZ, '..');

/**
 * Y MIRA TAMBIÉN LA CONFIG DE LA RAÍZ, que es el agujero por el que se coló
 * la tercera vez. `archivosDeFuente()` sólo recorre `src/`, así que durante
 * casi un mes `app.config.js` siguió declarando el verde oliva legado en tres
 * sitios: el `color` de `notification`, el `themeColor` del PWA y el `color`
 * del plugin `expo-notifications`. Ese último es el tinte del ícono de
 * notificación en Android, o sea que lo veía cualquiera que recibiera un
 * push: el color viejo estaba en el lugar más visible de todos, justo donde
 * nadie estaba mirando.
 *
 * Son los dos archivos de la raíz que pintan: `app.config.js` porque declara
 * colores de la app nativa y del PWA, y `tailwind.config.js` porque declara
 * las clases con nombre. El resto (`App.js`, `index.js`, `babel.config.js`,
 * `metro.config.js`) no nombra colores; si algún día lo hace, se agrega acá.
 *
 * `app.config.js` no puede importar de `src/theme/colors.js`: lo evalúa Node
 * antes del bundler y `colors.js` es un módulo ES. Por eso ahí el hex va
 * escrito, con un comentario que dice de dónde sale — y por eso esta prueba
 * es lo único que lo mantiene sincronizado con la paleta.
 */
const CONFIG_DE_RAIZ = ['app.config.js', 'tailwind.config.js'];

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

/** Todo lo que pinta: `src/` y los archivos de configuración de la raíz. */
function archivosConPaleta() {
  return [...archivosDeFuente(), ...CONFIG_DE_RAIZ.map((n) => path.join(RAIZ_REPO, n))];
}

test('ningún color de las paletas borradas está escrito a mano en src/ ni en la config de la raíz', () => {
  const hallazgos = [];

  for (const archivo of archivosConPaleta()) {
    const codigo = fs.readFileSync(archivo, 'utf8');
    const relativo = path.relative(RAIZ_REPO, archivo);
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
      + '`paleta`, o la clase con nombre de `tailwind.config.js` si es '
      + `NativeWind:\n  ${hallazgos.join('\n  ')}`
  );
});

/** Las tripletas de la paleta ACTUAL: correctas, pero no se escriben a mano. */
const A_MANO = {
  // El blanco translúcido también: como superficie o borde va
  // `alfa(C.tinta, 0.06)`, y como TEXTO no va — para eso está la rampa
  // (`textSoft`, `textDim`, `textSecondary`…). Un texto con opacidad se
  // multiplica contra el fondo, así que el mismo «blanco al 50%» se lee
  // distinto sobre la página, sobre una tarjeta y sobre un héroe.
  '255,255,255': 'tinta',
  '85,223,105': 'green',
  '237,107,118': 'red',
  '232,179,75': 'amber',
  '255,45,85': 'neon',
};

test('la paleta actual tampoco se escribe a mano: para eso está alfa()', () => {
  const hallazgos = [];
  for (const archivo of archivosConPaleta()) {
    const codigo = fs.readFileSync(archivo, 'utf8');
    const relativo = path.relative(RAIZ_REPO, archivo);
    for (const [rgb, nombre] of Object.entries(A_MANO)) {
      const [r, g, b] = rgb.split(',');
      const re = new RegExp(`rgba?\\(\\s*${r}\\s*,\\s*${g}\\s*,\\s*${b}\\s*[,)]`, 'g');
      const veces = (codigo.match(re) || []).length;
      if (veces > 0) hallazgos.push(`${relativo}: ${nombre} × ${veces}`);
    }
  }
  assert.deepEqual(
    hallazgos,
    [],
    'Estos escriben un color de la paleta con su opacidad en vez de usar '
      + `\`alfa(C.<color>, opacidad)\`:\n  ${hallazgos.join('\n  ')}`
  );
});

test('tailwind expone la paleta con nombre, para que nadie escriba un hex', () => {
  // La otra mitad del arreglo: mientras `theme.extend.colors` estuviera vacío,
  // la única forma de pintar algo con NativeWind era el valor arbitrario
  // `bg-[#...]`, que es exactamente lo que se nos escapó.
  const config = require(path.join(RAIZ_REPO, 'tailwind.config.js'));
  const colores = config.theme?.extend?.colors || {};
  const { paleta } = require('../colors.js');

  assert.equal(colores.verde, paleta.green, 'la clase `verde` debe salir del theme');
  assert.equal(colores.fondo, paleta.bg, 'la clase `fondo` debe salir del theme');
  assert.ok(
    Object.keys(colores).length >= 6,
    'tailwind tiene que exponer la paleta, no un par de colores sueltos'
  );
});

test('app.config.js pinta con el verde de la paleta, no con una copia vieja', () => {
  // La otra mitad del arreglo. El test de arriba caza los colores BORRADOS,
  // así que el día que `paleta.green` cambie de valor no diría nada: el hex de
  // `app.config.js` se quedaría en el verde de hoy, que no está prohibido,
  // y volveríamos a tener dos verdes. Como ese archivo no puede importar
  // `colors.js` (ver el comentario de `VERDE` ahí: lo evalúa el prebuild, en
  // un Node cuya versión no fijamos), lo que une las dos copias es esto.
  const { expo } = require(path.join(RAIZ_REPO, 'app.config.js'));
  const { paleta } = require('../colors.js');
  const plugin = expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-notifications');

  // El tinte del ícono de notificación en Android: el sitio más visible de
  // los tres, porque lo ve cualquiera que reciba un push.
  assert.equal(plugin[1].color, paleta.green, 'el plugin expo-notifications');
  assert.equal(expo.notification.color, paleta.green, 'notification.color');
  assert.equal(expo.web.themeColor, paleta.green, 'el themeColor del PWA');
});
