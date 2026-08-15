# Pendientes

Última revisión: 2026-08-14

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

- **Dominio afectado:** sanciones de club del ciclo de desafíos (migraciones 47, 47b y 47c).
- **Evidencia:** `solicitar_revision_sancion()` está concedida a `authenticated` y la pantalla del hilo ofrece «Solicitar revisión», pero `resolver_revision_sancion(p_review_id, p_decision, p_nota)` está **revocada de `public`, `anon` y `authenticated`** y sólo la conserva `service_role`. No hay ninguna pantalla, rol ni bandeja que la llame, y `src/services/clubSanctions.js` no tiene —a propósito— ninguna función que la invoque.
- **Cómo se resuelve HOY:** desde el panel de Supabase, con `service_role`, en dos pasos.
  1. Leer la cola: `select id, club_id, tipo, motivo, created_at, contexto from public.club_sanction_reviews where estado = 'pendiente' order by created_at;`. `contexto` es el expediente que se copió al pedir la revisión —partido, sanción, informe de incomparecencia, tiempos y eventos del hilo—, y es lo que hay que leer antes de decidir.
  2. Resolver: `select public.resolver_revision_sancion('<review_id>', 'retirar', 'nota que leerá el club');` o con `'mantener'`. Retirar marca la sanción como `'retirada'` —no la borra—; mantener confirma la provisional y la deja `'vigente'`. **Las dos descongelan el desafío** y lo devuelven a `estado_previo_sancion` en cuanto no queda ninguna revisión pendiente sobre ese encuentro, avisan al club con `club_revision_resuelta` y dejan el evento `revision_resuelta` en el hilo.
- **Por qué importa, y cuál es el riesgo real:** una sanción deja al club 14 días sin poder crear ni aceptar desafíos, y la única salida es que **una persona** ejecute esa función. **Nadie recibe un aviso cuando llega una revisión**: si nadie mira la cola, el reclamo se queda ahí, la sanción se cumple entera sin que la haya revisado nadie y el encuentro se queda congelado —con su hilo de solo lectura— hasta que alguien la resuelva. La ventana de 24 horas para informar una incomparecencia acota quién puede abrir uno de estos expedientes, pero no reemplaza a quien tiene que cerrarlos.
- **Decisión consciente:** no se inventó un permiso para fabricar la pieza que falta. Conceder la resolución a `authenticated` habría dejado a cualquier administrador retirándose sus propias sanciones, que es exactamente lo que la revisión existe para impedir. La prueba SQL 47c (caso 13) comprueba que un `authenticated` recibe `permission denied`.
- **Acción:** decidir quién modera (rol propio, no `admin` de club), y después construir la bandeja, la pantalla y la auditoría. Está emparentado con el pendiente de moderación de reportes de más abajo: conviene resolverlos con el mismo modelo de roles y no con dos.
- **Verificación necesaria:** una prueba de autorización que demuestre que sólo el rol de moderación resuelve, más una medida operativa mientras tanto —un aviso o una revisión periódica de la cola— para que ninguna revisión quede sin respuesta.

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
