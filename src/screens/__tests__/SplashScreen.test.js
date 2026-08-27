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
  assert.match(src, /tactical\.neon/, 'el ícono y el acento del wordmark deben usar tactical.neon');
  assert.match(src, /fut<Text/, 'el wordmark "fut...finder" debe estar presente');
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

test('usa la paleta oscura de Clubes, no la paleta global antigua', () => {
  const src = readSplashSrc();
  assert.match(src, /clubsExplorer/, 'debe usar clubsExplorer.bg como fondo');
  assert.doesNotMatch(src, /colors\.primary/, 'no debe quedar el verde global antiguo');
  assert.doesNotMatch(src, /colors\.background/, 'no debe quedar el fondo global antiguo');
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
    /fontWeight: '800'/,
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
