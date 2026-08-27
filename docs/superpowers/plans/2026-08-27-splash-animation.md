# Animación de inicio (Splash) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la animación de inicio de FutFinder (`SplashScreen.js`) por una versión que use el logo oficial compartido (`BrandMark`) y la paleta oscura de Clubes, sin tocar la lógica de sesión/navegación salvo una corrección puntual de coordinación.

**Architecture:** Un solo componente (`src/screens/SplashScreen.js`) orquesta, con `Animated` de React Native, una revelación de marca en dos pasos: el pin (`MapPin`) se asienta primero, luego el wordmark "futfinder" se desliza a su posición final a la derecha del pin y se desvanece hacia dentro — con una rama reducida cuando `AccessibilityInfo.isReduceMotionEnabled()` es verdadero (fundido conjunto, sin desliz). Ícono y texto reconstruyen los valores visuales de `BrandMark.js` (mismo ícono, mismo color, mismo wordmark) como dos piezas independientes, porque `BrandMark` no expone sus partes por separado para poder animarlas en momentos distintos — ver Revisión v2 en la spec. Un `Promise.all` espera tanto la animación como `getOnboardingState()` antes de navegar. `app.config.js` se actualiza para que el splash nativo de Expo (previo a que React monte) use el mismo fondo oscuro, evitando un flash de color.

**Tech Stack:** React Native (`Animated`, `AccessibilityInfo`, `useWindowDimensions`), `react-native-safe-area-context`, componente existente `BrandMark`, tokens existentes `clubsExplorer`/`tactical` de `src/theme/colors.js`, `node --test` para pruebas.

## Global Constraints

- Español de Chile en todo texto visible al usuario (no aplica aquí: esta pantalla no tiene texto propio, solo el wordmark de `BrandMark`).
- No modificar `Logo.js`, `BrandMark.js`, `getOnboardingState`, `getInitialRouteName`, `AppNavigator.js`, `withAuthGuard`, ni la espera de Splash para notificaciones en `App.js`.
- Sin `Animated.loop` en ningún punto: la animación nunca se repite.
- Sin retrasos artificiales: la navegación ocurre apenas la animación (o su variante reducida) Y la sesión están listas — lo que tarde más de las dos, sin agregar espera extra.
- Duración total de la secuencia normal (reduce motion desactivado): ~1.3–1.6s.
- Fondo nuevo: `clubsExplorer.bg` (`#0A0C0A`), no `tactical.bg` (`#000000`) ni `colors.background` (paleta antigua).
- `npm run verify` (lint + tests) debe quedar en cero errores de lint al terminar.

---

### Task 1: Fondo oscuro coherente en el splash nativo (`app.config.js`)

**Files:**
- Modify: `app.config.js:22-25` (bloque `splash`), `app.config.js:59-65` (bloque `web`)

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: nada que otras tareas consuman directamente — es una config estática independiente de `SplashScreen.js`. Su único requisito compartido es el valor de color `'#0A0C0A'`, que Task 3 también usa (como `clubsExplorer.bg`) para que ambos coincidan.

- [ ] **Step 1: Editar `app.config.js`**

Cambiar el bloque `splash` (líneas 22-25) de:

```js
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#201F1D',
    },
```

a:

```js
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#0A0C0A',
    },
    androidStatusBar: {
      backgroundColor: '#0A0C0A',
      barStyle: 'light-content',
    },
```

Y cambiar el bloque `web` (líneas 59-65) de:

```js
    web: {
      bundler: 'metro',
      name: 'FutFinder',
      shortName: 'FutFinder',
      themeColor: '#71B533',
      backgroundColor: '#201F1D',
    },
```

a:

```js
    web: {
      bundler: 'metro',
      name: 'FutFinder',
      shortName: 'FutFinder',
      themeColor: '#71B533',
      backgroundColor: '#0A0C0A',
    },
```

(`themeColor` no se toca — es solo el tinte de UI del navegador en PWA, fuera de alcance.)

- [ ] **Step 2: Verificar que `app.config.js` sigue siendo un módulo válido**

Run: `node -e "const c = require('./app.config.js'); console.log(c.expo.splash, c.expo.androidStatusBar, c.expo.web.backgroundColor);"`

Expected: imprime `{ resizeMode: 'contain', backgroundColor: '#0A0C0A' } { backgroundColor: '#0A0C0A', barStyle: 'light-content' } #0A0C0A` sin lanzar error.

- [ ] **Step 3: Commit**

```bash
git add app.config.js
git commit -m "fix(splash): alinea el fondo nativo con la nueva estética oscura"
```

---

### Task 2 (v2): Reescribir `SplashScreen.js` — pin primero, wordmark se desliza después (TDD)

> Reemplaza la versión anterior de esta tarea (halo + `BrandMark` como bloque único + pulso), que ya se implementó y comiteó (`ea5d4d0`) pero fue rechazada por Vicente tras verla: pidió que el pin aparezca solo primero y que el wordmark se deslice a su derecha después, sin halo ni pulso. Esta versión v2 reescribe `SplashScreen.js` y su test de nuevo, sobre lo que ya existe en el repo.

**Files:**
- Modify: `src/screens/__tests__/SplashScreen.test.js` (reescritura completa — las aserciones de la v1 sobre `<BrandMark` ya no aplican)
- Modify: `src/screens/SplashScreen.js` (reescritura completa)

**Interfaces:**
- Consumes: `MapPin` (named export) de `lucide-react-native` (ya es una dependencia del proyecto — se usa igual en `src/components/BrandMark.js:2`); `clubsExplorer`, `tactical` (named exports) de `src/theme/colors.js`; `getOnboardingState` (named export, `() => Promise<state>`) de `src/services/profile.js`; `getInitialRouteName` (named export, `(state) => 'Main' | 'LocationPermission' | 'Welcome'`) de `src/utils/routing.js`. Ninguna de estas firmas cambia. **No** se importa `BrandMark` en esta versión — ver la nota de Revisión v2 en la spec (`docs/superpowers/specs/2026-08-27-splash-animation-design.md`): `BrandMark` fusiona ícono y texto en un solo árbol y no permite animarlos en momentos distintos, así que esta pantalla reconstruye los mismos valores visuales (mismo ícono, mismo tamaño, mismo color, mismo wordmark) como dos piezas independientes. `BrandMark.js` no se modifica ni se toca.
- Produces: `SplashScreen` sigue siendo el default export con la firma `({ navigation })`, consumida sin cambios por `src/navigation/AppNavigator.js:22,80` (`import SplashScreen from '../screens/SplashScreen'; const SafeSplashScreen = withErrorBoundary(SplashScreen, 'Splash');`).

- [ ] **Step 1: Reescribir el test (falla contra la implementación v1 actual)**

Reemplazar `src/screens/__tests__/SplashScreen.test.js` completo por:

```js
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
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `node --test src/screens/__tests__/SplashScreen.test.js`

Expected: FAIL en el primer test ("usa el mismo ícono y wordmark oficiales...") — la implementación v1 actual usa `<BrandMark />`, no `MapPin`/`fut<Text` reconstruidos. Los demás 6 tests deben seguir en PASS (la v1 ya cumplía reduce motion, paleta, sin loop, sin setTimeout, Promise.all y el contrato de navegación — esta revisión no debería regresar eso).

- [ ] **Step 3: Reescribir `src/screens/SplashScreen.js`**

Reemplazar el archivo completo por:

```js
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  AccessibilityInfo,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin } from 'lucide-react-native';
import { clubsExplorer, tactical } from '../theme/colors';
import { getOnboardingState } from '../services/profile';
import { getInitialRouteName } from '../utils/routing';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// El ícono y el wordmark reproducen exactamente los valores de
// BrandMark.js (pin + "fut...finder"): mismo ícono, mismo tamaño 26, mismo
// color tactical.neon, mismo estilo de texto. Se reconstruyen acá — en vez
// de renderizar <BrandMark /> — porque esta pantalla necesita animar el
// pin y el texto en momentos distintos (el pin se asienta, luego el texto
// se desliza a su derecha), algo que un <BrandMark /> fusionado no puede
// coreografiar. BrandMark.js no se modifica.
const ICON_SIZE = 26;

export default function SplashScreen({ navigation }) {
  const { width } = useWindowDimensions();

  // Escala del conjunto hero: cabe con margen entre 320px (teléfono chico)
  // y pantallas anchas de tablet/web, sin desbordar ni verse minúsculo.
  const heroScale = clamp(width * 0.0058, 1.7, 2.4);

  const iconOpacity = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.86)).current;
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateX = useRef(new Animated.Value(28)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  const destRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    // Chequeo de sesión en paralelo con la animación, igual que antes.
    const sessionPromise = (async () => {
      const state = await getOnboardingState();
      destRef.current = getInitialRouteName(state);
    })();

    const runAnimation = async () => {
      const reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      if (!isMounted) return;

      if (reduceMotion) {
        // Alternativa reducida: pin y texto ya en su lugar final, solo un
        // fundido conjunto corto — sin desliz, sin secuencia pin→texto.
        iconScale.setValue(1);
        textTranslateX.setValue(0);
        await new Promise((resolve) => {
          Animated.parallel([
            Animated.timing(iconOpacity, {
              toValue: 1,
              duration: 250,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(textOpacity, {
              toValue: 1,
              duration: 250,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
          ]).start(resolve);
        });
        return;
      }

      await new Promise((resolve) => {
        Animated.sequence([
          // 1. El pin se asienta primero.
          Animated.parallel([
            Animated.timing(iconOpacity, {
              toValue: 1,
              duration: 380,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(iconScale, {
              toValue: 1,
              duration: 380,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          Animated.delay(120),
          // 2. El wordmark se desliza a su lugar (a la derecha del pin) y
          // se desvanece hacia dentro.
          Animated.parallel([
            Animated.timing(textOpacity, {
              toValue: 1,
              duration: 460,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
            Animated.timing(textTranslateX, {
              toValue: 0,
              duration: 460,
              easing: Easing.out(Easing.cubic),
              useNativeDriver: true,
            }),
          ]),
          // 3. Hold breve con el logo completo, estático (nada se repite).
          Animated.delay(280),
        ]).start(resolve);
      });
    };

    const animationPromise = runAnimation();

    // Espera tanto la animación como la sesión: si la sesión tarda más, el
    // logo queda quieto en su estado final (nada se repite) hasta que
    // resuelva — recién ahí se desvanece la pantalla y se navega.
    Promise.all([animationPromise, sessionPromise]).then(() => {
      if (!isMounted) return;

      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => {
        if (!isMounted) return;
        const dest = destRef.current || 'Welcome';
        if (dest === 'Main') {
          navigation.reset({ index: 0, routes: [{ name: 'Main' }] });
        } else if (dest === 'LocationPermission') {
          navigation.reset({ index: 0, routes: [{ name: 'LocationPermission' }] });
        } else {
          navigation.replace('Welcome');
        }
      });
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <Animated.View style={[styles.root, { opacity: screenOpacity }]}>
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.row, { transform: [{ scale: heroScale }] }]}>
          <Animated.View
            style={{
              opacity: iconOpacity,
              transform: [{ scale: iconScale }],
            }}
          >
            <MapPin size={ICON_SIZE} color={tactical.neon} strokeWidth={2.2} />
          </Animated.View>
          <Animated.View
            style={{
              opacity: textOpacity,
              transform: [{ translateX: textTranslateX }],
            }}
          >
            <Text style={styles.word}>
              fut<Text style={styles.wordAccent}>finder</Text>
            </Text>
          </Animated.View>
        </View>
      </SafeAreaView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: clubsExplorer.bg,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  word: {
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: -0.4,
    color: tactical.text,
  },
  wordAccent: {
    color: tactical.neon,
  },
});
```

- [ ] **Step 4: Ejecutar el test y verificar que pasa**

Run: `node --test src/screens/__tests__/SplashScreen.test.js`

Expected: PASS en los 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/screens/SplashScreen.js src/screens/__tests__/SplashScreen.test.js
git commit -m "feat(splash): el pin se asienta primero y el wordmark se desliza después, sin halo ni pulso"
```

---

### Task 3: Verificación completa y chequeo visual

**Files:**
- No crea ni modifica archivos (a menos que `npm run lint` señale algo real, en cuyo caso corregirlo en los archivos de la Task 2).

**Interfaces:**
- Consumes: el `SplashScreen.js` y `app.config.js` de las Tasks 1-2.
- Produces: nada — es el gate final de calidad antes de dar la tarea por terminada.

- [ ] **Step 1: Correr la suite completa**

Run: `npm run verify`

Expected: 0 errores de lint, todos los tests (incluyendo los nuevos de `SplashScreen.test.js` y los ya existentes, como `headerBrand.test.js`) en PASS.

- [ ] **Step 2: Chequeo visual en web**

Run: `npm run web` (dejarlo corriendo) y abrir la app en el navegador.

Verificar a ojo:
- Fondo negro/casi negro desde el primer frame (sin flash del marrón `#201F1D` antiguo).
- El pin (verde, `MapPin`) aparece centrado y se asienta primero; después, a su derecha, se desliza y desvanece hacia dentro el wordmark "futfinder"; el conjunto completo se desvanece luego hacia `Welcome` o `Main` sin que se vea la pantalla siguiente "de golpe" ni un parpadeo entre pantallas. Sin halo ni pulso — la pantalla es solo fondo oscuro + pin + texto.
- Redimensionar la ventana del navegador (o probar con las devtools en modo responsive a ~320px de ancho) para confirmar que el logo no se corta ni se ve desproporcionado.

Si algo no calza (tamaño, timing, flash de color), ajustar los valores correspondientes en `src/screens/SplashScreen.js` (no re-litigar el diseño, solo afinar constantes) y volver a correr `npm run verify`.

- [ ] **Step 3: Revisar `git status` y confirmar alcance**

Run: `git status`

Expected: solo aparecen modificados/creados `app.config.js`, `src/screens/SplashScreen.js` y `src/screens/__tests__/SplashScreen.test.js` (más el archivo ya presente `docs/Rediseno-Clubes-FutFinder.md`, sin tocar). Ningún otro archivo debe quedar modificado por esta tarea.

- [ ] **Step 4: Actualizar memoria si corresponde**

Si algún ajuste de la Step 2 cambió una convención registrada en `docs/memoria/diseno/sistema-visual.md` (por ejemplo, si el halo terminó reutilizando un token distinto al planeado), actualizar solo esa nota, en el mismo commit. Si no hubo cambios de comportamiento respecto a la spec, no tocar la memoria.

- [ ] **Step 5: Commit final (solo si la Step 2 requirió ajustes)**

```bash
git add src/screens/SplashScreen.js docs/memoria/diseno/sistema-visual.md
git commit -m "fix(splash): ajusta constantes de la animación tras verificación visual"
```

(Si no hubo ajustes, no hay commit en esta tarea — Task 1 y Task 2 ya quedaron commiteadas.)
