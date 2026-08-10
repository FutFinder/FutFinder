# Reglas de negocio

Última revisión: 2026-08-08

## Propósito

Reunir las reglas de producto que cambian el resultado para jugadores, organizadores y clubes, sin duplicar la implementación de sus servicios o migraciones.

## Estado verificado

Las reglas de partidos se centralizan en `src/services/matchRules.js` y su espejo versionado es la función `partido_reglas()` de la migración 33. Las reglas de clubes y asistencia también tienen validación en servicios y/o PostgreSQL.

## Clubes y planes

- La regla histórica de un solo club por usuario fue reemplazada por la migración 24: una persona puede pertenecer como máximo a **tres clubes** y solo una vez a cada club. No debe reintroducirse el límite anterior.
- Un club Estándar admite hasta 15 integrantes y 1 administrador; un club Premium, hasta 26 integrantes y 3 administradores. El trigger `check_club_limits` valida estos topes.
- Las solicitudes de ingreso y las invitaciones usan estados `pending`, `approved` o `rejected`; al aprobarse se crea la membresía.

## Desafíos entre clubes

- El ciclo formal se centraliza en `src/services/clubChallengeRules.js` y su espejo versionado es `desafio_reglas()` de la migración 41.
- Plazos: 72 horas de negociación desde que se acepta el desafío, 24 horas de prórroga final si vence sin propuesta, 2 horas antes del inicio como límite para proponer un cambio, y 14 días de sanción al club que cancela con menos de 2 horas. La sanción de club **no** modifica el Trust Score personal de nadie.
- Cupos: se expresan **por club**, nunca como total del partido, y van de 4 a 15. El máximo no es una preferencia: `matches.cupos_totales` admite hasta 30 y el total de un partido de clubes es el doble de los cupos por club.
- Métodos de inscripción: `orden_llegada` (se inscriben solos hasta llenar el cupo del club) o `seleccion_admin` (postulan y cada club confirma su nómina).
- Estados: `pendiente`, `negociacion`, `esperando_aprobacion`, `publicado`, `en_juego`, `esperando_resultado`, `finalizado`, `rechazado`, `sin_acuerdo`, `cancelado`, `resultado_en_disputa`, `bloqueado_sancion` y `expirado`. `aceptado` es legado: no lo produce el código nuevo, pero las filas anteriores a la migración 41 lo conservan junto con su conversación directa.
- Un club no puede desafiar a otro del que quien crea el desafío es miembro. Se aplica en la interfaz, en `listRivalCandidates()` y —única capa que un cliente modificado no puede saltarse— en el trigger `club_challenges_valida_rival()`.
- Sólo puede existir un desafío activo por par de clubes, sin importar quién retó a quién.

## Trust Score

- El puntaje se almacena entre 0 y 100 y puede condicionar el ingreso cuando un partido define `min_trust_score`.
- Confirmar presencia por GPS suma 1 punto, con tope de 100, y registra una asistencia confirmada.
- Al registrar asistencia, el organizador puede marcar presente o ausente: una presencia no confirmada previamente por GPS suma 2 puntos; una ausencia resta 15. La operación evita repetir ese efecto si el estado no cambia.
- Las salidas y cancelaciones usan una ventana sin penalización de 2 horas; las penalizaciones vigentes se consultan en la fuente central de reglas antes de modificar esta política.

## Estados de partidos y asistencia

- Los estados de partido son `abierto`, `lleno`, `en_curso`, `finalizado` y `cancelado`.
- Los estados de asistencia son `pendiente` (solicitud con aprobación manual, sin reservar cupo), `inscrito`, `confirmado_gps`, `no_asistio` y `cancelado`.
- El organizador solo puede guardar asistencia después de que termine el partido y hasta 72 horas después de su hora de término; al guardarla, el partido queda `finalizado`, salvo si ya estaba cancelado o finalizado.

## Confirmación GPS

- El radio máximo es de 200 metros respecto de las coordenadas de la cancha.
- La fuente temporal para la validación es `now()` de PostgreSQL, comparada con la hora y duración del partido: abre 30 minutos antes y cierra 30 minutos después del término calculado. No se valida con la hora del dispositivo.

## Lista de espera

- Solo se permite entrar a la cola de un partido abierto o lleno que aún no comienza y para el que el jugador cumple los mismos requisitos de elegibilidad.
- El orden es de llegada (`created_at`). Cuando se pasa de cero cupos disponibles a uno o más, un trigger avisa al primer integrante aún no avisado y le asigna 30 minutos para confirmar.
- Salir de la lista no modifica el Trust Score. Al unirse al partido, el jugador sale automáticamente de su entrada en la cola.

## Rutas de código relacionadas

- `src/services/matchRules.js`, `src/services/matches.js` y `src/services/attendance.js`
- `src/services/clubs.js`
- `supabase/migrations/11_clubes.sql`, `supabase/migrations/24_multi_club_membership.sql` y `supabase/migrations/33_partidos_flujo_completo.sql`
- `supabase/migrations/22_settings_radius_trust_history.sql`

## Limitaciones conocidas

Las migraciones describen el estado versionado; antes de cambiar una regla que afecte producción, comprueba de forma segura que las migraciones correspondientes estén aplicadas en ese entorno.

## Notas relacionadas

- [Visión y alcance](vision-y-alcance.md)
- [Stack y estructura](../arquitectura/stack-y-estructura.md)
- [Inicio de la memoria](../00-inicio.md)
