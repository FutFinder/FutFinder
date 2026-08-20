# Navegación

Última revisión: 2026-08-20

## Propósito

Ubicar rutas, límites de sesión y destinos de enlaces o avisos sin duplicar el detalle de cada dominio.

## Estado verificado

`AppNavigator` monta un `RootStack` tras resolver `AuthProvider`. Parte en `Splash`; éste dirige a `Welcome`, `LocationPermission` o `Main` según sesión y onboarding. `Main` contiene las tabs Inicio, Partidos, Clubes, Crear, **Reservas**, Chat y Perfil — Avisos dejó de ser una tab (decisión del handoff de Reservas) y su lugar en la barra lo toma Reservas; la campana de notificaciones vive ahora arriba a la derecha en cada pantalla principal (`NotificationBell`), no en la barra inferior. Crear intercepta su pulsación y abre `CreateMatch` en el stack, por lo que no deja una tab seleccionable ni muestra la barra inferior.

Las rutas operativas del stack (partidos, chat, perfil, clubes, ajustes, avisos y calificación) usan `withAuthGuard`. Si no hay sesión, la guarda registra el destino y restablece Login; tras autenticarse y con onboarding completo, Login reanuda ese destino. La resolución inicial también evita montar `NavigationContainer` antes de conocer la sesión. `LocationPermission` se alcanza desde el flujo de onboarding, pero no está envuelta individualmente por la guarda.

## Enlaces y avisos

- `linking` acepta el esquema de la app y los dominios web; enlaza `p/:matchId` a detalle de partido y define rutas de gestión, cupo, solicitud, edición y publicación.
- `navigationRef` y la promesa de disponibilidad permiten que `App.js` espere el fin de Splash antes de abrir el destino de un push. Los destinos se resuelven una sola vez por identificador de aviso para evitar dobles navegaciones en arranque frío.
- `NotifTab` y `ChatTab` renderizan respectivamente la bandeja de avisos y la bandeja de chat dentro de `Main`. El stack añade la ruta `Notifications` y los detalles `ChatThread` y `ChatDetails`; los badges se actualizan desde las suscripciones de sus dominios.
- `ClubProposal` es la propuesta oficial de un desafío y se abre desde la cabecera del hilo `challenge:<id>` con `{ challengeId, modo: 'crear' | 'revisar', proposalId? }`. La cabecera sólo dibuja botón para las acciones que la app sabe ejecutar; el resto del estado se muestra como información.
- `ClubMatchRoster` recibe `{ matchId }` y es la superficie operativa de U3: inscripción/postulación, confirmación/rechazo y salida por club. `MatchDetail` deriva allí sólo los partidos formales con propuesta y reparto por club; los partidos de clubes antiguos conservan el flujo normal. `club_match_reserva_omitida` también apunta a esta ruta.
- El descubrimiento del vertical Reservas encadena `ComplejoDetail { complejoId }` → `ElegirCancha { complejoId, canchaId? }` → `FechaHora { complejoId, canchaId }` → `Resumen { complejoId, canchaId, fechaLabel, horaInicio, horaFin, duracion }`, las cuatro con `withAuthGuard`. Se pasan ids y valores ya resueltos, no objetos completos — cada pantalla vuelve a pedir el complejo por id en vez de arrastrarlo por parámetros. Ver [Reservas](../funcionalidades/reservas.md).

## Fuentes principales

- `src/navigation/AppNavigator.js`, `src/navigation/MainTabs.js` y `src/navigation/withAuthGuard.js`
- `src/contexts/AuthContext.js`, `src/utils/routing.js`, `src/utils/notificationTargets.js` y `App.js`

## Limitaciones conocidas

Los enlaces profundos llevan a rutas protegidas y por tanto requieren sesión. El repositorio prueba la decisión pura de ruta inicial, no una ejecución de navegación nativa completa.

## Notas relacionadas

- [Autenticación](../funcionalidades/autenticacion.md)
- [Avisos y push](../funcionalidades/avisos-y-push.md)
- [Reservas](../funcionalidades/reservas.md)
- [Seguridad y privacidad](seguridad-y-privacidad.md)
- [Inicio de la memoria](../00-inicio.md)
