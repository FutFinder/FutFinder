# Pendientes

Última revisión: 2026-08-08

Los ítems siguientes son trabajo no resuelto. Cada uno se separa de los cambios ya versionados y requiere una comprobación explícita para cerrarse.

## P1 — El esquema desplegado tiene objetos que ninguna migración versiona

- **Dominio afectado:** base de datos, recuperación de entornos y cualquier cambio que toque partidos, asistentes o avisos.
- **Evidencia (comprobada el 2026-08-10 contra `jvfoendzblkoxvwvommz`):** dieciséis objetos existen en la base y en ninguna migración del repositorio — `canchas`, `search_canchas`, `tg_register_cancha`, `norm_text`, `recalc_user_ratings`, `tg_ratings_recalc`, `create_notification`, `tg_enforce_join_rules`, `tg_match_future_only`, `tg_notify_match_join`, `tg_notify_friend_request`, `tg_notify_message_new`, `reactivate_suspended`, `tg_auto_suspend`, `send_match_reminders`, `send_rating_reminders` — más las columnas `profiles.estado` y `profiles.suspended_until` y los cron `futfinder-match-reminders`, `futfinder-rating-reminders` y `futfinder-reactivate`.
- **Por qué importa:** tres de ellos condicionan cualquier código nuevo que cree partidos o inscriba jugadores. `tg_match_future_only` rechaza insertar un partido con hora pasada; `tg_enforce_join_rules` valida suspensión, Trust Score y choque de horario antes de aceptar un asistente; `create_notification()` es el ayudante que conviene reutilizar en vez de insertar en `notifications` a mano.
- **Acción:** volcar esos objetos a una migración de recuperación para que una base nueva pueda reconstruirse desde el repositorio.
- **Verificación necesaria:** una base creada sólo desde `supabase/` levanta sin objetos ausentes y las pruebas SQL pasan.

## Resuelto el 2026-08-10 — migraciones 39, 40 y 41 aplicadas

Las migraciones 39 (`/todos`) y 40 (bandeja por RPC) estaban versionadas pero **no** aplicadas: `get_my_threads()` no existía, así que `listMyThreads()` no tenía contra qué correr. Se aplicaron junto con la 41 y se verificaron: `get_my_threads()` ejecuta, `messages.mention_all` y los dos triggers de la 39 existen, y la prueba SQL del ciclo de desafíos pasa sin dejar residuos. No existe un proyecto Supabase de desarrollo separado: hay uno solo y es el que usa `.env`.

## P1 — `attendees` se puede escribir sin pasar por ninguna RPC

- **Dominio afectado:** partidos y, sobre todo, los cupos por club del ciclo de desafíos.
- **Evidencia (comprobada el 2026-08-12 contra `jvfoendzblkoxvwvommz`):** las políticas `attendees_insert_self`, `attendees_update_self` y `attendees_delete_self` permiten a cualquier `authenticated` insertar, modificar o borrar su propia fila de `attendees` directo por PostgREST, sin pasar por `join_match` ni por sus comprobaciones de cupo. `attendees_update_self` incluso deja pasar de `pendiente` a `inscrito`, que es la aprobación manual.
- **Por qué importa:** el reparto de cupos por club de la migración 45 cuenta filas de `attendees` dentro de una transacción; si un jugador puede insertarlas por su cuenta, el conteo no protege nada. Hoy no se explota porque el cliente sólo usa RPC, pero eso es una convención del cliente, no una regla del servidor.
- **Acción:** en la migración 45, acotar las tres políticas con `challenge_proposal_id is null` para que no alcancen a los partidos de clubes. Los partidos normales no cambian de comportamiento. Cerrarlas del todo es un cambio mayor y va aparte.
- **Verificación necesaria:** la prueba SQL 45 comprueba que un `insert` directo sobre un partido de clubes lo rechaza la RLS, y que en un partido normal todo sigue igual.

## P2 — La dirección exacta del partido de clubes sólo está protegida en la interfaz

- **Dominio afectado:** privacidad y partidos de clubes.
- **Evidencia (2026-08-12):** mientras es propuesta, la dirección la protege la RLS de `club_challenge_proposals`. Al aprobarse, el partido pasa a `matches`, cuya política de lectura es `using (true)`: `direccion`, `latitud` y `longitud` quedan legibles por cualquiera vía PostgREST. La app no las muestra a quien no pertenece a alguno de los dos clubes —`lugarLabel()` y el botón «Cómo llegar»—, pero eso es una decisión de pintado, no una regla del servidor.
- **Por qué importa:** la promesa al usuario es que la dirección exacta es de los dos clubes. Hoy se cumple en la app y no en la API.
- **Acción:** decidir el mecanismo. Una vista con las columnas públicas, o separar la ubicación exacta a una tabla con su propia RLS. Cambiar `matches_read_all` sin más rompería el resto de la app, que lee partidos públicos.
- **Verificación necesaria:** una prueba SQL en la que un `authenticated` ajeno a los dos clubes no obtiene `direccion` de un partido de clubes, y sí la obtiene de un partido normal.

## P2 — Funciones de trigger ejecutables como RPC por `anon`

- **Dominio afectado:** superficie de la API.
- **Evidencia (comprobada el 2026-08-12):** el advisor de seguridad marca 54 funciones `SECURITY DEFINER` ejecutables por `anon`, entre ellas funciones de trigger que nunca deberían ser un endpoint: `add_organizer_as_attendee`, `matches_guard_cupos`, `tg_notify_match_join`, `tg_register_cancha`, `check_club_limits` y `handle_new_user`. Todas tienen `=X/postgres` en su ACL, es decir el `EXECUTE` que PostgreSQL concede a `PUBLIC` por defecto y que nunca se revocó.
- **Por qué importa:** PostgreSQL **no** comprueba `EXECUTE` cuando un trigger dispara su función, así que revocarlas de `public`, `anon` y `authenticated` no rompe ningún trigger y quita esos endpoints de PostgREST.
- **Acción:** una migración de limpieza que revoque `EXECUTE` de `public` en todas las funciones de trigger. No se hizo dentro de la 44 para no mezclar una limpieza transversal con la publicación de partidos.
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
