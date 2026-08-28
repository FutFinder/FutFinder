# Diseño: Portada de Clubes — pasos 1 y 2

**Fecha:** 2026-08-28
**Estado:** Propuesto
**Alcance:** pasos 1 (tema + tokens) y 2 (portada) del handoff `design_handoff_clubes_portada`
**Origen:** `~/Downloads/design_handoff_clubes_portada` — `README.md`, `Clubes Portada.dc.html`, `support.js`

## Qué es esto

Rediseño de la entrada a la pestaña Clubes. Hoy la pestaña entra directo al
detalle del club; el rediseño introduce una portada desde la que se accede
ordenadamente a las funciones **que ya existen**. No se agrega funcionalidad.

`support.js` es el runtime generado del prototipo y los paneles laterales del
`.dc.html` son andamiaje: no se implementan. Solo se implementa el teléfono
central (390 × 845).

## Decisiones tomadas

| Decisión | Resolución | Por qué |
|---|---|---|
| Hexes de los cuatro temas | Los del repo (`#5AE06A`, `#4DA3FF`, `#FF4B2E`, `#FFBE1A`) | El verde del handoff (`#22E06A`) rompería con el verde corporativo que usa el resto de la app fuera de Clubes. Los cuatro del repo ya están validados por prueba |
| Alfas del acento | Las del handoff: `soft .14`, `border .42`, `glow .30` | `dsColors` ya usa `.14` en `winSoft`/`drawSoft`/`lossSoft`; alinea las dos escalas |
| Tinta sobre rojo | La del repo, `#2A0800` | La del handoff (`#FFF3EF`) da **3,07:1** sobre `#FF4B2B` y no pasa WCAG AA. La del repo da **5,56:1** |
| Rol de capitán | **No existe.** Solo `admin` y `jugador` | La migración 11 tiene `check (rol in ('admin','jugador'))`. Confirmado por el usuario. Ya hay un comentario en `utils/chatMeta.js:42` avisando de esta misma confusión |
| Nombre del plan | «Premium», como el repo | Toda la app dice Premium (`ClubPlanBadge`, `PremiumBadge`, `CLUB_LIMITS.premium`, migración 11). Los límites del handoff coinciden: 15/1 y 26/3 |
| Tipos de tarea pendiente | Los 7, derivados en el hook | Contrato completo del handoff desde el primer día; el badge nunca muestra un número incompleto |
| Actividad reciente | `listNotifications` filtrado por club activo | No existe feed de actividad de club. El handoff manda conectar a lo que exista antes que construir pantalla nueva |
| Badge en la barra inferior | Se agrega en Clubes | Revierte deliberadamente el «único badge que queda es el de Chat» de `MainTabs.js`; se actualiza ese comentario |

## Paso 1 — Tema y tokens

### Lo que ya existe

`src/theme/clubThemes.js` ya implementa el paso 1 casi entero: cuatro temas
guardados como clave estable en `clubs.tema` (migración 53), escala derivada
por opacidades compartidas, tinta de contraste por tema, y
`src/theme/__tests__/clubThemes.test.js` fijando ese contrato con 24 pruebas
(4,5:1 garantizado, distancia de color contra derrota, empate y el dorado
Premium).

### Cambios

**`src/theme/clubThemes.js`** — solo el bloque `ALFA`:

```
soft:  0.12 → 0.14
border: 0.35 → 0.42
glow:   0.22 → 0.30
```

`softStrong` (0.20) y `bannerGlow` (0.07) no cambian: el handoff no los
menciona y tienen uso propio. Los cuatro hexes y las cuatro tintas no se
tocan.

**`src/theme/__tests__/clubThemes.test.js`** — ninguna prueba actual fija los
alfas: solo comprueban que deriven del color principal y que
`softStrong > soft`, que sigue siendo cierto (.20 > .14). El cambio no rompe
nada, y por eso mismo hay que **agregar** una prueba que fije los tres valores
del handoff: si nadie los guarda, el próximo retoque los pierde en silencio.
Las de contraste y distancia siguen intactas y deben seguir pasando: son la
razón por la que no adoptamos los hexes del handoff.

**`src/theme/colors.js`** — se agrega una familia `clubTonos` con los tonos
semánticos que el handoff declara **no tematizables** (conservan su color en
los cuatro temas), para que ninguna pantalla vuelva a escribir un `rgba`
suelto:

| Tono | soft | fg |
|---|---|---|
| `warn` | `rgba(255,197,49,.14)` | `#FFC531` |
| `danger` | `rgba(255,75,43,.15)` | `#FF6E4F` |
| `info` | `rgba(255,255,255,.07)` | `#D6D6DA` |

El tono `accent` no vive aquí: sale de `temaDeClub()`, porque sí depende del
club.

Y las superficies de la portada: tarjeta `#101012`, tarjeta destacada
`#0D0E0D`, barra inferior `rgba(9,9,10,.94)`, header sticky `rgba(0,0,0,.9)`.

### Archivos que hoy pintan verde fijo

Nueve archivos del módulo usan verde literal y nunca consultan el tema del
club. Seis se tematizan:

| Archivo | Usos de verde |
|---|---|
| `src/screens/ClubChallengesScreen.js` | 14 |
| `src/components/partidos/ClubMatchCard.js` | 14 |
| `src/screens/ClubChallengeScreen.js` | 5 |
| `src/screens/ClubHistoryScreen.js` | 3 |
| `src/components/clubes/ChallengeHeader.js` | 2 |
| `src/components/clubes/CambioPartidoCard.js` | 2 |

Dos **no** se tematizan, y es a propósito: `ClubExplorer.js` (17 usos) y
`ClubExplorerCard.js` (2) muestran clubes ajenos. Ahí cada tarjeta usa el tema
de *su* club y el cromo de la pantalla se queda con el verde de la app — un
explorador teñido del color de mi club mentiría sobre los clubes que lista.
(`ExploreClubsScreen.js`, que los aloja, no pinta verde: hereda el de ellos.)

`ClubsScreen.js` (1 uso) desaparece en el paso 2.

Ya tematizados, no se tocan: `ClubDetailScreen`, `EditClubScreen`,
`RivalClubCard`, `CreateChallengeButton`, `ClubThemePicker`,
`ClubPhotoGallery`, `ClubHeroCard`, `ds/BannerBackdrop`, `ds/EmptyStateCard`,
`ds/SectionHeader`.

## Paso 2 — La portada

### Arquitectura

Tres capas, sin que ninguna invada a la siguiente:

```
ClubsScreen (pantalla)      → solo compone y pinta
  └ useClubsHome (hook)     → consulta, orquesta, expone el view-model
      └ clubsHomeTasks      → derivación pura, sin red: normaliza y cuenta
```

Los componentes de portada reciben **datos por props y no consultan la API**.
Toda la lógica de permisos, pendientes, plan y tema vive en el hook.

### `src/utils/clubsHomeTasks.js` — derivación pura

Va aparte del hook porque es lo que se prueba, y porque el handoff avisa que
justo aquí se equivocó el prototipo. Sin red, sin React.

Normaliza cada fuente a una `Task` (`{ id, type, tone, title, subtitle, cta,
target, status }`), ordena por prioridad, aplica el tope de 4 tarjetas
visibles y calcula los contadores. Las cuatro reglas que se prueban:

1. `taskBadgeCount` cuenta solo tareas **con acción**: excluye resueltas y
   vencidas. El badge de la sección y el de la barra usan **el mismo número**.
2. El contador del botón «ver más» se calcula sobre **tareas con acción
   ocultas**, no sobre tarjetas ocultas. Si lo oculto no tiene acción, el
   texto es «Ver N avisos más».
3. `limits.members.used` cuenta integrantes activos; las **solicitudes
   pendientes no cuentan**.
4. `limits.admins.used` cuenta todos los admins del club. (El handoff decía
   «incluye al capitán»; sin rol de capitán, la regla se simplifica.)

### `src/utils/useClubsHome.js` — el view-model

Vive en `src/utils/` junto a `useConnection.js` y `useUnreadNotifications.js`,
que es donde el repo pone sus hooks.

Contrato, con dos ajustes al modelo real: `role` es `'jugador' | 'admin'` y el
plan es `'estandar' | 'premium'`.

```
useClubsHome() → {
  loading, error, retry(),
  membership: 'none' | 'pending' | 'member',
  clubs, activeClubId, setActiveClub(id),   // activeClubId persistido
  club, role, can, limits,
  tasks, nextMatch, activity, suggestedRivals, invitations, pendingRequests,
  resolveTask(id), ...
}
```

Las siete fuentes de tarea, consultadas en paralelo:

| Tarea | Tono | Servicio |
|---|---|---|
| Desafío recibido | accent | `clubChallenges.listChallengesForClub` |
| Propuesta pendiente | info | `clubProposals.getPropuestaVigente` |
| Cambio de partido | warn | `clubMatchChanges.getCambioPendiente` |
| Jugadores por confirmar | info | `clubRoster.getNominaPartido` |
| Solicitud de ingreso | warn | `clubs.listPendingRequests` (solo admin) |
| Sanción / revisión | danger | `clubSanctions.getSancionVigente` |
| Próximo partido en N días | accent | `clubMatchRules.proximoPartidoDeClub` |

El resto del view-model sale de servicios que ya existen: `getMyClubs`,
`getClubById`, `getClubEstadisticas`, `listMembers`, `listPendingRequests`,
`listMyInvitations`, `listRivalCandidates`, `CLUB_LIMITS` y
`listNotifications`.

**Permisos.** `can.*` se calcula en un solo lugar, derivado de
`role === 'admin'`. Regla del handoff: el jugador **ve** todo lo pendiente
pero no lo resuelve; su CTA es «Ver» y el subtítulo agrega «· responde un
admin». Un jugador nunca ve un botón que no puede usar, pero sí ve la
información.

**Club activo.** Se persiste en `AsyncStorage` (ya usado en `supabase.js` y
`pendingSignUp.js`). Si el club guardado ya no está entre los del usuario, se
cae al primero por fecha de ingreso.

### `src/screens/ClubsScreen.js` — la pantalla

Hoy tiene 115 líneas, ninguna de UI propia: consulta la membresía y **embebe**
`ClubDetailScreen` o `ClubExplorer`. Ese embebido se elimina; es el cambio de
fondo del rediseño. `ClubDetailScreen` queda alcanzable solo por navegación
explícita: el tile «Mi club» y el botón «Ver club» del resumen.

Con el embebido se va también el parámetro `viaClubesTab` de
`ClubDetailScreen`, que existía solo para darle un «volver al explorador» en
vez del back normal. Ahora hay una portada real a la que volver.

El banner de éxito que hoy llega por `route.params.successTitle` desde
`ClubMembersScreen` (al salir o eliminar un club) se conserva: pasa a
mostrarse sobre la portada.

### Componentes

Nuevos, en `src/components/club/`:

`ClubsHeader` · `ClubSwitcher` · `PendingTaskCard` · `AllClearBanner` ·
`NextMatchCard` · `QuickActionGrid` · `ClubSummaryCard` · `ActivityList` ·
`SkeletonHome` · `VerifiedBadge`

`VerifiedBadge` es el único que se dibuja desde cero: el handoff pide una
forma específica (escudo festoneado de 12 puntas en el color del tema, con
check en la tinta). Tiene respaldo en datos — `clubs.verificado` ya existe en
la migración 11.

Se reutiliza lo que ya hay: `ClubLogo`, `ClubPlanBadge`, `PremiumBadge`,
`Button`, `Banner`, `ds/SectionHeader`, `ds/EmptyStateCard`, `RivalClubCard`
(carrusel de rivales sugeridos) e iconos de `lucide-react-native`, que es el
set del repo.

### Estados

| Estado | Qué se muestra |
|---|---|
| Un club | Portada directa, sin selector. Nunca se entra automáticamente al detalle |
| Varios clubes | Selector de chips; recuerda el último club activo |
| Sin club | «Aún no tienes club»: Crear club + Explorar clubes, invitaciones pendientes y clubes sugeridos |
| Solicitud pendiente | Tarjeta ámbar «Solicitud en revisión» + qué queda bloqueado + sugeridos |
| Cargando | Skeletons con la silueta real (hoy es un `ActivityIndicator` centrado) |
| Error | «No pudimos cargar tus clubes» + «Reintentar» |

El botón «Ver estado del servicio» del prototipo de error **se omite**: no
tiene respaldo en la app y el handoff prohíbe construir pantalla nueva sin
confirmarlo. Queda «Reintentar» solo.

**Errores.** El handoff manda no mostrar `error.message` crudo del backend.
La portada muestra copy propio; el mensaje real va a `console.error`, como ya
hace `services/clubs.js`.

### Barra inferior

`MainTabs.js` recibe el contador de pendientes y pinta el badge sobre el icono
de Clubes, con el mismo número que la sección «Pendiente para ti». Se
actualiza el comentario de la línea 120, que hoy afirma que el de Chat es el
único badge de la barra.

El FAB circular de 56 que pide el handoff **ya existe** (`CreateTab`, icono
`Plus`), igual que el padding izquierdo de Reservas. No hay trabajo ahí.

## Pruebas

- `src/theme/__tests__/clubThemes.test.js` — actualizar los alfas. Las pruebas
  de contraste y distancia siguen intactas y deben seguir verdes.
- `src/utils/__tests__/clubsHomeTasks.test.js` (nuevo) — las cuatro reglas de
  derivación, más el tope de 4, los micro-estados (resuelta / vencida) y el
  filtrado por rol. Sin red.
- Verificación final: `npm run verify` con **cero errores** de lint.

## Fuera de alcance

Lo que este diseño **no** cubre, y por qué:

- **Pasos 3 a 9 del handoff.** Se abordan después, sobre esta base.
- **«Transferir capitanía» (paso 7).** No es funcionalidad nueva: es el
  rediseño de «¿Ceder la administración a X?», que ya existe en
  `ClubMembersScreen.js:253` sobre la RPC `transfer_club_admin`. Su copy en el
  handoff está mal para este modelo: al ceder **no** pasas a admin, pasas a
  jugador. Corregirlo al llegar al paso 7.
- **«Privacidad y solicitudes» y «Notificaciones del club»** (paso 7). Sin
  respaldo en la app. Se deja el punto de entrada conectado a un stub.
- **Renombrar Premium a «Pro».** Se mantiene el nombre del repo.
- **Unificar las seis familias de tokens** que documenta
  `docs/Rediseno-Clubes-FutFinder.md`. Es trabajo real pero es otro proyecto;
  este diseño solo toca lo que los pasos 1 y 2 necesitan.
