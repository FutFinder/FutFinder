# Pendientes

Última revisión: 2026-08-13

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

## Notas relacionadas

- [Estado actual](estado-actual.md)
- [Pruebas](pruebas.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](../funcionalidades/avisos-y-push.md)
