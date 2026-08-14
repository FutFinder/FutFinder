# Clubes

Última revisión: 2026-08-13

## Propósito

Gestionar clubes, membresías, administración, galería, desafíos y partidos entre clubes.

## Flujos actuales

La tab Clubes consulta `getMyClubs`: si hay membresías, muestra embebido el primer club por fecha de ingreso; si no, abre el explorador. No navega entre esas dos vistas, por lo que el detalle embebido ofrece volver al explorador. Creación agrega al fundador como administrador; solicitudes e invitaciones se resuelven en `club_join_requests`, cuyo trigger crea la membresía aprobada. Administra miembros, fotos, desafíos y la publicación de partido asociado.

## Reglas y permisos

Una persona puede integrar hasta tres clubes y una sola vez cada club. Estándar admite 15 integrantes/1 administrador y Premium 26/3; triggers validan topes. Sólo administradores pueden gestionar club, miembros, fotos, desafíos o mensajes importantes; miembros leen y escriben el chat. Un desafío pendiente por par de clubes y la expiración a siete días se controlan en base de datos.

## Ciclo formal de desafíos (en construcción)

La migración 41 abre el ciclo formal: trece estados con transiciones autorizadas, plazos de negociación y prórroga, cupos por club, método de inscripción y la guarda de base de datos contra desafiar a un club propio. Las reglas viven en `src/services/clubChallengeRules.js`, con `desafio_reglas()` como espejo en PostgreSQL. Ver [Reglas de negocio](../producto/reglas-de-negocio.md).

La 42 agrega el chat grupal `challenge:<id>` con todos los administradores de ambos clubes y la RPC `aceptar_desafio()`, que abre el plazo de negociación con hora de servidor.

La 43 pone a correr ese tiempo. `procesar_vencimientos_desafios()` corre por `cron` cada cinco minutos y aplica, sobre cada fila y con el estado esperado en el `where`: pendiente de más de siete días a expirado, negociación vencida a prórroga de 24 h, prórroga vencida sin dos «Sí» a sin acuerdo, y el paso del partido publicado a en juego y a esperando resultado. `refrescar_desafio()` hace lo mismo sobre una sola fila para que la pantalla no espere al cron. Responde la prórroga un administrador por club —`club_challenge_extension_replies` con `unique (challenge_id, club_id)`—, un «No» cierra el desafío en el acto y dos «Sí» reabren la negociación borrando las respuestas de la prórroga cerrada. La propuesta oficial vive en `club_challenge_proposals`, es idempotente por `client_token`, admite una sola pendiente por desafío y la puede leer cualquier integrante de los dos clubes, no sólo los administradores.

La 43c exige que la propuesta traiga la cancha ubicada en el mapa: `matches.latitud` y `longitud` son NOT NULL, así que una propuesta sin coordenadas nacía imposible de aprobar. `ClubProposalScreen` usa `LocationAutocomplete` —el mismo buscador de `PublishMatchScreen`— y las coordenadas se validan otra vez en el servidor, por tipo y por rango. La 43d cierra en `rechazar_propuesta()` el mismo hueco de doble pertenencia que ya cubría la aprobación.

La 44 cierra el ciclo hasta la publicación. `aprobar_propuesta()` verifica, crea el partido y avisa dentro de una sola transacción: exige ser administrador de un club del desafío distinto al proponente **y** no pertenecer al club proponente en ningún rol, crea el `matches` con `cupos_totales = 2 × cupos_por_club`, pasa el desafío a `publicado` y avisa a todos los integrantes de los dos clubes con `club_match_published`. Volver a pulsar aprobar devuelve el mismo partido en vez de crear otro. El botón de aprobar vive en `ClubProposalScreen`, no en la barra del chat: «Revisar propuesta» lleva allí, porque publicar un partido sin haber leído cancha, hora, cupos y cuota sería demasiado fácil de pulsar por accidente.

El partido entre clubes es privado hasta que termina: sólo lo ven los integrantes de cualquiera de los dos clubes, con o sin rol de administrador, y para ellos aparece en Inicio, Partidos y mapa, con dirección exacta y «Cómo llegar». Para todos los demás no existe. Al finalizar, lo único público es el resultado en el historial del club: clubes, día, marcador y V/E/D. Ver [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md).

El partido publicado tiene tarjeta propia (`ClubMatchCard`): borde y halo verdes, franja «PARTIDO DE CLUBES», escudos y nombres de los dos clubes con VS, la fecha con más peso y CTA «Ver partido». Aparece en Partidos, en el detalle y en una sección propia de Inicio, «Próximo partido de tu club», que es la primera de la pantalla y sólo la ven los integrantes de alguno de los dos clubes; `seleccionInicio()` decide destacado y resto a la vez para que el mismo partido no salga dos veces. Los cupos NO se muestran como compartidos: «9 cupos para tu club» a los integrantes y «9 cupos por club» al resto, siempre desde `cupos_por_club`.

U3 está cerrada y sus migraciones 44e y 45 quedaron aplicadas en producción el 2026-08-13. `ClubMatchRosterScreen` muestra las dos nóminas, «X de Y inscritos de tu club», inscripción por llegada o postulación, confirmación/rechazo por un administrador del club del jugador, salida y retiro de postulación. Se refresca con Realtime para INSERT/UPDATE y sondeo de respaldo para DELETE/reconexiones. Proponer y aprobar preguntan por una reserva voluntaria con «No» predeterminado; la aprobación presenta un resumen final. Una reserva impedida no aborta la publicación y genera `club_match_reserva_omitida` sólo para la persona afectada. Las pruebas automatizadas y de esquema están completas.

La comprobación manual autenticada se hizo el 2026-08-13 con dos sesiones simultáneas y pasó: ambas cuentas ven las dos nóminas con los `username` reales y el conteo correcto por club; salir libera únicamente el cupo del club de quien se va y la otra sesión se actualiza sola por el sondeo de respaldo, sin recargar; inscribirse dos veces devuelve «Ya estabas en la nómina» y deja una sola fila. Los permisos de administración están cubiertos por el servidor y no por la interfaz: en un partido `orden_llegada` nadie queda `pendiente`, así que los botones de confirmar/rechazar no se dibujan, y quien lo demuestra es `45_inscripcion_por_club_test.sql` (caso 9: el administrador del club rival no puede confirmar; caso 11: nadie se confirma a sí mismo). El corte de 720 px se comprobó en Chrome a 390 × 845: las dos nóminas se apilan sin cortes ni superposiciones, los conteos y los `username` se leen completos y el botón de acción queda alcanzable bajo las listas. **U3 está cerrada desde el 2026-08-13.** Lo único que no tiene evidencia es el render nativo en un dispositivo físico; lo verificado es web a 904 px y a 390 px.

La interfaz de esta pantalla se acepta como funcional pero **no definitiva**: se priorizan lógica, permisos, estados y flujos, y el rediseño visual es un trabajo posterior y explícito. Ver [la decisión del 2026-08-13](../decisiones/2026-08-13-funcionalidad-antes-que-rediseno.md).

La consulta de la nómina se arma en `src/utils/nominaQuery.js` y sus columnas se contrastan con `supabase/schema.sql` y las migraciones en una prueba. Es la corrección de un fallo real: la nómina pedía `profiles.nombre`, columna que no existe, y PostgREST rechazaba la consulta entera con 400 y `42703`. El nombre visible sale de `username`, que es el único identificador de persona en `profiles`. Además, `getNominaPartido()` ya no traduce un fallo de esquema a lista vacía: devuelve `data: null` con el error, y `ClubMatchRosterScreen` distingue «no hay nadie inscrito» de «no se pudo cargar» —en el segundo caso no dibuja conteos, listas ni botón de acción, sólo el aviso y «Reintentar»—, porque un «0 de 7» con las listas en blanco y «Inscribirme» a quien ya estaba dentro se ve igual que un partido vacío.

Lo que todavía no comenzó es U4: cambios negociados, sanciones y resultado. U3 se desplegó en el orden 44e y después 45. El plan por fases está en `docs/superpowers/plans/2026-08-10-desafios-clubes.md`. El flujo antiguo sigue vivo: los desafíos en estado `aceptado` conservan su conversación directa entre dos administradores, permitida por `chat_valid_club_challenge_dm()`.

## Pantallas y dependencias

- Pantallas: `ClubsScreen`, `ClubDetailScreen`, `ExploreClubsScreen`, creación/edición, miembros, galería, invitación, planes, desafíos, `ClubProposalScreen` y `ClubMatchRosterScreen`.
- Código: `src/services/clubs.js`, `clubGallery.js`, `clubChallenges.js`, `clubProposals.js`, `clubRoster.js`, `clubMatches.js`, `clubChallengeRules.js`, `clubMatchRules.js`, `src/utils/rivalClubsQuery.js`, `src/utils/nominaQuery.js`, `src/utils/challengeThread.js`, `src/components/club/` y `src/components/clubes/`.
- Backend: tablas de clubes, fotos, desafíos, partidos y notificaciones de migraciones 11, 24 a 29 y 41 a 45; 44e/45 están aplicadas.

## Estados, errores y problemas conocidos

La tab mantiene un loader hasta resolver membresía y refresca al aceptar invitación. Si falta `clubs.modalidad` (migración 29), el servicio reintenta sin ella y la UI muestra modalidad sin definir. La disponibilidad de topes y RLS reales exige migraciones aplicadas en Supabase.

## Notas relacionadas

- [Base de datos](../arquitectura/base-de-datos.md)
- [Chat](chat.md)
- [Avisos y push](avisos-y-push.md)
