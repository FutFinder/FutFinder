# Configuración

Última revisión: 2026-08-20 (Reportar un problema con tabla propia)

## Propósito

Centralizar preferencias de cuenta, privacidad, radio y categorías de avisos, además de operaciones sensibles de cuenta.

## Flujos actuales

`SettingsScreen` carga el perfil, persiste toggles y radio, y revierte un toggle si la escritura falla. Permite cambiar correo o contraseña tras verificar la contraseña actual, solicitar recuperación, editar ubicación/preferencias, cerrar sesión, exportar los datos propios y solicitar borrado de cuenta. Los valores se guardan en el perfil del usuario actual mediante una lista permitida de campos.

**Cambiar email es de tres pasos, no uno.** (1) Contraseña actual + email nuevo, con `verifyPassword()`. (2) `requestEmailChangeOtp()` manda un código de 6 dígitos al correo ACTUAL (`supabase.auth.signInWithOtp({ email: currentEmail, options: { shouldCreateUser: false } })`) — la persona tiene que seguir teniendo acceso a esa casilla, no a la nueva. La pantalla lo pide con seis casillas (`OtpBoxes`, propio de `SettingsScreen.js`) y un reenvío con cooldown de 60 s, mismo patrón que ya usa "¿Olvidaste tu contraseña?". (3) Sólo si `verifyEmailChangeOtp()` (`supabase.auth.verifyOtp({ email: currentEmail, token, type: 'email' })`) valida el código, se llama a `changeEmail()` — que sigue siendo `updateUser({ email: nuevo })` y por lo tanto Supabase manda ADEMÁS su propia confirmación al correo nuevo (link), sin cambios ahí. El código al correo actual es una capa nueva y adicional, no un reemplazo de esa confirmación — así que el cambio completo sigue necesitando abrir el correo nuevo al final, y la pantalla lo dice en el banner de éxito. Si `changeEmail()` falla después de un código válido, la pantalla vuelve al paso 1 porque el código ya se consumió (de un solo uso).

"Bloqueados" abre `BlockedUsersScreen`, que lista quién bloqueó el usuario (vía `blockedUsers.listBlockedUsers()`) y permite desbloquear. "Idioma" y "Tema" son filas fijas (Español / Oscuro): no son ajustables todavía, se muestran sin flecha a propósito para no insinuar que se puede tocar. La versión de la app (`APP_VERSION`, de `expo.version`) se muestra centrada bajo Soporte.

"Exportar mis datos" arma un JSON con `dataExport.buildMyDataExport()` (perfil, historial de partidos, amigos, clubes — sin mensajes de chat) y lo entrega copiándolo al portapapeles en web o con `Share.share` en nativo, igual que el patrón ya usado para compartir el perfil.

"Reportar un problema" (handoff `Reportar un problema.dc.html`) dejó de abrir un `mailto:` y ahora es `ReportarProblemaScreen`, una pantalla propia con tres estados (`form`/`sending`/`ok`). Envía directo a una tabla nueva (`support_tickets`, migración 52) — ver detalle en Reglas y permisos. Las 4 categorías del handoff se mantuvieron (`supportTickets.CATEGORIAS_TICKET`), pero "Comportamiento de un jugador" NO reconstruye el buscador de jugador/partido que trae el mockup (era decorativo en el propio prototipo, sin estado ni backend): en vez de fabricar una búsqueda que no existe, se muestra un aviso que dirige a "Reportar esta cuenta" desde el perfil del jugador — la vía real y ya existente (`reports.js`, migración 31) para reportes CON destinatario. Tampoco se construyó el banner de "conexión inestable"/cola offline del mockup (guardar el reporte en el teléfono y reintentar solo, sin conexión): es una pieza aparte, no lo mínimo fácil que se pidió. El folio que se muestra al terminar es real: los primeros 8 caracteres del `id` de la fila insertada, no un correlativo inventado.

`SettingsScreen` se rediseñó visualmente (handoff `Ajustes.dc.html` de Claude Design, proyecto "Nueva estética y reservas") migrando de `colors`/`radius` (la paleta original de la app) a `reservas`/`reservasRadius`/`reservasFonts` — la misma familia de tokens que ya usan Reservas y Desafío entre clubes, y que comparte diseñador/paleta con `clubsExplorer`. Es un rediseño solo visual: ninguna lógica ni RPC cambió. El mockup traía dos cosas que NO se llevaron tal cual porque hubieran fabricado comportamiento inexistente: pills de Idioma/Tema realmente seleccionables (se dejaron como pastillas visuales sin `onPress`: no hay i18n ni tema claro implementados) y una quinta categoría de notificaciones "Reservas y pagos" que no tiene columna de preferencia en `profiles` (se omitió). La burbuja de icono verde (`icoSt` del handoff) es propia de esta pantalla — vive local en `SettingsScreen.js`, no en `components/reservas/ui.js`, porque el `ListRow` compartido usa una burbuja gris neutra en el resto de Reservas y no había que tocarlo.

## Reglas y permisos

`privacy_friend_requests` controla RLS de inserción de amistad; `privacy_visible_in_search` se aplica en búsqueda. `notif_matches`, `notif_clubs`, `notif_chat` y `notif_friends` son la única fuente para elegir el push externo de cada tipo, no para borrar avisos internos. La RPC de borrado actúa sobre la identidad autenticada y elimina/ajusta datos relacionados antes de la cuenta.

El bloqueo de usuarios (migración 51) vive en `blocked_users`, no en `friendships.status`: ver [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md) para el porqué y el alcance real (qué corta y qué no).

`support_tickets` (migración 52) es independiente de `user_reports` (migración 31): esa es reportar la CONDUCTA de otro jugador (con destinatario, oculto de terceros); esta es reportar un problema con la APP misma, sin destinatario. RLS: cada uno solo ve y crea los suyos (`auth.uid() = user_id`); no hay política de UPDATE ni DELETE para el cliente a propósito — el estado (`pendiente`/`en_proceso`/`resuelto`) se cambia desde el Table Editor de Supabase, con el rol de soporte, que no pasa por RLS. La captura de pantalla opcional sube al bucket `support-screenshots`, público como el resto de los buckets de esta app (mismo criterio y misma limitación ya documentada abajo: no es para contenido confidencial), en `<user_id>/<timestamp>.<ext>` — si falla guardar la fila después de subir la imagen, el archivo se borra para no quedar huérfano (mismo patrón que `uploadGalleryPhoto`).

## Pantallas y dependencias

- Pantallas: `SettingsScreen`, `TermsScreen`, `TrustScoreHistoryScreen`, `BlockedUsersScreen` y `ReportarProblemaScreen`.
- Código: `src/services/settings.js`, `profile.js`, `auth.js`, `blockedUsers.js`, `dataExport.js`, `supportTickets.js`, `storage.js` (`uploadSupportScreenshot`/`removeSupportScreenshotFile`), `src/utils/notificationPreferences.js` y `src/utils/appVersion.js`.
- Backend: `profiles`, historial de Trust Score, avisos/tokens, `delete_my_account` (migración 21), `blocked_users`/`bloquear_usuario`/`desbloquear_usuario` (migración 51) y `support_tickets` + bucket `support-screenshots` (migración 52).

## Estados, errores y problemas conocidos

La pantalla muestra error y devuelve la UI al valor anterior si un cambio optimista falla. El borrado depende de la RPC y de sus dependencias remotas; no hay prueba de integración de Auth ni confirmación de migraciones desplegadas. Las preferencias de push son efectivas sólo si la Edge Function y su mapeo se mantienen alineados. El export de datos no incluye chat (alcance decidido, no un olvido) y no genera un archivo descargable real: copia/comparte el JSON como texto. Si la migración 52 no está aplicada, `submitSupportTicket()` avisa con un mensaje claro en vez de fallar en silencio (mismo `faltaLaTabla()` que ya usa `reports.js`).

## Notas relacionadas

- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Avisos y push](avisos-y-push.md)
- [Autenticación](autenticacion.md)
