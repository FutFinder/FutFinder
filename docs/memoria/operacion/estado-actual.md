# Estado actual

Última revisión: 2026-08-08

## Alcance verificado en el repositorio

FutFinder contiene flujos de autenticación y onboarding, navegación protegida, partidos, clubes, chat, avisos, perfil, amistades y preferencias. `src/services/` concentra la mayor parte de las llamadas de dominio y los límites principales se complementan con migraciones, RLS, RPC y la Edge Function `send-push`. Aún existen accesos directos puntuales al cliente Supabase: `src/screens/HomeScreen.js` consulta `attendees` y `matches`, y `src/screens/ChatThreadScreen.js` obtiene el usuario actual y perfiles.

- La navegación resuelve sesión antes de montar la aplicación, restringe las rutas privadas y reanuda un destino protegido después de autenticar.
- Partidos permite descubrimiento, filtros, publicación, cupos/solicitudes, cola, asistencia GPS, gestión y registro final de asistencia.
- Clubes incluye creación, membresías, administración, galería, desafíos e historial; la base de datos define los límites de integrantes y administradores por plan.
- Chat cubre conversaciones directas, de partido y de club, lectura, silencio, ocultamiento, paginación, avisos importantes y `/todos` en conversaciones grupales.
- Perfil y amistades cubren edición con staging/rollback de medios, privacidad de descubrimiento/solicitudes, reputación e informes de usuario.
- La bandeja de avisos tiene operaciones optimistas con reversión y destino de navegación; el push externo depende de token, permisos, preferencias y el procesamiento de la Edge Function.

## Seguridad y fiabilidad terminadas recientemente

El historial reciente verifica cambios versionados que reforzaron límites y recuperación de fallos:

- `9ee91d6` agregó la guarda global de sesión para pantallas privadas y `f7531d5` añadió pruebas de rutas y destinos de avisos.
- Las migraciones 35 a 37 establecen privacidad efectiva en solicitudes/búsqueda, RLS de chat y helpers `SECURITY INVOKER`.
- `013034b` incorporó la migración 38 y pruebas de lógica para tickets, recibos, tokens e idempotencia de `send-push`.
- `486770a` incorporó backend de `/todos`, paginación estable, desconexión explícita y la bandeja por RPC; las migraciones 39 y 40 y sus pruebas SQL acompañan ese cambio.

Estos hechos describen código y pruebas versionadas. No confirman que una instancia remota de Supabase tenga las migraciones aplicadas ni que un dispositivo físico haya recibido una notificación push.

## Límites operativos

Sin las variables públicas de Supabase, el cliente entra en modo de demostración para renderizar las pantallas, lo que no equivale a un backend conectado. La exportación web y las pruebas de Node no sustituyen pruebas de integración contra Supabase ni validación de push en hardware físico.

## Notas relacionadas

- [Pendientes](pendientes.md)
- [Pruebas](pruebas.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)
