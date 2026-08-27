# Unificación del encabezado e identidad visual — Diseño

Fecha: 2026-08-27

## Objetivo

El logo de FutFinder (pin + wordmark "fut**finder**") y el botón de
notificaciones (`NotificationBell`) están implementados de forma duplicada e
inconsistente entre pantallas. Este cambio unifica ambos elementos en las 6
pantallas raíz de pestaña, reutilizando un único componente de marca y el
componente de campana ya existente, sin tocar lógica de negocio ni
navegación.

## Alcance

- **Logo:** solo las 3 pantallas que ya muestran el pin+wordmark hoy — Home,
  Partidos y Chat. No se toca el flujo de onboarding/login (`Logo.js`, el SVG
  de balón+pin en `SplashScreen.js`, Welcome, Verification,
  LocationPermission, Terms, Success): es una marca visualmente distinta,
  usada antes de iniciar sesión, y no aparece en la referencia entregada.
- **Bell:** las 6 pantallas raíz de pestaña (Home, Partidos, Clubes, Reservas,
  Chat, Perfil), con la excepción explícita de "Mi club". No se agrega a
  pantallas empujadas/internas (`ClubMembers`, `MatchDetail`,
  `EditProfile`, `Settings`, etc.) — las que ya lo tienen (`EditProfile`,
  `Settings`, `ElegirCancha`, `ComplejoDetail`) lo conservan tal cual, sin
  cambios.
- No se agrega el logo a Reservas, Clubes ni Perfil: esas 3 pantallas
  mantienen su título de texto plano y solo ganan el bell.

## Referencia visual

Captura de ChatTab: pin verde + "fut" (blanco) + "finder" (verde), fila
superior con el bell/acción a la derecha. Del código actual, la
implementación de `TacticalHeader.js` (Home) es la que más se acerca en
tamaño y color, y ya convive con `NotificationBell` — se adopta como fuente
de verdad.

## Componente nuevo: `BrandMark`

`src/components/BrandMark.js` — sin props de tamaño ni color (deliberado,
para que no puedan volver a divergir). Solo acepta `style` opcional para
posicionamiento del contenedor, igual que `NotificationBell`.

```jsx
<View style={styles.row}>
  <MapPin size={26} color={tactical.neon} strokeWidth={2.2} />
  <Text style={styles.word}>
    fut<Text style={styles.wordAccent}>finder</Text>
  </Text>
</View>
```

- Ícono: `MapPin` (lucide-react-native), 26px, color `tactical.neon`
  (`#00FF66`), `strokeWidth` 2.2.
- Texto: "fut" en `tactical.text` (`#FFFFFF`) + "finder" en `tactical.neon`,
  ambos `fontWeight: '800'`, `fontSize: 21`, `letterSpacing: -0.4`.
- Gap ícono↔texto: 8px.
- Implementado con `StyleSheet` (no NativeWind), para comportarse igual en
  web y nativo.

## Componente reutilizado: `NotificationBell`

Sin cambios. `src/components/NotificationBell.js` ya resuelve navegación
(`navigate('Notifications')`), contador (`useUnreadNotifications`) y estados
(badge condicional, accesibilidad). Se importa donde falta, nunca se
reimplementa.

## Cambios por pantalla

| Pantalla | Archivo | Cambio |
|---|---|---|
| Home | `src/components/home/TacticalHeader.js` | Reemplaza el `MapPin`+`Text` inline por `<BrandMark/>`. `NotificationBell` ya estaba — sin cambio funcional. |
| Partidos | `src/screens/PartidosScreen.js` (función local `Header`) | Reemplaza el `MapPin`+`Text` inline por `<BrandMark/>`. Agrega `<NotificationBell/>` en el bloque derecho, junto al botón de filtros existente (gap 8px), sin quitar el filtro. |
| Chat | `src/components/chat/ChatInboxHeader.js` | Reemplaza el `MapPin`+`Text` inline por `<BrandMark/>`. Agrega `<NotificationBell/>` junto al botón "Amigos y solicitudes" existente — ambos íconos conviven a la derecha, cada uno con su propio badge. |
| Perfil | `src/components/player/PlayerProfileTopBar.js` | Agrega `<NotificationBell/>` **solo** dentro de la rama `isOwnProfile` (después del ícono de Configuración). La rama de perfil ajeno (`!isOwnProfile`, pantalla empujada) no se toca — nunca muestra el bell. |
| Clubes (sin club) | `src/components/club/ClubExplorer.js` | Agrupa el botón "atrás" (`showBackButton`) y el título "Clubes" en una fila (`justifyContent: space-between`). Agrega `<NotificationBell/>` **solo** cuando `!showBackButton` — es decir, únicamente cuando actúa como raíz de la pestaña Clubes (invitado sin club). Cuando se abre empujado (`ExploreClubsScreen`, "buscar rivales"), sigue mostrando solo el botón atrás. |
| Clubes (con club) / "Mi club" | `src/screens/ClubDetailScreen.js`, `src/components/club/ClubHeaderBar.js` | Sin cambios — ya no tienen bell, y así se quedan (excepción explícita del pedido). |
| Reservas | `src/screens/ReservasScreen.js` | Sin cambios — ya tiene `NotificationBell` correctamente. |

## Fuera de alcance

- Onboarding/login (`Logo.js`, `SplashScreen.js`, Welcome, Verification,
  LocationPermission, Terms, Success): marca visual distinta, decisión
  explícita del usuario de no tocarla en este cambio.
- Cualquier pantalla empujada/interna que hoy no tenga el bell (detalle de
  partido, integrantes de club, historial, etc.).
- Lógica de negocio, navegación real, contador de no leídos: todo eso ya
  vive en `NotificationBell`/`useUnreadNotifications` y no se modifica.

## Pruebas

Este cambio es puramente presentacional — reutiliza componentes ya
probados (`NotificationBell` y su hook de contador) sin lógica de negocio
nueva, así que no hay una función de dominio para cubrir con `node --test`
al estilo de los servicios existentes.

Se agrega una prueba de regresión chica y dirigida al problema real
reportado (implementaciones duplicadas del logo): un test que lee el código
fuente de `TacticalHeader.js`, `ChatInboxHeader.js` y `PartidosScreen.js` y
falla si alguno vuelve a dibujar el pin+wordmark a mano en vez de importar
`BrandMark` — para que una futura duplicación accidental quede atrapada.

## Verificación visual

Con el skill `run`: levantar `npm run web`, recorrer las 6 pestañas en ancho
móvil (~390px) y ancho de escritorio (~1280px), capturar cada header y
confirmar:
- Logo idéntico (símbolo, tipografía, tamaño, color) en Home/Partidos/Chat.
- Bell presente en Home, Partidos, Chat, Reservas, Perfil (perfil propio) y
  Clubes sin club; ausente en "Mi club" y en perfil ajeno.
- El bell conserva su navegación a Avisos, su contador y sus estados.
- Ningún header queda con dos veces el mismo botón.
- Comportamiento correcto en web y en el simulador/dispositivo móvil.
