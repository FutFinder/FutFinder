# Seguridad y privacidad

Última revisión: 2026-08-17

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
- **El partido entre clubes es PRIVADO hasta que termina** (migración 44d). Mientras no esté finalizado sólo existe para los integrantes de los dos clubes —integrantes, no sólo administradores: un jugador tiene que ver el partido de su club para poder ir—. Un externo o un anónimo no obtiene ninguna fila: ni por id, ni listando, ni en la nómina, ni en la lista de espera, ni en la ubicación. Tampoco aparece en Inicio, Partidos, mapa, filtros ni búsquedas, porque todas esas superficies leen `matches` y la RLS las filtra antes.
- El predicado está escrito una sola vez, en la política de `matches`: `challenge_proposal_id is null` (partido normal, público) **o** soy integrante de alguno de los dos clubes. `attendees` y `match_waitlist` se cuelgan de ella con un `exists` sobre `matches`, que ya viene filtrada: si el partido no se ve, sus inscritos y su cola tampoco.
- Las escrituras están cerradas del todo en los partidos de clubes: ni externos ni integrantes se inscriben a mano. Las RPC que inscriben son `security definer` y no pasan por RLS, así que la red es un TRIGGER sobre `attendees` y otro sobre `match_waitlist`: se disparan venga la fila de donde venga y no hay que acordarse de tapar cada función. El trigger deja pasar la fila que trae `club_id`, que es la puerta de `join_club_match()`.
- Desde el despliegue de 44e y 45 el 2026-08-13, también los partidos normales tienen cerrada la escritura directa: toda alta, cambio o baja pasa por una RPC. `approve_join`/`reject_join` no gestionan partidos de clubes, y `cupos_ocupados_club`/`mi_club_en_partido` son helpers internos sin EXECUTE para `authenticated`. La verificación posterior confirmó cero políticas o privilegios de escritura directa y las ACL esperadas.
- La ubicación exacta vive en `club_match_locations` con su propia RLS (migración 44b), y `matches` conserva sólo un punto aproximado de ~1 km marcado con `ubicacion_aproximada`, sin calle. Desde la 44d ninguna de las dos es pública; la aproximada es lo que llevan las listas —pedir la exacta sería una consulta por tarjeta— y queda como defensa en profundidad. La distancia mostrada desde ella puede errar hasta ~0,73 km, y la interfaz lo dice. «Cómo llegar» sólo se habilita con la exacta, y el GPS de asistencia usa exclusivamente la exacta y falla cerrado sin ella.
- Lo ÚNICO público de un partido de clubes es su resultado, y sólo cuando está finalizado: `historial_publico_club()` expone clubes, día (nunca la hora), marcador y V/E/D. Es una proyección `security definer`, no una ventana a la fila: elige las columnas y filtra el estado, así que un partido cancelado o no disputado no se publica, y nunca salen cancha, ubicación, cuota, cupos, nómina, asistencia, chat, propuestas ni cambios.
- El historial que muestra la aplicación es `historial_club()` (migración 49) y respeta ese mismo corte con una sola llamada para todos. Lo público suma dos cosas al día y el marcador: los ESCUDOS de los dos clubes —`clubs.foto_url` ya se lee sin restricción— y el TIPO de partido (recreativo/intermedio/competitivo), que no dice dónde ni cuándo juega nadie. La HORA EXACTA y la CANCHA siguen siendo dato operativo y sólo viajan si quien pregunta pertenece a uno de los dos clubes, el mismo grupo al que la RLS de `matches` ya le muestra la fila completa; para cualquier otro llegan en `null` y la tarjeta no dibuja esa línea. Además exige resultado `confirmado`, de modo que un partido que se cerró sin que nadie confirmara el marcador no se publica como jugado.
- **El encuentro entre clubes tiene una sola puerta para cerrarse y otra para cancelarse** (migración 50). `matches.id_organizador` de un partido nacido de una propuesta es el administrador que la aprobó, y con eso pasaba por dos RPC genéricas que no se pensaron para este flujo: `save_match_attendance()` marcaba la asistencia con −15 de Trust Score por ausente y ponía `finalizado` sin mirar `club_match_results`, y `cancel_match()` cancelaba con penalización personal y sin sanción de club. Las dos rechazan ahora `challenge_proposal_id is not null`. La interfaz ya no las ofrecía —`MatchDetailScreen` calcula `isOrganizer` con `&& !usaNominaClub`—, pero esconder un botón es cortesía y no autorización: es el mismo razonamiento con el que la 44e cerró la escritura directa de `attendees` y con el que la 48b cerró su propia puerta trasera.
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
