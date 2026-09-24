# Especificación: sistema TrueScore de FutFinder

Este documento describe el sistema de reputación de FutFinder, una app para organizar partidos de fútbol, y es la fuente de verdad para implementarlo. Los números y reglas son definitivos: no los cambies ni los "mejores" sin preguntarme.

## Paso 0: antes de escribir código

1. Explora el repositorio y dime qué stack usa (frontend, backend, base de datos, autenticación) y cómo están modelados hoy los usuarios, los partidos, las inscripciones, la lista de espera y el rol de organizador.
2. Con eso, propónme un plan: tablas o columnas nuevas, dónde vivirá la lógica, qué pantallas cambian y en qué orden lo harás.
3. **Espera mi aprobación antes de implementar.**

## Principios técnicos obligatorios

- **Toda la lógica de puntajes se calcula en el servidor** (función de base de datos, API o job), nunca en el cliente. El cliente solo muestra.
- **Registro de eventos inmutable (ledger):** cada cambio de puntaje se guarda como un evento con usuario, partido, tipo, puntos aplicados, motivo y fecha. El puntaje del usuario se guarda aparte como caché, pero debe poder recalcularse desde cero recorriendo sus eventos en orden.
- **Correcciones sin borrar historia:** un reclamo aceptado no edita el evento original; agrega un evento de reversión y recalcula el puntaje, la racha y la reincidencia desde ese punto.
- **Idempotencia:** procesar dos veces la misma asistencia, salida o job no debe duplicar puntos.
- **Todos los números en un solo archivo o tabla de configuración** (puntos, horas, ventanas, umbrales), para ajustarlos sin tocar la lógica.
- **Feature flags por fase** (ver al final), para activar cada grupo de reglas cuando yo lo decida.
- Los puntajes siempre se limitan entre 0 y 100 después de aplicar cada evento.
- Redondeo: se redondea el valor absoluto de la penalización al entero más cercano (0.5 hacia arriba). Ejemplo: 12.5 → −13.

## 1. TrueScore del jugador

Rango 0 a 100. Todos empiezan en **75**. Tope en 100.

### 1.1 Asistencia y racha

| Partido asistido a tiempo | Puntos |
| --- | --- |
| Primero de la racha | +6 |
| Segundo seguido | +8 |
| Tercero seguido | +10 |
| Cuarto seguido en adelante | +12 (máximo) |

Qué pasa con la racha según el evento:

| Evento | Efecto en la racha |
| --- | --- |
| Asistió a tiempo | La aumenta en 1 |
| Salida con 24 horas o más de aviso | No la rompe ni la aumenta |
| Salida con menos de 24 horas | La rompe (vuelve a 0) |
| Llegó tarde | La rompe |
| No asistió y no avisó | La rompe |
| Eventos neutros (ver 1.5) | No la afectan |

### 1.2 Salidas del partido

El sistema registra la salida automáticamente según las horas que faltaban para el inicio del partido. Entre dos puntos de la tabla se interpola de forma lineal y luego se redondea.

| Horas de aviso | Penalización |
| --- | --- |
| 0 (última hora) | −28 |
| 2 | −23 |
| 4 | −15 |
| 6 | −10 |
| 12 | −7 |
| 24 | −4 |
| 48 o más | −1 |

Ejemplos para tus tests: 5 h = −13, 3 h = −19, 8 h = −9, 36 h = −3 (verifícalos con la interpolación).

Si otro jugador toma el cupo, **la penalización se aplica igual, completa**. No hay reducción.

### 1.3 Faltas del día del partido

El organizador marca a cada jugador de su nómina después del partido: **Asistió**, **Llegó tarde** (más de 10 minutos) o **No fue**.

| Falta | Puntos |
| --- | --- |
| Llegar tarde | −8 |
| Llegar tarde teniendo 2 o más tardanzas en sus últimos 10 partidos | −15 |
| No asistió y no avisó | −35 |
| Plantón con reincidencia | −35 × (1 + 0.5 × plantones previos en sus últimos 10 partidos) → −53, −70, ... |

"Últimos 10 partidos" = los 10 eventos de TrueScore anteriores de ese jugador (asistencias, tardanzas, plantones y salidas), sin contar eventos neutros.

### 1.4 Niveles y colores

| TrueScore | Nivel | Color | Consecuencia |
| --- | --- | --- | --- |
| 90 a 100 | Muy confiable | Verde | Prioridad en listas de espera |
| 75 a 89 | Confiable | Verde | Ninguna |
| 50 a 74 | En observación | Amarillo | Ninguna |
| 0 a 49 | Poco confiable | Rojo | Ninguna |

- Cuando un jugador pide unirse a un partido, su TrueScore se muestra con su color al organizador y en la lista de jugadores.
- En partidos abiertos, cualquier jugador entra **sin confirmación manual**, sin importar su puntaje.
- El organizador puede **expulsar** a cualquier jugador de su partido. La expulsión **no resta puntos** al jugador expulsado.
- **No existe** ninguna restricción automática por puntaje bajo (ni confirmación obligatoria ni aceptación manual).

### 1.5 Casos especiales

| Situación | Regla |
| --- | --- |
| El organizador cancela el partido | Evento neutro para todos los jugadores. El organizador recibe su penalización (sección 2). |
| Partido suspendido por lluvia o cierre de cancha | Evento neutro para todos, incluido el organizador. |
| El organizador no confirma la asistencia en 24 horas desde el fin del partido | El partido queda neutro para todos los jugadores. El organizador recibe −10. |
| Jugador marcado mal | Tiene 48 horas para reclamar. Si 2 compañeros que asistieron a ese partido confirman que sí estuvo, se revierte el evento y se aplica "Asistió". El organizador recibe −20. |
| Entró desde la lista de espera | Mismas reglas de salida que cualquier jugador, sin reducciones ni periodo de gracia. |
| Emergencias | **No hay comodines.** Toda falta resta completa, sin excepciones. |
| Cuentas duplicadas | Cada cuenta requiere un número de teléfono verificado y único. |
| Inactividad | Job mensual: si el jugador lleva 6 meses sin partidos, su puntaje se acerca a **65** en 2 puntos por mes (sube o baja), sin pasarse de 65. |

## 2. Puntaje del organizador

Rango 0 a 100, empieza en 75, tope 100. Mismo sistema de ledger.

| Hecho | Puntos |
| --- | --- |
| Partido realizado y asistencia confirmada en menos de 12 horas | +5 |
| Partido realizado y asistencia confirmada entre 12 y 24 horas | +2 |
| No confirma la asistencia en 24 horas | −10 |
| Cancela con 48 horas o más | −2 |
| Cancela con 24 horas o más (y menos de 48) | −5 |
| Cancela con 6 horas o más (y menos de 24) | −10 |
| Cancela con 2 horas o más (y menos de 6) | −15 |
| Cancela con menos de 2 horas o no aparece | −25 |
| Información falsa del partido (hora, cancha o precio), comprobada por un administrador tras un reclamo con pruebas | −25 |
| Marcó mal a un jugador y el reclamo lo probó | −20 |

- Cancelar por lluvia o cierre de cancha no resta.
- Los jugadores califican al organizador con 1 a 5 estrellas después de cada partido. Se muestra el promedio junto al puntaje, pero **no se mezcla** con él.

| Puntaje del organizador | Consecuencia |
| --- | --- |
| 50 o más | Ninguna |
| 30 a 49 | Sus partidos muestran una alerta a los jugadores |
| Menos de 30 | No puede crear partidos durante 2 semanas; al terminar, su puntaje vuelve a 50 |

Los reclamos por información falsa necesitan una pantalla simple de revisión para administradores (aprobar o rechazar con pruebas adjuntas).

## 3. Fair play

Rango 0 a 100, empieza en **100**.

| Hecho | Puntos |
| --- | --- |
| Partido jugado sin reportes válidos | +1 (tope 100) |
| 3 o más reportes válidos de jugadores del mismo partido | −15 |
| Agresión física confirmada por el organizador | −40 y la cuenta queda marcada para revisión de un administrador |

Un reporte es válido solo si quien reporta jugó ese partido y tiene TrueScore de 75 o más. Un reporte aislado no resta nada. Un jugador solo puede reportar una vez a la misma persona por partido.

## 4. Fuera de alcance

No implementes nada de esto: nivel de juego (ranking tipo Elo), evaluación de canchas ni puntaje de pagos.

## 5. Fases y feature flags

| Flag | Incluye |
| --- | --- |
| `truescore_fase1` | TrueScore con asistencia, racha, salidas, tardanzas simples y plantones simples; confirmación del organizador; colores; expulsión; eventos neutros por lluvia y cancelación; teléfono verificado |
| `truescore_fase2` | Reincidencia (plantones y tardanzas), reclamos, prioridad en lista de espera, puntaje del organizador |
| `truescore_fase3` | Fair play |
| `truescore_fase4` | Job de inactividad |

Sin `truescore_fase2`, la reincidencia no se aplica (−35 y −8 fijos). Al activar la fase 2 **no se recalcula el pasado**: las reglas nuevas aplican desde ese momento.

## 6. Tests obligatorios

Escribe tests unitarios de la lógica de puntaje con estos casos (todos con fase 2 activa salvo que se indique):

1. Jugador nuevo asiste 4 partidos seguidos: 75 → 81 → 89 → 99 → 100.
2. Jugador nuevo no asiste sin avisar: 75 → 40.
3. Desde 40, asiste 4 seguidos: 40 → 46 → 54 → 64 → 76.
4. Patrón "asiste 4, falta 1" repetido tres veces desde 75: el primer ciclo llega a 100 y el plantón lo deja en 65; el segundo llega a 100 y el plantón (−53) lo deja en 47; el tercero llega a 83 y el plantón (−70, dos previos) lo deja en 13.
5. Salida a las 5 h: −13. A las 2 h: −23. A las 48 h: −1 y la racha se mantiene.
6. Salida a las 12 h rompe la racha: el siguiente partido asistido vale +6.
7. Tercera tardanza en 10 partidos: −15.
8. En 100, una asistencia deja el puntaje en 100 (tope).
9. Organizador cancela: el jugador queda igual y su racha intacta.
10. Organizador no confirma en 24 h: jugadores sin cambios, organizador −10.
11. Reclamo aceptado: el plantón se revierte, se aplica la asistencia, y el puntaje, la racha y la reincidencia posteriores se recalculan correctamente.
12. Entró de la lista de espera 8 h antes y se sale 2 h antes del partido: −23, igual que cualquier jugador.
13. Reporte de fair play de un jugador con TrueScore 70: no cuenta.
14. Procesar dos veces la misma confirmación de asistencia: los puntos se aplican una sola vez.

## 7. Entrega

Al terminar cada fase, dame un resumen corto con: archivos creados o modificados, migraciones de base de datos, cómo probarlo a mano en la app y cualquier decisión que hayas tenido que tomar por tu cuenta.

## 8. Decisiones tomadas al aprobar el plan (2026-09-24)

Estas decisiones las tomó Vicente al aprobar el plan de la fase 1. Donde contradicen una sección anterior, mandan estas.

| Tema | Decisión |
| --- | --- |
| Puntaje de organizador (sección 2) | **No existe por ahora.** Hay un solo TrueScore global; lo que castiga al organizador se descuenta de ese mismo puntaje. Las alertas (30–49), el bloqueo de 2 semanas y las estrellas quedan fuera. |
| Cancelación del organizador | Con 12 h o más de aviso, o por lluvia/cierre de cancha: no pierde nada. Con menos de 12 h: −15 si faltan más de 2 h, −25 si faltan 2 h o menos. Aplica también a «cancelar y cambiarme a otro partido». No toca su racha ni cuenta en sus «últimos 10 partidos». Para los jugadores, cancelar siempre es neutro. |
| Organizador que no confirma en 24 h | −10 a su TrueScore desde la fase 1. Si la nómina estaba vacía no hay nada que confirmar y no se cobra. |
| Puntaje inicial | Al activar `truescore_fase1` todas las cuentas, también las existentes, parten en 75 con un evento «inicio». El historial viejo (`trust_score_history`) queda sólo como archivo. |
| Restricciones por puntaje | El organizador puede seguir exigiendo un puntaje mínimo en su partido. La app no suspende a nadie por puntaje ni agrega otras restricciones. |
| Aprobación manual | «Entra sin confirmación manual» se refiere a los partidos de ingreso inmediato; el organizador puede seguir eligiendo aprobación manual. |
| Confirmación de asistencia | Se confirma una sola vez y a toda la nómina. Un error se corrige con el reclamo de la fase 2. |
| Encuentros entre clubes | Quedan fuera de TrueScore. |
| Expulsión | No resta puntos y el expulsado no puede volver a ese partido (ni a su lista de espera). |
| Teléfono verificado | La pantalla y el chequeo quedan listos, pero se exigen sólo con el flag `telefono_obligatorio`, que espera a que haya proveedor de SMS configurado. |

### Decisiones de la fase 2 (2026-09-24)

| Tema | Decisión |
| --- | --- |
| Alcance | Reincidencia, reclamos (con el −20 al organizador de la sección 1.5), prioridad en la lista de espera y los bonos de confirmación. Todo sobre el TrueScore global. |
| Bono del organizador | +5 si confirma la asistencia antes de 12 h desde el fin del partido, +2 entre 12 y 24 h. Sólo si al menos un jugador asistió («partido realizado»). |
| Información falsa (−25) | Fuera por ahora, junto con su pantalla de revisión. |
| Ventana de reincidencia | Sólo cuentan los eventos ocurridos con la fase 2 activa: al activarla, todos parten de cero. |
| Plazo del reclamo | Todo ocurre dentro de las 48 h desde la marca: reclamar y que los compañeros confirmen. Vencido el plazo, el reclamo se cierra y la marca se mantiene. |
| Qué se reclama | Una tardanza o una ausencia marcadas por el organizador. Aceptado, se aplica «Asistió». Si no hay 2 compañeros que hayan asistido, no se puede reclamar. |
| Quién confirma | Compañeros marcados «Asistió» o «Llegó tarde» en ese partido; no el reclamante ni el organizador. |
| Prioridad en la lista de espera | El nivel «Muy confiable» va antes, y dentro de cada grupo manda el orden de llegada. Se evalúa con el puntaje del momento en que se libera el cupo. |
