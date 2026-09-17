# Sistema visual

Última revisión: 2026-09-02

## Propósito

Mantener las convenciones visuales verificadas del código para que los cambios reutilicen tokens y componentes existentes, sin convertir esta nota en un repositorio de capturas.

## La paleta, que es una sola

`src/theme/colors.js` exporta **una** paleta: `paleta`, con
`radios`, `medidas` y `fuentes` (Manrope, cargada en
`App.js` con `expo-font`). Fondo `#0A0C0A`, superficie `#131613`, verde de
acción `#55DF69`, ocho escalones de texto de `#F4F6F4` a `#565E57`.

Hasta el 2026-09-16 eran **siete familias** —`colors` (olivo `#71B533` sobre
fondo café `#201F1D`), `dsColors`/`clubColors`, `chatColors`, `tactical`
(flúor `#00FF66`), `partidos` y `clubsExplorer`— con cuatro verdes, tres
fondos, dos tipografías y cuatro escalas de radios. Un solo recorrido
—Inicio → Partidos → Clubes → Chat— las cruzaba todas. **Se borraron.**

**Lo que impide que vuelvan** no es esta nota: es que el export no existe, más
una regla `no-restricted-imports` en `eslint.config.mjs` que nombra las
dieciséis y falla como error si alguien las recrea. Y
`src/theme/__tests__/unaSolaEstetica.test.js`, que comprueba que el theme no
exporte una segunda paleta y que ningún token que el código usa se quede sin
valor —en React Native un token inexistente pinta transparente o negro y no
avisa.

Diseño y fases: `docs/superpowers/specs/2026-09-16-estetica-unica-design.md`.

### Lo que NO se unificó, a propósito

Los colores que llevan **significado** y no estética: victoria/empate/derrota,
el dorado Premium, el ámbar de advertencia y el `#FF2D55` del desafío recién
aceptado (que no es un rojo de error: es «hay un partido nuevo que
coordinar»). Viven dentro de `paleta` como tokens propios.

`clubTonos` y `clubSuperficies` tampoco: sus valores están **medidos**
—`clubThemes.test.js` exige distancia de color entre el peligro y el tema rojo
del club— y cambiarlos es volver a medir, no reemplazar un token.

`src/theme/clubThemes.js` sigue siendo la única fuente del color de identidad
de un club. Ofrece cuatro temas —`green` (el verde de acción tal cual), `blue`,
`red` y `yellow`— y de cada uno una escala: `main`, `pressed`, `soft`,
`softStrong`, `border`, `glow`, `ink` y `bannerRgb`/`bannerGlow`. Los
componentes reciben esa escala por prop `tema`; ninguno pregunta por una clave
concreta ni escribe su propio `rgba`.

Hay UNA excepción documentada, y es deliberada: el tile «V» del resumen del
club va en el acento del tema (`escala.main`) mientras «D» conserva el rojo
semántico. Lo pide el handoff de diseño, que manda en color. En el tema rojo
eso deja los dos tiles a **ΔE76 17,8** —seis veces más cerca que en cualquier
otro tema, aunque por encima del umbral de confusión de un vistazo (ΔE 10)—, y
ese contraste **se aceptó por decisión de diseño el 2026-09-02**, con la
medición hecha: lo que distingue los tiles es la letra, dibujada tan legible
como el número, y una excepción por tema («V es verde sólo si el club es
rojo») sería una regla sorprendente. No es deuda pendiente.

## Familias reutilizables y copy

- `src/components/ds/`: fondo de banner, estado vacío, cabecera de sección y badge de etiqueta para Clubes y Perfil. La cabecera mantiene acciones españolas como “Ver todos”, “Ver todo” o “Ver todas”.
- `src/components/club/`: explorador, tarjetas de club/rival/historial, héroe, logo, galería, insignia de plan, estadísticas y CTA de desafío.
- `src/components/player/`: héroe, biografía, estadísticas, reputación, participación, acciones públicas, tarjetas de cuenta/soporte, galería, reporte y skeleton de perfil.
- `src/components/partidos/`: hojas, filtros, selectores, tarjeta de partido, vistas de estado y primitivas `ui`.
- `src/components/BrandMark.js`: única fuente del logo "fut**finder**" (pin + wordmark) para el header de las pantallas ya logueadas. Sin props de tamaño ni color — usa siempre los tokens de `tactical` (`neon` y `text`), sea cual sea la pantalla que lo aloja. Se usa en Home, Partidos y Chat; el onboarding (`Logo.js`, el ícono de balón) es una marca distinta y no lo usa. `src/screens/SplashScreen.js` tampoco renderiza `<BrandMark />`: reconstruye a mano el mismo ícono `MapPin`/`tactical.neon` y el mismo wordmark (mismo tamaño, mismo estilo) como dos piezas independientes, porque necesita animar el pin y el texto en momentos distintos (el pin se asienta, después el texto se desliza a su derecha) y `BrandMark` no expone sus partes por separado. Fondo del splash: `clubsExplorer.bg`, no `tactical.bg` ni la paleta global.
- `src/components/NotificationBell.js`: campana de avisos global, con el mismo criterio de tokens fijos (`paleta`) que `BrandMark`. Vive arriba a la derecha en las 6 pantallas raíz de pestaña (Home, Partidos, Clubes cuando no hay club propio, Reservas, Chat, Perfil propio) y en varias pantallas internas que ya la traían. Nunca aparece en "Mi club" (`ClubHeaderBar`) ni al ver el perfil de otro jugador.

El copy visible se mantiene en español. Los componentes reciben labels ya resueltos desde sus utilidades de dominio cuando corresponde: por ejemplo, `TagBadge` no decide modalidad, posición ni nivel, y sólo representa el label recibido.

`PendingTaskCard` tiene tres estados y cada uno cambia el CONTENIDO, no sólo el aspecto. Abierta lleva su botón; resuelta se apaga con chip «Listo ✓»; vencida se apaga al 55 % de opacidad, pierde el botón y lleva chip «Expiró». En la vencida el texto también cambia: el título nombra el ESTADO —«Desafío sin acuerdo», «Propuesta rechazada», «Cambio sin respuesta»— en vez del tipo de tarea, con un texto por cierre en vez de uno genérico, y `cta` viaja en `null` para que el objeto no siga prometiendo «Responder» en un campo que otro consumidor pueda leer. Apagar una tarjeta no basta si el texto sigue invitando a responder algo que ya no existe. Los títulos son sustantivos de estado, no verbos: hay una prueba que rechaza cualquier verbo de acción en el título o el subtítulo de una vencida.

Una tarea puede traer `acciones` en vez de `cta`: entonces `PendingTaskCard` dibuja esos botones —el primero con el acento del club, el segundo en gris, porque no son un par simétrico— y **deja de navegar** al pulsar la tarjeta, para que un toque al lado de un botón no dispare un destino que nadie pidió. Hoy la usa la invitación a un club, que se resuelve en la propia tarjeta.

El rótulo de un badge numérico se decide en un solo sitio, `etiquetaBadge()` de `src/utils/clubsHomeTasks.js`: por encima de nueve muestra «9+». Lo usan la barra inferior (`MainTabs`) y «Pendiente para ti» (`ClubsScreen`), que antes escribían la regla por separado y con diez o más pendientes mostraban textos distintos del mismo dato. El tope es del rótulo y nunca del conteo: el número exacto es el que llega al lector de pantalla.

## Objetivos táctiles

La medida mínima sólo se afirma donde el código la define. `dsSizes.tapBtn` es 44, y `dsSizes.iconBtn` es 40 con `hitSlop` para llegar a 44. `EmptyStateCard` mantiene un botón visual de 38 con `hitSlop` vertical de 4 para alcanzar 44. En Partidos, las primitivas de botón usan 48 o más por defecto; `IconButton` usa tamaño 36 con `hitSlop` de 8. Otros controles deben conservar su medida o `hitSlop` comprobando el componente afectado, en vez de inferir un mínimo global.

## Diferencias web y nativo

`MatchMap.native.js` usa `react-native-maps`; `MatchMap.web.js` devuelve una alternativa sin mapa para preservar lista y filtros en web. Al compartir un partido, `ShareSheet` usa la API de portapapeles del navegador cuando está disponible y recurre a la hoja del sistema en nativo; el payload de `Share.share` distingue iOS. El skeleton de perfil evita el driver nativo de animación porque no existe en web.

## Referencias visuales

Las capturas o handoffs específicos de una tarea permanecen fuera de esta memoria. Esta nota sólo registra tokens, familias y reglas que estén presentes en el código; una tarea visual debe conservar sus imágenes de referencia en su contexto externo y traducir a código únicamente las decisiones verificadas. Por lo mismo, el estado de verificación de una rama —suite, lint, build y los controles que siguen pendientes— vive en [Clubes](../funcionalidades/clubes.md) y no acá.

## Rutas relacionadas

- `src/theme/colors.js`
- `src/components/ds/`, `src/components/club/`, `src/components/player/` y `src/components/partidos/`
- `src/components/BrandMark.js` y `src/components/NotificationBell.js`
- [Partidos](../funcionalidades/partidos.md), [Clubes](../funcionalidades/clubes.md) y [Perfil y amigos](../funcionalidades/perfil-y-amigos.md)
