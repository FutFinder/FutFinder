# Navegación

Última revisión: 2026-11-27

## Propósito

Ubicar rutas, límites de sesión y destinos de enlaces o avisos sin duplicar el detalle de cada dominio.

## Estado verificado

`AppNavigator` monta un `RootStack` tras resolver `AuthProvider`. Parte en `Splash`; éste dirige a `Welcome`, `LocationPermission` o `Main` según sesión y onboarding. `Main` contiene las tabs Inicio, Partidos, Clubes, Crear, **Reservas**, Chat y Perfil — Avisos dejó de ser una tab (decisión del handoff de Reservas) y su lugar en la barra lo toma Reservas; la campana de notificaciones vive ahora arriba a la derecha en cada pantalla principal (`NotificationBell`), no en la barra inferior. Crear intercepta su pulsación y abre `CreateMatch` en el stack, por lo que no deja una tab seleccionable ni muestra la barra inferior.

Las rutas operativas del stack (partidos, chat, perfil, clubes, ajustes, avisos y calificación) usan `withAuthGuard`. Si no hay sesión, la guarda registra el destino y restablece Login; tras autenticarse y con onboarding completo, Login reanuda ese destino. La resolución inicial también evita montar `NavigationContainer` antes de conocer la sesión. `LocationPermission` se alcanza desde el flujo de onboarding, pero no está envuelta individualmente por la guarda.

## Enlaces y avisos

- `linking` acepta el esquema de la app y los dominios web. **Desde el 2026-11-27 toda pantalla con sesión tiene dirección propia**, y las direcciones viven en `src/navigation/direcciones.js` (sin React, para poder probarlas), no en `AppNavigator`. Antes unas cincuenta no la tenían: la web les inventaba `/ClubMembers?clubId=…`, que después no reconocía, y recargar devolvía al inicio. Las seis tabs tienen la suya (`inicio`, `partidos`, `clubes`, `reservas`, `chat`, `perfil`). Los caminos van en español y por familia: `clubes/:clubId/…`, `p/:matchId/…`, `desafio/:challengeId/…`, `recintos/:complejoId/…` (reservar), `reserva/:reservaId/…`, `mis-recintos/:complejoId/…` (administrar), `perfil/ajustes/…`.
  - **Abierta directo, cada pantalla queda sobre la que le corresponde** (`DEBAJO` + `conPantallaDeAbajo`, enchufada como `linking.getStateFromPath`), y todo sobre Main en la pestaña de donde cuelga: «volver» lleva a donde llevaría si se hubiera llegado tocando (Invitar → El grupo → Mis reservas → Reservas). Las páginas sin sesión (`SIN_SESION`) nunca llevan Main debajo: Main pide sesión y mandaría a Login a quien sólo quería leer los términos.
  - **Lo que no sirve en una URL se esconde con `stringify: { x: ocultar }`** (objetos, listas, fotos), y la pantalla lo vuelve a pedir: `OcuparHorario` los bloques del día, `InvitarJugadores` quiénes ya están, `SolicitudRecinto` la solicitud a corregir (en la URL sólo va `corregir=si`). Los números y booleanos vuelven como texto (`modoRival=true`, `precioBloque=28000`): quien los lee los convierte.
  - **Una dirección se puede escribir aunque el panel esconda el botón.** `Administradores` sólo se ofrece al dueño, pero cualquier admin del recinto llega por `/mis-recintos/<id>/administradores`: el servidor ya le rechaza agregar, quitar y repartir permisos, y desde `cea4fa7` la pantalla le muestra la lista sin botones. Toda pantalla nueva tiene que defenderse sola, no confiar en que nadie llegue.
  - Con Main debajo hay dos guardas montadas a la vez; `elegirDestinoPendiente` (`utils/routing.js`) impide que la de Main pise el destino que pidió la persona.
  - `navigation/__tests__/direcciones.test.js` pasa cada pantalla por las mismas `getPathFromState`/`getStateFromPath` de React Navigation, ida y vuelta, y exige que toda pantalla con guarda esté en su tabla `LLEGADAS`. **Una pantalla nueva con sesión no pasa la prueba sin dirección.**
- `Terminos`, `Privacidad` y `Cookies` son tres rutas del stack que montan la misma `LegalScreen`, sin `withAuthGuard`: se leen sin sesión (se enlazan desde Registro, `Terms` y Ajustes). `Terms` es la pantalla de aceptación del onboarding, distinta de `Terminos`.
**El Splash tiene techo para la animación, no para la sesión** (2026-09-11). Navegaba recién cuando terminaban las dos, y la animación del logo se mueve con `requestAnimationFrame`, que el navegador **suspende mientras la página no se dibuja** — una pestaña en segundo plano, por ejemplo. Ahí la secuencia no termina nunca y lo único que se ve es el logo quieto; se arregla solo al mirar la pestaña, pero dejaba una animación decorativa como el único motivo por el que alguien no puede entrar. `conTecho()` (`src/utils/conTecho.js`, 5 pruebas) le pone 3 s de tope. **La sesión se sigue esperando sin techo a propósito**: soltarla antes mandaría a la portada a alguien que sí tiene cuenta. Verificado con la página oculta, que es justo la condición que antes colgaba: llega a `Welcome`.

- `navigationRef` y la promesa de disponibilidad permiten que `App.js` espere el fin de Splash antes de abrir el destino de un push. Los destinos se resuelven una sola vez por identificador de aviso para evitar dobles navegaciones en arranque frío.
- `ChatTab` renderiza la bandeja de chat dentro de `Main` (`NotifTab` ya no existe: la bandeja de avisos es la ruta `Notifications` del stack, a la que se llega desde `NotificationBell`). El stack añade además los detalles `ChatThread` y `ChatDetails`. Los badges de la barra son el de Chat (mensajes sin leer) y el de Clubes (pendientes con acción); los de avisos viven en la campana.
- `Moderacion` es una ruta del stack a la que se llega desde Ajustes → Moderación; la entrada sólo se dibuja para quien está en el padrón de moderadores (la autoridad es el servidor, no la pantalla).
- `ClubProposal` es la propuesta oficial de un desafío y se abre desde la cabecera del hilo `challenge:<id>` con `{ challengeId, modo: 'crear' | 'revisar', proposalId? }`. La cabecera sólo dibuja botón para las acciones que la app sabe ejecutar; el resto del estado se muestra como información.
- `ClubMatchRoster` recibe `{ matchId }` y es la superficie operativa de U3: inscripción/postulación, confirmación/rechazo y salida por club. `MatchDetail` deriva allí sólo los partidos formales con propuesta y reparto por club; los partidos de clubes antiguos conservan el flujo normal. `club_match_reserva_omitida` también apunta a esta ruta.
- El descubrimiento del vertical Reservas encadena `ComplejoDetail { complejoId }` → `ElegirCancha { complejoId, canchaId? }` → `FechaHora { complejoId, canchaId }` → `Resumen { complejoId, canchaId, fechaLabel, horaInicio, horaFin, duracion }`, las cuatro con `withAuthGuard`. Se pasan ids y valores ya resueltos, no objetos completos — cada pantalla vuelve a pedir el complejo por id en vez de arrastrarlo por parámetros. Ver [Reservas](../funcionalidades/reservas.md).

- **Enlaces universales (preparados el 2026-11-13, faltan dos datos):** `https://www.futfinder.cl/...` abre la app en vez del navegador para **toda dirección con sesión** (desde el 2026-11-27: las seis pestañas, `p/*`, `publicar`, `clubes/*`, `desafio/*`, `chat/*`, `perfil/*`, `jugador/*`, `amigos`, `avisos`, `saldo`, `moderacion`, `recintos/*`, `mis-reservas`, `reserva/*`, `mis-recintos` y `mis-recintos/*`). La prueba recorre `DIRECCIONES` y falla si una dirección con sesión no está cubierta, si una de `SIN_SESION` sí lo está, o si una ruta reclama algo que la app no sabe abrir (términos, políticas y `ui-reservas` quedan en el navegador). Una sola fuente, `scripts/enlacesUniversales.js`, alimenta `app.config.js` (`ios.associatedDomains`, `android.intentFilters` con `autoVerify`) y `scripts/enlaces-universales.mjs`, que escribe `public/.well-known/apple-app-site-association` y `assetlinks.json`. **Falta correr ese script** con el Team ID de Apple y la huella SHA-256 del certificado de Android (`eas credentials`; más la de Play Console si se usa la firma de apps de Play), y que llegue un build nuevo. El dominio es `www` a propósito: `futfinder.cl` redirige a `www` y ni Apple ni Google siguen redirecciones; por eso «Compartir partido» (`ShareSheet.js`) ya arma `https://www.futfinder.cl/p/<id>`. La prueba `scripts/__tests__/enlacesUniversales.test.js` vigila que las cuatro piezas calcen.

## Fuentes principales

- `src/navigation/AppNavigator.js`, `src/navigation/direcciones.js`, `src/navigation/MainTabs.js` y `src/navigation/withAuthGuard.js`
- `src/contexts/AuthContext.js`, `src/utils/routing.js`, `src/utils/notificationTargets.js` y `App.js`

## Limitaciones conocidas

Los enlaces profundos llevan a rutas protegidas y por tanto requieren sesión. El repositorio prueba la decisión pura de ruta inicial, no una ejecución de navegación nativa completa.

## Notas relacionadas

- [Autenticación](../funcionalidades/autenticacion.md)
- [Avisos y push](../funcionalidades/avisos-y-push.md)
- [Reservas](../funcionalidades/reservas.md)
- [Seguridad y privacidad](seguridad-y-privacidad.md)
- [Inicio de la memoria](../00-inicio.md)
