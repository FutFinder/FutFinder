# Partidos

Última revisión de cupos, ubicación y aprobación: 2026-09-15
Última revisión de salida, asistencia, búsqueda y evaluaciones: 2026-09-21

## Propósito

Descubrir, publicar, administrar y completar partidos, incluyendo cupos, solicitudes, asistencia y reputación.

## Flujos actuales

`PartidosScreen` descubre y filtra; detalle decide su CTA con `matchRules`. Publicar usa un wizard de tres pasos e inserción idempotente por token cliente. El ingreso inmediato, aprobación manual, intercambio, salida, cancelación, cola y asistencia llaman RPC atómicas. Gestión permite al organizador resolver solicitudes y registrar asistencia; GPS confirma al jugador cerca de la cancha.

## Reglas y permisos

`matchRules.js` es la fuente de UI: 2 horas sin penalización, cupos 1–30, 200 m para GPS y 72 horas para asistencia final. PostgreSQL replica las reglas críticas: estado, cupos, elegibilidad, Trust Score, choques de horario, cola y una sola aplicación de asistencia. Desde la migración 122, salir, confirmar el GPS y guardar la asistencia reclaman su fila bajo bloqueo —partido primero, inscripción después— y aplican su efecto una sola vez aunque lleguen dos peticiones a la vez; la 125 hace lo mismo con la otra puerta de la salida, cambiarse de partido, y la 127 hace que ese cambio CANCELE el partido del anfitrión en vez de borrarlo —con sus inscritos, su chat y su aviso apuntando a algo que existe— y cierra en esas dos puertas la guarda de partidos entre clubes que la 50 no alcanzó. Sólo organizador actualiza/cancela/gestiona; asistentes autorizados participan en chat de partido.

En partidos normales, los cupos representan jugadores adicionales al organizador: «falta 1 jugador» admite al organizador y a un jugador más. `matches_guard_cupos` calcula la disponibilidad desde la nómina vigente, excluyendo al organizador (migraciones 104 y 105). Los partidos de clubes conservan su conteo propio. La regresión `supabase/tests/partidos_cupo_unico_test.sql` cubre ingreso inmediato, rechazo de un segundo jugador y aprobación manual para ese único cupo.

La ubicación del teléfono solo ordena sugerencias al publicar. El punto de la cancha se fija al elegir una sugerencia o pulsar «Usar mi ubicación»; `ubicacionPropuesta` lo vincula a la dirección y lo invalida si cambia el texto, también al editar. Sin punto válido no se publica ni se guarda la edición. Las pruebas están en `src/utils/__tests__/ubicacionPropuesta.test.js`.

En partidos de aprobación manual, `join_match` rechaza el ingreso directo incluso si el jugador tiene una solicitud pendiente (migraciones 103 y 105). `request_join` mantiene el cupo disponible y solo el organizador puede aprobar con `approve_join`. La regresión `supabase/tests/partidos_aprobacion_manual_test.sql` comprueba esa separación y el ingreso inmediato legítimo.

Editar un partido no es sólo guardar campos. Cambiar la dirección o el punto de la cancha cuenta como cambio de lugar y avisa a los inscritos —lo comprueban `cambioDeLugar()` en la confirmación del formulario y `notify_match_updated` en el servidor—, y mover la hora o la duración encima de otro partido de un inscrito lo rechaza el trigger `tg_matches_reprogramar` con `CHOQUE_AGENDA_INSCRITOS`; `EditMatchScreen` lo traduce con `traducirChoqueDeAgenda()` (migración 123).

El buscador pagina por el par `(hora, id)`, no sólo por la hora: dos partidos con la misma hora exacta en el corte entre dos páginas hacían desaparecer al segundo. Un fallo al pedir la página siguiente conserva la lista, el cursor y el botón —ahora dice «Reintentar»— en vez de parecerse a «no hay más partidos», y sólo la búsqueda vigente puede escribir el listado y la caché, para que una respuesta lenta de los filtros anteriores no pise a la actual. Las tres reglas viven en `src/utils/paginacionPartidos.js`, probadas en `src/utils/__tests__/paginacionPartidos.test.js`.

«Calificar a los jugadores» no se ofrece en un partido cancelado (`puedeCalificar`), y `RateMatchScreen` distingue tres estados que antes eran uno solo: no se pudo cargar (con reintento), el partido no se jugó, y no hay compañeros elegibles.

## Pantallas y dependencias

- Pantallas: `PartidosScreen`, `MatchDetailScreen`, `PublishMatchScreen`, `EditMatchScreen`, `ManageMatchScreen`, `MatchRequestStatusScreen` y `MatchSpotScreen`.
- Código: `src/services/matches.js`, `attendance.js`, `matchRules.js` y `src/components/partidos/`.
- Backend: `matches`, `attendees`, `match_waitlist`, perfiles, avisos y RPC de las migraciones 33 y 34.

## Estados, errores y problemas conocidos

Se muestran estados de carga, vacío, sin red, sin ubicación y bloqueos accionables. Si faltan columnas o RPC de la migración 33, el servicio entrega un mensaje de migración pendiente. La conservación de cancelados y chat de sólo lectura depende de la migración 34 aplicada en el entorno; no puede verificarse desde este repositorio.

## Notas relacionadas

- [Reglas de negocio](../producto/reglas-de-negocio.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](avisos-y-push.md)
