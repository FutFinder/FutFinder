# Chat

Última revisión: 2026-08-08

## Propósito

Ofrecer conversaciones directas, de partido y de club con lectura, silencio, avisos importantes y bandeja escalable.

## Flujos actuales

Los hilos usan `dm:<usuario>`, `match:<partido>` o `club:<club>`. Inbox usa `get_my_threads()` en una RPC, una fila por conversación, último mensaje real, no leídos, silencio y ocultamiento ya aplicados en servidor. El historial pagina de 40 en 40; abrirlo marca lectura. Un hilo oculto reaparece ante actividad posterior. El compositor permite `/importante` y `/todos` cuando corresponda.

## Reglas y permisos

RLS decide acceso: DM sólo con amistad aceptada, excepto administradores de dos clubes con desafío aceptado; partido sólo para `inscrito` o `confirmado_gps`; club sólo para miembros. El servidor asigna autor y hora, prohíbe editar mensajes y deja marcar importante sólo a administradores. `/todos` sólo es válido en grupos y genera avisos para participantes derivados por el backend. Silenciar es por usuario y los importantes conservan su señal en no leídos.

## Pantallas y dependencias

- Pantallas: `ChatScreen`, `ChatThreadScreen`, `ChatDetailsScreen` y `src/components/chat/`.
- Código: `src/services/messages.js`, `src/utils/chatMeta.js` y `src/utils/notificationTargets.js`.
- Backend: `messages`, lectura, silencio, ocultamiento, amistades, asistentes, miembros y migraciones 32, 36, 37, 39 y 40.

## Estados, errores y problemas conocidos

El servicio distingue falta de sesión de inbox vacío. Si falta la migración 32, degrada lectura de club a marcador local y deshabilita silencio; si faltan 39 o 40, `/todos` o la bandeja quedan indisponibles de forma explícita. Las pruebas SQL verifican RLS, mención y bandeja, pero deben ejecutarse en un Supabase de desarrollo.

## Notas relacionadas

- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](avisos-y-push.md)
