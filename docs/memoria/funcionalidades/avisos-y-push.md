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

La bandeja no presenta vacío si falta sesión o falla la carga. No hay push nativo en web/simulador y la entrega final depende de permisos, Expo y los recibos. La configuración del webhook y el cron remoto no se puede confirmar desde el repositorio; las pruebas de lógica y SQL cubren decisiones, no entregas reales.

## Notas relacionadas

- [Configuración](configuracion.md)
- [Navegación](../arquitectura/navegacion.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
