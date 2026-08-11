# Chat

Última revisión: 2026-08-10

## Propósito

Ofrecer conversaciones directas, de partido, de club y de negociación de desafíos, con lectura, silencio, avisos importantes y bandeja escalable.

## Flujos actuales

Los hilos usan `dm:<usuario>`, `match:<partido>`, `club:<club>` o `challenge:<desafío>`. Inbox usa `get_my_threads()` en una RPC, una fila por conversación, último mensaje real, no leídos, silencio y ocultamiento ya aplicados en servidor. El historial pagina de 40 en 40; abrirlo marca lectura. Un hilo oculto reaparece ante actividad posterior. El compositor permite `/importante` y `/todos` cuando corresponda.

El hilo de desafío (`messages.challenge_id`, migración 42) es un grupo con todos los administradores vigentes de ambos clubes y convive con el DM que dos de ellos puedan tener: son conversaciones distintas. Lo crea la RPC `aceptar_desafio()`, que en la misma transacción pasa el desafío a `negociacion`, fija el plazo con hora de servidor, escribe el evento, deja el mensaje de sistema y avisa con `threadKey`. El filtro «Clubes» de la bandeja muestra los dos tipos. La tarjeta lleva acento rojo neón hasta que ese administrador la abre (`abierto_alguna_vez` sale de `chat_reads`, que es por usuario). Los `club_challenge_events` se intercalan como burbujas de sistema. Del hilo no se puede eliminar la conversación: tiene un plazo corriendo.

## Reglas y permisos

RLS decide acceso: DM sólo con amistad aceptada, excepto administradores de dos clubes con desafío `aceptado` legado; partido sólo para `inscrito` o `confirmado_gps`; club sólo para miembros. En el desafío se separan dos permisos: `chat_puede_ver_desafio()` deja leer a un administrador vigente de cualquiera de los dos clubes en cualquier estado, y `chat_puede_escribir_desafio()` exige además estado activo, de modo que un desafío cerrado queda archivado en solo lectura en vez de desaparecer. Ambos derivan de `club_members` en vivo: degradar a un administrador le quita el acceso en la consulta siguiente. El servidor asigna autor y hora, prohíbe editar mensajes —incluido cambiar de hilo— y deja marcar importante sólo a administradores de club. `/todos` sólo es válido en grupos y genera avisos para participantes derivados por el backend. Silenciar es por usuario y los importantes conservan su señal en no leídos.

## Pantallas y dependencias

- Pantallas: `ChatScreen`, `ChatThreadScreen`, `ChatDetailsScreen` y `src/components/chat/`.
- Código: `src/services/messages.js`, `src/utils/chatMeta.js`, `src/utils/challengeThread.js`, `src/utils/notificationTargets.js` y `src/components/clubes/ChallengeHeader.js` / `ChallengeEventBubble.js`.
- Backend: `messages`, `club_challenge_events`, lectura, silencio, ocultamiento, amistades, asistentes, miembros y migraciones 32, 36, 37, 39, 40, 42 y 42b (todas aplicadas al 2026-08-10).

## Estados, errores y problemas conocidos

El servicio distingue falta de sesión de inbox vacío. Si falta la migración 32, degrada lectura de club a marcador local y deshabilita silencio; si faltan 39, 40 o 42, `/todos`, la bandeja o el hilo de desafío quedan indisponibles de forma explícita. Las pruebas SQL verifican RLS, mención, bandeja y el hilo de desafío, pero deben ejecutarse pegándolas en el editor de Supabase: no las corre ningún script.

`subscribeToClubMessages()` (`src/services/messages.js`) referencia una variable inexistente (`messagesChannelSeq`) y lanzaría `ReferenceError`. Hoy no la llama nadie, así que es código muerto, no un fallo activo.

## Notas relacionadas

- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](avisos-y-push.md)
