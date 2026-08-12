# Seguridad y privacidad

Última revisión: 2026-08-11

## Propósito

Resumir qué límite aplica el backend y qué controles de interfaz sólo mejoran la experiencia.

## Estado verificado

Auth de Supabase define la identidad; `AuthProvider` y `withAuthGuard` evitan montar rutas operativas sin sesión, pero RLS y las RPC son la frontera de autorización. El cliente usa solamente variables públicas de configuración y debe mantener fuera del repositorio y de la aplicación las credenciales administrativas y los archivos de servicios de plataforma.

## Reglas aplicadas en backend

- Perfiles, partidos, asistentes, clubes, membresías, solicitudes, galerías, reportes, lectura/silencio de chat y tickets de push tienen políticas versionadas. Los tickets no exponen políticas al cliente.
- Las solicitudes de amistad se rechazan en RLS si el destinatario eligió no recibirlas; la visibilidad en búsqueda se filtra desde la consulta de perfiles.
- Chat: los DM requieren amistad aceptada o la excepción de administradores de clubes con desafío aceptado; grupos de partido requieren asistencia inscrita o GPS confirmada y chats de club requieren membresía. Las funciones auxiliares son `SECURITY INVOKER`, con lo que no revelan relaciones a terceros.
- Los triggers de mensajes asignan hora/autores del servidor, bloquean editar contenido y limitan avisos importantes a administradores de club. `/todos` sólo se acepta en grupos y el servidor deriva a sus destinatarios.
- Desafíos entre clubes: la bitácora y las respuestas de prórroga las leen los administradores de los dos clubes; la propuesta oficial la lee cualquier integrante, porque dirección, cuota e instrucciones son lo que un jugador necesita para decidir si va. Ninguna de las tres tiene política de escritura: sólo escriben las RPC. Las de vencimientos están revocadas de todos los roles y corren por `cron`.
- Responder una propuesta —aprobarla o rechazarla— pide dos condiciones, no una: ser administrador de un club del desafío distinto al proponente **y** no pertenecer al club proponente en ningún rol. La primera sola no basta: quien administra el club rival y además juega en el que propuso pasaba el filtro y se respondía a sí mismo. El trigger que impide crear un desafío entre clubes que comparten administrador no cubre esto, porque las membresías cambian después de creado el desafío; hay que volver a comprobarlo al responder. La interfaz espeja la regla (`getChallengeCta` devuelve `conflicto_pertenencia`) para no ofrecer un botón que el servidor va a rechazar, pero la protección es la del servidor.
- Un token de idempotencia que genera el cliente no es una credencial. La primera versión de `crear_propuesta_oficial()` resolvía el reintento por `client_token` antes de autorizar, así que acertar un token entregaba la propuesta a cualquiera; la 43b mueve esa resolución después de derivar el club desde `club_members` y la ata al desafío pedido. En una función `security definer`, todo `return` temprano tiene que estar después de la autorización.

## Privacidad y avisos

Las preferencias de solicitudes, descubribilidad, categorías de avisos y radio se guardan en `profiles`. Las preferencias bloquean sólo el push externo: la fila de aviso dentro de la app se conserva. La Edge Function procesa avisos con credenciales de plataforma, reclama cada envío de forma atómica y registra tickets/recibos sin publicar tokens.

## Limitaciones conocidas

Las políticas y pruebas versionadas no prueban que el proyecto Supabase desplegado tenga las migraciones 35 a 40 aplicadas. El Storage de avatares y galerías es de lectura pública por política; no debe usarse para contenido que requiera confidencialidad.

## Fuentes principales

- `src/contexts/AuthContext.js`, `src/navigation/withAuthGuard.js` y `src/utils/searchPlayersQuery.js`
- `supabase/migrations/35_privacy_friend_requests_rls.sql`, `36_chat_seguridad_rls.sql`, `37_chat_helpers_security_invoker.sql` y `39_chat_mencion_todos.sql`
- `supabase/functions/send-push/` y `supabase/tests/35_privacy_test.sql`

## Revocar EXECUTE en una RPC: `public`, no `anon`

PostgreSQL concede `EXECUTE` a `PUBLIC` en toda función nueva, y `anon` lo hereda por ahí. `revoke execute ... from anon` no quita nada: hay que revocar de `public` y volver a conceder a `authenticated`. Se detectó con el advisor de Supabase («Public Can Execute SECURITY DEFINER Function») sobre `aceptar_desafio()` y se corrigió en la migración 42b. Aplica a toda RPC `security definer` nueva.

## Notas relacionadas

- [Autenticación](../funcionalidades/autenticacion.md)
- [Chat](../funcionalidades/chat.md)
- [Configuración](../funcionalidades/configuracion.md)
