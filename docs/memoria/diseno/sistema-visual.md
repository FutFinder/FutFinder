# Sistema visual

Última revisión: 2026-08-27

## Propósito

Mantener las convenciones visuales verificadas del código para que los cambios reutilicen tokens y componentes existentes, sin convertir esta nota en un repositorio de capturas.

## Tokens globales

`src/theme/colors.js` conserva la paleta global `colors`: fondos oscuro (`background`, `surface` y `surfaceAlt`), verdes corporativos (`primary`, `primaryDark` y `primarySoft`), jerarquía de texto, estados de error/éxito y bordes. Los tokens globales de geometría son `radius` (`sm` a `xl` y `pill`) y `spacing` (`xs` a `xxl`); la fuente declarada es `System` en los tres pesos disponibles.

El rediseño compartido de Clubes y Perfil usa `dsColors`, `dsRadius` y `dsSizes`. Define sus propias superficies, verdes de acción, estados de resultado, dorado Premium, chips, bordes y divisor. `dsSizes` fija, cuando aplica, un gutter de 16, botón táctil de 44, botón de acción de 58 y logo de 72. Los alias `clubColors`, `clubRadius` y `clubSizes` mantienen compatibilidad con componentes de Clubes.

`src/theme/clubThemes.js` es la única fuente del color de identidad de un club. Ofrece cuatro temas —`green` (el verde corporativo tal cual), `blue`, `red` y `yellow`— y de cada uno una escala: `main`, `pressed`, `soft`, `softStrong`, `border`, `glow`, `ink` (tinta de contraste sobre `main`) y `bannerRgb`/`bannerGlow` para el fondo del banner. Los componentes de club reciben esa escala por prop `tema` y su valor por defecto es el verde, de modo que las pantallas que no son de un club —perfil de jugador, historial— siguen igual. Ningún componente pregunta por una clave concreta ni escribe su propio `rgba`. Los colores semánticos (`win`, `draw`, `loss`, `gold`, error) NO forman parte del tema: sus pruebas exigen distancia de color contra derrota, empate y el dorado de Premium, además de 4,5:1 de contraste WCAG.

Existen extensiones deliberadamente separadas: `chatColors` añade superficies y estados propios del chat; `tactical` corresponde a Inicio; y `clubsExplorer` y `clubsExplorerRadius` corresponden al explorador de clubes. No se debe sustituir la paleta global por una de estas familias de manera masiva: el propio código mantiene pantallas de distintos rediseños coexistiendo.

## Tokens de Partidos

El módulo Partidos no toma sus decisiones visuales de los tokens globales: usa `partidos` y `partidosRadius` en `src/theme/colors.js`. Sus superficies, verdes de acción, dorado de pendiente, coral de error/destructivo, escalones de texto, bordes, pistas y degradados de héroe son tokens del módulo. Sus radios definidos son `pill`, `chipSm`, `chip`, `control`, `input`, `card`, `list` y `sheet`.

`src/components/partidos/ui.js` centraliza las primitivas de ese módulo: botones principal, fantasma, de superficie y de estado; botón de icono; pills; chips de opción; tags; etiquetas de sección y campo; controles de fecha/hora y notas. Sus botones reutilizables declaran alturas de 48 px o más, salvo que el componente exponga explícitamente otra medida.

## Familias reutilizables y copy

- `src/components/ds/`: fondo de banner, estado vacío, cabecera de sección y badge de etiqueta para Clubes y Perfil. La cabecera mantiene acciones españolas como “Ver todos”, “Ver todo” o “Ver todas”.
- `src/components/club/`: explorador, tarjetas de club/rival/historial, héroe, logo, galería, insignia de plan, estadísticas y CTA de desafío.
- `src/components/player/`: héroe, biografía, estadísticas, reputación, participación, acciones públicas, tarjetas de cuenta/soporte, galería, reporte y skeleton de perfil.
- `src/components/partidos/`: hojas, filtros, selectores, tarjeta de partido, vistas de estado y primitivas `ui`.
- `src/components/BrandMark.js`: única fuente del logo "fut**finder**" (pin + wordmark) para el header de las pantallas ya logueadas. Sin props de tamaño ni color — usa siempre los tokens de `tactical` (`neon` y `text`), sea cual sea la pantalla que lo aloja. Se usa en Home, Partidos y Chat; el onboarding (`Logo.js`, el ícono de balón) es una marca distinta y no lo usa.
- `src/components/NotificationBell.js`: campana de avisos global, con el mismo criterio de tokens fijos (`reservas`) que `BrandMark`. Vive arriba a la derecha en las 6 pantallas raíz de pestaña (Home, Partidos, Clubes cuando no hay club propio, Reservas, Chat, Perfil propio) y en varias pantallas internas que ya la traían. Nunca aparece en "Mi club" (`ClubHeaderBar`) ni al ver el perfil de otro jugador.

El copy visible se mantiene en español. Los componentes reciben labels ya resueltos desde sus utilidades de dominio cuando corresponde: por ejemplo, `TagBadge` no decide modalidad, posición ni nivel, y sólo representa el label recibido.

## Objetivos táctiles

La medida mínima sólo se afirma donde el código la define. `dsSizes.tapBtn` es 44, y `dsSizes.iconBtn` es 40 con `hitSlop` para llegar a 44. `EmptyStateCard` mantiene un botón visual de 38 con `hitSlop` vertical de 4 para alcanzar 44. En Partidos, las primitivas de botón usan 48 o más por defecto; `IconButton` usa tamaño 36 con `hitSlop` de 8. Otros controles deben conservar su medida o `hitSlop` comprobando el componente afectado, en vez de inferir un mínimo global.

## Diferencias web y nativo

`MatchMap.native.js` usa `react-native-maps`; `MatchMap.web.js` devuelve una alternativa sin mapa para preservar lista y filtros en web. Al compartir un partido, `ShareSheet` usa la API de portapapeles del navegador cuando está disponible y recurre a la hoja del sistema en nativo; el payload de `Share.share` distingue iOS. El skeleton de perfil evita el driver nativo de animación porque no existe en web.

## Referencias visuales

Las capturas o handoffs específicos de una tarea permanecen fuera de esta memoria. Esta nota sólo registra tokens, familias y reglas que estén presentes en el código; una tarea visual debe conservar sus imágenes de referencia en su contexto externo y traducir a código únicamente las decisiones verificadas.

## Rutas relacionadas

- `src/theme/colors.js`
- `src/components/ds/`, `src/components/club/`, `src/components/player/` y `src/components/partidos/`
- `src/components/BrandMark.js` y `src/components/NotificationBell.js`
- [Partidos](../funcionalidades/partidos.md), [Clubes](../funcionalidades/clubes.md) y [Perfil y amigos](../funcionalidades/perfil-y-amigos.md)
