# Handoff — Rediseño de la sección Clubes

**Fecha:** 2026-08-29
**Rama:** `rediseno/portada-clubes`, creada desde `main @ 95032d3`
**Estado:** 5 de 10 tareas cerradas. La sesión anterior se cortó por límite de API a mitad de la tarea 6.
**Nada está en `main`.** La rama no se ha pusheado: todos los commits son locales.

## Documentos que mandan

| Documento | Qué es |
|---|---|
| `~/Downloads/design_handoff_clubes_portada/README.md` | El handoff de diseño. La fuente de verdad de medidas, colores y copy |
| `~/Downloads/design_handoff_clubes_portada/Clubes Portada.dc.html` | Prototipo navegable. Los paneles laterales son andamiaje: **no se implementan** |
| `docs/superpowers/specs/2026-08-28-portada-clubes-design.md` | El diseño acordado y las decisiones tomadas |
| `docs/superpowers/plans/2026-08-28-portada-clubes.md` | El plan de 10 tareas. **Contiene defectos conocidos**, ver más abajo |
| `.superpowers/sdd/2026-08-28-portada-clubes/progress.md` | El registro de ejecución tarea por tarea. **Léelo antes de nada** |

`support.js` del handoff es el runtime generado del prototipo. No se implementa.

---

## 1. Objetivo general

Hoy la pestaña Clubes **entra directo al detalle del club**: `ClubsScreen.js` no tiene interfaz propia, consulta la membresía y embebe `ClubDetailScreen` o `ClubExplorer`.

El rediseño introduce una **portada / centro de control** desde la que se accede ordenadamente a las funciones que ya existen. **No se agrega funcionalidad**: se reorganiza lo que hay, se reduce el scroll y lo urgente aparece primero.

El trabajo son 9 pasos del handoff. Este plan cubre los **pasos 1 y 2**:

1. **Tema y tokens** — que el acento salga del tema del club en vez de un verde escrito a mano. Sin esto, todo lo demás se hace dos veces.
2. **La portada** — ruta nueva: encabezado, selector de club, «Pendiente para ti», próximo partido, accesos rápidos, resumen, actividad y rivales.

Los pasos 3 a 9 son trabajo posterior.

---

## 2. Tareas completadas

Las cinco pasaron implementación **y** revisión independiente.

| # | Tarea | Commit | Veredicto |
|---|---|---|---|
| 1 | Alfas del acento a .14/.42/.30 | `a0eda9c` | Limpia, sin hallazgos |
| 2 | Tonos semánticos y superficies | `387e8f9` + `9ea84bd` | 1 Importante + 2 Menores, **corregidos** |
| 3 | Tematizar las pantallas de desafío | `8d4e555` + `97246c7` | Limpia, 1 Menor diferido |
| 4 | Tematizar historial y tarjeta de partido | `cd8fde1` | Limpia, 1 Menor diferido |
| 5 | `clubsHomeTasks.js`, la derivación pura | `e5a76cf` | 1 Crítico + 2 Importantes + 3 Menores, **los seis corregidos**, ver §10 |
| 6 | `useClubsHome` → `ClubsHomeProvider` | `d786fe6` | Auditada, conservada, 7 defectos corregidos, ver §3 |
| 7 | `VerifiedBadge`, `ClubsHeader`, `ClubSwitcher` | `649decc` | Sin revisión independiente todavía |
| 8 | Los 7 componentes de contenido | `f2d845c` | Sin revisión independiente todavía |
| 9 | La portada: `ClubsScreen` + los 6 estados | este commit | Sin revisión independiente todavía |
| 10 | Badge de pendientes en la barra | este commit | Sin revisión independiente todavía |

**Las diez tareas del plan están implementadas y revisadas.** La revisión independiente de las tareas 7 a 10 encontró **12 hallazgos, todos verificados y todos corregidos**. Ver §9.

> La tarea 5 está commiteada y **sus seis hallazgos están corregidos**, con pruebas que fijan cada uno. Ver §10.

Con las tareas 1 a 4 el **paso 1 del handoff queda cerrado**.

## 3. Tarea 6 — cerrada tras auditoría

**`useClubsHome` se auditó, se conservó y se convirtió en contexto compartido.**

La auditoría comprobó una por una las **14 llamadas a servicios** contra la firma real de cada `export`: forma `{data, error}`, argumentos y campos leídos. Todas calzaban. En un caso el hook **corregía al brief**: el brief prescribía `listRivalCandidates({ clubId })` y la firma real es `{ retadorClubId, ... }` — con el brief, los rivales sugeridos habrían salido sin filtrar.

También se verificó contra las migraciones que `clubId`/`clubRetadorId`/`clubRetadoId` son marcas reales y siempre presentes (13, 14, 16, 26, 28, 42, 43, 47, 47c).

Hallazgo colateral que valida el arreglo del badge: `getPropuestaVigente()` devuelve *«la propuesta abierta del desafío, o la última que hubo»*, sin filtrar estado. Una propuesta `rechazada` o `caducada` **sí llega**. Con el `ESTADOS_MUERTOS` viejo habría quedado abierta para siempre: el defecto crítico tenía este camino real.

### Los siete defectos, todos corregidos

| | Defecto | Arreglo |
|---|---|---|
| A | La decisión «no existe un lístame-mis-solicitudes sin clubId» era **falsa**: `listMyInvitations()` hace esa consulta sin `club_id`. `membership: 'pending'` por solicitud enviada era inalcanzable para quien postula a su primer club | `listMyRequests()` en `services/clubs.js`, espejo con `tipo='solicitud'`. RLS `11:238` y el índice `11:71` lo respaldan |
| B | No se refrescaba nunca: ni al enfocar ni por Realtime. El `ClubsScreen` de hoy sí usa `useFocusEffect`, así que el rediseño **perdía** el refresco | `reload()` expuesto por el contexto y llamado desde `ClubsScreen` con `useFocusEffect` |
| C | Las tareas 9 y 10 llamaban al hook por separado: ~22 consultas por montaje y dos `badgeCount` que podían divergir | `ClubsHomeProvider` en `src/contexts/ClubsHomeContext.js`, montado en `MainTabs` |
| D | Dos `new Date()` con una ronda de red en medio: un partido a minutos de empezar podía quedar como `nextMatch` y a la vez descartado como tarea | Un solo `ahora` |
| E | El cambio de partido colgaba de `usaNominaPorClub()`, que exige `cupos_por_club != null`; la migración 46:395 solo exige `challenge_proposal_id` | `partidoAdmiteCambio()`, probada |
| F | `listOpenMatches({limit:50})` traía los 50 partidos abiertos más próximos **de toda la app** y excluía los `'lleno'`: el partido del club desaparecía sin avisar | `listPartidosDeClub()` en `services/matches.js`, filtrada por club en la base. La RLS 44d lo permite |
| G | `futfinder:clubActivo` significaba dos cosas | Resuelto con A: la clave vuelve a significar solo «club activo» |

### Reducciones declaradas en la tarea 9

Dos cosas del brief no se implementaron tal cual, y conviene que se sepan:

- **«Clubes sugeridos» en el estado sin club.** El brief los pedía con botón «Unirse». El contexto no trae esa lista —`listRivalCandidates` necesita un club de referencia y quien no tiene club no lo tiene—, y añadirla significaba otra consulta y otra clave del contrato. En su lugar, «Explorar clubes» lleva a `ExploreClubs`, que es el explorador completo con búsqueda y listado: la capacidad queda a un toque, no se pierde.
- **«Ver estado del servicio»** en el estado de error: el propio plan ya lo había descartado por no tener respaldo en la app.

### Qué se puede probar y qué no

El repo no tiene pruebas de render, así que **todo lo que decide algo salió del hook** a `src/utils/clubsHomeSources.js` (`avisoDelClub`, `elegirClubActivo`, `derivarMembresia`, `partidoAdmiteCambio`) con **18 pruebas**. Lo que queda en el contexto es atar servicios y ordenar rondas: eso está verificado por lectura y lint, **no por prueba automática**, y conviene decirlo así.

`listMyRequests()` y `listPartidosDeClub()` tampoco tienen prueba: importan `./supabase`, que no carga bajo `node --test`.

## 4. Qué falta antes del merge

1. **Recorrido manual** (`npm run web`): pestaña Clubes → abre la portada, no el detalle → «Ver club» lleva al detalle → el back vuelve a la portada. Y con un desafío recibido pendiente, comprobar que el badge de la barra y el de «Pendiente para ti» muestran lo mismo. Ahora también: con un desafío cerrado **sin acuerdo** en los últimos siete días, que la tarjeta salga apagada, con el chip «Expiró», sin botón, titulada **«Desafío sin acuerdo»** y **sin sumar al badge** (§15 y §16). Y con **diez o más** pendientes, que la barra inferior y «Pendiente para ti» digan los dos «9+».
2. **Reducciones declaradas de la tarea 9**, ver §3 — decidir si se aceptan. (El otro punto que esperaba decisión, el contraste del tema rojo, quedó **cerrado sin cambio**: §17.)
3. Actualizar `docs/memoria/funcionalidades/clubes.md` y `docs/memoria/diseno/sistema-visual.md`.

---

## 5. Commits, uno por uno

Del más antiguo al más reciente. Base: `95032d3` en `main`.

**`a0eda9c` — `refactor(tema): los alfas del acento pasan a .14/.42/.30 y quedan fijados por prueba`**
`src/theme/clubThemes.js` (bloque `ALFA`) y `src/theme/__tests__/clubThemes.test.js`. Sube `soft` .12→.14, `border` .35→.42, `glow` .22→.30. `softStrong` (.20) y `bannerGlow` (.07) no cambian. Agrega la prueba que fija los tres valores: antes ninguna lo hacía y el cambio habría pasado inadvertido.

**`387e8f9` — `feat(tema): tonos semánticos y superficies de la portada de Clubes`**
`src/theme/colors.js`: familias nuevas `clubTonos` (`warn`, `danger`, `info`) y `clubSuperficies` (`card`, `cardAlta`, `barra`, `header`, `separador`, `borde`). Más 3 pruebas.

**`9ea84bd` — `fix(tema): pruebas más precisas para tonos semánticos y superficies`**
Ronda de arreglos de la tarea 2. La prueba original medía colisión de hex y no independencia del tema. Se parte en dos: una que fija los 12 valores dígito a dígito y otra que comprueba `Object.isFrozen`, incluidos los objetos anidados de cada tono. El implementador **comprobó que la prueba falla** alterando un valor a mano.

**`8d4e555` — `refactor(clubes): la bandeja y el envío de desafíos usan el tema del club en vez del verde fijo`**
`ClubChallengesScreen.js` y `ClubChallengeScreen.js`.

**`97246c7` — `refactor(clubes): el chat de desafío pinta con el tema de MI club, no el rival`**
`ChallengeHeader.js`, `CambioPartidoCard.js` y `ChatThreadScreen.js` (+46 líneas). Ver §8 sobre la ampliación de alcance.

**`cd8fde1` — `refactor(clubes): historial y tarjeta de partido toman el tema del club propio`**
`ClubHistoryScreen.js`, `ClubMatchCard.js` y `src/services/matches.js`.

**`e5a76cf` — `feat(clubes): derivación de la portada — tareas, badge, cupos y permisos`**
Crea `src/utils/clubPlanLimits.js` y `src/utils/clubsHomeTasks.js` (218 líneas), más `src/utils/__tests__/clubsHomeTasks.test.js` (228 líneas, 22 pruebas). `src/services/clubs.js` pasa a re-exportar `CLUB_LIMITS`.

---

## 6. Archivos principales

### Creados

| Archivo | Qué hace |
|---|---|
| `src/utils/clubPlanLimits.js` | Los límites por plan, sin dependencias |
| `src/utils/clubsHomeTasks.js` | Derivación pura: 7 fuentes → `Task[]`, contadores, cupos, permisos |
| `src/utils/__tests__/clubsHomeTasks.test.js` | 22 pruebas |
| `src/utils/useClubsHome.js` | **SIN COMMITEAR, sin revisar.** Ver §3 y §12 |

### Modificados

`src/theme/clubThemes.js` · `src/theme/colors.js` · `src/theme/__tests__/clubThemes.test.js` · `src/services/clubs.js` · `src/services/matches.js` · `src/screens/ClubChallengesScreen.js` · `src/screens/ClubChallengeScreen.js` · `src/screens/ClubHistoryScreen.js` · `src/screens/ChatThreadScreen.js` · `src/components/clubes/ChallengeHeader.js` · `src/components/clubes/CambioPartidoCard.js` · `src/components/partidos/ClubMatchCard.js`

### Sin tocar, a propósito

`ClubExplorer.js` y `ClubExplorerCard.js` conservan el verde de la app. **Listan clubes ajenos**: teñirlos del color de mi club mentiría sobre ellos. Cada tarjeta usa el tema de *su* club; el cromo de la pantalla se queda con el verde corporativo.

---

## 7. Migraciones involucradas

Ninguna migración nueva. Este trabajo es solo cliente. Las que importan:

| Migración | Qué aporta |
|---|---|
| `11_clubes.sql` | `clubs.plan` (`estandar`/`premium`), `clubs.verificado`, `club_members.rol` con `check (rol in ('admin','jugador'))`, y el trigger `check_club_limits()` que valida cupos por plan |
| `24_multi_club_membership.sql` | `check_user_club_limit`: máximo 3 clubes por jugador. **Es otra cosa, no confundir con el anterior** |
| `43_desafios_plazos_y_propuesta.sql` | `club_challenges.estado` y `club_challenge_proposals.estado` |
| `44*`, `50` | Partido de clubes |
| `46_cambios_de_partido.sql` | `club_match_changes.estado` |
| `49` | `historial_club()` y `club_estadisticas()` |
| `53` | `clubs.tema`. **Puede no estar aplicada en todos los entornos** |

---

## 8. Decisiones de arquitectura y diseño

**Los cuatro hexes de tema son los del repo, no los del handoff.** El handoff pedía verde `#22E06A`, azul `#4A9DFF`, rojo `#FF4B2B`, amarillo `#FFC531`. Se conservan `#5AE06A`, `#4DA3FF`, `#FF4B2E`, `#FFBE1A`. Dos motivos: el verde del handoff rompería con el verde corporativo que usa el resto de la app fuera de Clubes, y los del repo ya están validados por prueba.

**La tinta clara del handoff sobre rojo no pasa WCAG.** `#FFF3EF` sobre `#FF4B2B` da **3,07:1**. La del repo, `#2A0800`, da **5,56:1**. Calculado, no supuesto. Gana la del repo.

**Sí se adoptan las opacidades del handoff** (`.14`/`.42`/`.30`), que además alinean el acento con `winSoft`/`drawSoft`/`lossSoft` de `dsColors`, que ya usaban `.14`.

**No existe rol de capitán.** La migración 11 solo admite `admin` y `jugador`. El handoff asume `player | admin | captain` y una subpantalla «Transferir capitanía»; eso **no es funcionalidad nueva**, es el rediseño de «¿Ceder la administración a X?» que ya existe en `ClubMembersScreen.js:253` sobre la RPC `transfer_club_admin`. Su copy en el handoff además miente para este modelo: al ceder **no** pasas a admin, pasas a jugador. Hay un comentario en `src/utils/chatMeta.js:42` avisando de esta misma confusión desde antes.

**El plan pagado se llama «Premium», no «Pro».** Toda la app ya lo llama así. Los límites del handoff coinciden con `CLUB_LIMITS`: 15/1 y 26/3.

**Los colores semánticos no se tematizan, en ningún tema.** Victoria, empate y derrota (`dsColors.win`/`draw`/`loss`) y los estados del desafío (`ESTADO_TONE` en `ClubChallengesScreen.js`) conservan su color siempre. Un club rojo no puede hacer que una victoria parezca una derrota. Por eso el grep del plan todavía marca 6 líneas con `'green'` en esa pantalla: **es deuda intencional, no un olvido**.

**En cualquier vista con dos clubes, el acento sale del club del usuario.** Nunca del rival. Si el usuario pertenece a los dos, se toma el primero (`club_retador_id` en el chat, el local en la tarjeta de partido): arbitrario, pero nunca el rival.

**`CLUB_LIMITS` se mudó a un módulo puro.** `src/services/clubs.js` importa `./supabase` sin extensión, y eso solo lo resuelve Metro. Bajo `node --test` revienta:

```
node -e "require('./src/services/clubs.js')"
→ Cannot find module .../services/supabase
```

Por eso los límites viven en `src/utils/clubPlanLimits.js` y el servicio los re-exporta. **Los imports entre módulos puros van con extensión `.js`.**

**Ampliación de alcance en la tarea 3: `ChatThreadScreen.js`.** El plan pedía tematizar `ChallengeHeader` y `CambioPartidoCard`, pero esos componentes solo reciben la fila del desafío, que no trae clubes embebidos. `ChatThreadScreen` sí tiene `myClubIds`, `clubChallenge` y `getClubById`, así que resuelve el tema ahí y lo pasa como prop. Dejar el chat de un desafío en verde mientras la pantalla de al lado va con el color del club era la inconsistencia que este rediseño existe para borrar.

**Ampliación de alcance en la tarea 4: `services/matches.js`.** `withClubs()` hacía `select('id, nombre, foto_url')` **sin la columna `tema`**, así que `temaDeClub()` habría devuelto verde siempre y el trabajo de la tarea habría sido invisible. Al agregarla, el implementador reutilizó `src/utils/columnasOpcionales.js` en vez de confiar en el fallback: con un `select` explícito, si falta la migración 53 Postgres devuelve 42703 y la consulta **entera** falla, dejando `club_local` y `club_visitante` en `null` para todos los partidos de clubes. No «sin color»: sin nombre y sin escudo.

**«V» va en el acento del club; «D» se queda en el rojo semántico.** Lo pide el handoff de diseño (README línea 192) y es el único punto donde el acento toca algo con carga de resultado, así que roza la regla de arriba. Se aplicó tal cual porque el handoff manda en colores, pero **en el tema rojo `V` (`#FF4B2E`) y `D` (`#FF6E4F`) quedan parecidos**: lo que distingue es la letra, y por eso el rótulo se dibujó tan legible como el número. **Triado y CERRADO por decisión de diseño: ver §9 y §17.**

**Los implementadores commitean pero no pushean.** El plan escrito dice `git push` en cada tarea; se anuló. El push va al final, con el merge.

---

## 9. Bugs encontrados por los revisores

### Corregidos

**Tarea 2, Importante.** La prueba «los tonos semánticos no dependen del tema» solo comparaba los tonos contra los cuatro colores de tema. Eso demuestra que hoy no chocan, no que sean independientes: si alguien tematizara `clubTonos`, la prueba seguiría pasando mientras el resultado no coincidiera *textualmente* con uno de esos hexes. Corregido en `9ea84bd`: se parte en una prueba de valores fijados y otra de `Object.isFrozen`.
**El defecto venía del plan, no del implementador.**

**Tarea 2, dos Menores.** Comentario de `clubSuperficies` que no explicaba nada, y un `require` a mitad de archivo. Corregidos.

### Revisión de las tareas 7 a 10 — 12 hallazgos, todos corregidos

Los doce se verificaron contra el código antes de aceptarlos; ninguno era un falso positivo. Los dos primeros son los que de verdad dolían.

| # | Hallazgo | Arreglo |
|---|---|---|
| 1 | **La portada se reemplazaba entera por el esqueleto en CADA foco** de la pestaña: `reload()` encendía `loading` y la pantalla dibuja `SkeletonHome` mientras dure. Volver del detalle de un club borraba la portada durante dos rondas de consultas | El contexto distingue `loading` (primera carga) de `refreshing` (recarga con datos ya en pantalla) |
| 2 | **Un fallo de red al refrescar borraba una portada completa.** El contexto conservaba los datos, pero la pantalla mostraba el error a pantalla completa igual | El error ocupa la pantalla sólo si `!cargado`; con datos previos avisa con un banner y deja lo que había |
| 3 | «Desafiar» a un rival sugerido pasaba `retadorClubId`, que `ClubChallengeScreen` no lee, y omitía `rivalNombre` y `rivalFotoUrl`, que sí | Se pasan los tres params reales |
| 4 | «Buscar rivales» y «Ver todos» iban a `ExploreClubs` sin `modoRival: true`, así que salía el catálogo completo —clubes propios incluidos— y `retadorClubId` se ignoraba | Se pasa `modoRival: true` |
| 5 | Los cupos de la tarjeta destacada se sacaban con una expresión regular del subtítulo de la tarea, y esa tarea no existe con la nómina llena: **la barra desaparecía justo al llegar al 100 %** | Ya corregido en `906a2d1`: el contexto expone `nextMatchCupos`, que no depende de que haya tarea |
| 6 | El badge de la sección se encendía con `tasks.length` pero mostraba `badgeCount`: con una única tarea vencida decía «0» | Se enciende con `badgeCount > 0` |
| 7 | «Ajustes del club» llevaba a `ClubDetail`, el mismo destino que el tile «Mi club» de al lado | Va a `EditClub`, que es lo que promete la etiqueta |
| 8 | El subtítulo decía «Solicitud en revisión» a quien solo tenía una invitación recibida: le atribuía algo que no hizo | Distingue solicitud enviada de invitación recibida |
| 9 | La sección de actividad dejaba un hueco de 23px cuando `ActivityList` devolvía `null` | La sección no se dibuja sin actividad |
| 10 | «N.A.» era **inalcanzable** para V/E/D: `club_estadisticas()` siempre devuelve numérico, así que un club nuevo mostraba «0 · 0 · 0» — justo lo que el comentario del archivo dice que no puede pasar | Se mira `pj > 0`, no si `v` es un número |
| 11 | En `SkeletonHome` el desfase estaba DENTRO del bucle, así que se reaplicaba cada vuelta y la onda se desarmaba a los pocos segundos | El desfase sale del bucle |
| 12 | El lector de pantalla decía «Clubes, 3 sin leer» sobre tareas por hacer | La etiqueta se bifurca igual que el badge |

### Diferidos — triados y cerrados

**Tarea 3, Menor. CORREGIDO.** La barra «Ver / Crear partido de club» de `ChatThreadScreen` toma `temaDesafio`, el mismo que ya usaba la cabecera justo encima: `tema.border`/`tema.soft` en la variante secundaria, `tema.main`/`tema.ink` en la solida.

**Tarea 4, Menor. CORREGIDO.** No se podia escribir la prueba donde estaba el codigo: `services/matches.js` importa `./supabase` sin extension y no carga bajo `node --test`. La consulta salio a `src/utils/clubesDePartidoQuery.js` con el cliente inyectado —el patron que el repo ya usa en `rivalClubsQuery.js` y `nominaQuery.js`— y tiene **7 pruebas** con un cliente falso que responde 42703. Fijan el contrato entero: con la migracion 53 llega el tema; sin ella se reintenta una vez y **los clubes conservan nombre y escudo**; un registro que ya sabe que falta no vuelve a pedirla; y un error que no es de columna no se disfraza de columna ausente.

**«V» en el tema rojo. CERRADO: no se cambia. Decisión de diseño tomada el 2026-09-02 (§17), sobre la medición de abajo.** Distancia perceptual (DeltaE76) entre el acento de cada tema y el `#FF6E4F` de «D»:

| Tema | Acento | DeltaE con «D» |
|---|---|---|
| verde | `#5AE06A` | 114,8 |
| azul | `#4DA3FF` | 109,7 |
| amarillo | `#FFBE1A` | 57,5 |
| **rojo** | `#FF4B2E` | **17,8** |

El rojo queda seis veces mas cerca que cualquier otro tema, pero **por encima del umbral de confusion de un vistazo (DeltaE 10)**. No alcanza para contradecir al handoff de diseno, que es la fuente de verdad en color, y una excepcion por tema («V es verde solo si el club es rojo») seria una regla sorprendente para quien venga despues. Se deja como esta, con el rotulo tan legible como el numero. La linea que habria que tocar para revertirlo es `ClubSummaryCard.js`: `color={escala.main}` -> `color={dsColors.win}`. **No se tocó: el contraste actual se acepta tal cual.**

---

## 10. Bugs de la tarea 5

Todos en `src/utils/clubsHomeTasks.js`, commiteado en `e5a76cf`. **Son defectos de diseño del plan**, no del implementador: el plan traía el código escrito y él lo transcribió literalmente, como se le pidió.

### ✅ CORREGIDO — CRÍTICO: `ESTADOS_MUERTOS` no coincidía con los estados terminales reales

`src/utils/clubsHomeTasks.js:24-27`, usado en las líneas 67, 80 y 93.

Un solo `Set` —`'expirado'`, `'cancelado'`, `'rechazado'`, `'aceptado'`— decide si una tarea está vencida, y se aplica a **tres tablas que usan vocabularios distintos**. Verificado contra las migraciones 43 y 46:

| Tabla | Estados terminales reales | ¿En el `Set`? |
|---|---|---|
| `club_challenges` | `sin_acuerdo`, `finalizado`, `bloqueado_sancion` | **no** |
| `club_challenge_proposals` | `rechazada`, `caducada` (femenino) | **no** — el `Set` tiene `rechazado` y `expirado` |
| `club_match_changes` | `caducado` | **no** — el `Set` tiene `expirado` |

**Consecuencia:** una propuesta rechazada, un desafío sin acuerdo o un cambio caducado quedan como `'abierta'` **para siempre**. El badge cuenta cosas que el usuario ya no puede accionar y lo manda a buscar algo que no existe.

Eso rompe justo el invariante que el encabezado del archivo declara defender: *«que el badge no mienta»*.

**Por qué las 22 pruebas no lo atrapan:** el único caso terminal probado es `estado: 'expirado'` sobre un desafío, reusando el mismo objeto de prueba. Nunca se prueba una propuesta ni un cambio con el vocabulario de *su* tabla.

**Arreglo aplicado.** `ESTADOS_MUERTOS` se sustituyó por `RESUELTOS` y `VENCIDOS`, **un vocabulario por dominio**, y `estadoDeTarea(dominio, estado)` ahora exige saber de qué tabla habla. Los valores se copiaron del `check` de cada migración; los del desafío se **derivan** de `ESTADOS_CERRADOS` de `clubChallengeRules.js` para que un estado cerrado nuevo se herede solo. Hay una prueba que compara la tabla de expectativas contra `ESTADOS` y falla si aparece un estado sin clasificar.

`bloqueado_sancion` y `resultado_en_disputa` quedan **abiertos** a propósito: no son terminales según `TRANSICIONES` —retirar la sanción devuelve el desafío al estado en que estaba— y darlos por vencidos escondería un desafío vivo.

### ✅ CORREGIDO — IMPORTANTE: `'aceptado'` no debe tratarse como vencido

Para `club_match_changes`, `'aceptado'` es el resultado **exitoso** de aceptar un cambio (migración 46): mostrarlo como «vencida» miente, el cambio se aplicó. Para `club_challenges`, `'aceptado'` es `ACEPTADO_LEGADO` — filas anteriores a la migración 41, que el código nuevo ya no produce (ver `clubChallengeRules.js`).

En los dos casos la tarea debe **desaparecer de la lista**, no aparecer como vencida. «Vencida» implica que algo falló o expiró; aquí salió bien.

**Arreglo aplicado.** Hay un tercer estado, `'resuelta'`, y `normalizarTareas` **no dibuja** esas tareas: salieron bien y no hay nada que hacer con ellas. Es `{finalizado, aceptado}` en el desafío, `{aprobada}` en la propuesta y `{aceptado}` en el cambio. Que no ocupen lugar importa además para el tope de cuatro visibles.

### ✅ CORREGIDO — IMPORTANTE: `diasHasta` con valores 0 y negativos

`src/utils/clubsHomeTasks.js`, función `diasHasta` y el título de la tarea `partido`. Verificado ejecutando la función:

| Situación | Título que sale |
|---|---|
| Partido en 2 horas | «Próximo partido en **1 días**» — sin singular |
| Partido que empezó hace 5 minutos | «Próximo partido en **0 días**» — un partido en curso no es «el próximo» |
| Partido que empezó hace 2 días | «Próximo partido en **-2 días**» |

El mismo archivo sí resuelve singular y plural en `etiquetaVerMas`, pero no acá. Ninguna de las 22 pruebas verifica el **texto** de esa tarea, solo su `type`.

**Arreglo aplicado.** `diasHasta` se sustituyó por `diasDeCalendario` + `plazoDePartido` + `tituloPartido`. Se cuenta por **día de calendario en hora local**, no por bloques de 24 horas: un partido de esta noche es «hoy» aunque falten once horas. Sale «Próximo partido hoy», «… mañana» o «… en N días» —el plural nunca se equivoca porque N siempre es ≥ 2—, y **un partido que ya empezó no genera tarea**: anunciarlo como «el próximo» manda al usuario a algo que no va a alcanzar.

### ✅ CORREGIDO — MENOR: documentación que citaba el trigger equivocado

`src/utils/clubPlanLimits.js:9` dice que `check_user_club_limit` de la migración 11 valida estos límites. **Es falso.** El trigger de cupos por plan es `check_club_limits()` / `trg_check_club_limits`, de la migración 11. `check_user_club_limit` es otra función, de la migración 24, y valida «máximo 3 clubes por jugador».

**Arreglo aplicado.** El comentario nombra `check_club_limits()` / `trg_check_club_limits` sobre `club_members` (migración 11), leído del archivo, y avisa expresamente de no confundirlo con `check_user_club_limit()` de la 24, que limita a 3 los clubes por jugador. Verificado también que los números del trigger (15/1 y 26/3) coinciden con `CLUB_LIMITS`.

### ✅ CORREGIDO — MENOR: nómina con `cupos` en 0 o nulo

La tarea de nómina se generaba solo si `confirmados < cupos`. Con `cupos: 0` o `null` desaparecía en silencio; peor, con `confirmados: null` **sí** se generaba, porque `null < 11` es `true` en JavaScript, y la tarjeta salía con «null de 11 cupos confirmados».

**Arreglo aplicado.** Una guardia `nominaAccionable()` exige dos cuentas de verdad. `cupos` en 0 o nulo se trata como **dato incompleto**, no como «partido sin cupos»: la migración 43:177 tiene `check (cupos_por_club between 4 and 15)`, así que esos valores no existen en un partido legítimo. Ante datos a medias, callar en vez de inventar una cifra. Ocho pruebas nuevas.

### ✅ CORREGIDO — MENOR: desempate entre tareas del mismo tipo

**Arreglo aplicado.** El contrato queda escrito junto al comparador: **entre tipos manda `ORDEN`; dentro de un tipo manda el orden en que vino la fuente**, que es el que ya trae el servidor, y se apoya en que `Array.prototype.sort` es estable desde ES2019. Tres pruebas lo fijan, incluida una que comprueba que **el estado no entra en el orden**: hundir lo vencido al fondo escondería tareas accionables detrás de avisos muertos cuando se aplica el tope de cuatro visibles.

---

## 11. Pruebas y resultados

| Momento | Suite | Resultado |
|---|---|---|
| Base (`main @ 95032d3`) | 796 | verde |
| Tras la tarea 1 | 797 | verde |
| Tras la tarea 2 | 800 | verde |
| Tras las tareas 3 y 4 | 800 | verde |
| Tras la tarea 5 | **822** | verde |
| Tras arreglar el crítico de la 5 | **845** | verde |
| Tras arreglar los tres menores de la 5 | **856** | verde |
| Tras cerrar la tarea 6 | **874** | verde |
| Tras las tareas 7 y 8 | **881** | verde |
| Tras la revisión y sus 12 arreglos | **886** | verde |
| Tras cerrar los tres menores | **893** | verde |
| Tras la revisión final (§15) | **923** | verde |
| **Ahora** | **923** | **verde, 0 fallos** |

`npm run lint`: **0 errores**, 24 avisos preexistentes. `useClubsHome.js` también linta limpio.

Detalles que importan:

- Las 22 pruebas de `clubsHomeTasks.js` se **ejecutaron en un scratchpad antes de escribir el plan** y daban 22/22. Se verificó después que el módulo commiteado es **idéntico token a token** a ese. Aun así tenía el defecto crítico de §10: **la verificación era real, la cobertura era estrecha**. Que una suite pase no dice nada sobre lo que no prueba.
- La prueba de alfas de la tarea 1 y la de valores de la tarea 2 se **vieron fallar** alterando un valor a mano antes de darlas por buenas.
- **No hay pruebas de render.** El repo no tiene esa infraestructura: las 822 son de lógica pura. Decisión tomada explícitamente para las tareas 7 y 8.
- `useClubsHome.js` **no tiene ninguna prueba**.

---

## 12. Cambios actuales sin commit

```
?? src/utils/useClubsHome.js      ← 352 líneas del agente interrumpido. Sin revisar.
?? docs/Rediseno-Clubes-FutFinder.md
```

`docs/Rediseno-Clubes-FutFinder.md` **estaba sin seguir desde antes de empezar** y no es parte de este trabajo. No lo toques ni lo añadas.

`src/utils/useClubsHome.js` es el resultado de la tarea 6. **Se decidió NO commitearlo**, aunque la auditoría de §3 no encontró nada roto, porque el criterio acordado es que lo que todavía debe revisarse no entra al historial como trabajo terminado. Meterlo ahora lo haría pasar por hecho: quedaría en el árbol de la rama, la tarea 9 construiría contra él y nadie volvería a mirarlo.

No está en git, así que **un `git clean -fdx` lo borra**. Respáldalo antes de limpiar el árbol.

---

## 13. Riesgos técnicos

**El badge ya no miente.** El crítico de §10 está corregido con 23 pruebas nuevas. Las tareas 9 y 10 pueden apoyarse en `contarConAccion()`.

**Un módulo probado no es un módulo correcto.** El caso de `clubsHomeTasks.js` es la lección de esta sesión: 22 pruebas verdes, ejecutadas de verdad, y aun así el invariante principal roto. Las pruebas del plan las escribió quien escribió el código, y compartían el mismo punto ciego. Cuando escribas pruebas para los estados de una tabla, **léelos de la migración**, no de tu memoria.

**Las pruebas del repo son CommonJS sobre módulos ESM.** Funciona porque Node 22 soporta `require()` de ESM. Pero cualquier módulo que importe `./supabase` u otro import sin extensión **no se puede cargar bajo `node --test`**. Si escribes lógica que quieres probar, va en un módulo puro con imports con extensión `.js`.

**`clubs.tema` puede faltar.** La migración 53 no está garantizada en todos los entornos. `services/clubs.js` y `services/matches.js` ya lo manejan con `columnasOpcionales.js`; cualquier consulta nueva que pida `tema` tiene que hacer lo mismo o degradar a verde.

**`ChatThreadScreen.js` y `services/matches.js` son código compartido.** El primero sirve también hilos de partido y mensajes directos; el segundo lo usan Inicio y Partidos. Un error ahí no se queda en Clubes.

**Nada está pusheado.** Siete commits viven solo en este disco. El repo se trabaja desde dos Macs: hasta que se pushee, el otro no ve nada de esto.

**El árbol de trabajo es uno solo.** No corras dos agentes implementando a la vez: cada uno ejecuta `npm run verify` y vería el árbol a medio editar del otro. Un revisor sí puede correr en paralelo con un implementador, porque solo lee.

---

## 14. Qué hacer al retomar

Por orden. **No empieces por la tarea 7.**

**Paso 0.** `git pull` en `main`, comprobar que `rediseno/portada-clubes` sigue en `e5a76cf`, y leer `.superpowers/sdd/2026-08-28-portada-clubes/progress.md` entero. Ese registro es el mapa: los commits que nombra existen en git aunque nadie los recuerde.

**Paso 1 — Arreglar `clubsHomeTasks.js` (§10). HECHO, los seis hallazgos.** Nada pendiente acá; el siguiente paso real es el 2.

1. Leer los `check (estado in (...))` de `club_challenges` y `club_challenge_proposals` en `supabase/migrations/43_desafios_plazos_y_propuesta.sql`, y de `club_match_changes` en `46_cambios_de_partido.sql`. **Copiar los valores de ahí, no escribirlos de memoria.**
2. Sustituir `ESTADOS_MUERTOS` por un vocabulario terminal **por dominio**.
3. Decidir qué pasa con `'aceptado'`: no es «vencida». Lo más probable es que esas tareas no se generen.
4. Arreglar `diasHasta`: singular y plural, un caso para menos de un día, y qué hacer con un partido ya empezado.
5. Corregir el comentario de `clubPlanLimits.js:9` — el trigger es `check_club_limits`.
6. Decidir el caso de `cupos` 0 o nulo, y documentar el desempate del orden.
7. **Pruebas nuevas para cada uno**, usando los estados reales de cada tabla. Ver fallar cada prueba antes de darla por buena.
8. `npm run verify`, commit local, sin push.

**Paso 2 — Decidir qué hacer con `useClubsHome.js` (§3).** Está sin commitear, sin informe y sin revisar. Dos salidas honestas:

- **Auditarlo** contra el brief de la tarea 6 (`.superpowers/sdd/2026-08-28-portada-clubes/task-6-brief.md`) como si lo hubiera escrito un desconocido, y decidir si se conserva.
- **Borrarlo y rehacer la tarea 6** desde el brief.

Lo que **no** vale es commitearlo porque linta limpio. No tiene una sola prueba ni una sola revisión.

Si lo auditas, comprueba en particular lo que el brief le pedía justificar y cuyo informe se perdió: de dónde saca los partidos para `proximoPartidoDeClub`, si `listOpenMatches` realmente incluye los partidos de club ya agendados, y cómo filtra `listNotifications` por club activo — los avisos son del usuario, no del club, y una lista vacía es preferible a una mentirosa.

**Paso 3 — Seguir el plan** por las tareas 7, 8, 9 y 10, en ese orden. Los briefs ya están extraídos en `.superpowers/sdd/2026-08-28-portada-clubes/task-N-brief.md`.

Ojo con el plan: dice `git push` al final de cada tarea. **Se anuló.** Commit local; el push va con el merge.

**Paso 4 — Antes del merge.** Triar los dos menores diferidos de §9 **(hecho, §9)**, correr una revisión de toda la rama **(hecha, §15)**, y recién ahí presentar el merge a `main`.

Y actualizar `docs/memoria/funcionalidades/clubes.md` (cambia la entrada de la pestaña) y `docs/memoria/diseno/sistema-visual.md` (tonos nuevos). Solo esas dos.

---

## 15. La revisión final: un hallazgo real y uno descartado

Una revisión de toda la rama levantó dos puntos. Los dos se comprobaron contra el código, las migraciones y los briefs de `.superpowers/sdd/2026-08-28-portada-clubes/` antes de tocar nada.

### ✅ CORREGIDO — El estado `'vencida'` era inalcanzable desde el flujo real

`clubsHomeTasks.js` clasifica tres situaciones —abierta, vencida, resuelta— y `PendingTaskCard` sabe dibujar la vencida: opacidad .55, chip «Expiró», sin botón, y `contarConAccion()` no la suma. **Nada la producía.** `ClubsHomeContext` filtraba `estado === 'pendiente'` sobre los desafíos recibidos, y el cambio de partido se pedía con `getCambioPendiente()`, que filtra `estado = 'pendiente'` **en la base**. Las pruebas puras pasaban porque inyectaban tareas vencidas a mano; el cableado real no las dejaba nacer.

Con las propuestas pasaba lo mismo por un camino distinto: sólo se pedía `getPropuestaVigente()` para desafíos en `esperando_aprobacion`, y de ahí una propuesta no puede salir vencida. **Esto se cerró después, en la pasada de F10/N4: ver §16.**

**Arreglo aplicado.** Quién entra en la lista sale de dos funciones puras nuevas en `clubsHomeSources.js`, con **ventana de 7 días** (`DIAS_DESENLACE_VISIBLE`) y 20 pruebas:

| Función | Qué deja pasar |
|---|---|
| `desafiosRecibidosParaTareas()` | `pendiente` siempre; `sin_acuerdo` cerrado hace ≤ 7 días |
| `cambioParaTareas()` | el `pendiente` si lo hay; si no, el último `caducado` de ≤ 7 días |

**Por qué hace falta la ventana.** `listChallengesForClub()` devuelve el historial **completo y sin límite** del club. Sin acotarlo, cada desenlace de la historia del club se quedaría en la portada para siempre.

**Por qué sólo `sin_acuerdo`, y no los otros tres cierres malos.**

| Estado | Veredicto |
|---|---|
| `sin_acuerdo` | **entra.** No lo decidió nadie, lo decidió el reloj, y el servidor avisa a los **dos** clubes. «Expiró» es exactamente lo que pasó |
| `expirado` | fuera. La 43 avisa **sólo al retador** y lo argumenta: «el retado nunca respondió, y avisarle de algo que decidió ignorar es ruido». La portada no contradice al servidor |
| `rechazado` | fuera. Lo decide el retado, o sea yo (26:75). Contarme lo que acabo de decidir es el mismo ruido |
| `cancelado` | fuera. La 47 sólo lo aplica desde `publicado`/`en_juego` y **no escribe fecha de cierre**, así que el único ancla sería un `created_at` de hace semanas; y «Desafío recibido» no es lo que pasó — se canceló un encuentro ya publicado, y eso lo cuenta el hilo |

**Con qué fecha se mide.** `sin_acuerdo` no toca `responded_at`: 43:395 y 43:733 escriben sólo `estado` y `motivo_cierre`. La ventana se ancla en `prorroga_vence_at || negociacion_vence_at`, el plazo que corría al cerrarse. La prórroga manda sobre la negociación: con el otro, un desafío cerrado ayer contaría como cerrado hace tres días. Un desenlace **sin fecha usable no entra** —dejarlo pasar sería volver al historial sin fin por la puerta de atrás—, y una fecha en el **futuro** sí entra: un «No» a la prórroga cierra en el acto (43:733) con el plazo todavía por delante.

**Un cambio de copy que sólo se vuelve visible ahora.** `coletilla()` le pegaba «· responde un admin» a toda tarea de un jugador. En una vencida el botón no falta por su rol —tampoco lo tiene el admin—, así que mandarlo a buscar a alguien que tampoco puede hacer nada es la promesa vacía que estas tarjetas existen para no hacer. Ahora sólo se pega si `status === 'abierta'`. **Fue el primer parche de un problema mayor —el texto entero de la tarjeta vencida era el de una tarea pendiente— que se resolvió en §16.**

**Y un cambio de consulta.** `getCambioPendiente()` → `getCambiosDelPartido()`, porque la primera no puede devolver un caducado ni aunque se quiera. Sigue viajando **uno como máximo**; lo elige `cambioParaTareas()`, comparando `respondida_at` en vez de fiarse del orden de la consulta.

**Lo que sigue sin aparecer, a propósito.** `bloqueado_sancion` y `resultado_en_disputa` están vivos y el clasificador los da por `abierta`, pero la tarea dice «Desafío recibido / Responder» y ahí no hay nada que responder: se atienden en el hilo. Y un desafío **enviado** que expiró —del que el servidor **sí** avisa al retador— tampoco entra: la portada sólo construye tareas desde `recibidos`, y añadir «Desafío enviado» es alcance nuevo.

### ❌ DESCARTADO — «La tematización de `ChallengeHeader` es parcial»

La revisión pedía teñir también el icono `Swords`, el borde y el fondo de la barra con el color del club. **No es un defecto: es un contrato que no existe.**

`task-3-brief.md` define la tematización como una **tabla de sustitución de tokens verdes**, y lista `ChallengeHeader.js` con «2 usos de verde»: el fondo del CTA (`chatColors.green` → `tema.main`) y su tinta (`chatColors.inkOnGreen` → `tema.ink`). **Los dos están convertidos.** El paso 3 del propio brief dice que lo único que puede quedar sin tematizar son `win`/`winSoft`.

Los tres puntos señalados no son verdes: salen de `chatColors.neon` = `#FF2D55`, `challengeBorder` = `rgba(255,45,85,0.22)` y `cardChallenge` = `#141013`. Ese neón es la identidad del **módulo de chat de desafío**, compartida con `ChallengeEventBubble` en el mismo hilo. Y `theme/clubThemes.js:16-21` excluye las superficies con todas sus letras: «El fondo oscuro, los textos, la navegación… siguen siendo los de `dsColors` para todos los clubes». Teñirlas sería una decisión de diseño nueva, no un arreglo.

Queda una inconsistencia menor y real, anotada por si alguien la quiere: el `Swords` de la cabecera va en neón mientras el `Swords` de la barra de abajo (`ChatThreadScreen.js`, «Ver / Crear partido de club») va en `temaDesafio.main`. Son cosas distintas —indicador de estado vs. botón del club— y el neón de la cabecera hace juego con su propio borde.

### ✅ CORREGIDO — El contrato del color no tenía prueba

Lo que la revisión sí destapó: **de qué club sale el acento del hilo no estaba probado en ninguna parte.** `miClubId` se decidía en línea dentro de `ChatThreadScreen.js`, un archivo con JSX que `node --test` no carga — el mismo muro que ya obligó a sacar `clubesDePartidoQuery.js`.

La regla salió a `clubPropioDelDesafio()` en `utils/challengeThread.js`, con **7 pruebas**. La que importa fija el contrato de frente: con un solo bando en la lista de membresías, la respuesta **no puede ser el otro** — que es el fallo que un `find` invertido produciría en silencio. Las demás cubren el hilo abierto sin membresía (cae a `null`, y `temaDeClub(null)` es verde), el desafío todavía sin cargar, y pertenecer a los dos clubes: gana el retador, siempre el mismo, para que el hilo no cambie de color entre dos aperturas.

---

## 16. F10 y N4: la conducta definitiva

La auditoría de los 92 puntos del checklist dejó **2 fallos confirmados**. Los otros 90 quedaron en 71 aprobados contra el código y las pruebas, 18 bloqueados por falta de sesión y datos sembrados, y 1 —el ΔE del tema rojo— que necesitaba una decisión de producto y ya la tiene: **cerrado sin cambio, §17**. Ningún punto se verificó con los ojos: no hay automatización de navegador que llegue más allá del login.

### F10 — el contenido de la tarjeta vencida

**Lo que fallaba.** §15 hizo alcanzable el estado `'vencida'`, pero sólo arregló el cableado. El TEXTO seguía siendo el de una tarea pendiente:

| Antes | Chip que lo acompañaba |
|---|---|
| «Desafío recibido» · cta `Responder` | «Expiró» |
| «Propuesta pendiente» · cta `Revisar` | «Expiró» |
| «Cambio de partido» · «El rival propuso mover el encuentro» | «Expiró» |

Apagar la tarjeta al 55 % no arregla que invite a responder algo que ya no existe.

**Ahora el título nombra el estado, y cada cierre tiene el suyo.** Si los cuatro dijeran «Desafío cerrado», la tarjeta explicaría menos que el chip.

| Dominio | Estado | Título | Subtítulo |
|---|---|---|---|
| desafío | `sin_acuerdo` | Desafío sin acuerdo | el rival, o «La negociación se cerró sin acuerdo» |
| desafío | `expirado` | Desafío expirado | Nadie respondió dentro del plazo |
| desafío | `rechazado` | Desafío rechazado | El desafío no se aceptó |
| desafío | `cancelado` | Desafío cancelado | El encuentro se canceló |
| propuesta | `rechazada` | Propuesta rechazada | El rival no aceptó la propuesta oficial |
| propuesta | `caducada` | Propuesta caducada | Se aprobó otra propuesta del desafío |
| cambio | `caducado` | Cambio sin respuesta | El plazo se cumplió sin que nadie contestara |
| cambio | `rechazado` | Cambio rechazado | El cambio no se aceptó |

`cta` viaja en `null`: no basta con que la tarjeta no lo dibuje, el objeto no puede seguir prometiendo «Responder» en un campo que otro consumidor podría leer.

El **subtítulo del desafío nombra al rival** cuando se sabe quién era, y cae a la explicación cuando no. Con el título ya contando el estado, lo útil es con quién fue: dos desafíos cerrados el mismo día serían la misma tarjeta sin eso.

Hay **respaldo por dominio** («Desafío cerrado», «Propuesta cerrada», «Cambio cerrado») porque `VENCIDOS.desafio` se **deriva** de `ESTADOS_CERRADOS`: una migración puede añadir un cierre nuevo sin que nadie escriba su texto, y ese día la tarjeta tiene que decir algo cierto.

### F10 — la propuesta vencida ya puede nacer

De los tres dominios, la propuesta era el único donde `'vencida'` seguía siendo inalcanzable. Se cerró por la vía que sí existe:

- `ESTADOS_CON_PROPUESTA` pasa a ser `['esperando_aprobacion', 'negociacion']`. El segundo es donde **cae** el desafío cuando una propuesta se rechaza (43d:130), y por tanto el único sitio donde queda ese rechazo.
- `propuestasParaTareas()` deja pasar la `pendiente` siempre, y la `rechazada` **sólo si la propuso mi club**, dentro de la ventana de 7 días. Responder una propuesta le toca al club que NO la propuso (43:1078): si el proponente era el rival, quien rechazó fue mi propio club, y contarme lo que acabo de decidir es el mismo ruido que un desafío `rechazado`.

### F10 — por qué `caducada` NO se cablea

El checklist nombra «una propuesta caducada» como disparador. **Ese estado no significa lo que el checklist asume, y verificarlo cambió el arreglo.**

Las **tres únicas** escrituras de `caducada` en todo el esquema —`44:329`, `44b:438` y `45:855`— son la misma sentencia, dentro del RPC de aprobación:

```sql
update public.club_challenge_proposals set estado = 'caducada'
 where challenge_id = v_row.id and id <> v_prop.id and estado = 'pendiente';
```

No hay cron, no hay plazo, no hay otra puerta. Una propuesta `caducada` implica que **otra se aprobó y el partido se publicó**. Pintarla «Expiró» diría que la negociación falló justo cuando terminó bien — exactamente el error que `RESUELTOS` existe para impedir («Pintarlos «vencida» diría que algo falló»).

Así que el estado **no entra por cableado**, pero **su texto sí está escrito y probado**, por si una reparación manual en la base deja una suelta — que es el caso que el propio comentario de la migración 44 dice estar cubriendo.

**Contra la letra del checklist esto es una desviación declarada, no un aprobado.** F10 queda cumplido como contrato de interfaz: cualquier tarea vencida, en los tres dominios, sale al 55 %, sin botón, con chip «Expiró», con texto que describe su estado y sin sumar al badge.

### N4 — un solo rótulo para el badge

`contarConAccion()` ya garantizaba que la barra inferior y «Pendiente para ti» **contaran** lo mismo. Lo que no estaba compartido era el **rótulo**: `MainTabs` cortaba en `'9+'` y la portada pintaba el número entero, así que con doce pendientes los dos badges del mismo dato se contradecían a diez píxeles de distancia.

`etiquetaBadge()` vive en `clubsHomeTasks.js`, junto al conteo, y la usan los dos. El tope es del rótulo, no del conteo: `badgeCount` sigue viajando exacto y es el que oye un lector de pantalla («Clubes, 12 pendientes»).

Lo fija una prueba que **lee el fuente de los dos archivos** (`navigation/__tests__/badgeDeClubes.test.js`), porque el defecto no estaba dentro de ninguna función: estaba en que dos archivos escribían la misma regla por separado. Ninguna prueba de lógica pura puede ver eso. El repo ya prueba cableado así en `rutasPrivadas.test.js` y `sesionCableado.test.js`.

### Pruebas

**25 nuevas, escritas antes del arreglo y vistas fallar** (7 rojas tras el bloque de copy, 10 tras el del badge, 19 tras el de propuestas, 21 tras los respaldos). Una de ellas —«ni el título ni el subtítulo de una vencida hablan de algo por hacer»— rechazó el primer título que se puso al cambio caducado, «Cambio sin **responder**», por contener el verbo. Quedó «Cambio sin respuesta», que además es mejor castellano para un estado.

| Momento | Suite | Resultado |
|---|---|---|
| Tras la revisión final (§15) | 923 | verde |
| **Tras F10 y N4 (§16)** | **948** | **verde, 0 fallos** |

`npm run lint`: 0 errores, 24 avisos preexistentes. `npm run build:web`: código de salida 0.

### Lo que sigue pendiente

Los **18 puntos bloqueados** del checklist necesitan sesión iniciada y datos sembrados: E6-E9 (varios clubes y persistencia), H5-H6 (pila de navegación), K1 (los cuatro temas), L1-L2 (error total), M2-M6 (responsive), C3-C4, D7, N3. No se tocaron. **K3 ya no está en esta lista: se cerró por decisión, no por arreglo (§17).**

---

## 17. K3 — decisión de diseño: el tema rojo se queda como está

**Cerrado el 2026-09-02. No es una corrección técnica: no se tocó una sola línea de código.**

El punto K3 del checklist pedía mirar los tiles V y D del resumen con el tema rojo puesto y decidir si molestaban. La medición está en §9 y no cambia:

| Tema | Acento | ΔE76 con el `#FF6E4F` de «D» |
|---|---|---|
| verde | `#5AE06A` | 114,8 |
| azul | `#4DA3FF` | 109,7 |
| amarillo | `#FFBE1A` | 57,5 |
| **rojo** | `#FF4B2E` | **17,8** |

**La decisión es aceptar ese contraste tal cual.** El rojo queda seis veces más cerca que cualquier otro tema, y eso está medido y asumido a conciencia, no pasado por alto. Sigue por encima del umbral de confusión de un vistazo (ΔE 10), lo que distingue los dos tiles es la letra —dibujada tan legible como el número— y una excepción por tema («V es verde sólo si el club es rojo») sería una regla sorprendente para quien venga después. El handoff de diseño manda en color y no se contradice por un caso.

Qué significa esto para quien lea después:

- **K3 no vuelve a la lista de pendientes.** No es deuda ni un «ya lo veremos»: es una decisión de producto tomada con el número delante.
- **No hay arreglo asociado**, ni prueba nueva, ni cambio de tokens. `ClubSummaryCard.js` sigue con `color={escala.main}` en el tile V.
- **Si alguien quiere revertirlo** —cambiar de opinión es legítimo— es una línea: `color={escala.main}` → `color={dsColors.win}`. Pero entonces sería un cambio de diseño nuevo, con su propia justificación, no la corrección de un defecto pendiente.

Lo que **sí** sigue abierto es K1, que es otra cosa: comprobar con los cuatro temas puestos que la portada entera los sigue. Está entre los 18 controles bloqueados de §16 porque necesita sesión y datos sembrados, y no se puede dar por aprobado desde el código.
