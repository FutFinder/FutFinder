# 2026-08-17 — El ciclo de desafíos entre clubes, de la invitación al historial

Cierre de la **Fase 6** y, con ella, del ciclo completo abierto por la migración
41. Esta nota existe para que una sesión futura entienda la implementación sin
reconstruir seis fases de conversación: qué hace cada pieza, dónde vive, y qué
reglas no se pueden romper.

## Contexto

Un desafío entre clubes recorre trece estados, seis pantallas y diez migraciones
(41 a 50b). Las decisiones que lo gobiernan se tomaron a lo largo de cinco
fases y varias de ellas se aprendieron corrigiendo un fallo, no diseñando:
la doble pertenencia (43d), el token de idempotencia que no es una credencial
(43b), la reserva de cupo que no aborta la publicación (45c), el estado cerrado
que manda sobre la sanción (U5.1), el expediente que tiene que entrar en el
sondeo (U5.2) y la disputa que ningún club reabre (48b).

## Decisión

### 1. El recorrido, y qué pieza lo mueve

| Paso | Estado del desafío | Lo mueve | Pantalla |
|---|---|---|---|
| Retar | `pendiente` | `crear_desafio` | `ClubChallengeScreen` |
| Aceptar | `negociacion` | `aceptar_desafio()` (42) | `ClubChallengesScreen` / hilo |
| Acordar | `negociacion` → prórroga → `sin_acuerdo` | `procesar_vencimientos_desafios()` por `cron` (43) | hilo |
| Proponer | `esperando_aprobacion` | `crear_propuesta_oficial()` (43d) | `ClubProposalScreen` |
| Aprobar | `publicado` | `aprobar_propuesta()` (44) — crea el `matches` | `ClubProposalScreen` |
| Inscribirse | `publicado` | `join_club_match()` (45) | `ClubMatchRosterScreen` |
| Cambiar algo | `publicado` | `pedir_cambio_partido()` / `responder_cambio_partido()` (46) | `ClubMatchChangeScreen` |
| Jugar | `en_juego` → `esperando_resultado` | el `cron` de la 43 | hilo |
| Registrar el resultado | `esperando_resultado` | `proponer_resultado()` (48, 48b) | `ClubResultScreen` |
| Confirmarlo | `finalizado` | `confirmar_resultado(id, true)` (48, 50, 50b) | `ClubResultScreen` |
| Rechazarlo | `resultado_en_disputa` | `confirmar_resultado(id, false)` | `ClubResultScreen` |
| Cancelar | `cancelado` + sanción de club | `cancelar_encuentro_club()` (47) | `CancelarEncuentroBar` |
| Incomparecencia | `bloqueado_sancion` | `informar_incomparecencia()` / `solicitar_revision_sancion()` (47c) | `IncomparecenciaYRevisionBar` |

`src/services/clubChallengeRules.js` es **la única fuente de verdad de las
transiciones** en el cliente, con `desafio_reglas()` como espejo en PostgreSQL.
`getChallengeCta()` decide qué acción ofrece el hilo; si una pantalla y el
servidor no coinciden, gana el servidor y la pantalla está mal.

### 2. Dónde vive el resultado real

`club_match_results` (migración 48), una fila por propuesta, con
`estado 'propuesto' / 'confirmado' / 'rechazado'`. Lectura para los integrantes
de los dos clubes; **sin ninguna política de escritura**: sólo la escriben las
dos RPC `security definer`. El índice único parcial
`club_match_results_activo_uidx` sobre `challenge_id` **excluye los
rechazados**: eso es lo que permite que exista un solo resultado activo y, a la
vez, que una propuesta nueva pueda reemplazar a una rechazada el día que la
moderación reabra una disputa.

### 3. Cómo se lee el historial

`historial_club(p_club_id, p_limit)` (migración 49), con `join` **interno**
contra los resultados `confirmado`. La perspectiva es del club que pregunta:
`V` significa «ganó `p_club_id`», sea local o visitante. `club_estadisticas()`
devuelve PJ, V, E, D, GF y GC y **delega V/E/D en `club_record()`** en vez de
copiar su cálculo.

`historial_publico_club()` (44d, rellenada por la 48) sigue existiendo como la
proyección estrictamente pública, pero **ninguna pantalla la llama**: su `join`
es `left` y publica un partido `finalizado` sin marcador confirmado. Ver el P4
de [Pendientes](../operacion/pendientes.md).

## Las reglas que no se pueden romper

1. **CONFIRMAN LOS DOS CLUBES.** Propone un administrador de uno; confirma o
   rechaza un administrador del **otro**. Tres condiciones en el servidor: no
   ser quien propuso, administrar el club contrario, y **no pertenecer al club
   proponente en ningún rol** (regla estricta de la 43d). Quien administra los
   dos clubes no participa en ninguna de las dos puntas.
2. **UN CLUB NO REABRE UNILATERALMENTE UNA DISPUTA.** `resultado_en_disputa` es
   terminal para los clubes: sólo la moderación vuelve a `esperando_resultado`.
   Lo fijó la 48b en la guarda y lo dicen ya, desde la 50 y la 50b, el aviso
   del rechazo y el motivo de error — antes invitaban a «proponer uno nuevo»,
   una acción que el servidor rechazaba acto seguido.
3. **UN RESULTADO NO CONFIRMADO NO MUEVE NADA.** Ni `club_record()`, ni
   `club_estadisticas()`, ni `historial_club()`. Un partido `finalizado` sin
   resultado confirmado **no es un partido jugado**.
4. **EL MARCADOR SE LEE DESDE EL CLUB QUE SE MIRA.** «Club A 3-1 Club B» es
   «Victoria 3-1» en el perfil de A y «Derrota 1-3» en el de B. La letra V/E/D
   se deriva de los dos números que la tarjeta pinta, para que la insignia no
   pueda contradecir al marcador. En el hilo, donde están los dos clubes, el
   marcador va anclado: «3-1 (local-visitante)».
5. **QUÉ ES PÚBLICO DE UN ENCUENTRO TERMINADO:** los dos clubes, sus escudos,
   el día, el marcador y el V/E/D. **La hora exacta y la cancha sólo viajan a
   los integrantes de los dos clubes**, que es a quienes la RLS de `matches` ya
   les muestra la fila entera. Antes de terminar, el partido no existe para
   nadie más (44d).
6. **LA ASISTENCIA Y EL CIERRE DE UN ENCUENTRO ENTRE CLUBES TIENEN UNA SOLA
   PUERTA.** `proponer_resultado()` marca quién llegó, reutilizando
   `attendees.estado` (`confirmado_gps` / `no_asistio`) y **sin tocar el Trust
   Score de nadie**; `confirmar_resultado()` cierra. Desde la 50,
   `save_match_attendance()` y `cancel_match()` —las RPC genéricas del partido
   normal— **rechazan** los partidos nacidos de una propuesta.
7. **LAS SANCIONES SON DEL CLUB, NO DE LAS PERSONAS.** Cancelar dentro de las 2
   horas previas, o no presentarse, deja al club 14 días sin poder crear,
   aceptar, proponer ni aprobar desafíos. Nadie pierde un punto de Trust Score
   por eso.
8. **LA MODERACIÓN NO EXISTE TODAVÍA Y NO ES UN OLVIDO.**
   `resolver_revision_sancion()` sólo la ejecuta `service_role` desde el panel,
   y una disputa no tiene quién la reabra. Son los dos P1/P2 abiertos de
   [Pendientes](../operacion/pendientes.md).

## Consecuencias

- **Ninguna pantalla decide permisos.** Esconder un botón es cortesía; la
  autorización se vuelve a comprobar en la RPC con la fila bloqueada. Todo lo
  que el cliente sabe de las reglas vive en utilidades puras y probadas
  (`clubChallengeRules.js`, `cambioPartido.js`, `cancelacionEncuentro.js`,
  `revisionSancion.js`, `resultadoRpc.js`, `historialClub.js`,
  `permisosDesafio.js`), no en las pantallas.
- **El servidor guarda datos, no frases.** Los `club_challenge_events` llevan
  `tipo` y `payload`; la redacción se arma en el cliente y se corrige sin migrar
  filas. Las tres burbujas del resultado eran las únicas que ignoraban su
  payload —decían «El resultado quedó confirmado» mientras el push del mismo
  evento decía «confirmó 3-1»— y se alinearon en la 6.3.
- **Realtime no cubre este ciclo.** `club_challenge_events`,
  `club_match_changes`, `club_sanctions` y `club_match_results` no están en la
  publicación, así que el hilo se refresca con `crearSondeo` cada 15 segundos y
  **todo** lo que puede cambiar por acción del otro club entra en ese refresco.
  Dos fallos reales nacieron de olvidarlo (U4.4 y U5.2).
- **Un valor por defecto no es un dato.** El nivel del encuentro
  (recreativo / intermedio / competitivo) no se acuerda en ninguna parte del
  ciclo, así que no se muestra en el historial aunque la columna exista. Ver el
  P3 correspondiente.
- **Lo que queda pendiente está clasificado y no bloquea:** la moderación
  (P1/P2), la comprobación manual del historial en pantalla (P3), el nivel del
  encuentro (P3) y el destino de `historial_publico_club()` (P4).

## Pruebas que sostienen todo esto

Los arneses SQL del ciclo, todos con `BEGIN … ROLLBACK` y corridos contra el
esquema ya aplicado: `41_desafio_ciclo`, `42_desafio_chat_rls`,
`43_desafio_plazos`, `43c`, `43d`, `44` y sus cuatro, `45` y sus tres
(`45_inscripcion_por_club` 14/14), `46_cambios_de_partido` (22/22),
`47_cancelacion_y_sancion` (25/25), `47b` (5/5), `47c` (26/26),
`48_resultado` (19/19), `49_historial` (13/13) y
`50_una_sola_puerta` (8/8). Los tres últimos se volvieron a correr el
2026-08-17 después de aplicar la 50 y la 50b. Del lado del cliente, las utilidades puras tienen
prueba propia; las que cubren esta fase son `resultadoRpc.test.js`,
`historialClub.test.js`, `expedienteSancion.test.js` (la única que simula dos
sesiones a la vez), `cambioPartido.test.js`, `cancelacionEncuentro.test.js`,
`revisionSancion.test.js` y `permisosDesafio.test.js`.

**Una prueba SQL en verde no dice que la pantalla funcione.** Pasó tres veces en
esta fase: el arnés de la 45 llevaba 14/14 mientras la nómina se veía vacía; el
de la 47, 25/25 mientras el hilo mostraba el motivo de otra sanción; el de la
47c, 26/26 mientras el club acusado no veía su botón hasta recargar. Ninguna
unidad se cierra sólo con SQL.

## Documentos relacionados

- [Clubes](../funcionalidades/clubes.md)
- [Chat](../funcionalidades/chat.md)
- [Reglas de negocio](../producto/reglas-de-negocio.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Seguridad y privacidad](../arquitectura/seguridad-y-privacidad.md)
- [Pruebas](../operacion/pruebas.md)
- [Pendientes](../operacion/pendientes.md)
- [2026-08-13 — La funcionalidad completa va antes que el rediseño visual](2026-08-13-funcionalidad-antes-que-rediseno.md)
