# Configuración

Última revisión: 2026-08-19

## Propósito

Centralizar preferencias de cuenta, privacidad, radio y categorías de avisos, además de operaciones sensibles de cuenta.

## Flujos actuales

`SettingsScreen` carga el perfil, persiste toggles y radio, y revierte un toggle si la escritura falla. Permite cambiar correo o contraseña tras verificar la contraseña actual, solicitar recuperación, editar ubicación/preferencias, cerrar sesión, exportar los datos propios y solicitar borrado de cuenta. Los valores se guardan en el perfil del usuario actual mediante una lista permitida de campos.

"Bloqueados" abre `BlockedUsersScreen`, que lista quién bloqueó el usuario (vía `blockedUsers.listBlockedUsers()`) y permite desbloquear. "Idioma" y "Tema" son filas fijas (Español / Oscuro): no son ajustables todavía, se muestran sin flecha a propósito para no insinuar que se puede tocar. La versión de la app (`APP_VERSION`, de `expo.version`) se muestra centrada bajo Soporte.

"Exportar mis datos" arma un JSON con `dataExport.buildMyDataExport()` (perfil, historial de partidos, amigos, clubes — sin mensajes de chat) y lo entrega copiándolo al portapapeles en web o con `Share.share` en nativo, igual que el patrón ya usado para compartir el perfil.

## Reglas y permisos

`privacy_friend_requests` controla RLS de inserción de amistad; `privacy_visible_in_search` se aplica en búsqueda. `notif_matches`, `notif_clubs`, `notif_chat` y `notif_friends` son la única fuente para elegir el push externo de cada tipo, no para borrar avisos internos. La RPC de borrado actúa sobre la identidad autenticada y elimina/ajusta datos relacionados antes de la cuenta.

El bloqueo de usuarios (migración 51) vive en `blocked_users`, no en `friendships.status`: ver [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md) para el porqué y el alcance real (qué corta y qué no).

## Pantallas y dependencias

- Pantallas: `SettingsScreen`, `TermsScreen`, `TrustScoreHistoryScreen` y `BlockedUsersScreen`.
- Código: `src/services/settings.js`, `profile.js`, `auth.js`, `blockedUsers.js`, `dataExport.js`, `src/utils/notificationPreferences.js` y `src/utils/appVersion.js`.
- Backend: `profiles`, historial de Trust Score, avisos/tokens, `delete_my_account` (migración 21) y `blocked_users`/`bloquear_usuario`/`desbloquear_usuario` (migración 51).

## Estados, errores y problemas conocidos

La pantalla muestra error y devuelve la UI al valor anterior si un cambio optimista falla. El borrado depende de la RPC y de sus dependencias remotas; no hay prueba de integración de Auth ni confirmación de migraciones desplegadas. Las preferencias de push son efectivas sólo si la Edge Function y su mapeo se mantienen alineados. El export de datos no incluye chat (alcance decidido, no un olvido) y no genera un archivo descargable real: copia/comparte el JSON como texto.

## Notas relacionadas

- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Avisos y push](avisos-y-push.md)
- [Autenticación](autenticacion.md)
