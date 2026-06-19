# Remodelación de ClubDetailScreen — Diseño

Fecha: 2026-06-18

## Objetivo

Reconstruir la pantalla principal de detalle del club según el boceto entregado:
header (editar + plan), banner con logo superpuesto, récord V-E-P, nombre +
verificado, contador de integrantes, "buscar rivales", "historial de partidos" y
"fotos del club".

## Descomposición en 3 sub-proyectos

El boceto mezcla datos que ya existen con un subsistema de competencia que no
tiene modelo de datos. Se divide en tres entregas independientes, cada una
mergeable por sí sola:

### ① Maqueta visual + extracción de integrantes (sin BD)
- **Extraer** toda la gestión de miembros/solicitudes/admin del actual
  `ClubDetailScreen` a una nueva pantalla `ClubMembersScreen` (mover lógica tal
  cual, sin reescribir). Se llega a ella tocando el contador de integrantes.
- **Reescribir** `ClubDetailScreen` como el dashboard del boceto. Datos reales
  donde ya existen (logo, nombre, verificado, plan, nº de integrantes, lupa →
  ExploreClubs, solicitar/cancelar unirse). Récord, historial, rating de zona y
  fotos quedan como placeholders estáticos con la forma exacta de los datos
  reales para que ③ solo conecte el servicio.
- Registrar `ClubMembers` en `AppNavigator`.

### ② Media del club: banner + galería de fotos (bajo riesgo)
- Columna `clubs.banner_url` + bucket `club-banners`.
- Tabla `club_photos` (espejo de `profile_photos`) + bucket `club-gallery`.
- Servicio espejo de `gallery.js`. Reutiliza el patrón visual "+X" de
  `GalleryCard`.

### ③ Subsistema de competencia entre clubes (diseño aparte, pendiente)
- Fixtures club-vs-club con resultado. De ahí se derivan récord V-E-P,
  historial de enfrentamientos y rating de club ("buscar rivales").
- Se diseñará en su propio ciclo spec → plan → implementación.

## Decisión de arquitectura (①)

El actual `ClubDetailScreen` (~950 líneas) **es** la pantalla de integrantes. El
boceto solo muestra un contador. Por eso se separa en dos pantallas:

- `ClubDetailScreen` → dashboard público del boceto.
- `ClubMembersScreen` → lista de integrantes + acciones de admin (solicitudes,
  promover, expulsar, invitar, salir/eliminar, amistad), movido sin cambios de
  lógica. Conserva el acceso al chat del club.

Se preservan intactos: chat del club, gestión completa de miembros/admin, planes.

## Formas de placeholder (contrato para ③)

- Récord: `{ v: number, e: number, p: number }`
- Equipos en zona: `[{ id, nombre, logoUrl, rating }]`
- Historial: `[{ id, rivalNombre, miLogoUrl, rivalLogoUrl, miMarcador, suMarcador }]`
- Fotos: `[{ id, photo_url }]` (igual que `profile_photos`)
