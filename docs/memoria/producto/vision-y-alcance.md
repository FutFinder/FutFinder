# Visión y alcance

Última revisión: 2026-11-05

## Propósito

Definir qué problema resuelve FutFinder y los límites de producto que se pueden respaldar con el repositorio actual.

## Estado verificado

FutFinder es una aplicación móvil y web para descubrir, crear, organizar y completar partidos de fútbol amateur. La interfaz de usuario está escrita en español de Chile y el producto contiene datos geográficos chilenos para regiones y comunas.

## Personas y responsabilidades

- **Jugador:** descubre partidos, solicita o toma cupos, confirma asistencia, conversa, mantiene su perfil y puede integrarse a clubes.
- **Organizador de partido:** publica y gestiona su partido, revisa solicitudes y registra la asistencia final dentro del plazo permitido.
- **Integrante de club:** participa en la membresía, el chat y las funciones de su club.
- **Administrador de club:** crea o administra el club, responde solicitudes o invitaciones y gestiona a sus integrantes según las políticas de base de datos.
- **Moderador:** una persona del padrón `public.moderadores` (migración 151), que sólo se llena desde el panel de Supabase; hoy hay una fila (decisión de Vicente del 2026-10-14). `es_moderador()` decide en el servidor. Desde Ajustes → Moderación (`ModeracionScreen`, `src/services/moderacion.js`) retira o mantiene una sanción en revisión (`resolverRevision`), reabre un resultado en disputa (`reabrirResultado`) y aprueba recintos que esperan revisión (`aprobarRecinto`, migración 164). Los reportes de usuario se muestran pero no se resuelven: esa decisión sigue abierta.

No existe un rol global de administrador de la plataforma más allá del moderador: esta nota no le atribuye otros permisos.

## Módulos de producto

- Partidos: exploración, filtros, publicación, gestión de cupos, solicitudes, lista de espera, asistencia y calificación.
- Clubes: creación, membresías, galería, desafíos e historial de encuentros (sin planes: ver más abajo).
- Reservas de canchas: descubrimiento de recintos, reserva, pago con Flow (aún sin credenciales cargadas) y panel del recinto; ver [Reservas](../funcionalidades/reservas.md).
- Moderación: padrón de moderadores y cola de sanciones en revisión, resultados en disputa y recintos por aprobar.
- Comunicación: conversaciones directas, de partido y de club; avisos dentro de la app y notificaciones push cuando el dispositivo y la configuración lo permiten.
- Identidad y confianza: registro e inicio de sesión, perfil, amistades, valoraciones, historial y Trust Score.
- Preferencias: privacidad, radio de búsqueda y configuración de avisos.

## Límites de alcance verificados

Los clubes no tienen planes ni nada de pago: Estándar y Premium se retiraron el 2026-10-02 (migración 152) y todos los clubes tienen el mismo tope. No se deduce de esto una hoja de ruta más amplia ni se presentan otras funcionalidades no implementadas como compromisos de producto.

## Rutas de código relacionadas

- `src/screens/PartidosScreen.js`, `src/screens/PublishMatchScreen.js` y `src/screens/ManageMatchScreen.js`
- `src/screens/ClubsScreen.js` y `src/screens/ClubDetailScreen.js`
- `src/screens/ChatScreen.js`, `src/screens/NotificationsScreen.js` y `src/screens/ProfileScreen.js`
- `src/screens/ReservasScreen.js`, `src/screens/ModeracionScreen.js` y `src/services/moderacion.js`
- `src/navigation/AppNavigator.js` y `src/navigation/MainTabs.js`
- `src/data/regiones-chile.js` y `src/data/comunas-coords.js`

## Limitaciones conocidas

La disponibilidad de datos reales depende de la configuración de Supabase. Sin las dos variables públicas requeridas no hay sesión posible: `AuthContext` deja al usuario sin autenticar y las rutas privadas mandan a Login, así que la app no abre con datos de demostración (algunos servicios conservan retornos de demostración, pero quedan detrás de esa puerta).

## Notas relacionadas

- [Reglas de negocio](reglas-de-negocio.md)
- [Stack y estructura](../arquitectura/stack-y-estructura.md)
- [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)
- [Inicio de la memoria](../00-inicio.md)
