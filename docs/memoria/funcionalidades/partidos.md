# Partidos

Última revisión de cupos, ubicación y aprobación: 2026-09-15
Última revisión de salida, asistencia, búsqueda y evaluaciones: 2026-09-21
Última revisión de GPS, Trust Score y validación de edad: 2026-09-22
Última revisión de TrueScore: 2026-09-24
Última revisión de plazos de asistencia y límites conocidos (incluye mínimos de puntaje, cancelación con motivo e Inicio): 2026-11-05

## Propósito

Descubrir, publicar, administrar y completar partidos, incluyendo cupos, solicitudes, asistencia y reputación.

## Flujos actuales

`PartidosScreen` descubre y filtra; detalle decide su CTA con `matchRules`. Publicar usa un wizard de tres pasos e inserción idempotente por token cliente. El ingreso inmediato, aprobación manual, intercambio, salida, cancelación, cola y asistencia llaman RPC atómicas. Gestión permite al organizador resolver solicitudes y registrar asistencia; GPS confirma al jugador cerca de la cancha.

## Reglas y permisos

`matchRules.js` es la fuente de UI: 2 horas sin penalización, cupos 1–30, 200 m para GPS, la ventana de confirmación (30 minutos antes de la hora / 30 después del término) y 72 horas para asistencia final (`ATTENDANCE_WINDOW_HOURS`, **sólo sin TrueScore**: con la fase 1 activa el plazo son 24 horas desde el fin del partido, que sale de `truescore_config.confirmacion_plazo_horas` y llega a la pantalla con los ajustes del servidor). **Ser la fuente sólo sirve si las pantallas la usan**, y el 22-09 aparecieron tres que no: `EditMatchScreen` tenía su propia validación de edad sin los límites 12–99 de `matches_edad_check` —se podía guardar `edad_min = 5` y chocar con el error crudo de Postgres—, y la barra del chat del partido ofrecía «GPS» y «Calificar» sin mirar ninguna regla. Lo de GPS era lo peor: esa barra nace cuando el partido TERMINA y no se va nunca, así que el botón quedaba visible para siempre en cualquier hilo viejo respondiendo «Fuera de la ventana», y faltaba justo mientras la gente llega a la cancha, que es cuando sirve. Ahora la edad se valida con `validarRangoEdad()` en las dos pantallas y la barra usa `enVentanaGps()` y `puedeCalificar()`.

**El punto de Trust Score se anota sólo si de verdad ocurrió** (migración 132). `confirm_attendance_gps` sube con `LEAST(trust_score + 1, 100)` —el tope es correcto— pero escribía siempre una fila en `trust_score_history` con `change_amount = 1`. Como `trust_score` NACE en 100 y 32 de 34 perfiles estaban ahí, casi toda confirmación anotaba un punto que no se dio, y el historial que explica el puntaje dejó de cuadrar con el puntaje: dos usuarios tienen 100 y un historial que suma 101. Ahora el delta sale de restar el puntaje de antes y el de después con la fila bloqueada, la fila sólo se escribe si el delta es mayor que 0, y la respuesta devuelve `trust_delta` y `trust_score`. Del lado de la app, `textoConfirmacionGps()` redacta las tres frases posibles en un solo sitio —se dio el punto, ya estabas en el máximo, ya estaba confirmado—; antes eran cuatro copias con cuatro textos distintos y dos de ellas prometían «+1» pasara lo que pasara. Las dos filas ya escritas de más no se corrigieron: reescribir historial es otra decisión. PostgreSQL replica las reglas críticas: estado, cupos, elegibilidad, Trust Score, choques de horario, cola y una sola aplicación de asistencia. Desde la migración 122, salir, confirmar el GPS y guardar la asistencia reclaman su fila bajo bloqueo —partido primero, inscripción después— y aplican su efecto una sola vez aunque lleguen dos peticiones a la vez; la 125 hace lo mismo con la otra puerta de la salida, cambiarse de partido, y la 127 hace que ese cambio CANCELE el partido del anfitrión en vez de borrarlo —con sus inscritos, su chat y su aviso apuntando a algo que existe— y cierra en esas dos puertas la guarda de partidos entre clubes que la 50 no alcanzó. Sólo organizador actualiza/cancela/gestiona; asistentes autorizados participan en chat de partido.

En partidos normales, los cupos representan jugadores adicionales al organizador: «falta 1 jugador» admite al organizador y a un jugador más. `matches_guard_cupos` calcula la disponibilidad desde la nómina vigente, excluyendo al organizador (migraciones 104 y 105). Los partidos de clubes conservan su conteo propio. La regresión `supabase/tests/partidos_cupo_unico_test.sql` cubre ingreso inmediato, rechazo de un segundo jugador y aprobación manual para ese único cupo.

La ubicación del teléfono solo ordena sugerencias al publicar. El punto de la cancha se fija al elegir una sugerencia o pulsar «Usar mi ubicación»; `ubicacionPropuesta` lo vincula a la dirección y lo invalida si cambia el texto, también al editar. Sin punto válido no se publica ni se guarda la edición. Las pruebas están en `src/utils/__tests__/ubicacionPropuesta.test.js`.

En partidos de aprobación manual, `join_match` rechaza el ingreso directo incluso si el jugador tiene una solicitud pendiente (migraciones 103 y 105). `request_join` mantiene el cupo disponible y solo el organizador puede aprobar con `approve_join`. La regresión `supabase/tests/partidos_aprobacion_manual_test.sql` comprueba esa separación y el ingreso inmediato legítimo.

Editar un partido no es sólo guardar campos. Cambiar la dirección o el punto de la cancha cuenta como cambio de lugar y avisa a los inscritos —lo comprueban `cambioDeLugar()` en la confirmación del formulario y `notify_match_updated` en el servidor—, y mover la hora o la duración encima de otro partido de un inscrito lo rechaza el trigger `tg_matches_reprogramar` con `CHOQUE_AGENDA_INSCRITOS`; `EditMatchScreen` lo traduce con `traducirChoqueDeAgenda()` (migración 123).

El buscador pagina por el par `(hora, id)`, no sólo por la hora: dos partidos con la misma hora exacta en el corte entre dos páginas hacían desaparecer al segundo. Un fallo al pedir la página siguiente conserva la lista, el cursor y el botón —ahora dice «Reintentar»— en vez de parecerse a «no hay más partidos», y sólo la búsqueda vigente puede escribir el listado y la caché, para que una respuesta lenta de los filtros anteriores no pise a la actual. Las tres reglas viven en `src/utils/paginacionPartidos.js`, probadas en `src/utils/__tests__/paginacionPartidos.test.js`.

«Calificar a los jugadores» no se ofrece en un partido cancelado (`puedeCalificar`), y `RateMatchScreen` distingue tres estados que antes eran uno solo: no se pudo cargar (con reintento), el partido no se jugó, y no hay compañeros elegibles.

## TrueScore (fase 1, detrás de su flag)

Las pantallas leen `useTrueScoreAjustes()` (`src/services/trueScore.js`) y cambian sólo con `truescore_fase1` activo. Gestionar partido confirma la asistencia en tres estados y una sola vez, con una hoja de confirmación, y ofrece sacar a un jugador desde la nómina; la cancelación pide el motivo (lluvia, cierre de cancha u otro) y muestra el costo que calcula `truescore_costo_salida`. El detalle y «Mi cupo» piden ese costo antes de salir, pero los botones siguen habilitados mientras se calcula o si falla: ver T04 en el listado de calidad. `TrueScoreChip` pinta el puntaje con el color de su nivel en solicitudes, lista de espera, nómina y organizador. La presentación pura vive en `src/utils/trueScore.js` (pruebas en `src/utils/__tests__/trueScore.test.js`) y **no calcula puntos**: todo número llega del servidor. Ajustes → Teléfono registra un celular chileno único sin SMS (migración 138); `telefono_obligatorio` y `telefono_verificacion_sms` siguen apagados en la comprobación de 2026-09-24.

Con `truescore_fase2`: el historial ofrece «Reclamar» en las tardanzas y ausencias dentro del plazo y muestra el estado del reclamo; el detalle del partido muestra `ReclamosDelPartido` (`src/components/partidos/ReclamosDelPartido.js`) para que los compañeros que asistieron confirmen; la lista de espera llega ordenada por `lista_de_espera` y marca «Prioridad»; y confirmar la asistencia avisa del bono ganado.

Con `truescore_fase3`: «Calificar jugadores» ofrece «Reportar a este jugador» con motivo; Gestionar partido muestra al organizador las agresiones físicas reportadas para confirmarlas; y la tarjeta de reputación del perfil suma el fair play.

## Pantallas y dependencias

- Pantallas: `PartidosScreen`, `MatchDetailScreen`, `PublishMatchScreen`, `EditMatchScreen`, `ManageMatchScreen`, `MatchRequestStatusScreen` y `MatchSpotScreen`.
- Código: `src/services/matches.js`, `attendance.js`, `matchRules.js` y `src/components/partidos/`.
- Backend: `matches`, `attendees`, `match_waitlist`, perfiles, avisos y RPC de las migraciones 33 y 34.

## Estados, errores y problemas conocidos

**La ubicación no bloquea ninguna pantalla** (2026-09-29). `getCurrentLocation()` pasa por `conPlazo()` de `src/utils/geolocalizacion.js`, que garantiza que la promesa termina aunque la API de abajo no conteste: el Chrome de una de las Macs, con el permiso denegado, no llamaba a ninguno de los dos callbacks de `getCurrentPosition` y su propia opción `timeout` tampoco saltaba, así que la promesa quedaba viva dentro del `Promise.all` de la carga y el detalle del partido y Partidos se quedaban cargando para siempre. Además la ubicación salió del `Promise.all` en las dos: sólo alimenta la distancia y el encuadre del mapa, así que ningún contenido la espera. La regla general: el plazo de una API ajena no es nuestro plazo.

Se muestran estados de carga, vacío, sin red, sin ubicación y bloqueos accionables. Si faltan columnas o RPC de la migración 33, el servicio entrega un mensaje de migración pendiente. La conservación de cancelados y chat de sólo lectura depende de la migración 34 aplicada en el entorno; no puede verificarse desde este repositorio.

**Límites conocidos de este dominio** (comprobados leyendo el código el 2026-11-05):

- **Los mínimos de puntaje salen de los niveles del servidor** (`3df6d0a`). `TRUST_OPTS` ofrecía 50, 70 y 85, que no son ningún borde de nivel (los de `truescore_config.niveles`, migración 134, cortan en 50 «En observación», 75 «Confiable» y 90 «Muy confiable»): un «70 o más» dejaba entrar a gente que el resto de la app rotula «En observación». Publicar y Editar sacan ahora las opciones de la tabla de niveles con su nombre (`opcionesDeTrustMinimo()` en `matchRules.js`, con `useTrueScoreAjustes().niveles`); con la fase 1 apagada, o antes de que llegue la tabla, el respaldo `TRUST_OPTS` es 0/50/75/90. Un partido viejo con 70 u 85 conserva su mínimo y se agrega como opción al editarlo, y `validateDraft` acepta cualquier entero de 0 a 100 (lo que permite `matches_min_trust_score_check`). La prueba `minimoDeConfianza.test.js` lee los cortes de la propia migración 134.
- **`cancelMatchWithReason()` escribe `motivo_cancelacion` ANTES de llamar a `cancel_match`, y ya no lo deja huérfano** (`dc52a29`; `utils/motivoDeCancelacion.js`). El orden se mantiene porque `cancel_match` (migración 134) lee el motivo para el aviso a los jugadores («Motivo: …»). Lo que cambió: lee el motivo previo, no cancela si no puede guardar el nuevo (devuelve «No pudimos guardar el motivo de la cancelación») y, si la RPC falla o revienta —por ejemplo porque la 50 rechaza los partidos nacidos de un desafío—, restaura el motivo de antes.
- **La rama `canceledGone` de `ManageMatchScreen` ya no muestra jerga técnica** (`31d4e2f`): si el partido no se puede volver a leer tras cancelar, dice que no se pudo mostrar pero que la cancelación quedó hecha. Una prueba (`cancelacionSinJerga.test.js`) impide que vuelvan los nombres de RPC, migraciones o Supabase a esa rama.
- **El nombre del puntaje en los rótulos de partido sale de `nombrePuntajeDe`** (`e4c20dc`): `MatchDetailScreen`, `MatchSpotScreen` y `ManageMatchScreen` escribían «Trust Score» a mano en la rama con la fase 1 apagada; hoy el texto es igual, pero ahora sale de un solo lugar (`nombreTS`), con una prueba contra el literal en esas tres pantallas. **Quedan «Trust Score» escritos a mano fuera de ellas:** `matchRules.js` (el texto del GPS sin TrueScore y `leaveRuleText`), `TrustScoreHistoryScreen` y el valor por defecto de `TrustScoreCard`; ver [Pendientes](../operacion/pendientes.md).

**Inicio (portada).** Cuatro cosas cambiaron en `HomeScreen`, todas sin tocar el servidor. (I01) «Partidos cerca de ti» ya no pide los 20 más próximos del país y aplica el radio después: `listOpenMatches` acepta `cerca: { lat, lng, km }` y filtra por una caja de latitud/longitud antes del límite (`utils/cajaDeBusqueda.js`; el radio exacto lo sigue aplicando `applyFilters`), y la pantalla lee primero perfil y ubicación. (I02) Un fallo de `listOpenMatches` ya no se muestra como «Sin partidos en tu radio»: el bloque dice «No pudimos cargar los partidos» con **Reintentar**, o muestra lo último cargado con un aviso (`vistaDePartidosCerca`). (I04) Cada `load()` pide turno con `crearSecuencia` y, después de cada espera, si ya no es el vigente no escribe estado. (I06) «ADMIN · N CLUBES» cuenta sólo los clubes donde el rol es `admin` (`etiquetaAdminDeClubes`, mínimo 1 mientras las membresías no llegan). El próximo partido propio sale de `getMisInscripcionesYProximo()` en `matches.js` y no de consultas en la pantalla. **Sigue abierto I07:** el resumen puede decir «1 partido cerca» y la lista «Sin partidos en tu radio» cuando el único cercano ya está destacado en «Tu club juega».

## Notas relacionadas

- [Reglas de negocio](../producto/reglas-de-negocio.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](avisos-y-push.md)
