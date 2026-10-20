const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

/**
 * Que la barra fija de abajo no se coma la última fila de la pantalla.
 *
 * POR QUÉ EXISTE. `StickyFooter` se dibuja en `position: 'absolute'` pegado
 * al borde inferior, ENCIMA del contenido. El `ScrollView` no sabe que está
 * ahí, así que si su `contentContainerStyle` no reserva el hueco, lo último
 * de la página queda tapado para siempre: no se destapa bajando, porque el
 * scroll ya llegó al final.
 *
 * Lo encontró un recorrido a mano el 2026-10-19 en `ComplejoDetailScreen`:
 * tenía `paddingBottom: 24` contra una barra de ~90, y lo que quedaba
 * debajo era la DIRECCIÓN del recinto — justo lo que la sección «Ubicación»
 * viene a decir. Todas las demás pantallas con barra ya reservaban entre
 * 110 y 130; esa se había quedado sin el hueco y nadie lo había mirado.
 *
 * No se puede comprobar con lint ni renderizando: es una resta entre dos
 * medidas que viven en archivos distintos. Así que se mira el texto, igual
 * que `nadieEscribeLaPaletaAMano`.
 */

const SCREENS = path.join(__dirname, '..');
const MINIMO = 100; // la barra mide ~90 con su padding; 100 es el piso cómodo

function pantallasConBarraFija() {
  return fs.readdirSync(SCREENS)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => /<StickyFooter[\s>]/.test(fs.readFileSync(path.join(SCREENS, f), 'utf8')));
}

test('hay pantallas con barra fija que vigilar', () => {
  // Si `StickyFooter` se renombra, esta prueba dejaría de mirar nada y
  // pasaría igual. Mejor que falle y se note.
  assert.ok(pantallasConBarraFija().length >= 5);
});

test('toda pantalla con barra fija reserva el hueco en su scroll', () => {
  const sinHueco = [];

  for (const archivo of pantallasConBarraFija()) {
    const src = fs.readFileSync(path.join(SCREENS, archivo), 'utf8');

    // Vale cualquiera de las dos formas de reservarlo: `paddingBottom` en el
    // contenedor del scroll, o un espaciador `<View style={{ height: N }} />`
    // al final — las dos se usan en el repositorio y las dos funcionan.
    //
    // Basta una: una pantalla puede tener varios scrolls y solo uno lleva la
    // barra, y distinguirlos exigiría entender el JSX. Lo que se caza acá es
    // la pantalla que NO reserva el hueco en ningún lado, que es el fallo
    // real; no se persigue que el número sea el más fino de cada caso.
    const holgados = [
      ...src.matchAll(/paddingBottom:\s*(\d+)/g),
      // El espaciador, y SOLO en su forma de JSX suelto —`{{ height: N }} />`—
      // y no cualquier `height`: el primer intento de esta prueba miraba todos
      // los alto del archivo y el del recuadro del mapa (150) la hacía pasar
      // sobre la pantalla rota que la originó.
      ...src.matchAll(/height:\s*(\d+)\s*\}\}\s*\/>/g),
    ]
      .map((m) => Number(m[1]))
      .filter((n) => n >= MINIMO);

    if (holgados.length === 0) sinHueco.push(archivo);
  }

  assert.deepEqual(
    sinHueco, [],
    `Estas pantallas dibujan una barra fija sobre el contenido sin reservarle `
    + `hueco al scroll (paddingBottom >= ${MINIMO}), así que tapan su última fila`,
  );
});

/**
 * La otra mitad del mismo problema: el hueco al final sirve cuando el scroll
 * llegó abajo, pero MIENTRAS se baja el contenido pasa por detrás de la
 * barra. Si la barra no tiene fondo, se ve a través: en la ficha del recinto
 * «Ver horarios» quedaba encima del precio de otra cancha, y en el resumen
 * «Continuar al pago» encima de «¿Necesitas algo más?» (recorrido del
 * 2026-10-20). El componente decía tener «el degradado del handoff» y no
 * tenía ni degradado ni fondo.
 */
test('la barra fija tiene fondo propio', () => {
  const ui = fs.readFileSync(path.join(__dirname, '../../components/reservas/ui.js'), 'utf8');
  const estilo = ui.match(/\n\s*stickyFooter:\s*\{([^}]*)\}/);
  assert.ok(estilo, 'no encontré el estilo `stickyFooter` en components/reservas/ui.js');
  assert.match(estilo[1], /backgroundColor:\s*C\.bg/,
    'la barra fija no tiene fondo: el contenido se ve a través de ella al hacer scroll');
});
