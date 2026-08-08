# Configuración

Última revisión: 2026-08-08

## Propósito

Centralizar preferencias de cuenta, privacidad, radio y categorías de avisos, además de operaciones sensibles de cuenta.

## Flujos actuales

`SettingsScreen` carga el perfil, persiste toggles y radio, y revierte un toggle si la escritura falla. Permite cambiar correo o contraseña tras verificar la contraseña actual, solicitar recuperación, editar ubicación/preferencias, cerrar sesión y solicitar borrado de cuenta. Los valores se guardan en el perfil del usuario actual mediante una lista permitida de campos.

## Reglas y permisos

`privacy_friend_requests` controla RLS de inserción de amistad; `privacy_visible_in_search` se aplica en búsqueda. `notif_matches`, `notif_clubs`, `notif_chat` y `notif_friends` son la única fuente para elegir el push externo de cada tipo, no para borrar avisos internos. La RPC de borrado actúa sobre la identidad autenticada y elimina/ajusta datos relacionados antes de la cuenta.

## Pantallas y dependencias

- Pantallas: `SettingsScreen`, `TermsScreen` y `TrustScoreHistoryScreen`.
- Código: `src/services/settings.js`, `profile.js`, `auth.js` y `src/utils/notificationPreferences.js`.
- Backend: `profiles`, historial de Trust Score, avisos/tokens y `delete_my_account` de la migración 21.

## Estados, errores y problemas conocidos

La pantalla muestra error y devuelve la UI al valor anterior si un cambio optimista falla. El borrado depende de la RPC y de sus dependencias remotas; no hay prueba de integración de Auth ni confirmación de migraciones desplegadas. Las preferencias de push son efectivas sólo si la Edge Function y su mapeo se mantienen alineados.

## Notas relacionadas

- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Avisos y push](avisos-y-push.md)
- [Autenticación](autenticacion.md)
