const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readSplashSrc() {
  return fs.readFileSync(path.join(__dirname, '../SplashScreen.js'), 'utf8');
}

test('usa el mismo ícono y wordmark oficiales que BrandMark, no un ícono propio', () => {
  const src = readSplashSrc();
  assert.match(src, /MapPin/, 'debe usar el ícono MapPin, igual que BrandMark');
  // El acento salía de `tactical.neon` (#00FF66) hasta que la app se unificó
  // en una sola estética el 2026-09-16; ahora es el verde único.
  assert.match(src, /C\.green/, 'el ícono y el acento del wordmark deben usar el verde de la paleta');
  assert.match(src, /Fut<Text/, 'el wordmark «FutFinder» debe estar presente');
  assert.doesNotMatch(
    src,
    /<Svg/,
    'no debe quedar el ícono SVG de pin+balón dibujado a mano de la animación antigua'
  );
});

test('consulta reduce motion antes de animar', () => {
  const src = readSplashSrc();
  assert.match(src, /AccessibilityInfo\.isReduceMotionEnabled/);
});

test('nunca repite la animación (sin Animated.loop)', () => {
  const src = readSplashSrc();
  assert.doesNotMatch(src, /Animated\.loop/);
});

test('usa la paleta única, no ninguna de las familias viejas', () => {
  // Nació comprobando que el splash no volviera a la paleta global antigua, y
  // después que usara la de Clubes. Desde que la app tiene UNA estética
  // (2026-09-16) la comprobación es la misma idea con una sola respuesta: la
  // primera pantalla que se ve no puede ser la que se quede atrás.
  const src = readSplashSrc();
  assert.match(src, /paleta as C/, 'debe importar la paleta única');
  for (const vieja of ['colors', 'dsColors', 'clubColors', 'chatColors', 'tactical', 'partidos']) {
    assert.doesNotMatch(
      src,
      new RegExp(`\\b${vieja}\\.`),
      `no debe quedar ninguna referencia a ${vieja}`
    );
  }
});

test('no agrega un retraso artificial desacoplado de la carga real', () => {
  const src = readSplashSrc();
  assert.doesNotMatch(
    src,
    /setTimeout/,
    'no debe haber un setTimeout que retrase la navegación de forma artificial'
  );
});

test('espera tanto la animación como la resolución de sesión antes de navegar', () => {
  const src = readSplashSrc();
  assert.match(
    src,
    /Promise\.all/,
    'debe coordinar la animación y getOnboardingState con Promise.all antes de navegar'
  );
});

test('conserva el contrato de navegación hacia Main/LocationPermission/Welcome', () => {
  const src = readSplashSrc();
  assert.match(src, /getOnboardingState/);
  assert.match(src, /getInitialRouteName/);
  assert.match(src, /navigation\.reset\(\{ index: 0, routes: \[\{ name: 'Main' \}\] \}\)/);
  assert.match(src, /navigation\.reset\(\{ index: 0, routes: \[\{ name: 'LocationPermission' \}\] \}\)/);
  assert.match(src, /navigation\.replace\('Welcome'\)/);
});

test('los valores del pin y el wordmark coinciden con BrandMark.js (mismo ícono oficial)', () => {
  const splashSrc = readSplashSrc();
  const brandMarkSrc = fs.readFileSync(path.join(__dirname, '../../components/BrandMark.js'), 'utf8');

  const sharedValues = [
    /strokeWidth={2\.2}/,
    /fontSize: 21/,
    // Era `fontWeight: '800'` hasta que la app pasó a Manrope: en React Native
    // el peso se fija con `fontFamily`, no con `fontWeight`.
    /fontFamily: F\.extraBold/,
    /letterSpacing: -0\.4/,
    /gap: 8/,
  ];

  for (const pattern of sharedValues) {
    assert.match(brandMarkSrc, pattern, `BrandMark.js debería tener ${pattern}`);
    assert.match(splashSrc, pattern, `SplashScreen.js debería reproducir ${pattern} de BrandMark.js`);
  }

  assert.match(splashSrc, /ICON_SIZE = 26/, 'el tamaño del ícono debe coincidir con el size={26} de BrandMark');
  assert.match(brandMarkSrc, /size=\{26\}/, 'BrandMark.js debe seguir usando tamaño 26 (si cambia, SplashScreen debe seguirlo)');
});
