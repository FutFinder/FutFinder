# Estado actual

Última revisión: 2026-11-05

## Qué es esta nota

Una fotografía comprobable de dónde está FutFinder: qué existe, qué está
aplicado y qué no se ha podido verificar. Lo que está **abierto** vive en
[Pendientes](pendientes.md); acá no se repite.

## Lo construido

Autenticación y onboarding, navegación protegida, partidos, clubes, chat,
avisos, perfil, amistades, reputación, preferencias y el vertical de reservas
de canchas. `src/services/` concentra las llamadas de dominio.

- **Ninguna pantalla consulta una tabla directamente (desde 2026-11-05).**
  Las 76 pantallas de `src/screens/` ya no hacen `supabase.from(...)`: las seis
  consultas que quedaban (`HomeScreen`, `ChatThreadScreen`, `ClubMatchChangeScreen`
  y `ClubProposalScreen`) pasaron a `src/services/` en el commit `6c653a5`, y
  una prueba (`src/screens/__tests__/lasPantallasNoConsultanTablas.test.js`)
  impide que vuelvan. La prueba revisa línea por línea sólo `src/screens/`, sin
  subcarpetas ni `components/`. Ojo con el grep: `grep '\.from('` en una sola
  línea no las veía, porque el `.from(` va en la línea siguiente a `supabase`.
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
  puertas para resolver— con el padrón vacío a propósito; el 2026-10-14 se
  nombró a un solo moderador (Vicente) y `ModeracionScreen` (Configuración →
  Moderación, sólo visible para quien está en el padrón) dibuja las colas. La
  migración **164** (aplicada el 2026-10-19, está en el registro de
  producción) sumó la **cuarta cola, «Recintos esperando revisión»**
  (`recintos_esperando` en `moderacion_cola()`, `src/services/moderacion.js`) y
  `moderacion_aprobar_recinto()`, con botón «Aprobar recinto»: antes el
  recinto que pedía revisión no avisaba a nadie. Aprobar no publica; rechazar
  sigue fuera a propósito. El padrón no se volvió a leer el 2026-11-05.
- **Informes de error**: `@sentry/react-native` instalado desde el 2026-10-14
  y **apagado** hasta que exista `EXPO_PUBLIC_SENTRY_DSN`. Detalle y política
  de privacidad en [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md).

## Base de datos

- **179 archivos de migración** en el repositorio (la última, la **167**; la
  numeración tiene sufijos como 44b o 105b, por eso no son 167). Con la
  **162** y la **163** aplicadas el 2026-10-16, la **164** el 2026-10-19 y la
  **165** y la **166** el 2026-11-05 (hardening; ver
  [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)),
  **las que el repositorio tiene y producción no son dos, y las dos
  esperan a propósito**: la **149** («no aplicar hasta distribuir un build»,
  por las reglas de contraseña) y la **167** (verificación en dos pasos del
  personal, que nace con su bandera apagada y espera el build con la pantalla
  de MFA). La comparación huella por huella que sigue es anterior y no
  incluye la 165 ni la 166. No es una cuenta: es el resultado de construir
  una base desde cero con `--sin-149` y comparar las dos huella por huella
  (ver [Pruebas](pruebas.md)); esa comparación es del 2026-10-16 y no se
  repitió con la 164, aunque el registro de producción sí la lista.
- **72 tablas, 286 funciones, 118 políticas y 12 tareas cron**, medidas en
  producción el 2026-11-05. La función de más respecto de la comparación del
  2026-10-16 (285) es `moderacion_aprobar_recinto`, de la 164. La nota
  anterior decía 147 políticas; son 118 en `public`, medidas sobre
  `pg_policy`.
- **127 arneses SQL** y **3 de concurrencia `.cjs`** en `supabase/tests/`
  (contados con `ls` el 2026-11-05). Los **126 en verde** son de antes de la
  migración 164: se midieron contra una base construida desde cero con el
  repositorio **y con los interruptores de producción** (2026-10-17). **El
  arnés número 127, `164_recinto_esperando_revision_test.sql`, no se
  re-ejecutó en esta revisión**, así que «127 de 127» no está medido. Lo
  segundo no es un detalle: con las fases
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
- **Cero moderadores**, con 2 reportes de usuario sin mirar (la medición es
  anterior a que se nombrara el moderador ese mismo día; ver Moderación arriba).

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
- **`npm run verify`**: 1716 pruebas en verde y cero errores de lint, medido
  el 2026-10-16. **Según la sesión que hizo el lote de arreglos del
  2026-11-05** (no lo re-medí): 1.879 pruebas de Node, las 49 de Deno y cero
  errores de lint (24 avisos). Desde el 10-16 entraron cambios (términos y
  política dentro de la app, hardening y arreglos de cliente).
  Los avisos de lint son deuda conocida y no bloquean.

## Notas relacionadas

- [Pendientes](pendientes.md)
- [Pruebas](pruebas.md)
- [Calidad y lint](calidad-y-lint.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)
