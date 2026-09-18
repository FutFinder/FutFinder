# Avisos y push

Última revisión: 2026-08-13

## Propósito

Entregar bandeja persistente dentro de la app y push externo por categoría, dispositivo y disponibilidad de plataforma.

## Flujos actuales

La bandeja lee, marca, borra y se suscribe a `notifications`; usa actualizaciones optimistas con reversión ante error y evita repetir la misma acción. Al tocar un aviso, `notificationTargets` resuelve su ruta; `App.js` espera que navegación y Splash estén listos y deduplica respuestas de arranque frío. En login se registra el token del dispositivo y en logout se elimina el token actual.

## Reglas y permisos

Las preferencias de partidos, clubes, chat y amistades sólo cancelan el push externo: el aviso interno se mantiene. Web y simuladores omiten el registro nativo. La función `send-push` reclama de forma atómica cada aviso, filtra/deduplica tokens, registra tickets por token y deja recibos para el cron; un token marcado definitivamente inválido se limpia. Las categorías incluyen partidos, clubes/desafíos, amistades, mensajes y `chat_mention_all`. El ciclo formal de desafíos agrega `club_challenge_extension`, `club_challenge_closed`, `club_challenge_proposal`, `club_challenge_proposal_rejected`, `club_match_published` y, al aplicar la 45, `club_match_reserva_omitida`, todos bajo `notif_clubs`. Los cuatro primeros los emite `desafio_avisar()` y llevan al hilo. `club_match_published` lo reciben todos los integrantes y lleva al partido. `club_match_reserva_omitida` se genera sólo si la reserva voluntaria de un administrador no pudo materializarse; llega únicamente a la persona afectada, en ámbar y con atajo «VER NÓMINA», sin convertir un partido correctamente publicado en una alarma para los dos clubes. La 46 suma `club_match_change` —a los administradores del club que debe responder, en ámbar y con atajo «RESPONDER», el único aviso del ciclo que espera una acción concreta de quien lo recibe— y `club_match_change_responded`, a los del club que pidió el cambio. Los dos llevan al hilo, no al partido: mientras la solicitud está pendiente el detalle muestra el valor vigente, que es justo el que todavía no cambió. A los inscritos no les avisa ninguno de los dos; cuando el cambio se aplica les llega el `match_updated` de siempre. La 47, aplicada el 2026-08-14, suma `club_match_cancelled`, a los administradores de los DOS clubes cuando se cancela el encuentro, en rojo y con atajo «VER MOTIVO» al hilo, donde está el evento con el club que canceló y su explicación; y `club_sancionado`, sólo a los administradores del club sancionado, que lleva al CLUB y no al hilo, porque la sanción dura 14 días y alcanza a todo lo que el club intente hacer, no sólo a ese encuentro. A los jugadores inscritos les llega el `match_cancelled` de siempre, que es exactamente lo que les pasó. La 47c, aplicada el 2026-08-15, suma un único tipo: `club_revision_resuelta`, sólo a los administradores del club que pidió la revisión, con atajo «VER DECISIÓN» al hilo, donde está el evento con la decisión y la nota de quien la resolvió. En ámbar y no en rojo ni en verde, porque la misma etiqueta sirve para las dos salidas posibles y el color no puede adelantar cuál. La incomparecencia NO agrega un tipo propio: el club acusado se entera por el `club_sancionado` de siempre, cuyo texto pasa a decir que la sanción es provisional y que se puede pedir una revisión; dos avisos rojos por el mismo hecho serían ruido. Cualquier tipo nuevo se agrega a la vez en `notificationPreferences.js` y en su espejo `pushLogic.ts`, y necesita destino en `notificationTargets.js`: una prueba compara los tres y falla si uno se queda atrás —y en esta tarea falló, que es para lo que existe. **Un tipo nuevo no llega a los teléfonos hasta que `send-push` se redespliega**, porque `pushLogic.ts` viaja dentro de la función: la 47c se acompañó de la **versión 8**, ACTIVE, con `verify_jwt` y el resto de la configuración sin cambios.

## Pantallas y dependencias

- Pantalla/componentes: `NotificationsScreen` y `src/components/notifications/`.
- Código: `src/services/notifications.js`, `src/utils/notificationInbox.js`, `notificationTargets.js` y `notificationPreferences.js`.
- Backend: `notifications`, tokens y tickets, `supabase/functions/send-push/`, migraciones 38 y 39.

## Estados, errores y problemas conocidos

La bandeja no presenta vacío si falta sesión o falla la carga. No hay push nativo en web/simulador y la entrega final depende de permisos, Expo y los recibos. El cron remoto no se puede confirmar desde el repositorio; las pruebas de lógica y SQL cubren decisiones, no entregas reales.

## Quién dispara `send-push`, y de dónde sale su clave (migraciones 117 y 118)

Hasta el 2026-09-18 lo disparaba un **Database Webhook creado desde el panel**, que no estaba en el repositorio y que guardaba su cabecera `Authorization: Bearer <service_role>` en claro dentro de `pg_trigger.tgargs`. Desde la 117 lo dispara `public.notificar_push()`, un disparador normal `AFTER INSERT` sobre `notifications` que saca el token de `vault.decrypted_secrets` en el momento de usarlo y llama a `net.http_post`. El esquema `vault` no le da USAGE ni a `anon` ni a `authenticated`.

Dos cosas que hay que saber para no romperlo:

- **El secreto `send_push_authorization` NO está en el repositorio.** En una base nueva hay que crearlo a mano con `vault.create_secret(<clave publicable>, 'send_push_authorization', …)`. Desde la 118 guarda la clave **publicable** (rol `anon`), no la service key: `send-push` no lee esa cabecera —usa su propia service key del entorno— y el portero `verify_jwt` acepta cualquier JWT del proyecto. Comprobado contra la función desplegada: con la publicable responde 200; sin cabecera, 401. Sin él la app sigue funcionando: la notificación se guarda y sólo se pierde el push, con un aviso en el registro.
- **El disparador nunca lanza excepción.** Si fallara, la transacción que insertó la notificación se abortaría y el usuario perdería también el aviso dentro de la app, no sólo el push.

El token **sigue pasando** por `net.http_request_queue` mientras `pg_net` procesa la petición, y esa tabla es legible por PUBLIC sin que se pueda revocar. Lo que la 117 quita es la copia estática del catálogo, y lo que la 118 quita es el premio: lo que viaja ahí es la misma clave que va dentro del bundle de la app. Hoy nada de `net` es alcanzable desde fuera: PostgREST expone sólo `public` y `graphql_public` —comprobado pidiéndoselo— y la publicación de Realtime no lleva ninguna tabla de `net`.

## Notas relacionadas

- [Configuración](configuracion.md)
- [Navegación](../arquitectura/navegacion.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
