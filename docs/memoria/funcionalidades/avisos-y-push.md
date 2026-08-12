# Avisos y push

Última revisión: 2026-08-11

## Propósito

Entregar bandeja persistente dentro de la app y push externo por categoría, dispositivo y disponibilidad de plataforma.

## Flujos actuales

La bandeja lee, marca, borra y se suscribe a `notifications`; usa actualizaciones optimistas con reversión ante error y evita repetir la misma acción. Al tocar un aviso, `notificationTargets` resuelve su ruta; `App.js` espera que navegación y Splash estén listos y deduplica respuestas de arranque frío. En login se registra el token del dispositivo y en logout se elimina el token actual.

## Reglas y permisos

Las preferencias de partidos, clubes, chat y amistades sólo cancelan el push externo: el aviso interno se mantiene. Web y simuladores omiten el registro nativo. La función `send-push` reclama de forma atómica cada aviso, filtra/deduplica tokens, registra tickets por token y deja recibos para el cron; un token marcado definitivamente inválido se limpia. Las categorías incluyen partidos, clubes/desafíos, amistades, mensajes y `chat_mention_all`. El ciclo formal de desafíos agrega `club_challenge_extension`, `club_challenge_closed`, `club_challenge_proposal` y `club_challenge_proposal_rejected`, los cuatro bajo `notif_clubs`; los emite `desafio_avisar()` y llevan `threadKey` al hilo de negociación, salvo cuando el desafío expiró sin que nadie lo aceptara y por lo tanto nunca tuvo hilo. Cualquier tipo nuevo se agrega a la vez en `notificationPreferences.js` y en su espejo `pushLogic.ts`, y necesita destino en `notificationTargets.js`: una prueba compara los tres y falla si uno se queda atrás.

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
