# Base de datos

Última revisión: 2026-08-11

## Propósito

Orientar cambios de Postgres, Supabase y Realtime sin copiar el esquema completo.

## Estado verificado

El esquema base define `profiles`, `matches` y `attendees`; las migraciones numeradas agregan chat (`messages`, `chat_hides`, `chat_reads`, `chat_mutes`), amistades, clubes (`clubs`, membresías, solicitudes, fotos y desafíos), cola de partidos, galería, historial de Trust Score, reportes y tickets de push. `notifications`, `push_tokens` y `ratings` son consumidas por servicios y migraciones posteriores, pero su creación inicial no está versionada en `schema.sql` ni en las migraciones presentes: antes de alterar esas tablas hay que inspeccionar el proyecto Supabase objetivo.

Las RPC de partido cubren cupos, solicitudes, intercambios, cancelación, asistencia GPS, cola, asistencia final y reglas. Las de chat cubren lectura y no leídos; `get_my_threads()` devuelve una fila por conversación, ya filtrada y ordenada. También existen RPC de clubes, amistades, reportes, cuenta, historial y recibos de push. Revisa los nombres y contratos exactos en los servicios antes de cambiar una llamada.

El ciclo de desafíos entre clubes suma `aceptar_desafio()`, `refrescar_desafio()`, `responder_prorroga()`, `crear_propuesta_oficial()` y `rechazar_propuesta()` para usuarios, más `procesar_vencimientos_desafios()` y `procesar_vencimiento_desafio()`, que no son de la app: corren por `cron` (`futfinder-desafios`, cada cinco minutos) y están revocadas de todos los roles. Las tablas nuevas son `club_challenge_events`, `club_challenge_extension_replies` y `club_challenge_proposals`, las tres sin política de escritura: sólo las escriben las RPC `security definer`.

Dos hábitos que se ganaron a golpes en estas migraciones: `revoke ... from anon` **no** quita el `EXECUTE` que PostgreSQL concede a `PUBLIC` por defecto, así que toda RPC nueva revoca de `public` explícitamente; y un `update ... returning * into fila` que no mueve ninguna fila deja la variable en NULL, de modo que los avisos posteriores se irían al vacío.

## Integridad y tiempo real

- Triggers crean perfiles y asistentes organizadores, limitan clubes, automatizan cola y avisos, protegen mensajes y generan notificaciones de clubes, partido y chat.
- `messages` está en la publicación `supabase_realtime`; las pantallas también se suscriben a `notifications` y `friendships` mediante canales de cambios.
- RLS está habilitado para las tablas versionadas que contienen datos de usuario. Las políticas y RPC son parte del contrato, no un detalle del cliente.

## Convención de cambio

`supabase/schema.sql` es una base idempotente; `supabase/migrations/NN_*.sql` mantiene cambios incrementales. Crea una migración nueva y una prueba SQL cuando corresponda; no edites ni reordenes migraciones ya aplicadas. La presencia de un archivo no confirma que esté aplicado en un proyecto remoto.

## Fuentes principales

- `supabase/schema.sql` y `supabase/migrations/`
- `src/services/matches.js`, `messages.js`, `clubs.js`, `notifications.js` y `supabase.js`
- `supabase/tests/`

## Notas relacionadas

- [Partidos](../funcionalidades/partidos.md)
- [Chat](../funcionalidades/chat.md)
- [Seguridad y privacidad](seguridad-y-privacidad.md)
- [Reglas de negocio](../producto/reglas-de-negocio.md)
