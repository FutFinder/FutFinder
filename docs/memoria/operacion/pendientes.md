# Pendientes

Última revisión: 2026-08-17

Los ítems siguientes son trabajo no resuelto. Cada uno se separa de los cambios ya versionados y requiere una comprobación explícita para cerrarse.

## P1 — El esquema desplegado tiene objetos que ninguna migración versiona

- **Dominio afectado:** base de datos, recuperación de entornos y cualquier cambio que toque partidos, asistentes o avisos.
- **Evidencia (comprobada el 2026-08-10 contra `jvfoendzblkoxvwvommz`):** dieciséis objetos existen en la base y en ninguna migración del repositorio — `canchas`, `search_canchas`, `tg_register_cancha`, `norm_text`, `recalc_user_ratings`, `tg_ratings_recalc`, `create_notification`, `tg_enforce_join_rules`, `tg_match_future_only`, `tg_notify_match_join`, `tg_notify_friend_request`, `tg_notify_message_new`, `reactivate_suspended`, `tg_auto_suspend`, `send_match_reminders`, `send_rating_reminders` — más las columnas `profiles.estado` y `profiles.suspended_until` y los cron `futfinder-match-reminders`, `futfinder-rating-reminders` y `futfinder-reactivate`.
- **Por qué importa:** tres de ellos condicionan cualquier código nuevo que cree partidos o inscriba jugadores. `tg_match_future_only` rechaza insertar un partido con hora pasada; `tg_enforce_join_rules` valida suspensión, Trust Score y choque de horario antes de aceptar un asistente; `create_notification()` es el ayudante que conviene reutilizar en vez de insertar en `notifications` a mano.
- **Acción:** volcar esos objetos a una migración de recuperación para que una base nueva pueda reconstruirse desde el repositorio.
- **Verificación necesaria:** una base creada sólo desde `supabase/` levanta sin objetos ausentes y las pruebas SQL pasan.

## Resuelto el 2026-08-10 — migraciones 39, 40 y 41 aplicadas

Las migraciones 39 (`/todos`) y 40 (bandeja por RPC) estaban versionadas pero **no** aplicadas: `get_my_threads()` no existía, así que `listMyThreads()` no tenía contra qué correr. Se aplicaron junto con la 41 y se verificaron: `get_my_threads()` ejecuta, `messages.mention_all` y los dos triggers de la 39 existen, y la prueba SQL del ciclo de desafíos pasa sin dejar residuos. No existe un proyecto Supabase de desarrollo separado: hay uno solo y es el que usa `.env`.

## Resuelto el 2026-08-13 — `attendees` y `match_waitlist` sólo se escriben por RPC

- **Dominio afectado:** partidos y, sobre todo, los cupos por club del ciclo de desafíos.
- **Evidencia (comprobada el 2026-08-12 contra `jvfoendzblkoxvwvommz`):** las políticas `attendees_insert_self`, `attendees_update_self` y `attendees_delete_self` permiten a cualquier `authenticated` insertar, modificar o borrar su propia fila de `attendees` directo por PostgREST, sin pasar por `join_match` ni por sus comprobaciones de cupo. `attendees_update_self` incluso deja pasar de `pendiente` a `inscrito`, que es la aprobación manual.
- **Por qué importa:** el reparto de cupos por club de la migración 45 cuenta filas de `attendees` dentro de una transacción; si un jugador puede insertarlas por su cuenta, el conteo no protege nada. Hoy no se explota porque el cliente sólo usa RPC, pero eso es una convención del cliente, no una regla del servidor.
- **Resolución:** se aplicó `44e_attendees_solo_por_rpc.sql` antes de la 45. `join_match` y las demás RPC son las únicas vías también para partidos normales, `cancel_join_request()` sustituye el delete directo del cliente y `approve_join` serializa el último cupo.
- **Verificación de cierre:** el catálogo remoto devolvió cero políticas y cero privilegios de escritura directa; INSERT/UPDATE/DELETE fueron rechazados; 44e pasó 8/8 y todos los escritores reales conservaron su flujo. No quedaron fixtures, objetos temporales ni sesiones `idle in transaction`.

## Resuelto el 2026-08-13 — la ubicación exacta del partido de clubes ya no es pública

Estaba protegida sólo en la interfaz: al publicarse, el partido pasaba a `matches` (`using (true)`) y `tg_register_cancha` copiaba además la dirección a la tabla pública `canchas`. La migración 44b separó la exacta a `club_match_locations` con RLS y dejó en `matches` un punto aproximado de ~1 km marcado con `ubicacion_aproximada`, para que el partido se siga descubriendo. Verificado contra producción: integrantes de los dos clubes —con y sin rol administrativo— leen la exacta; un externo autenticado y un anónimo sólo la aproximada, sin calle; `search_canchas` no la devuelve; el GPS usa exclusivamente la exacta. **La distancia pública puede errar hasta ~0,73 km**, y el nombre de la cancha sigue siendo información pública a propósito.

## P2 — Funciones de trigger ejecutables como RPC por `anon`

- **Dominio afectado:** superficie de la API.
- **Evidencia (comprobada el 2026-08-12):** el advisor de seguridad marca 54 funciones `SECURITY DEFINER` ejecutables por `anon`, entre ellas funciones de trigger que nunca deberían ser un endpoint: `add_organizer_as_attendee`, `matches_guard_cupos`, `tg_notify_match_join`, `tg_register_cancha`, `check_club_limits` y `handle_new_user`. Todas tienen `=X/postgres` en su ACL, es decir el `EXECUTE` que PostgreSQL concede a `PUBLIC` por defecto y que nunca se revocó.
- **Por qué importa:** PostgreSQL **no** comprueba `EXECUTE` cuando un trigger dispara su función, así que revocarlas de `public`, `anon` y `authenticated` no rompe ningún trigger y quita esos endpoints de PostgREST.
- **Acción:** una migración de limpieza que revoque `EXECUTE` de `public` en todas las funciones de trigger. Se mantiene SEPARADA a propósito: no se metió en la 44, ni en la 44b, ni en la 44c, para no mezclar una limpieza transversal con correcciones acotadas. Ninguna de esas funciones filtra la ubicación; las dos que sí lo hacían (`tg_register_cancha` y `search_canchas` a través de `canchas`) ya están cerradas por la 44b.
- **Verificación necesaria:** el advisor deja de marcarlas y las pruebas SQL existentes siguen pasando.

## P1 — Validar el envío push de extremo a extremo en dispositivo físico

- **Dominio afectado:** avisos y push.
- **Evidencia:** `send-push` tiene pruebas de lógica y SQL, mientras que el registro de push nativo se omite en web y simuladores; la entrega final depende de permisos, Expo, tokens, webhook y cron remotos.
- **Acción:** configurar el archivo de servicios Android/secretos EAS y los servicios remotos autorizados; probar registro, preferencias, recepción y tratamiento de token inválido en hardware físico.
- **Verificación necesaria:** una matriz Android/iOS en dispositivos físicos confirma permisos, token, una categoría permitida, una bloqueada por preferencia y la recuperación ante token inválido. Las pruebas web no cierran este pendiente.

## P1 — No existe interfaz de moderación: las revisiones de sanción se resuelven a mano

> **En producción desde el 2026-08-15.** La 47c está aplicada, así que esto dejó de ser un riesgo previsto y pasó a ser una obligación operativa: desde hoy un club puede pedir una revisión y **nadie recibe un aviso cuando llega**. Mientras no exista la pieza de moderación, alguien tiene que mirar la cola a mano.

- **Dominio afectado:** sanciones de club del ciclo de desafíos (migraciones 47, 47b y 47c).
- **Evidencia:** `solicitar_revision_sancion()` está concedida a `authenticated` y la pantalla del hilo ofrece «Solicitar revisión», pero `resolver_revision_sancion(p_review_id, p_decision, p_nota)` está **revocada de `public`, `anon` y `authenticated`** y sólo la conserva `service_role`. No hay ninguna pantalla, rol ni bandeja que la llame, y `src/services/clubSanctions.js` no tiene —a propósito— ninguna función que la invoque.
- **Cómo se resuelve HOY:** desde el panel de Supabase, con `service_role`, en dos pasos.
  1. Leer la cola: `select id, club_id, tipo, motivo, created_at, contexto from public.club_sanction_reviews where estado = 'pendiente' order by created_at;`. `contexto` es el expediente que se copió al pedir la revisión —partido, sanción, informe de incomparecencia, tiempos y eventos del hilo—, y es lo que hay que leer antes de decidir.
  2. Resolver: `select public.resolver_revision_sancion('<review_id>', 'retirar', 'nota que leerá el club');` o con `'mantener'`. Retirar marca la sanción como `'retirada'` —no la borra—; mantener confirma la provisional y la deja `'vigente'`. **Las dos descongelan el desafío** y lo devuelven a `estado_previo_sancion` en cuanto no queda ninguna revisión pendiente sobre ese encuentro, avisan al club con `club_revision_resuelta` y dejan el evento `revision_resuelta` en el hilo.
- **Por qué importa, y cuál es el riesgo real:** una sanción deja al club 14 días sin poder crear ni aceptar desafíos, y la única salida es que **una persona** ejecute esa función. **Nadie recibe un aviso cuando llega una revisión**: si nadie mira la cola, el reclamo se queda ahí, la sanción se cumple entera sin que la haya revisado nadie y el encuentro se queda congelado —con su hilo de solo lectura— hasta que alguien la resuelva. La ventana de 24 horas para informar una incomparecencia acota quién puede abrir uno de estos expedientes, pero no reemplaza a quien tiene que cerrarlos.
- **Decisión consciente:** no se inventó un permiso para fabricar la pieza que falta. Conceder la resolución a `authenticated` habría dejado a cualquier administrador retirándose sus propias sanciones, que es exactamente lo que la revisión existe para impedir. La prueba SQL 47c (caso 13) comprueba que un `authenticated` recibe `permission denied`.
- **Acción:** decidir quién modera (rol propio, no `admin` de club), y después construir la bandeja, la pantalla y la auditoría. Está emparentado con el pendiente de moderación de reportes de más abajo: conviene resolverlos con el mismo modelo de roles y no con dos.
- **Verificación necesaria:** una prueba de autorización que demuestre que sólo el rol de moderación resuelve, más una medida operativa mientras tanto —un aviso o una revisión periódica de la cola— para que ninguna revisión quede sin respuesta.

## P2 — Un resultado en disputa no tiene forma de reabrirse

> **Sigue abierto, pero desde la Tarea 6.3 ya nadie lo niega en pantalla.** La 48b arregló la GUARDA y dejó dos frases diciendo lo contrario: el aviso del rechazo terminaba en «Propongan uno nuevo.» y el motivo de error al confirmar un rechazado decía «pide que propongan uno nuevo». Las corrigieron las migraciones **50 y 50b**, y la burbuja del hilo dice lo mismo desde `textoResultadoDisputado()`. La deuda es la pieza de moderación, no el texto.

- **Dominio afectado:** resultado del encuentro entre clubes (migraciones 48, 48b, 50 y 50b).
- **Evidencia:** `confirmar_resultado(id, false)` deja `club_challenges.estado = 'resultado_en_disputa'`, y desde la 48b `proponer_resultado()` exige `estado = 'esperando_resultado'` a secas — ni el club proponente ni el contrario pueden proponer un resultado nuevo por su cuenta. `src/services/clubChallengeRules.js` ya declaraba esto («Sólo la moderación puede reabrir una disputa; nunca se cierra sola») y `getChallengeCta()` siempre devuelve ese estado deshabilitado, sin ninguna acción que ofrecer.
- **Por qué importa:** hoy, un resultado disputado se queda ahí para siempre. No hay una función que lo resuelva ni una persona con el rol para hacerlo — es el mismo hueco que el P1 de abajo sobre las revisiones de sanción, y conviene resolverlos con el mismo modelo de roles y no con dos.
- **Decisión consciente:** no se inventó una forma de que el club se autorresuelva la disputa (dejaría a cualquiera de los dos deshacer un rechazo por su cuenta) ni se dejó `proponer_resultado()` aceptando `resultado_en_disputa`, que fue exactamente el error que corrigió la 48b.
- **Acción:** decidir quién modera (mismo rol que resuelva las revisiones de sanción) y construir la función que reabre el desafío a `esperando_resultado` — el índice único parcial de `club_match_results` ya está preparado para admitir una propuesta nueva sin chocar con la rechazada.
- **Verificación necesaria:** una prueba de autorización que demuestre que sólo el rol de moderación reabre, y que `club_record()`/`historial_publico_club()` siguen sin contar nada hasta que el resultado nuevo se confirme.

## P3 — Falta la comprobación manual del historial en pantalla (NO bloqueante)

> **El servidor está demostrado de punta a punta; lo que falta es la aceptación visual.** El recorrido completo —propuesta, confirmación por el club contrario, `matches` y `club_challenges` en `finalizado`, `club_record()`, `club_estadisticas()` e `historial_club()`— lo recorren tres arneses contra el esquema aplicado: `48_resultado_test.sql` 19/19, `49_historial_test.sql` 13/13 y `50_una_sola_puerta_test.sql` 8/8, todos con `rollback`. Lo que ninguno puede ver es la pantalla.

- **Dominio afectado:** historial y estadísticas del club (migraciones 48 a 50b, Tareas 6.1 a 6.3).
- **Evidencia (comprobada el 2026-08-17 contra `jvfoendzblkoxvwvommz`):** `club_match_results` tiene **cero filas**, así que hoy todos los perfiles muestran el estado vacío —«Aún no hay partidos en el historial»—, que es el comportamiento correcto y no un fallo.
- **Por qué importa:** es el mismo hueco que encontraron las comprobaciones manuales de U5.1 y U5.2, y las dos veces apareció un fallo real de interfaz que ninguna prueba SQL podía ver. Acá lo que falta por mirar es el corte de los nombres largos junto al marcador, las dos líneas de contexto en 390 px, y la fecha y la hora con el reloj del dispositivo.
- **Pasos exactos, con dos cuentas (A y B, cada una administradora de un club):**
  1. Con A, desafiar al club de B; con B, aceptar. Acordar y aprobar la propuesta hasta que el partido quede publicado.
  2. Esperar a que el desafío pase a `esperando_resultado` (el cron corre cada cinco minutos; el hilo también lo empuja al abrirlo). Si no se quiere esperar el partido, mover la hora del partido al pasado desde el panel de Supabase.
  3. Con A: «Registrar resultado» en el hilo, poner un marcador **distinto de un empate** y destildar a alguien de la nómina.
  4. En el hilo de B tiene que aparecer la burbuja con el club, el `username` y el marcador anclado —«Club A (@a) registró el resultado: 3-1 (local-visitante)»— y el CTA «Confirmar resultado».
  5. Con B: confirmar. Revisar entonces **los dos perfiles de club**: el ganador debe leer «Victoria 3-1» y el perdedor «Derrota 1-3» del MISMO partido, con «Local» o «Visita» según corresponda, y el resumen «1 partido jugado · 3 goles a favor · 1 en contra» cuadrando con la tarjeta.
  6. Con una tercera cuenta que no pertenezca a ninguno de los dos clubes, abrir el perfil de cualquiera de ellos: tiene que verse el marcador y los escudos, y **no** la hora ni la cancha, y la tarjeta no debe llevar a ninguna parte (sin chevron).
  7. Repetir el paso 3 en otro encuentro y, con B, **rechazar**: el hilo debe decir que queda en disputa y que sólo la moderación puede reabrirlo, el aviso también, y el historial y las estadísticas de los dos clubes no deben moverse.
- **Verificación necesaria:** los seis puntos de arriba. Es aceptación visual, no funcionalidad pendiente: por eso no bloquea el cierre de la Fase 6.

## Resuelto el 2026-08-17 — «Ver todo» del historial ya lleva al historial

- **Dominio afectado:** perfil del club.
- **Evidencia:** `ClubDetailScreen` mostraba los tres últimos encuentros y su «Ver todo» navegaba a `ClubChallenges`, la bandeja de retos pendientes: en cuanto un club pasara de tres encuentros confirmados, los anteriores no se podían ver desde la aplicación.
- **Resolución (Tarea 6.3):** se creó `ClubHistoryScreen` —registrada como `ClubHistory` en `AppNavigator`— que pide `historial_club()` con su tope real de 50 y reutiliza `getClubMatchHistory`, `MatchHistoryCard` y `resumenEstadisticas`, sin duplicar ninguna regla. «Ver todo» sólo aparece cuando hay más de tres encuentros.
- **Verificación de cierre:** `historialClub.test.js` comprueba que la sección del historial ya no navega a `ClubChallenges`, que la ruta existe en el navegador, que la pantalla pide `HISTORIAL_LIMITE_MAX` y que las dos pantallas usan el mismo servicio, la misma tarjeta y el mismo resumen.

## P3 — El nivel de un encuentro entre clubes no se acuerda en ninguna parte

- **Dominio afectado:** desafíos entre clubes y el historial del club.
- **Evidencia (comprobada el 2026-08-17 contra `jvfoendzblkoxvwvommz`):** `club_challenges` no tiene columna de nivel, `club_challenge_proposals` tampoco —se acuerdan fecha, cancha, modalidad, cupos, método de inscripción y cuota— y `aprobar_propuesta()` (migración 44) crea el `matches` sin `nivel`, así que queda el `default 'recreativo'` de la tabla. Los **7** partidos de clubes que existen están todos en `recreativo`, ninguno por elección.
- **Por qué importa:** la Tarea 6.2 mostraba ese campo en la tarjeta del historial como «tipo de partido», así que un encuentro competitivo se leía «Recreativo». Es un valor por defecto disfrazado de dato, exactamente lo que la 6.2 vino a quitar del historial. En la 6.3 se dejó de mostrar: `historial_club()` sigue devolviendo la columna, pero el cliente no la pinta (ver `NIVEL_POR_OMISION` en `src/utils/historialClub.js`).
- **Acción:** decidir si el nivel se acuerda en la propuesta —quién lo elige, si se negocia como la hora y la cuota, y si condiciona algo— y sólo entonces agregarlo. Volver a mostrarlo son dos líneas: `tipoLabel` en `normalizarPartido()` y la prop en `MatchHistoryCard`.
- **Verificación necesaria:** un encuentro creado con nivel competitivo se lee «Competitivo» en el historial de los dos clubes, y uno anterior a ese cambio no miente.

## P4 — `historial_publico_club()` quedó sin consumidor

- **Dominio afectado:** base de datos y la futura página pública de un club.
- **Evidencia:** la creó la migración 44d como la proyección estrictamente pública de un partido de clubes terminado (clubes, día, marcador y V/E/D) y la 48 le rellenó el marcador. Desde la 49, la aplicación lee el historial con `historial_club()`, que devuelve más —escudos y nivel— y reserva la hora exacta y la cancha para los integrantes de los dos clubes. Ninguna pantalla, servicio ni Edge Function llama ya a `historial_publico_club()`; sólo la usan `44d_partido_privado_test.sql` (caso 15) y `49_historial_test.sql` (caso 5), que la comparan a propósito.
- **Por qué NO se elimina:** sigue siendo el contrato que fija qué es público de un encuentro terminado, y `clubs.slug` existe desde la migración 11 «para la futura página pública `futfinder.com/club/<slug>`», donde el visitante es `anon` — el caso exacto que esta función atiende. Retirar una función aplicada porque hoy no tiene quien la llame es perder la referencia sin ganar nada; su coste es una función `stable security definer` de sólo lectura.
- **El detalle que hay que recordar si se usa:** su `join` contra `club_match_results` es `left`, así que publica cualquier partido `finalizado` **aunque nadie haya confirmado el marcador**, con los goles en `null`. `historial_club()` hace ese join interno justamente para no publicar un partido como jugado sin resultado. Quien construya la página pública tiene que elegir una de las dos a conciencia.
- **Acción:** al construir la página pública del club, decidir si se usa `historial_club()` para todo —recomendado, ya funciona para `anon`— y, si es así, retirar `historial_publico_club()` con una migración nueva que también actualice el caso 15 de la prueba de la 44d. Nunca editando la 44d.
- **Verificación necesaria:** la página pública no muestra ningún partido sin marcador confirmado, y ninguna prueba versionada queda apuntando a una función que ya no existe.

## P2 — Definir y construir la moderación posterior a un reporte

- **Dominio afectado:** perfil y seguridad de la comunidad.
- **Evidencia:** el flujo permite crear y consultar los propios reportes, pero la documentación y el código no describen moderación, sanción ni apelación.
- **Acción:** decidir roles, revisión, estados, medidas y apelación; después diseñar políticas, persistencia, interfaz y pruebas de autorización.
- **Verificación necesaria:** pruebas de RLS y flujos autenticados demuestran que sólo las personas autorizadas revisan o resuelven reportes y que el usuario ve el estado permitido.

## P2 — Recuperar trazabilidad de las tablas base no creadas en el historial versionado

- **Dominio afectado:** base de datos y recuperación de entornos.
- **Evidencia:** `notifications`, `push_tokens` y `ratings` son consumidas por servicios y migraciones posteriores, pero su creación inicial no aparece en `supabase/schema.sql` ni en las migraciones presentes.
- **Acción:** identificar la fuente de esquema autorizada y añadir una estrategia de aprovisionamiento o migración que preserve los entornos existentes.
- **Verificación necesaria:** una base nueva puede crearse desde las fuentes versionadas y ejecutar las pruebas de avisos, push y calificaciones sin objetos ausentes.

## P3 — Resolver o aceptar explícitamente la ausencia de mapa en web

- **Dominio afectado:** descubrimiento de partidos en web.
- **Evidencia:** `MatchMap.web.js` devuelve `null`; la variante nativa utiliza `react-native-maps` y la lista con filtros se conserva en web.
- **Acción:** decidir si la lista/filtros es el alcance web definitivo o implementar una alternativa de mapa compatible.
- **Verificación necesaria:** prueba manual de búsqueda de partidos en navegador documenta la experiencia acordada y, si se implementa un mapa, cubre selección y cambio de región.

## P2 — El servidor acepta (0, 0) como coordenada de una cancha

- **Dominio afectado:** propuestas y cambios del partido entre clubes.
- **Evidencia:** `crear_propuesta_oficial` (43c), `aprobar_propuesta` (44) y `cambio_partido_revisa_campos` (46) validan la latitud y la longitud por RANGO, y (0, 0) está dentro del rango. En esta app ese par nunca es una cancha: es la marca de que no se eligió ninguna, porque `Number(null)` es 0 en JavaScript. El cliente sí lo rechaza —`construirCampos` en `src/utils/cambioPartido.js`, con prueba—, así que hoy la única vía sería una llamada directa a la RPC.
- **Acción:** decidir el guardia (rechazar el par exacto (0, 0), o exigir un punto dentro de Chile) y aplicarlo a las tres funciones en una sola migración, para que no queden dos reglas distintas según por dónde entre la cancha.
- **Verificación necesaria:** una prueba SQL confirma que las tres funciones rechazan (0, 0) y que siguen aceptando una cancha real de Santiago.

## P3 — La concurrencia de los cambios negociados no tiene prueba de dos sesiones

- **Dominio afectado:** cambios negociados del partido entre clubes (migración 46).
- **Evidencia:** el invariante lo sostienen tres piezas de la base —`select … for update` sobre el partido, el índice único parcial `club_match_changes_pendiente_uidx` y el `update … where estado = 'pendiente'`—, pero `46_cambios_de_partido_test.sql` corre en UNA sola sesión: prueba que el invariante se cumple, no la carrera real.
- **Acción:** repetir el arnés de dos sesiones simultáneas que se usó en U3 (`FOR UPDATE NOWAIT`) para dos aceptaciones a la vez y para dos solicitudes a la vez.
- **Verificación necesaria:** con dos sesiones, sólo una aceptación aplica el cambio y sólo una solicitud queda pendiente; la otra recibe el rechazo esperado y no deja fila.

## P4 — 17 funciones de trigger heredadas siguen ejecutables por los roles del cliente

- **Dominio afectado:** todo el esquema; son funciones anteriores al ciclo de desafíos.
- **Evidencia:** el advisor de seguridad de Supabase marca 71 funciones `security definer` alcanzables desde `/rest/v1/rpc/`. La mayoría son RPC del cliente y están así a propósito. Pero 17 son funciones de TRIGGER —`club_challenges_valida_rival`, `notify_*`, `tg_*`, `attendees_solo_rpc_de_clubes`, `matches_guard_cupos`…— que nadie debería poder invocar. Llamarlas directamente falla con `0A000 — trigger functions can only be called as triggers`, así que hoy no se les puede sacar nada; es superficie expuesta, no un agujero.
- **Acción:** una migración que revoque `execute` de `public, anon, authenticated` sobre esas 17, en un cambio propio y revisado. La 47b ya lo hizo con `club_challenges_valida_sancion()` y sirve de plantilla, incluido su arnés.
- **Verificación necesaria:** además de comprobar los privilegios, cada trigger tiene que seguir disparando. Revocar el `EXECUTE` no lo desactiva —PostgreSQL comprueba ese privilegio al crear el trigger, no en cada disparo—, pero si alguna vez dejara de aplicarse una regla el fallo sería SILENCIOSO: ninguna pantalla se rompe, sólo se pierde la validación. `47b_valida_sancion_sin_execute_test.sql` muestra la forma de probarlo.

## Notas relacionadas

- [Estado actual](estado-actual.md)
- [Pruebas](pruebas.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](../funcionalidades/avisos-y-push.md)
