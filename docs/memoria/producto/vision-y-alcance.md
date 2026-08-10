# Visión y alcance

Última revisión: 2026-08-08

## Propósito

Definir qué problema resuelve FutFinder y los límites de producto que se pueden respaldar con el repositorio actual.

## Estado verificado

FutFinder es una aplicación móvil y web para descubrir, crear, organizar y completar partidos de fútbol amateur. La interfaz de usuario está escrita en español de Chile y el producto contiene datos geográficos chilenos para regiones y comunas.

## Personas y responsabilidades

- **Jugador:** descubre partidos, solicita o toma cupos, confirma asistencia, conversa, mantiene su perfil y puede integrarse a clubes.
- **Organizador de partido:** publica y gestiona su partido, revisa solicitudes y registra la asistencia final dentro del plazo permitido.
- **Integrante de club:** participa en la membresía, el chat y las funciones de su club.
- **Administrador de club:** crea o administra el club, responde solicitudes o invitaciones y gestiona a sus integrantes según las políticas de base de datos.

El repositorio no define un rol global de administrador de la plataforma; esta nota no le atribuye permisos.

## Módulos de producto

- Partidos: exploración, filtros, publicación, gestión de cupos, solicitudes, lista de espera, asistencia y calificación.
- Clubes: creación, membresías, planes, galería, desafíos e historial de encuentros.
- Comunicación: conversaciones directas, de partido y de club; avisos dentro de la app y notificaciones push cuando el dispositivo y la configuración lo permiten.
- Identidad y confianza: registro e inicio de sesión, perfil, amistades, valoraciones, historial y Trust Score.
- Preferencias: privacidad, radio de búsqueda y configuración de avisos.

## Límites de alcance verificados

La contratación de Premium no se realiza dentro de la app: la pantalla de planes indica contacto con el equipo de FutFinder y que la contratación directa está prevista a futuro. No se deduce de esto una hoja de ruta más amplia ni se presentan otras funcionalidades no implementadas como compromisos de producto.

## Rutas de código relacionadas

- `src/screens/PartidosScreen.js`, `src/screens/PublishMatchScreen.js` y `src/screens/ManageMatchScreen.js`
- `src/screens/ClubsScreen.js`, `src/screens/ClubDetailScreen.js` y `src/screens/ClubPlansScreen.js`
- `src/screens/ChatScreen.js`, `src/screens/NotificationsScreen.js` y `src/screens/ProfileScreen.js`
- `src/navigation/AppNavigator.js` y `src/navigation/MainTabs.js`
- `src/data/regiones-chile.js` y `src/data/comunas-coords.js`

## Limitaciones conocidas

La disponibilidad de datos reales depende de la configuración de Supabase. Sin las dos variables públicas requeridas, la aplicación usa respuestas de demostración para que las pantallas puedan renderizarse.

## Notas relacionadas

- [Reglas de negocio](reglas-de-negocio.md)
- [Stack y estructura](../arquitectura/stack-y-estructura.md)
- [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)
- [Inicio de la memoria](../00-inicio.md)
