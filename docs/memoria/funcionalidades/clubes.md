# Clubes

Última revisión: 2026-08-08

## Propósito

Gestionar clubes, membresías, administración, galería, desafíos y partidos entre clubes.

## Flujos actuales

La tab Clubes consulta `getMyClubs`: si hay membresías, muestra embebido el primer club por fecha de ingreso; si no, abre el explorador. No navega entre esas dos vistas, por lo que el detalle embebido ofrece volver al explorador. Creación agrega al fundador como administrador; solicitudes e invitaciones se resuelven en `club_join_requests`, cuyo trigger crea la membresía aprobada. Administra miembros, fotos, desafíos y la publicación de partido asociado.

## Reglas y permisos

Una persona puede integrar hasta tres clubes y una sola vez cada club. Estándar admite 15 integrantes/1 administrador y Premium 26/3; triggers validan topes. Sólo administradores pueden gestionar club, miembros, fotos, desafíos o mensajes importantes; miembros leen y escriben el chat. Un desafío pendiente por par de clubes y la expiración a siete días se controlan en base de datos.

## Pantallas y dependencias

- Pantallas: `ClubsScreen`, `ClubDetailScreen`, `ExploreClubsScreen`, creación/edición, miembros, galería, invitación, planes y desafíos.
- Código: `src/services/clubs.js`, `clubGallery.js`, `clubChallenges.js`, `clubMatches.js` y `src/components/club/`.
- Backend: tablas de clubes, fotos, desafíos, partidos y notificaciones de migraciones 11, 24 a 29.

## Estados, errores y problemas conocidos

La tab mantiene un loader hasta resolver membresía y refresca al aceptar invitación. Si falta `clubs.modalidad` (migración 29), el servicio reintenta sin ella y la UI muestra modalidad sin definir. La disponibilidad de topes y RLS reales exige migraciones aplicadas en Supabase.

## Notas relacionadas

- [Base de datos](../arquitectura/base-de-datos.md)
- [Chat](chat.md)
- [Avisos y push](avisos-y-push.md)
