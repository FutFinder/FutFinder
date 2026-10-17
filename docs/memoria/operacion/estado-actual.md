# Estado actual

Última revisión: 2026-10-16

## Qué es esta nota

Una fotografía comprobable de dónde está FutFinder: qué existe, qué está
aplicado y qué no se ha podido verificar. Lo que está **abierto** vive en
[Pendientes](pendientes.md); acá no se repite.

## Lo construido

Autenticación y onboarding, navegación protegida, partidos, clubes, chat,
avisos, perfil, amistades, reputación, preferencias y el vertical de reservas
de canchas. `src/services/` concentra las llamadas de dominio.

- **Ninguna pantalla consulta la base directamente.** Catorce de las 74
  importan algo de `services/supabase`, pero ocho sólo traen
  `isSupabaseConfigured` y las otras seis usan `supabase.auth` para saber
  quién es el usuario. **Cero `supabase.from(` en `src/screens/`** — la nota
  anterior decía que `HomeScreen` consultaba `attendees` y `matches` y que
  `ChatThreadScreen` leía perfiles; eso se limpió y ya no es cierto.
- **Partidos**: descubrimiento, filtros, publicación, cupos y solicitudes,
  cola de espera, asistencia por GPS, gestión y registro final. Desde octubre
  hay **mapa también en web** (Mapbox GL cargado del CDN, no como
  dependencia); antes el botón «Ver en el mapa» abría una vista vacía en el
  navegador.
- **Clubes**: creación, membresías, administración, galería, desafíos,
  propuestas negociadas, resultados e historial. **Ya no hay planes**: la
  migración 152 los retiró, con sus límites por plan y sus pantallas.
  `ClubDetail` y `EditClub` tienen URL propia desde octubre, así que el editor
  sobrevive a una recarga y a un enlace compartido.
- **Chat**: conversaciones directas, de partido y de club, lectura, silencio,
  ocultamiento, paginación, avisos importantes y `/todos` en grupos.
- **Perfil y amistades**: edición con staging y reversión de medios,
  privacidad de descubrimiento y solicitudes, reputación (TrueScore) e
  informes de usuario.
- **Reservas**: complejos, canchas reservables, tarifas, reglas de horario,
  bloqueos, reservas, cobros y pagos por Flow. Está completo y **nunca se ha
  usado** (ver más abajo).
- **Avisos**: bandeja por RPC con operaciones optimistas y destino de
  navegación. El push externo depende de token, permisos, preferencias y la
  Edge Function `send-push`.
- **Moderación**: la migración 151 dejó el mecanismo —padrón, colas y las
  puertas para resolver— con el **padrón vacío a propósito**. Mientras nadie
  esté en él, no cambia nada.
- **Informes de error**: `@sentry/react-native` instalado desde el 2026-10-14
  y **apagado** hasta que exista `EXPO_PUBLIC_SENTRY_DSN`. Detalle y política
  de privacidad en [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md).

## Base de datos

- **175 archivos de migración** en el repositorio. Con la **162** y la
  **163** aplicadas el 2026-10-16, **la única que el repositorio tiene y producción no es la
  149**, que lleva en su cabecera «no aplicar hasta distribuir un build» y
  espera ahí a propósito. No es una cuenta: es el resultado de construir
  una base desde cero con `--sin-149` y comparar las dos huella por huella
  (ver [Pruebas](pruebas.md)).
- **72 tablas, 285 funciones, 118 políticas y 12 tareas cron.** La nota
  anterior decía 147 políticas; son 118 en `public`, medidas sobre
  `pg_policy`.
- **126 arneses SQL** en `supabase/tests/`, **126 en verde** contra una
  base construida desde cero con el repositorio **y con los interruptores
  de producción** (2026-10-17). Lo segundo no es un detalle: con las fases
  de TrueScore apagadas —como las deja una base recién construida— seis
  arneses daban verde midiendo la regla anterior. No se
  ejecutan con `npm test`: corren con `node scripts/correr-arneses.mjs`, o
  se pegan en el editor SQL, siempre dentro de una transacción que termina
  en `ROLLBACK`.
- **Seis Edge Functions desplegadas y activas**: `send-push`, `pagar-reserva`,
  `flow-retorno`, `flow-confirmacion`, `solicitud-recinto` y
  `reportar-problema`. Sus **49 pruebas las corre Deno**, y desde el
  2026-10-16 **`npm run verify` las incluye** (`npm run test:edge`). Si
  Deno no está instalado el paso no bloquea, pero lo dice en una línea
  imposible de no ver: un paso que se salta en silencio es peor que no
  tenerlo. **Qué versión está desplegada de cada una vive en
  `supabase/functions/despliegues.json`**, con el sha256 de cada archivo;
  una prueba falla si el repositorio se adelanta al despliegue. Hizo falta:
  `send-push` llevaba dos meses corriendo código viejo (ver
  [Pendientes](pendientes.md)).

## Lo que la app no ha vivido todavía

Esto es lo que más define el estado real y no se ve mirando el código. Medido
en producción el 2026-10-14:

- **32 usuarios, 5 con sesión en los últimos 30 días.**
- **27 partidos en total y ninguno futuro.** Quien abre la app hoy no ve
  ningún partido al que inscribirse.
- **Cero reservas y cero pagos**, con 13 canchas reservables, 19 tarifas y 73
  reglas de horario ya cargadas. El vertical entero está armado y nunca ha
  transaccionado.
- **Un solo token de push** entre los 32 usuarios.
- **Cero moderadores**, con 2 reportes de usuario sin mirar.

No es un diagnóstico de calidad: es que el producto no se ha puesto delante de
nadie. Casi todo lo que queda abierto en [Pendientes](pendientes.md) espera a
eso o a una decisión de producto, no a más código.

## Límites de lo verificable desde acá

- **Sin las variables públicas de Supabase el cliente entra en modo de
  demostración**, que renderiza las pantallas pero no es un backend conectado.
- **Hay base local desde el 2026-10-15**, levantada con colima y el CLI de
  Supabase y construida desde `supabase/schema.sql` más las migraciones
  (`node scripts/construir-base.mjs`). No hay proyecto de staging: lo que no
  se puede probar ahí se comprueba contra producción, dentro de transacciones
  revertidas o interceptando `fetch` en el navegador.
- **Un arnés que corre como `postgres` no dice nada sobre lo que ve un
  usuario.** Costó un fallo real en octubre: la migración 153 dio 8/8 dos veces
  sobre una función que para `authenticated` reventaba con 42501. Los arneses
  de lo que ejecuta el cliente llevan `set local role authenticated`.
- **El push en un teléfono físico sigue sin comprobarse**, y `tsc --noEmit` no
  sirve como chequeo en este repositorio (desbordamiento de pila preexistente).
- **`npm run verify`**: 1716 pruebas en verde y cero errores de lint al cerrar
  esta revisión. Los avisos de lint son deuda conocida y no bloquean.

## Notas relacionadas

- [Pendientes](pendientes.md)
- [Pruebas](pruebas.md)
- [Calidad y lint](calidad-y-lint.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)
