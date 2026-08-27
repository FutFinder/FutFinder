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
