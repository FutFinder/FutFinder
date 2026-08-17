# Chat

Última revisión: 2026-08-17

## Propósito

Ofrecer conversaciones directas, de partido, de club y de negociación de desafíos, con lectura, silencio, avisos importantes y bandeja escalable.

## Flujos actuales

Los hilos usan `dm:<usuario>`, `match:<partido>`, `club:<club>` o `challenge:<desafío>`. Inbox usa `get_my_threads()` en una RPC, una fila por conversación, último mensaje real, no leídos, silencio y ocultamiento ya aplicados en servidor. El historial pagina de 40 en 40; abrirlo marca lectura. Un hilo oculto reaparece ante actividad posterior. El compositor permite `/importante` y `/todos` cuando corresponda.

El hilo de desafío (`messages.challenge_id`, migración 42) es un grupo con todos los administradores vigentes de ambos clubes y convive con el DM que dos de ellos puedan tener: son conversaciones distintas. Lo crea la RPC `aceptar_desafio()`, que en la misma transacción pasa el desafío a `negociacion`, fija el plazo con hora de servidor, escribe el evento, deja el mensaje de sistema y avisa con `threadKey`. El filtro «Clubes» de la bandeja muestra los dos tipos. La tarjeta lleva acento rojo neón hasta que ese administrador la abre (`abierto_alguna_vez` sale de `chat_reads`, que es por usuario). Los `club_challenge_events` se intercalan como burbujas de sistema. **Su texto se arma en el cliente, no en la base:** la fila guarda `tipo` y `payload` —datos— y la frase sale de una utilidad pura y probada por dominio (`cambioPartido.js`, `cancelacionEncuentro.js`, `revisionSancion.js`, `resultadoRpc.js`), así que la redacción se corrige sin migrar filas. Las tres burbujas del resultado eran las únicas que ignoraban su payload: decían «El resultado quedó confirmado» mientras el aviso push del mismo evento decía «confirmó 3-1». Desde la Tarea 6.3 nombran al club, al administrador y el marcador **anclado** —«Club B (@juan) confirmó el resultado: 3-1 (local-visitante)»—, porque el payload no dice qué club fue local y en un hilo donde están los dos un «3-1» suelto se lee al revés la mitad de las veces; la perspectiva de cada club es cosa del historial, no del hilo. La del rechazo dice además que el encuentro queda en disputa y que sólo la moderación puede reabrirlo, igual que el servidor desde la migración 50. Del hilo no se puede eliminar la conversación: tiene un plazo corriendo.

## Reglas y permisos

RLS decide acceso: DM sólo con amistad aceptada, excepto administradores de dos clubes con desafío `aceptado` legado; partido sólo para `inscrito` o `confirmado_gps`; club sólo para miembros. En el desafío se separan dos permisos: `chat_puede_ver_desafio()` deja leer a un administrador vigente de cualquiera de los dos clubes en cualquier estado, y `chat_puede_escribir_desafio()` exige además estado activo, de modo que un desafío cerrado queda archivado en solo lectura en vez de desaparecer. Ambos derivan de `club_members` en vivo: degradar a un administrador le quita el acceso en la consulta siguiente. El servidor asigna autor y hora, prohíbe editar mensajes —incluido cambiar de hilo— y deja marcar importante sólo a administradores de club. `/todos` sólo es válido en grupos y genera avisos para participantes derivados por el backend. Silenciar es por usuario y los importantes conservan su señal en no leídos.

## Pantallas y dependencias

- Pantallas: `ChatScreen`, `ChatThreadScreen`, `ChatDetailsScreen` y `src/components/chat/`.
- Código: `src/services/messages.js`, `src/utils/chatMeta.js`, `src/utils/challengeThread.js`, `src/utils/notificationTargets.js` y `src/components/clubes/ChallengeHeader.js` / `ChallengeEventBubble.js`.
- Backend: `messages`, `club_challenge_events`, lectura, silencio, ocultamiento, amistades, asistentes, miembros y migraciones 32, 36, 37, 39, 40, 42 y 42b (todas aplicadas al 2026-08-10).

## Estados, errores y problemas conocidos

El servicio distingue falta de sesión de inbox vacío. Si falta la migración 32, degrada lectura de club a marcador local y deshabilita silencio; si faltan 39, 40 o 42, `/todos`, la bandeja o el hilo de desafío quedan indisponibles de forma explícita. Las pruebas SQL verifican RLS, mención, bandeja y el hilo de desafío, pero deben ejecutarse pegándolas en el editor de Supabase: no las corre ningún script.

## Canales Realtime: un topic, un solo suscriptor

`supabase.channel(topic)` **no crea un canal nuevo si ya existe uno con ese topic**: devuelve el existente. Si ese canal ya llamó a `subscribe()`, encadenarle `.on('postgres_changes', …)` lanza «cannot add postgres_changes callbacks for realtime channel after subscribe()». Con topics deterministas (`notif-<userId>`) basta un segundo suscriptor para reventar: el badge de `MainTabs` está suscrito siempre, así que abrir Avisos lo disparaba. La solución en este repositorio es `createSharedChannel` (`utils/chatMeta`): un canal real por topic, abierto con el primer suscriptor y cerrado con el último. Lo usan el chat (`subscribeToMessages`) y los avisos (`subscribeToNotifications`). Cualquier suscripción nueva a un topic fijo debe pasar por ahí.

**Realtime no lo cubre todo, y el hilo de desafío es el ejemplo.** La publicación `supabase_realtime` sólo lleva `messages`, `attendees` y `notifications`: `club_challenge_events` y `club_match_changes` no emiten nada, y los eventos del ciclo tampoco escriben un mensaje del que colgarse porque `messages.sender_id` es NOT NULL. `ChatThreadScreen` los cargaba una vez al montar y los volvía a pedir sólo tras una acción propia, así que quien esperaba respuesta veía una solicitud pendiente que ya no lo estaba hasta recargar —comprobado a mano el 2026-08-13—. Se resuelve con `crearSondeo` (`utils/sondeo.js`), 15 segundos, activo sólo en hilos de desafío: no se solapa consigo mismo, un fallo no lo traba, un sondeo de fondo que falla no pinta error y sólo reemplaza la bitácora si de verdad cambió, para que el hilo no parpadee cada quince segundos. Publicar esas dos tablas en Realtime sería lo ideal, pero es una migración y una superficie de lectura nueva. Sus temporizadores por defecto llaman a los globales de forma SUELTA: guardarlos en un objeto y llamarlos como método le cambia el receptor y el navegador lanza `TypeError: Illegal invocation`, que tumbó el hilo entero el 2026-08-14. Y programar el sondeo nunca lanza: si falla, se degrada a «sin refresco automático» en vez de dejar al usuario sin conversación.

No hay ESLint en el proyecto, así que `no-undef` no cubre nada: un identificador mal escrito solo se descubre cuando esa rama se ejecuta. Ya costó una pantalla en blanco (ver decisiones). Al tocar componentes conviene pasar un `npx eslint --no-config-lookup` con `no-undef` sobre lo modificado.

## Notas relacionadas

- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](avisos-y-push.md)
