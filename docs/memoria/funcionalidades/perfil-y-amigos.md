# Perfil y amigos

Última revisión: 2026-08-20 (rediseño visual de Editar perfil)

## Propósito

Mantener identidad, historial y reputación del jugador, además de relaciones de amistad y reportes.

## Flujos actuales

Perfil muestra datos propios o públicos, participación, Trust Score, club y acciones de amistad. Editar valida imágenes, mantiene avatar/portada como cambios locales y sólo reemplaza lo visible tras guardar perfil. Primero sube los archivos nuevos, compensa si falla la fila de perfil y sólo luego elimina archivos anteriores; galería limpia huérfanos y prioriza borrar la fila antes del archivo. Amigos lista recibidas, enviadas y aceptadas con actualización Realtime.

`EditProfileScreen` se rediseñó visualmente (handoff `Editar perfil.dc.html`, mismo proyecto de Claude Design que Ajustes/Reservas) migrando a los tokens `reservas`. Es un rediseño solo visual, sin tocar `commitProfileSave`, la validación ni el guardado local de avatar/portada. La portada vacía reutiliza `BannerBackdrop` (`components/ds/BannerBackdrop.js`, ya usado en `PlayerHeroCard`) en vez de fabricar la textura a rayas del mockup con una librería nueva. La pastilla de "Modalidad" del mockup mostraba 3 opciones cortas ("Fútbol 5/7/11"), pero `OPCIONES_MODALIDAD` real solo tiene Fútbol 7 / Fútbol 11 / Fútbol 7 y Fútbol 11 — se usó el dato real (no el del mockup) y se cambió el layout de esa fila de pills iguales a pills de ancho libre para no truncar la opción combinada.

## Reglas y permisos

El perfil sólo se actualiza a sí mismo; búsqueda omite perfiles que desactivaron visibilidad. Una solicitud de amistad requiere que el destinatario permita solicitudes en RLS. Reportes sólo permiten al emisor leer los propios; no hay moderación, sanción ni apelación implementada. Los buckets de media son públicos para lectura y sus políticas limitan altas/bajas al dueño.

## Pantallas y dependencias

- Pantallas: `ProfileScreen`, `EditProfileScreen`, `FriendsScreen`, historial de Trust Score y componentes de `player/`.
- Código: `src/services/profile.js`, `friends.js`, `gallery.js`, `storage.js`, `reports.js` y `src/utils/profileEdit.js`.
- Backend: perfiles, amistades, fotos, historial, reportes y Storage; migraciones 21, 23, 30, 31 y 35.

## Estados, errores y problemas conocidos

Editar distingue carga, error y formulario listo para no mostrar datos vacíos. La privacidad bloqueada se traduce a un mensaje útil. Si faltan migraciones 30 o 31, el servicio degrada campos nuevos o reportes con un aviso; el repositorio no contiene un flujo de moderación posterior al reporte.

## Notas relacionadas

- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Configuración](configuracion.md)
- [Base de datos](../arquitectura/base-de-datos.md)
