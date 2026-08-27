# Animación de inicio (Splash) — rediseño con estética Clubes

Fecha: 2026-08-27
Estado: aprobado por Vicente, listo para plan de implementación

## Revisión (v2)

Tras ver la primera implementación (halo + `BrandMark` como bloque único +
pulso), Vicente pidió un cambio de composición: quiere que primero aparezca
solo el pin de ubicación y que, a su derecha, se deslice el nombre
«futfinder» — un patrón de revelación de marca ("estilo Netflix"), no el
bloque fusionado con halo/pulso de la v1. Las secciones de este documento
reflejan ya la v2; la v1 (halo + bloque único + pulso) queda descartada.

Esto obliga a un cambio técnico: `<BrandMark />` renderiza el pin y el
wordmark fusionados en un solo árbol, sin exponer sus partes por separado,
así que no puede coreografiar "el pin se asienta, después el texto se
desliza". La pantalla reconstruye el mismo ícono y el mismo texto —mismo
componente `MapPin` de `lucide-react-native`, mismo tamaño (26), mismo
color (`tactical.neon`), mismo wordmark con el mismo estilo— como dos
piezas independientes, en vez de importar `BrandMark`. No es un logo
distinto: son los mismos valores de `BrandMark.js`, duplicados a propósito
para poder animar el pin y el texto en momentos distintos. `BrandMark.js`
no se modifica.

## Contexto

El splash actual (`src/screens/SplashScreen.js`) dibuja un ícono SVG propio
(pin + balón) sobre `colors.background`/`colors.primary` — la paleta global
antigua (`#201F1D`, verde oliva `#71B533`). No usa el logo oficial
compartido (`BrandMark.js`) ni la estética oscura ya vigente en Clubes
(`clubsExplorer`, `tactical`).

Se pide renovar solo la animación de inicio: mismo arranque, misma
restauración de sesión, misma navegación inicial, mismos tiempos de carga
reales. Sin logo de imagen (no existe carpeta `assets/`): el logo oficial es
el componente vectorial `BrandMark`.

## Alcance

- Reescribe `src/screens/SplashScreen.js` completo.
- Actualiza `app.config.js` (colores del splash nativo y status bar de
  Android) para que coincidan con el nuevo fondo y no haya flash de color al
  pasar del splash nativo de Expo al componente React.
- No toca `Logo.js` (marca distinta, del onboarding) ni `BrandMark.js` (se
  usa sin modificar, sin props nuevas).
- No toca `getOnboardingState`, `getInitialRouteName`, `AppNavigator`,
  `withAuthGuard`, deep links, ni la espera de Splash para notificaciones
  (`waitUntilPastSplash` en `App.js`).

## Composición visual

- Fondo a pantalla completa: `clubsExplorer.bg` (`#0A0C0A`) — el negro casi
  puro del rediseño de Clubes, no `tactical.bg` (`#000000`) ni el
  `colors.background` antiguo.
- Sin halo, sin pulso, sin tarjetas, texto adicional, partículas, balones
  girando, escudos, trofeos ni líneas tácticas de fondo — pantalla limpia,
  fondo oscuro y dos protagonistas: el pin y el wordmark.
- Fila centrada (`flexDirection: 'row'`, `gap: 8`, igual que `BrandMark`):
  ícono `MapPin` (`lucide-react-native`, tamaño 26, color `tactical.neon`,
  `strokeWidth={2.2}`) seguido del texto "fut" + acento "finder" (mismo
  estilo que `BrandMark`: `fontSize: 21`, `fontWeight: '800'`,
  `letterSpacing: -0.4`, "fut" en `tactical.text`, "finder" en
  `tactical.neon`). Reconstruye los valores de `BrandMark.js` a propósito
  (ver Revisión v2) — no es un logo nuevo.
- La fila completa escala como bloque estático (`transform: [{ scale:
  heroScale }]`) para el tamaño hero; ícono y texto animan cada uno su
  propia entrada por dentro de esa fila ya escalada.

## Escala responsiva

- `useWindowDimensions()` → `heroScale = clamp(width * 0.0058, 1.7, 2.4)`.
- Verificado a mano contra el ancho natural de la fila reconstruida
  (~147px, igual que `BrandMark`): cabe con margen en anchos desde 320px
  hasta escritorio/tablet en web, sin recortarse ni verse desproporcionado.
  Se confirma visualmente con `npm run web` en la verificación final,
  ajustando el coeficiente si hace falta.
- El contenido centrado va dentro de `SafeAreaView` (todos los edges).

## Línea de tiempo de la animación (reduce motion desactivado)

Con `Animated.parallel`/`Animated.sequence`/`Animated.delay`, sin
`Animated.loop` en ningún punto (para que nunca se repita):

1. El pin se asienta primero: `iconOpacity` 0→1 y `iconScale` 0.86→1, en
   paralelo, 380ms, `Easing.out(cubic)`.
2. `Animated.delay(120)` — pausa breve tras el pin, antes de que el texto
   empiece a moverse.
3. El wordmark se desliza a su posición final (a la derecha del pin) y se
   desvanece hacia dentro: `textOpacity` 0→1 y `textTranslateX` 28→0, en
   paralelo, 460ms, `Easing.out(cubic)`.
4. Hold breve (~280ms) manteniendo el logo completo en su estado final
   estático.
5. Fade-out del `View` raíz completo, 260ms, `Easing.in(quad)`.

Duración total aproximada: 380+120+460+280+260 ≈ 1.5s (dentro del rango
1.3–1.6s pedido). Sin rebotes, sin rotaciones, sin ciclos repetidos.

## Reduce motion

- Se consulta `AccessibilityInfo.isReduceMotionEnabled()` al montar
  (funciona también en web vía `prefers-reduced-motion`, confirmado en
  `react-native-web`).
- Si está activo: pin y texto se fijan de una vez en su estado final
  (`iconScale.setValue(1)`, `textTranslateX.setValue(0)`) y solo se anima
  un fundido conjunto de opacidad 0→1 de ~250ms (sin escala, sin
  desplazamiento, sin secuencia pin→texto) y, al finalizar la carga real,
  el mismo fundido de salida de 260ms del punto 5 — para no cortar la
  pantalla en seco, lo cual también podría leerse como un flash.

## Coordinación con la carga real

Comportamiento actual: la animación se dispara en paralelo a
`getOnboardingState()`, pero al terminar la animación navega usando
`destRef.current` sin esperar a que esa promesa haya resuelto — si la
sesión tarda más que la animación, cae al valor por defecto (`Welcome`) aun
con sesión válida. Vicente pidió explícitamente que la animación se
coordine con la carga real: si la sesión sigue resolviendo, el logo debe
quedarse quieto en su estado final (sin repetir nada) hasta que la promesa
resuelva, y solo entonces navegar.

Cambio puntual: esperar `Promise.all([animationPromise, sessionPromise])`
antes de navegar, en vez de navegar apenas termina la animación. Esto no
cambia qué destino se calcula (`getOnboardingState`/`getInitialRouteName`
intactos) ni ninguna otra pieza de arranque/navegación — solo corrige la
carrera dentro del propio `SplashScreen` para que nunca se dispare la
animación de nuevo ni se navegue "de más" mientras la sesión sigue
resolviendo. No se agrega ningún retraso artificial: si la sesión ya
resolvió antes de que termine la animación, se navega apenas termina la
animación, igual que hoy.

## Cambios de soporte en `app.config.js`

- `splash.backgroundColor`: `'#201F1D'` → `'#0A0C0A'`.
- `web.backgroundColor`: `'#201F1D'` → `'#0A0C0A'` (mismo razonamiento:
  evitar flash de color en el arranque web antes de montar React).
- Se agrega `androidStatusBar: { backgroundColor: '#0A0C0A', barStyle:
  'light-content' }` para que la barra de estado de Android durante el
  arranque nativo use el mismo fondo oscuro.
- `web.themeColor` no se toca (`#71B533`): es solo el tinte de la UI del
  navegador (PWA), no genera flash de pantalla y no fue parte de lo
  confirmado; queda fuera de este alcance.

## Pruebas

El repo prueba este tipo de componente por patrón de código
(`node --test` + lectura de fuente, como
`src/components/__tests__/headerBrand.test.js`), no con un renderer real de
React Native. Se agrega `src/screens/__tests__/SplashScreen.test.js` que
verifica sobre el código fuente de `SplashScreen.js`:

- Usa `MapPin` (mismo ícono que `BrandMark`) con `tactical.neon`, y el
  wordmark "fut"+"finder"; no dibuja un `<Svg` propio de pin+balón (no debe
  quedar el ícono antiguo duplicado).
- Usa `AccessibilityInfo.isReduceMotionEnabled`.
- No usa `Animated.loop` en ningún punto (garantiza que nada se repite).
- No usa `colors.primary` ni `colors.background` (paleta antigua) — usa
  `clubsExplorer`/`tactical`.
- No introduce un `setTimeout`/delay fijo desacoplado de la animación real
  ni de la resolución de sesión (nada de retraso artificial).

## Riesgos conocidos / fuera de alcance

- `WelcomeScreen` sigue usando `colors.background` (`#201F1D`, paleta
  antigua). Para el flujo de onboarding (splash → Welcome) habrá un salto
  de color perceptible justo después del fundido de salida del splash. Para
  el flujo de sesión ya iniciada (splash → Main/Home) no hay salto: Home ya
  usa `tactical.bg` (`#000000`), muy cercano al nuevo `#0A0C0A` del splash.
  Rediseñar `WelcomeScreen` está fuera de este alcance (Vicente solo pidió
  la animación de inicio).
