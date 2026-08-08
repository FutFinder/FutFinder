# Seguridad y privacidad

Última revisión: 2026-08-08

## Propósito

Resumir qué límite aplica el backend y qué controles de interfaz sólo mejoran la experiencia.

## Estado verificado

Auth de Supabase define la identidad; `AuthProvider` y `withAuthGuard` evitan montar rutas operativas sin sesión, pero RLS y las RPC son la frontera de autorización. El cliente usa solamente variables públicas de configuración y debe mantener fuera del repositorio y de la aplicación las credenciales administrativas y los archivos de servicios de plataforma.

## Reglas aplicadas en backend

- Perfiles, partidos, asistentes, clubes, membresías, solicitudes, galerías, reportes, lectura/silencio de chat y tickets de push tienen políticas versionadas. Los tickets no exponen políticas al cliente.
- Las solicitudes de amistad se rechazan en RLS si el destinatario eligió no recibirlas; la visibilidad en búsqueda se filtra desde la consulta de perfiles.
- Chat: los DM requieren amistad aceptada o la excepción de administradores de clubes con desafío aceptado; grupos de partido requieren asistencia inscrita o GPS confirmada y chats de club requieren membresía. Las funciones auxiliares son `SECURITY INVOKER`, con lo que no revelan relaciones a terceros.
- Los triggers de mensajes asignan hora/autores del servidor, bloquean editar contenido y limitan avisos importantes a administradores de club. `/todos` sólo se acepta en grupos y el servidor deriva a sus destinatarios.

## Privacidad y avisos

Las preferencias de solicitudes, descubribilidad, categorías de avisos y radio se guardan en `profiles`. Las preferencias bloquean sólo el push externo: la fila de aviso dentro de la app se conserva. La Edge Function procesa avisos con credenciales de plataforma, reclama cada envío de forma atómica y registra tickets/recibos sin publicar tokens.

## Limitaciones conocidas

Las políticas y pruebas versionadas no prueban que el proyecto Supabase desplegado tenga las migraciones 35 a 40 aplicadas. El Storage de avatares y galerías es de lectura pública por política; no debe usarse para contenido que requiera confidencialidad.

## Fuentes principales

- `src/contexts/AuthContext.js`, `src/navigation/withAuthGuard.js` y `src/utils/searchPlayersQuery.js`
- `supabase/migrations/35_privacy_friend_requests_rls.sql`, `36_chat_seguridad_rls.sql`, `37_chat_helpers_security_invoker.sql` y `39_chat_mencion_todos.sql`
- `supabase/functions/send-push/` y `supabase/tests/35_privacy_test.sql`

## Notas relacionadas

- [Autenticación](../funcionalidades/autenticacion.md)
- [Chat](../funcionalidades/chat.md)
- [Configuración](../funcionalidades/configuracion.md)
