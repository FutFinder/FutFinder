# Perfil y amigos

Última revisión: 2026-09-22

## Propósito

Mantener identidad, historial y reputación del jugador, además de relaciones de amistad y reportes.

## Flujos actuales

Perfil muestra datos propios o públicos, participación, reputación, club y acciones de amistad. Con la fase 1 activa, el historial muestra TrueScore desde el evento inicial, y la tarjeta suma Fair Play con la fase 3. **`trustDisplay` depende de la época** (corregido el 2026-09-25): sin TrueScore sigue escondiendo el puntaje tras «N.A.» mientras no haya asistencias confirmadas, porque ahí el 100 es el valor por defecto de la BD; con TrueScore lo muestra desde el primer día, porque el servidor lo fija con un evento «inicio», y sólo cae en «N.A.» si el dato falta de verdad. El historial pagina de a 50 con «Ver más movimientos» hasta el evento más antiguo. Editar valida imágenes, mantiene avatar/portada como cambios locales y sólo reemplaza lo visible tras guardar perfil. Primero sube los archivos nuevos, compensa si falla la fila de perfil y sólo luego elimina archivos anteriores; galería limpia huérfanos y prioriza borrar la fila antes del archivo. Amigos lista recibidas, enviadas y aceptadas con actualización Realtime.

**Un rechazo no es para siempre, y un bloqueo sí.** `sendFriendRequest()` cortaba ante CUALQUIER fila existente y devolvía `existed: true` sin error, así que —como la interfaz trata 'rejected' y 'blocked' como «sin relación» y sigue ofreciendo «Agregar amigo»— el jugador leía «Solicitud enviada» de una solicitud que nunca salió, y podía repetirlo indefinidamente. Ahora sólo 'pending' y 'accepted' cuentan como «ya existe». Una fila 'rejected' se BORRA y se inserta de nuevo: `friendships_unique_pair` es direccional y sólo el addressee puede hacer UPDATE (migración 06), así que borrar es lo único que la RLS le permite a quien envía. Una fila 'blocked' no se toca ni se intenta reenviar, y devuelve EXACTAMENTE el mismo texto que el bloqueo por privacidad — dos mensajes distintos dejarían distinguir «me bloqueó» de «no acepta solicitudes». Aceptar y rechazar además exigen `status = 'pending'`, para que una tarjeta vieja no reviva algo ya resuelto.

**Un fallo de red no es una lista vacía.** `listMyFriends`, `listIncomingRequests` y `listOutgoingRequests` devuelven `{ data, error }` como el resto de los servicios; antes devolvían un arreglo pelado y se tragaban el error, y por eso el `catch` de `FriendsScreen` era inalcanzable y la pantalla afirmaba «no tienes amigos» con la red caída. **Y lo que se acaba de responder no desaparece:** la recarga sólo trae las pendientes, así que la solicitud recién aceptada —y su atajo «Abrir chat»— se borraba de un parpadeo; ahora la fila resuelta se conserva hasta salir de la pantalla.

**Agregar amigos está siempre a mano.** `FriendsScreen` tiene un botón flotante abajo a la derecha, «Agregar amigos», que abre el buscador de jugadores (`Main` → `SearchTab` con `initialMode: 'players'`). Antes ese camino sólo aparecía en las listas vacías: con amigos o solicitudes en pantalla no había forma de llegar a buscar a alguien.

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
