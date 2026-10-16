# Pendientes

Última revisión: 2026-09-30

Los ítems siguientes son trabajo no resuelto. Cada uno se separa de los cambios ya versionados y requiere una comprobación explícita para cerrarse.

La lista consolidada de fallas de cliente detectadas en Inicio, Chat, Perfil, Avisos y Ajustes el 2026-09-23 está en [`PENDIENTES_CALIDAD_2026-09-23.md`](../../../PENDIENTES_CALIDAD_2026-09-23.md). Ese documento distingue los casos reproducidos de los detectados por flujo de código y no los considera corregidos.

## Repaso del 2026-09-30

Los diecisiete pendientes abiertos se volvieron a contrastar, uno por uno, contra el código y contra `jvfoendzblkoxvwvommz` con consultas de **sólo lectura**. De los diecisiete no se cerró ninguno, pero cuatro cambiaron de tamaño y apareció uno nuevo —que sí quedó cerrado ese mismo día, con la migración 141—:

- **El esquema sin versionar se encogió de 16 objetos a 9**, sin que nadie lo persiguiera: migraciones posteriores redefinieron siete de ellos con `create or replace`, que en una base nueva los crea igual. Detalle en su propio ítem.
- **Las funciones de trigger ejecutables por `authenticated` crecieron de 41 a 42, y el total de 43 a 52.** Es exactamente lo que ese ítem advertía que iba a pasar: el disparador de la 115 cierra lo nuevo a `public` y `anon`, no a `authenticated`, así que la lista se alimenta sola con cada migración.
- **El historial de clubes ya no está vacío:** hay un resultado `confirmado` y un desafío `finalizado`. La comprobación visual que faltaba ya se puede hacer mirando datos reales, sin sembrar nada.
- **Los partidos de clubes pasaron de 7 a 9**, los nueve en `recreativo` por omisión.
- **Nuevo, y ya cerrado el mismo día:** `push_tickets` conservaba permisos de escritura para `authenticated` que sus siete tablas hermanas no tienen. Lo cierra la migración 141; ver el ítem al final.

Lo que se confirmó **sin cambios**: la política `profiles_read_all` sigue en `true`; las tres funciones de la cancha siguen validando sólo por rango y ninguna menciona el cero; `canchas` sigue con una única política, `canchas_select_any`, y 17 filas que nadie puede borrar; `historial_publico_club()` sigue sin un solo consumidor; `MatchMap.web.js` sigue devolviendo `null`; la migración 46 sigue sin arnés de dos sesiones; y no existe ni `reabrir_disputa` ni ninguna pantalla de moderación. Las dos colas que dependen de una persona están **vacías hoy** —cero revisiones de sanción pendientes y cero resultados en disputa—, así que el hueco no ha llegado a doler.

No se pudieron comprobar desde acá: la entrega push en un teléfono y los tipos de carácter de la contraseña, las dos por falta de entorno nativo y de un build distribuido.

## Resuelto el 2026-10-14 — el repositorio ya construye una base desde cero

**Y no construía.** Fallaba en la migración 16 de 169. Se levantó por primera vez una base vacía (colima + el stack local de Supabase, Postgres 17.11) y se fue arreglando hasta que entró entera. Lo que apareció por el camino no se veía desde producción, y ése era justamente el punto.

### Los cinco huecos

1. **El orden de los archivos, que ningún `sort` acierta.** Alfabéticamente la **100 va entre la 09 y la 10** —noventa posiciones antes de donde corresponde—, así que cualquier herramienta que lea el directorio aplica la 100 sobre tablas que la 10 no ha creado. Y `sort -V`, que arregla eso, pone **44b, 44c y 44d ANTES que la 44**, que es la que crea lo que las otras modifican. Las dos fallan al aplicar, no al leer. Lo resuelve `scripts/ordenMigraciones.js`, con pruebas que fijan las dos trampas.
2. **Tres de las cuatro tablas de la migración 146 se creaban después de usarse.** `notifications` la usa la **16**, `canchas` la **101** y `ratings` la **124**; las tres nacían en la **146**. La 146 demostró con una huella md5 que el repositorio describía todo lo que la base tiene, y era cierto **para producción** —donde ya existían— pero no decía nada de una base nueva.
3. **La 146 transcribió mal una columna, y no se podía notar.** `canchas.nombre_norm` es una columna **generada** (`attgenerated = 's'`) y la 146 la escribió como `default public.norm_text(nombre)`, que Postgres rechaza: «cannot use column reference in DEFAULT expression». En producción el `create table if not exists` nunca se evaluó, así que el error llevaba ahí desde octubre sin que nada lo delatara. La huella md5 probaba que no cambiaba nada, **no que la transcripción fuera correcta**.
4. **Nadie creaba `pg_net` ni `pg_cron`,** y el repositorio las usa: la migración 38 escribe `net.http_response_result` y la 146 llama `cron.schedule`. Estaban en producción porque Supabase las instaló a mano.
5. **Cuatro cosas más sin versionar:** `matches.direccion`, `matches.reminder_sent_at`, `matches.rating_reminder_sent_at` y la función `tg_auto_suspend` —que la migración **88** toca y que sólo se versionó en la **134**, cuarenta y seis después—.

### Cómo quedó

- **`scripts/construir-base.mjs`** levanta la base entera desde `supabase/schema.sql` más las 169 migraciones en el orden correcto. Usa `psql` si está, y si no, el que vive dentro del contenedor del stack local. Para en la PRIMERA que falla y dice cuántas iban.
- **`schema.sql` creció** con lo que faltaba: las dos extensiones, las tres columnas de `matches`, las funciones del cimiento (secciones 2 y 6 de la 146), `tg_auto_suspend` en su forma anterior a TrueScore, las cuatro tablas **con `nombre_norm` corregida** y las dos columnas de `profiles`. **La 146 no se tocó**: está aplicada, y como todo lo suyo lleva `if not exists`, cuando le llega su turno ya no hace nada.
- Sus **disparadores** (sección 7 de la 146) sí se quedan donde están: dependen de funciones que crean otras migraciones, así que no pueden ir antes que ellas.

### La comprobación

**169/169 migraciones aplicadas**, y reconstruida después **sin la 149** —la que espera un build— para comparar contra producción:

| | base nueva | producción |
|---|---|---|
| Tablas de `public` | 72 | 72 |
| Funciones de `public` | 285 | 285 |
| Políticas de `public` | 118 | 118 |
| Disparadores | 68 | 68 |
| Tareas cron | 12 | 12 |

La única diferencia bruta era una política de más en el recuento total, y resultó ser del propio stack local en `storage`, no del repositorio.

### Lo que esto deja montado

El stack local sigue disponible: `colima start` y después `supabase start` desde la carpeta aislada. Es lo que destraba el pendiente de la carrera de dos sesiones, que no se podía montar contra producción.

## Resuelto el 2026-09-23 — aprobar a un jugador también mira su agenda

`approve_join` y `confirmar_nomina_club` pasaban la fila de `pendiente` a `inscrito` con un UPDATE, y `tg_enforce_join_rules` —con el lock por jugador de la 109 y la revisión `CHOQUE_HORARIO`— sólo corría al insertar. Se podía aprobar al mismo jugador en dos partidos a la misma hora, incluso uno tras otro; se reprodujo contra producción en un bloque revertido. La migración 133 agrega `trg_enforce_join_rules_al_aprobar` (`BEFORE UPDATE OF estado`, sólo para `pendiente → inscrito`) y las dos RPC traducen el rechazo a `ok:false` con motivo legible y `code`. Verificado: `133_aprobar_mira_la_agenda_test.sql` 9/9 antes y después de aplicar, arnés 45 14/14 con la 133, `partidos_horario_concurrente_test.cjs` 5/5 y las funciones desplegadas iguales byte a byte al archivo. **Cambio de comportamiento:** aprobar ahora también revisa suspensión, Trust Score y el turno de la lista de espera (`CUPO_RESERVADO`), las mismas reglas que al entrar.

## Resuelto el 2026-08-10 — migraciones 39, 40 y 41 aplicadas

Las migraciones 39 (`/todos`) y 40 (bandeja por RPC) estaban versionadas pero **no** aplicadas: `get_my_threads()` no existía, así que `listMyThreads()` no tenía contra qué correr. Se aplicaron junto con la 41 y se verificaron: `get_my_threads()` ejecuta, `messages.mention_all` y los dos triggers de la 39 existen, y la prueba SQL del ciclo de desafíos pasa sin dejar residuos. No existe un proyecto Supabase de desarrollo separado: hay uno solo y es el que usa `.env`.

## Resuelto el 2026-08-13 — `attendees` y `match_waitlist` sólo se escriben por RPC

- **Dominio afectado:** partidos y, sobre todo, los cupos por club del ciclo de desafíos.
- **Evidencia (comprobada el 2026-08-12 contra `jvfoendzblkoxvwvommz`):** las políticas `attendees_insert_self`, `attendees_update_self` y `attendees_delete_self` permiten a cualquier `authenticated` insertar, modificar o borrar su propia fila de `attendees` directo por PostgREST, sin pasar por `join_match` ni por sus comprobaciones de cupo. `attendees_update_self` incluso deja pasar de `pendiente` a `inscrito`, que es la aprobación manual.
- **Por qué importa:** el reparto de cupos por club de la migración 45 cuenta filas de `attendees` dentro de una transacción; si un jugador puede insertarlas por su cuenta, el conteo no protege nada. Hoy no se explota porque el cliente sólo usa RPC, pero eso es una convención del cliente, no una regla del servidor.
- **Resolución:** se aplicó `44e_attendees_solo_por_rpc.sql` antes de la 45. `join_match` y las demás RPC son las únicas vías también para partidos normales, `cancel_join_request()` sustituye el delete directo del cliente y `approve_join` serializa el último cupo.
- **Verificación de cierre:** el catálogo remoto devolvió cero políticas y cero privilegios de escritura directa; INSERT/UPDATE/DELETE fueron rechazados; 44e pasó 8/8 y todos los escritores reales conservaron su flujo. No quedaron fixtures, objetos temporales ni sesiones `idle in transaction`.

## Resuelto el 2026-08-13 — la ubicación exacta del partido de clubes ya no es pública

Estaba protegida sólo en la interfaz: al publicarse, el partido pasaba a `matches` (`using (true)`) y `tg_register_cancha` copiaba además la dirección a la tabla pública `canchas`. La migración 44b separó la exacta a `club_match_locations` con RLS y dejó en `matches` un punto aproximado de ~1 km marcado con `ubicacion_aproximada`, para que el partido se siga descubriendo. Verificado contra producción: integrantes de los dos clubes —con y sin rol administrativo— leen la exacta; un externo autenticado y un anónimo sólo la aproximada, sin calle; `search_canchas` no la devuelve; el GPS usa exclusivamente la exacta. **La distancia pública puede errar hasta ~0,73 km**, y el nombre de la cancha sigue siendo información pública a propósito.

## Resuelto el 2026-09-17 — funciones de trigger ejecutables como RPC por `anon`

- **Dominio afectado:** superficie de la API.
- **Evidencia (comprobada el 2026-08-12):** el advisor de seguridad marca 54 funciones `SECURITY DEFINER` ejecutables por `anon`, entre ellas funciones de trigger que nunca deberían ser un endpoint: `add_organizer_as_attendee`, `matches_guard_cupos`, `tg_notify_match_join`, `tg_register_cancha`, `check_club_limits` y `handle_new_user`. Todas tienen `=X/postgres` en su ACL, es decir el `EXECUTE` que PostgreSQL concede a `PUBLIC` por defecto y que nunca se revocó.
- **Por qué importa:** PostgreSQL **no** comprueba `EXECUTE` cuando un trigger dispara su función, así que revocarlas de `public`, `anon` y `authenticated` no rompe ningún trigger y quita esos endpoints de PostgREST.
- **Acción:** una migración de limpieza que revoque `EXECUTE` de `public` en todas las funciones de trigger. Se mantiene SEPARADA a propósito: no se metió en la 44, ni en la 44b, ni en la 44c, para no mezclar una limpieza transversal con correcciones acotadas. Ninguna de esas funciones filtra la ubicación; las dos que sí lo hacían (`tg_register_cancha` y `search_canchas` a través de `canchas`) ya están cerradas por la 44b.
- **Resolución:** la migración **114** revocó `execute` sobre TODAS las rutinas de `public` a `public` y a `anon` —a los dos, que es la parte que las migraciones anteriores erraban— y la **115** puso un disparador de eventos para que lo que se cree mañana nazca igual de cerrado.
- **Verificación de cierre (2026-09-18, contra `jvfoendzblkoxvwvommz`):** de 43 funciones de trigger en `public`, `anon` puede ejecutar **0** y ninguna conserva `EXECUTE` para `PUBLIC`. El advisor ya no devuelve ni un `anon_security_definer_function_executable`. Las 91 RPC que el cliente llama de verdad siguen accesibles (arnés de la 114, sacado de `grep .rpc(` sobre `src/`).

## P2 — La migración 114 cerró a `anon` las CATORCE funciones que el producto le había abierto

> Descubierto el 2026-10-15 al correr los 120 arneses juntos. **No urge** —hoy ninguna pantalla llama nada sin sesión— pero es una decisión de producto revertida en silencio, y se arregla mejor ahora que cuando haya una página pública esperándola.

- **Qué pasó.** A lo largo del historial, varias migraciones concedieron `execute` a `anon` **a propósito**, cada una con su motivo y varias con un caso de arnés dedicado a comprobarlo. La migración **114** («anon no ejecuta nada») barrió TODAS las funciones de `public` para quitarle a `anon` el `execute` que `alter default privileges` le concedía a su nombre — un problema real, bien diagnosticado: 56 funciones `security definer` ejecutables por `anon` sin que nadie lo pidiera. **Pero el barrido no llevaba lista de excepciones**, así que se llevó por delante las concesiones deliberadas.
- **Medido: de las 14 funciones que alguna migración concede explícitamente a `anon`, hoy `anon` no puede ejecutar NINGUNA.**

  | Función | Quién se la concedió, y para qué |
  |---|---|
  | `historial_club(uuid,integer)` | **49** — el historial público de un club. Su caso 11 se llama «anon ve lo público, escudos incluidos» |
  | `historial_publico_club(uuid,integer)` | **44d** — la proyección estrictamente pública de un encuentro |
  | `get_disponibilidad_cancha(uuid,date)` | **54, 60, 64, 65, 84** — cinco veces en treinta migraciones |
  | `buscar_complejos(numeric,numeric,text,integer)` | buscar recintos sin cuenta |
  | `precio_de_bloque(uuid,date,time)` | el precio de una hora, sin cuenta |
  | `club_estadisticas(uuid)`, `club_record(uuid)` | las estadísticas públicas de un club |
  | `inicio_de_reserva`, `fin_de_reserva`, `desafio_reglas`, `distancia_km`, `normaliza_telefono_cl`, `sin_tildes` | ayudantes puros que acompañaban a las anteriores |
  | `expire_old_challenges()` | (conviene mirar ésta aparte: no es obvio que deba ser de `anon`) |

- **Por qué nadie se enteró:** los arneses que lo habrían cazado el mismo día —**49, 58, 65 y 69**— se pusieron rojos a la vez y no se volvieron a correr hasta ahora. Ya están actualizados para medir lo que de verdad pasa, con el conflicto escrito dentro de cada uno.
- **Esto explica el P4.** La nota de `historial_publico_club()` decía que `historial_club()` «ya funciona para `anon`» y el 2026-10-14 se corrigió como si fuera un error de la nota. **No lo era: era cierto cuando se escribió.** Lo reversó la 114.
- **La decisión que hace falta** no es función por función, es una sola: **si FutFinder tiene superficie pública sin cuenta**. Si la respuesta es sí, se reabren con una lista explícita —y el barrido de la 114 debería llevar esa lista para que no vuelva a pasar—. Si es no, hay que retirar las concesiones de catorce migraciones y los casos de arnés que las comprueban, para que el repositorio deje de decir dos cosas distintas.
- **Verificación necesaria:** con `set local role anon`, cada función de la lista que se decida reabrir responde; las que no, dan 42501; y ningún arnés queda afirmando lo contrario de lo que la base hace.

## Resuelto el 2026-10-15 — la disputa vuelve a cerrarse (migración 159)

**Un fallo de verdad en producción, encontrado por un arnés que llevaba cinco meses en rojo diciéndolo.**

- **La regla.** La migración **48b** existía para una sola cosa: con el desafío en `resultado_en_disputa`, **ningún club propone un resultado nuevo por su cuenta**. Su texto lo dice con todas sus letras y cambió la guarda de `estado not in ('esperando_resultado','resultado_en_disputa')` a `estado <> 'esperando_resultado'`.
- **Qué la rompió.** La **119** («permisos del club») reescribió `proponer_resultado` entera para añadirle la comprobación de permisos, y la reconstruyó desde una copia **anterior a la 48b**. La guarda laxa volvió. La función compila igual y hace otra cosa: no hubo aviso de nada.
- **La consecuencia.** Un club podía empujar su marcador otra vez estando en disputa, en vez de esperar a que alguien la resolviera — que es exactamente lo que la pieza de moderación de la **151** (`moderacion_reabrir_resultado`) vino a hacer bien. La puerta trasera llevaba abierta desde entonces.
- **Por qué nadie se enteró en cinco meses:** el caso 11 del arnés de la 48 lo comprueba literalmente, y estaba rojo. Los arneses se corren cuando se escriben y nadie vuelve. Salió al correrlos todos juntos.
- **Gravedad real, sin inflarla:** hoy hay **cero** desafíos en `resultado_en_disputa`, así que **no hay ni un dato afectado**. Lo que estaba abierto era la puerta.
- **Verificación:** arnés `159_..._test.sql` **4/4**, midiendo conducta y no el texto de la función — en `esperando_resultado` sí se propone (control), en disputa no lo hacen ni el proponente ni el contrario, y la moderación reabre y entonces sí se puede, que es la salida que impide que un encuentro quede trabado para siempre. Más el caso 11 de la 48, que vuelve a verde.
- **La lección, que no es nueva pero costó cinco meses:** reescribir una función de 12 KB para cambiarle una línea es la forma más fácil de revertir lo que otra migración decidió. Por eso las migraciones de estos días parchean el cuerpo **desplegado** con anclas que fallan si no existen, en vez de transcribirlo.

## P1 — Validar el envío push de extremo a extremo en dispositivo físico

- **Dominio afectado:** avisos y push.
- **Evidencia:** `send-push` tiene pruebas de lógica y SQL, mientras que el registro de push nativo se omite en web y simuladores; la entrega final depende de permisos, Expo, tokens, webhook y cron remotos.
- **Acción:** configurar el archivo de servicios Android/secretos EAS y los servicios remotos autorizados; probar registro, preferencias, recepción y tratamiento de token inválido en hardware físico.
- **Verificación necesaria:** una matriz Android/iOS en dispositivos físicos confirma permisos, token, una categoría permitida, una bloqueada por preferencia y la recuperación ante token inválido. Las pruebas web no cierran este pendiente.
- **No se puede avanzar desde la Mac en la que se trabaja hoy:** no tiene Xcode ni el SDK de Android, así que ni siquiera se llega a un build para instalar.

## Resuelto el 2026-10-14 — ya hay quien modera, y pantalla para hacerlo

- **La decisión (Vicente): modera él, y solo él.** Con 32 usuarios no hace falta más, y no reparte un poder que después cuesta quitar. Queda **una fila** en `public.moderadores`, puesta desde el panel porque la tabla no tiene políticas ni privilegios de cliente: la app ni lee el padrón ni puede nombrar a nadie.
- **La pantalla** (`src/screens/ModeracionScreen.js`) muestra las tres colas de `moderacion_cola()` y resuelve dos: retirar o mantener una sanción revisada, y reabrir un resultado en disputa. Se llega por Configuración → Moderación, y **esa entrada sólo se dibuja para quien está en el padrón**.
- **Esconder la entrada es cosmética y el código lo dice.** `es_moderador()` decide en el servidor y las tres RPC lo comprueban por su cuenta; la pantalla nunca es la autoridad.
- **Los reportes se muestran y no se tocan**, y la pantalla lo explica en vez de limitarse a no traer botones: resolverlos exige decidir estados, medidas y apelación, que sigue abierto (ver el P2). Esa decisión vive en `COLAS` de `src/utils/moderacion.js` con una prueba que se pone roja si alguien agrega el botón sin darse cuenta.
- **«Vacía» y «no se pudo leer» se dibujan distinto.** En una pantalla de sanciones sin resolver, confundirlas es grave: la primera dice que no hay nada, la segunda ofrece reintentar.
- **Verificación, con la sesión real de Vicente:**
  - La entrada aparece en Configuración y la pantalla abre con las colas de producción (2 reportes, 0 revisiones, 0 disputas).
  - **Las filas accionables se vieron dibujadas** —con su expediente, su campo de nota y sus botones— fabricando la respuesta de `moderacion_cola()` con el arnés de `fetch`, de sólo lectura. Las dos colas estaban vacías en producción y no se iba a sembrar una sanción para mirarla.
  - **El camino de acción está probado de punta a punta sin escribir nada:** al confirmar «Retirar sanción» sobre una fila inventada, la pantalla mostró **«No se pudo — Esa revisión no existe»**, que es un texto que vive dentro de `resolver_revision_sancion`. Para llegar ahí la RPC se llamó, `es_moderador()` devolvió **true** (si no, habría sido un 42501, no un `ok:false`) y el cliente leyó `data.ok === false`. Lo único sin ejercitar es la rama de éxito, que necesita una sanción real.
  - **La puerta cierra por los cuatro lados:** con una cuenta fuera del padrón, `es_moderador()` da false y `moderacion_cola()`, `moderacion_reabrir_resultado()` y `moderacion_resolver_revision()` responden **42501**; y `public.moderadores` no se puede leer desde la app.
- **Lo que esto NO cierra:** el P2 de moderación de reportes sigue abierto, y a propósito.

## Resuelto el 2026-10-01 — un resultado en disputa ya tiene forma de reabrirse

`confirmar_resultado(id, false)` dejaba el desafío en `resultado_en_disputa` y ahí se quedaba para siempre: `proponer_resultado()` exige `esperando_resultado` y nadie podía devolverlo. Lo hace `moderacion_reabrir_resultado()` (**migración 151**), que sólo puede llamar quien esté en el padrón y deja su evento en el hilo. El `club_match_results` rechazado se queda como está: `club_match_results_activo_uidx` excluye los `rechazado`, así que la propuesta nueva entra sin chocar — el índice ya estaba preparado para esto desde la 48b.

**No manda aviso al reabrir**, a propósito: un tipo nuevo en `notifications_type_check` necesita un texto que alguien tiene que escribir, y la verificación que pedía este pendiente no lo incluía. El evento en el hilo sí está, y las apps instaladas lo muestran sin romperse gracias al `default` de `ChallengeEventBubble`.

## Resuelto casi entero el 2026-10-01 — la comprobación visual del historial

> Llevaba abierto desde agosto porque `club_match_results` estaba **vacía** y todos los perfiles mostraban el estado vacío. Ya hay un resultado confirmado, así que se pudo mirar sin sembrar nada.

- **El partido que existe:** `clubesprueba` **2–2** `Club prueba`, desafío `finalizado`, jugado el 2026-08-15 00:00 UTC en la cancha «jaja». Es un **empate**, así que los textos de victoria y derrota («Victoria 3-1» / «Derrota 1-3») **no se ejercitaron**: sólo el de empate.
- **Los dos perfiles de club, verificados (paso 5).** Desde dentro: récord «0 victorias · 1 empate · 0 derrotas», tarjeta «Club prueba 2 - 2 clubesprueba» con chip «Empate» y **«Visita»**, y resumen «1 partido jugado · 2 goles a favor · 2 en contra», que cuadra con la tarjeta. Desde el otro club: el mismo partido con el marcador anclado a quien se mira y **«Local»** en vez de «Visita». La perspectiva se invierte bien por los dos lados.
- **La fecha con el reloj del dispositivo, verificada.** La base guarda `2026-08-15 00:00+00` y la tarjeta muestra **«14-ago · 20:00»** — la conversión a UTC−4 es correcta. Era uno de los puntos que ninguna prueba SQL podía ver.
- **Los nombres largos y las dos líneas de contexto, verificados a 375 px** (más estrecho que los 390 que pedía la nota): los dos nombres se cortan con elipsis, **el marcador queda anclado y legible en el centro**, y el contexto cabe en dos líneas.
- **El paso 6, a medias y hay que decirlo.** La mitad del servidor está comprobada contra producción: una cuenta que **no** pertenece a ninguno de los dos clubes recibe el marcador pero con **hora y cancha ocultas**, y `soy_integrante = false`. La mitad visual —que la tarjeta no lleve a ninguna parte— está comprobada **por código**, no vista: `ClubDetailScreen` y `ClubHistoryScreen` pasan `onPress` sólo si `soyIntegrante`, y `MatchHistoryCard` dibuja el chevron sólo si hay `onPress`. Para verlo hace falta una sesión de una cuenta ajena a los dos clubes, y en este recorrido sólo había una.
- **El paso 7 sigue sin hacerse:** el del resultado rechazado que deja el desafío en disputa. Hoy hay **cero** desafíos en `resultado_en_disputa` y montarlo exige rechazar un resultado real.

## Resuelto el 2026-10-14 — el nivel lo fija quien propone (migraciones 156 y 157)

- **Qué pasaba.** `club_challenge_proposals` no tenía columna de nivel y `aprobar_propuesta()` creaba el `matches` sin ponerlo, así que quedaba el `default 'recreativo'` de la tabla. Los nueve partidos de clubes estaban los nueve en `recreativo` y **ninguno por elección**. La tarjeta del historial lo mostraba como «tipo de partido», así que un encuentro competitivo se leía «Recreativo»: un valor por omisión disfrazado de dato. En la 6.3 se dejó de pintar, que tapaba el síntoma.
- **La decisión (Vicente, 2026-10-14): lo fija quien propone y no se negocia**, igual que la modalidad. El club rival lo ve antes de aceptar —se le muestra la propuesta entera— pero no lo contrapropone. Menos ida y vuelta, a cambio de que quien recibe no pueda ajustarlo sin rechazar la propuesta completa.
- **`null` no es `'recreativo'`, y ahí está todo.** La columna nueva admite nulo y nace nula: significa «no se eligió». Poner `'recreativo'` por defecto habría repetido exactamente el fallo. Sólo al crear el `matches` se cae a `'recreativo'`, porque esa tabla tiene ese valor por omisión desde siempre.
- **Hicieron falta DOS migraciones, y la segunda no es un detalle.** La **156** da dónde elegirlo y lo lleva al partido. Pero `historial_club()` devolvía `m.nivel`, y con el `default` de `matches` un encuentro anterior a la 156 es **indistinguible** de uno donde alguien eligió «recreativo»: volver a pintarlo leyendo de ahí habría repetido el fallo con una migración de respaldo que lo hacía parecer cierto. La **157** hace que el historial tome el nivel de **la propuesta**, que sí admite nulo. Es literalmente lo que pedía la verificación de este pendiente: «uno anterior a ese cambio no miente».
- **Las dos parchean los cuerpos DESPLEGADOS** de `crear_propuesta_oficial` (7 KB), `aprobar_propuesta` (12 KB) e `historial_club`, con anclas que fallan si no existen o aparecen más de una vez. Transcribir funciones de ese tamaño es la forma más fácil de meter un error que nadie nota.
- **Verificación: arnés de la 156 6/6 y el de la 157 2/2**, en ensayo revertido, recorriendo el flujo real —desafío → aceptar → proponer con `competitivo` → aprobar— y comprobando que el partido sale `competitivo` y no el valor de la tabla. **El control de la 157 es el que más dice:** con la función vieja en pie, el único encuentro del historial devolvía «recreativo», un nivel que nadie había elegido; después devuelve `null`. Más **1694 pruebas** en verde, incluidas las dos que fijaban la conducta anterior y se reescribieron en vez de borrarse.
- **Lo que queda sin comprobar, y conviene saberlo:** el selector de nivel en `ClubProposalScreen` **no se ha visto en pantalla**. No hay ningún desafío en negociación en producción y crear uno entre dos clubes de Vicente para mirarlo habría sido escribir en producción sin pedirlo. Lo que sí está probado es que el borrador lleva el nivel, que el payload usa el nombre de columna correcto y que la pantalla compila y la app levanta con el cambio dentro.

## P4 — `historial_publico_club()` quedó sin consumidor

- **Dominio afectado:** base de datos y la futura página pública de un club.
- **Evidencia:** la creó la migración 44d como la proyección estrictamente pública de un partido de clubes terminado (clubes, día, marcador y V/E/D) y la 48 le rellenó el marcador. Desde la 49, la aplicación lee el historial con `historial_club()`, que devuelve más —escudos y nivel— y reserva la hora exacta y la cancha para los integrantes de los dos clubes. Ninguna pantalla, servicio ni Edge Function llama ya a `historial_publico_club()`; sólo la usan `44d_partido_privado_test.sql` (caso 15) y `49_historial_test.sql` (caso 5), que la comparan a propósito.
- **Por qué NO se elimina:** sigue siendo el contrato que fija qué es público de un encuentro terminado, y `clubs.slug` existe desde la migración 11 «para la futura página pública `futfinder.com/club/<slug>`», donde el visitante es `anon` — el caso exacto que esta función atiende. Retirar una función aplicada porque hoy no tiene quien la llame es perder la referencia sin ganar nada; su coste es una función `stable security definer` de sólo lectura.
- **El detalle que hay que recordar si se usa:** su `join` contra `club_match_results` es `left`, así que publica cualquier partido `finalizado` **aunque nadie haya confirmado el marcador**, con los goles en `null`. `historial_club()` hace ese join interno justamente para no publicar un partido como jugado sin resultado. Quien construya la página pública tiene que elegir una de las dos a conciencia.
- **CORRECCIÓN del 2026-10-14, matizada el 2026-10-15: «ya funciona para `anon`» era falso HOY, pero era cierto cuando se escribió** — lo reversó la migración 114 (ver el P2 de arriba, que cubre las catorce funciones afectadas). Medido con `set local role anon` contra producción: `historial_club()` y `historial_publico_club()` dan **42501** las dos. Ninguna la puede ejecutar `anon` —el `execute` es de `postgres`, `authenticated` y `service_role`— así que la recomendación que estaba escrita acá habría mandado a quien construya la página pública directo contra un muro. Elegir cuál se usa **no basta**: hace falta además un `grant execute … to anon`, y eso es una decisión de seguridad, no un trámite.
- **Lo que un visitante anónimo YA ve hoy, sin que exista ninguna página pública** (medido el 2026-10-14):

  | | `anon` |
  |---|---|
  | `profiles` | **0 filas** — cerrado por las migraciones 142, 143 y 148 |
  | `clubs` | 13 filas (`clubs_read` es `true` para todos) |
  | `club_members` | 15 filas… |
  | …pero esos `user_id` | **no resuelven a nadie**: 0 de 15 llegan a un perfil |
  | `club_photos` | 4 filas |
  | `matches` | 18 de 27 |
  | `historial_club()` / `historial_publico_club()` | **42501** |

  O sea: el padrón de quién pertenece a qué club es legible, pero **anonimizado** —son uuid que no llevan a ninguna persona, porque `profiles` se cerró—. Esa mitigación no es deliberada, es un efecto de las migraciones de privacidad del perfil; si alguien reabriera `profiles` a `anon`, el grafo de membresías quedaría con nombre y apellido sin que nadie tocara `club_members`.
- **Acción:** al construir la página pública del club, decidir si se usa `historial_club()` para todo y, si es así, retirar `historial_publico_club()` con una migración nueva que también actualice el caso 15 de la prueba de la 44d. Nunca editando la 44d. **Y, antes que eso, decidir qué se abre a `anon`:** hoy no hay ninguna función de historial que pueda llamar.
- **Verificación necesaria:** la página pública no muestra ningún partido sin marcador confirmado, y ninguna prueba versionada queda apuntando a una función que ya no existe.

## P2 — Definir y construir la moderación posterior a un reporte

- **Dominio afectado:** perfil y seguridad de la comunidad.
- **Evidencia:** el flujo permite crear y consultar los propios reportes, pero la documentación y el código no describen moderación, sanción ni apelación.
- **Acción:** decidir roles, revisión, estados, medidas y apelación; después diseñar políticas, persistencia, interfaz y pruebas de autorización.
- **Verificación necesaria:** pruebas de RLS y flujos autenticados demuestran que sólo las personas autorizadas revisan o resuelven reportes y que el usuario ve el estado permitido.

## Resuelto el 2026-10-01 — las tablas base ya están en el historial versionado

`notifications`, `push_tokens`, `ratings` y `canchas` existían en la base y no las creaba ninguna migración. Las crea la **146**, con sus índices, su RLS y sus políticas. Es la misma falta que el P1 de arriba, visto desde las tablas, y se cerró con el mismo cambio.

## Resuelto el 2026-10-01 — se retiró el avisador de chat muerto

`tg_notify_message_new()` existía en producción desde antes del historial versionado y no la usaba nadie: el disparador que parecía suyo, `trg_notify_message_new`, ejecuta `notify_message_new()`, que es otra y sí está versionada —la puso la migración 32, cuando el chat cambió de camino—. Apareció al escribir la 146 y se dejó fuera de ella a propósito; la **150** la retira de la base.

**Se comprobó por seis vías antes de borrarla**, no por una: cero disparadores la ejecutan, ninguna otra función la nombra, ningún cron, ninguna política, ninguna restricción, y desde la 147 no la puede ejecutar nadie del cliente. Tampoco aparece en `src/` ni en las Edge Functions. El `drop` va **sin `cascade`** a propósito: si algo dependiera de ella, falla en vez de llevarse por delante lo que cuelgue.

**Verificación: arnés 4/4**, con el control que registra que la función existía antes del `drop`. El caso que vale es el 3: se manda un DM de verdad y se cuenta el aviso antes y después (0 → 1). Que el objeto ya no esté no demuestra que no hiciera falta; que el chat siga avisando, sí.

## Resuelto el 2026-10-01 — el mapa de partidos en web

- **Qué pasaba, y no era lo que decía este pendiente.** `MatchMap.web.js` devolvía `null`, pero eso no era «en web la lista es el alcance»: el botón «Ver en el mapa» de `PartidosScreen` se dibuja **sin ninguna guarda de plataforma**, así que en el navegador abría una vista vacía. Era un botón muerto, no una decisión.
- **Qué se hizo.** Mapbox GL JS, el mismo proveedor y el mismo `EXPO_PUBLIC_MAPBOX_TOKEN` que ya usa `LocationAutocomplete` para su autocompletado: no entra una cuenta nueva ni un proveedor nuevo. **Ojo con el costo:** el autocompletado cobra por sesión de búsqueda, pero el mapa cobra **por carga**, y esto es una carga cada vez que alguien abre la pestaña en el navegador.
- **No es dependencia de npm.** Se inyecta desde el CDN y sólo al abrir el mapa: GL JS pesa ~200 KB comprimidos y quien nunca abre el mapa no tiene por qué pagarlos en el bundle. Sin token, sin red o con el script caído el componente **vuelve a devolver `null`** y la pantalla conserva su lista y sus filtros: un mapa que no carga no puede dejar algo peor que no tener mapa.
- **La traducción vive aparte, en `src/utils/regionMapa.js`,** porque es donde está el error caro: los deltas de `react-native-maps` son el alto y el ancho **completos** de la ventana, no la mitad, y confundirlo deja el mapa al doble o a la mitad del zoom sin que nada falle. `fmtHora` se movió ahí desde la versión nativa para que las dos plataformas dibujen la misma chapita y no se separen.
- **Verificación: 10/10 en `regionMapa.test.js`** (ida y vuelta región→rectángulo→región, deltas negativos, los polos, y el centro del mapa mandando sobre el del rectángulo) **y recorrido en el navegador con la sesión de Vicente**, que es lo que este pendiente pedía: se vieron los tres marcadores con su formato `8/10 · 00:16`, **la selección** —el marcador se pone verde y abajo abre la ficha del partido— y **el cambio de región**: arrastrar el mapa hace aparecer «Buscar en esta zona», pulsarlo dispara la consulta por límites, cierra el botón y limpia la selección.
- **Los partidos del recorrido fueron fabricados interceptando `fetch`**, de sólo lectura y sin escribir una fila: en producción hay 27 partidos y **ninguno futuro**, así que la lista está vacía para todo el mundo y no había marcadores reales que mirar.

## Resuelto el 2026-10-01 — una cancha en (0, 0) no es una cancha

- **Qué pasaba:** `crear_propuesta_oficial` (43c), `aprobar_propuesta` (44) y `cambio_partido_revisa_campos` (46) validaban la latitud y la longitud **por rango**, y (0, 0) cae dentro. En esta app ese par nunca es una cancha: es la marca de que no se eligió ninguna, porque `Number(null)` es 0 en JavaScript. El cliente ya lo rechazaba —`construirCampos()` en `src/utils/cambioPartido.js`— así que la única vía era llamar la RPC a mano. **Comprobado antes de arreglar:** un `insert` directo en `matches` con (0,0) era aceptado.
- **La regla es la del cliente, no una nueva.** Se rechaza el par exacto, no «un punto dentro de Chile». Lo segundo sería más estricto que el cliente y volveríamos a dos reglas distintas según por dónde entre la cancha, que es lo que este pendiente pedía evitar. Si algún día se exige territorio, se cambian los dos lados a la vez.
- **Resolución (migración 145):** cuatro restricciones `check` en vez de editar las tres funciones. Una regla declarativa por tabla, no tres copias de un `if` dentro de cuerpos de 12 KB que pueden divergir — y la divergencia era el problema. Cubre además a **todo** el que escriba, no sólo a esas tres funciones: `matches` también lo escribe la publicación de un partido normal, que tenía el mismo agujero y nadie lo había mirado. Van en `club_challenge_proposals` (corta la propuesta en la fuente, así que `aprobar_propuesta` nunca ve una en cero), `matches` —se comprobó que `aproximar_grado(0)` es `0.00`, o sea que el cero sobrevive al redondeo del punto aproximado—, `club_match_locations` (la ubicación exacta de la 44b) y `club_match_changes.campos` (la cancha anidada en el jsonb).
- **Lo que se acepta a cambio:** el rechazo llega como violación de restricción (23514) y no como un `ok:false` con texto en español. A esta ruta sólo se llega llamando la RPC a mano, saltándose la pantalla que ya explica bien el error.
- **Verificación:** arnés `145_..._test.sql` **8/8**, en el ensayo revertido y otra vez contra el esquema aplicado. Cubre las dos direcciones —rechaza (0,0) y **sigue aceptando** una cancha real de Santiago—, que un punto con **un solo cero** se acepta (la marca es el par, no un cero suelto), que un cambio de sólo hora no queda bloqueado, y que las coordenadas en texto pasan la restricción a propósito, porque de eso se encarga la validación de tipo de la función. Antes de aplicar se confirmó que no había ni una fila en (0,0) en las tres tablas: 27 partidos, 11 propuestas y 3 cambios.

## Resuelto el 2026-10-14 — la carrera de dos sesiones, corrida de verdad

- **Qué faltaba.** El invariante de los cambios negociados (migración 46) lo sostienen tres piezas —el `select … for update` sobre el partido, el índice único parcial `club_match_changes_pendiente_uidx` y el `update … where estado = 'pendiente'`— y `46_cambios_de_partido_test.sql` corre en UNA sola sesión: probaba que el invariante se cumple, no que aguante la carrera.
- **Por qué no se podía antes, y queda anotado para no volver a intentarlo:** contra producción hacen falta dos transacciones vivas a la vez y las dos vías están cerradas — `dblink` no está instalado (y no se instala para una prueba: deja en la base la capacidad de abrir conexiones arbitrarias) y `max_prepared_transactions` es **0**, así que `PREPARE TRANSACTION` tampoco retiene el bloqueo entre llamadas. Lo destrabó la base local.
- **Cómo corre:** `scripts/carrera-dos-sesiones.sh` lanza **dos procesos `psql` de verdad a la vez** con `&`. No orquesta el entrelazado: los suelta y mira quién gana. Se repite varias vueltas porque una carrera que no llegó a solaparse no prueba nada y con una sola pasada no se distingue. Si no encuentra el fixture, lo siembra solo (`scripts/carrera-semilla.sql`).
- **Resultado: 6/6, y las dos mitades que pedía la verificación.**
  - **Dos solicitudes a la vez** → queda **exactamente una** pendiente. El índice único parcial hace su trabajo.
  - **Dos aceptaciones del mismo cambio a la vez** → **una aplica y la otra contesta `already`**. No es un empate ni una doble aplicación: es la idempotencia que la 46 promete.
- **Un detalle que el arnés tuvo que aprender, y vale la pena por si alguien lo repite:** aceptar un cambio mueve la hora del partido, así que proponer la misma hora en la vuelta siguiente **no es un cambio** y la RPC lo rechaza con razón. El arnés se lo comía como si fuera un fallo de carrera. Cada vuelta usa una hora distinta.

## Resuelto el 2026-10-01 — una función de trigger no es un endpoint

- **Qué pasaba:** de las 53 funciones de trigger de `public`, `authenticated` podía ejecutar **42**. `anon` y `public` ya ejecutaban 0 desde la 114. No era un agujero —llamar a una función de trigger directamente falla con `0A000`— pero era superficie expuesta en PostgREST que nadie audita.
- **Por qué no se cerraba sola, que era la parte que faltaba entender.** `pg_default_acl` tiene, para el rol `postgres` y tipo función en `public`, `{postgres=X, authenticated=X, service_role=X}`: **toda función creada por `postgres` —o sea, toda migración— nace con un `execute` explícito para `authenticated`.** No es el `grant` implícito a `PUBLIC` que cerró la 114; es una concesión propia, y por eso revocarle a `public` no la tocaba. Las funciones de trigger recientes que sí estaban cerradas lo estaban porque su migración lo revocó a mano, una por una.
- **Resolución (migración 147):** revoca `execute` de `public`, `anon` y `authenticated` sobre las 53, y agrega el disparador de eventos `los_triggers_nacen_sin_endpoint`, que hace lo mismo con toda función de trigger nueva. **Va aparte del de la 115 a propósito:** `anon_nace_sin_llaves` cierra `public` y `anon` sobre toda rutina nueva, y agregarle `authenticated` habría roto cada RPC nueva del cliente. El nuevo mira sólo el tipo de retorno `trigger`, así que no puede alcanzar a una RPC ni por error. Cambiar el `alter default privileges` tampoco era la salida: se habría llevado las 162 RPC que el cliente sí necesita.
- **Comprobado antes de revocar:** ninguna de las 42 la llama el cliente. Se cruzaron sus nombres contra los 111 `.rpc(` distintos de `src/` y de las Edge Functions; cero coincidencias.
- **Verificación: arnés 8/8**, en el ensayo revertido y contra el esquema aplicado. El control dejó el antes por escrito —42 de 53, y 162 RPC— y después quedó en **0 de 53 con las 162 RPC intactas**. Los casos 3 y 4 prueban el disparador en las dos direcciones: una función de trigger nueva nace cerrada, y una RPC nueva sigue abierta.
- **Y los cuatro casos que no se pueden reemplazar mirando privilegios.** Revocar el `EXECUTE` no desactiva un trigger —PostgreSQL comprueba ese privilegio al CREAR el trigger, no en cada disparo— pero si alguna vez dejara de aplicarse una regla el fallo sería **silencioso**: ninguna pantalla se rompe, sólo se pierde la validación. Por eso el arnés dispara cuatro de verdad y comprueba el efecto: `tg_match_future_only` sigue rechazando un partido en el pasado, `tg_notify_friend_request` sigue creando el aviso, `add_organizer_as_attendee` sigue inscribiendo al organizador y `tg_ratings_recalc` sigue recalculando las valoraciones.

## P2 — Los tipos de carácter de la contraseña esperan a un build nuevo

- **Dominio afectado:** registro y cambio de contraseña.
- **Evidencia (2026-09-18, contra el servidor):** el panel exige **mínimo 8**, activo y verificado (`Ab3!xyz` → `422 weak_password {reasons:["length"]}`). Los **tipos de carácter** se activaron ese día y se volvieron a apagar el mismo día: con ellos puestos, `contrasenalarga` daba `422 {reasons:["characters"]}`.
- **Por qué se apagaron:** la app que está en los teléfonos sólo valida el largo. Con los tipos puestos, alguien escribe `contrasena123`, la app la acepta, se crea la cuenta, se manda el código, la persona verifica su correo y **recién ahí** `updateUser` falla. La contraseña pendiente es de un solo uso: no hay reintento y queda una cuenta confirmada sin contraseña usable. **No hay actualizaciones por aire** (`expo-updates` no está instalado), así que el arreglo del cliente no llega hasta que se distribuye un build.
- **Estado del cliente:** ya listo. `validarPassword()` espeja las reglas y corre antes de crear nada; `describeAuthError` traduce el motivo real (`length` / `characters`) en vez de uno fijo.
- **Acción:** distribuir un build con ese cambio y **después** volver a activar «Letters, digits and symbols» en Authentication → Sign In / Providers → Email.
- **Verificación necesaria:** contra el servidor, que `contrasenalarga` vuelva a dar 422 por `characters` y que una válida siga dando 200; y que la app muestre qué falta, no un mensaje genérico.
- **Relacionado:** la protección de contraseñas filtradas (HaveIBeenPwned) del advisor **no se puede activar**: es de plan Pro o superior y la organización está en `free`. Cuando se suba de plan no necesita ningún cambio en la app.

## Resuelto el 2026-09-30 — «Visible en búsquedas» ya es cierto

- **Las dos mitades.** La migración **142** sacó la búsqueda del cliente: `buscar_jugadores()` aplica el interruptor en el servidor, exige sesión, excluye a quien busca y topa el límite en 50. Pero declaró su propio límite: mientras `profiles` se leyera entera, cualquiera se armaba su propia búsqueda. La migración **143** cierra eso: `profiles_read_all` (`to public using (true)`) se reemplaza por lectura **por relación**. Un perfil se lee si es el propio, si su dueño lo dejó descubrible, o si hay relación. **`anon` pierde la lectura entera.**
- **Las siete relaciones:** amistad en cualquier estado, club compartido, partido compartido (por nómina o por organizarlo), desafío entre los dos clubes, lista de espera de un partido propio, alguien a quien bloqueé, y co-administrar un recinto o ser su dueño.
- **Cuatro de las siete no salieron del modelo, salieron de buscar los `INNER JOIN`.** Es la lección de este cambio: una política que niega de más no rompe ninguna pantalla. Con `LEFT JOIN` deja un nombre vacío; con `INNER JOIN` **hace desaparecer la fila entera y lo que queda se ve sano**. Lo que apareció: `lista_de_espera()` perdía al jugador oculto y corría un puesto a todos los de abajo (se cierra por los dos lados — la relación, y la función pasa a `security definer` porque cualquier `authenticated` la llama); `administradoresDelRecinto()` usa `profiles!inner` y su comentario decía que se apoyaba en que «profiles es de lectura pública»; la pantalla de Bloqueados usa un embed; y `friendships_insert` (migración 35) consulta `profiles` desde su política, así que mandar una solicitud habría fallado **cerrado y sin mensaje**.
- **Verificación (2026-09-30):** arnés de la 143 **15/15** con la migración en la misma transacción revertida. Contra el esquema aplicado: `anon` lee **0 de 32** perfiles —por SQL y por una petición HTTP real con la clave publicable, la misma que antes devolvía filas— y **una cuenta real sigue viendo las 32**, la búsqueda devuelve 30 y la bandeja de chat conserva su hilo: cero regresión hoy. El arnés de la 142 quedó en **10/10** con la 143 puesta, después de invertir su caso 1, que existía justamente para avisar de esto.
- **Por qué el riesgo real es futuro y no de hoy:** las 32 cuentas están descubribles (`default true`, `not null`), así que la regla de relación está dormida. Sólo muerde cuando alguien apaga el interruptor — y ahí es donde falta mirar.

## Resuelto el 2026-10-01 — el recorrido con el interruptor apagado, y los dos textos

- **Dominio afectado:** perfil, búsqueda y privacidad (migraciones 142 y 143).
- **Por qué importaba:** ninguna prueba SQL ve una pantalla, y la regla de la 143 sólo se activa cuando alguien apaga «Visible en búsquedas». Mientras nadie lo apagara, un fallo habría aparecido después, para una sola persona, en silencio. Se cerró con dos cuentas reales; el detalle está abajo.
- **Los dos textos que iban a mentir se corrigieron el 2026-09-30:**
  1. `getProfileById()` devolvía `null` por tres motivos —no existe, es privado, falló la consulta— y `ProfileScreen` los llamaba a los tres «Este jugador no existe». Ahora devuelve `{ data, error }`: el fallo de carga lleva a «No pudimos cargar el perfil» con **Reintentar** —eso cierra también P02 de `PENDIENTES_CALIDAD_2026-09-23.md`— y la ausencia a **«Este perfil no está disponible»** con «Puede ser un perfil privado o una cuenta que ya no existe». Los dos últimos casos **no se separan a propósito**: distinguirlos obligaría al servidor a confirmar que esa cuenta existe, que es justo lo que el interruptor viene a evitar.
  2. `withOrganizers()` leía `profiles` directo y perdía el nombre del organizador oculto. Pasa por `organizadores_publicos()` (**migración 144**), `security definer`, que entrega sólo usuario, foto y puntaje, y sólo de los partidos que quien mira puede ver. Publicar un partido es un acto público; entregar la fila entera del perfil no se sigue de ahí, y por eso es una función de tres columnas y no una relación más. Arnés: control negativo + 3/3.
- **Recorrido con sesión iniciada (2026-10-01).** Se hizo con la cuenta `vicentebastiasmunoz`, en el navegador, con la app en `localhost` contra la instancia real. Antes de tocar nada quedó anotado el estado: `privacy_visible_in_search = true`, `estado activo`, TrueScore 75.
  - **Sin apagar nada, cero regresión:** Inicio, la nómina del club (dos integrantes con nombre y reputación), la bandeja de chat (**10 hilos**, con el autor de cada uno), el perfil propio y Ajustes cargan completos. El buscador devolvió **21 jugadores** reales y la petición fue `POST /rest/v1/rpc/buscar_jugadores`; el único `GET /profiles` de todo el recorrido fue el del **propio** perfil. `organizadores_publicos` devolvió los cinco organizadores de cinco partidos, con las cinco columnas declaradas y ninguna más.
  - **Con el interruptor apagado desde la app** —lo que prueba también `updateMyProfile`, que guardó— y mirando con dos cuentas reales por consulta de sólo lectura: un **desconocido** deja de leer el perfil (0 filas) y deja de encontrarlo en la búsqueda (0), pero sigue viendo a los demás (30 jugadores); su **compañero de club** lo sigue leyendo (1 fila, la nómina intacta) y conserva su hilo de chat, y **tampoco** le aparece en la búsqueda, que es lo correcto: ocultarse vale para todos.
  - **Restaurado y comprobado:** `privacy_visible_in_search` volvió a `true` por la misma pantalla, el desconocido vuelve a ver el perfil y a encontrarlo, y la base quedó con **0 cuentas ocultas** y los 32 perfiles de siempre. No se escribió nada más.
- **El texto, visto en su pantalla real (2026-10-01).** Con una segunda sesión —`chatgptpruebas5415`, comprobada **sin relación** con la cuenta oculta y que antes de ocultarla sí la veía— se abrió el perfil de `vicentebastiasmunoz` y cargó completo. Con el interruptor apagado, el mismo perfil, desde la misma lista de resultados ya cargada —que es el caso real: un enlace o una lista viejos— dice **«Este perfil no está disponible · Puede ser un perfil privado o una cuenta que ya no existe»** y ofrece **Volver**, no «Reintentar». Al volver a encenderlo, el perfil se ve otra vez entero. Con esto los dos textos de la 144 quedan comprobados en pantalla.
- **De paso se confirmó en vivo el P4 del rediseño de Clubes:** ese mismo perfil público muestra «CLUB — Sin club» cuando la cuenta administra tres clubes.
- **Estado al terminar:** 32 perfiles, **0 ocultos**, 0 cuentas no activas; las dos cuentas usadas quedaron con `visible = true`, `estado activo`, TrueScore 75 y `privacy_friend_requests = everyone`. La única escritura de toda la comprobación fue ese booleano, apagado y encendido.
- **Ojo con la 144 si cambia la RLS de `matches`:** la función repite a mano la condición de `matches_read_publico_o_de_mi_club` porque es `security definer`. El caso 2 de su arnés —un partido de clubes ajeno no entrega su organizador— es el que avisa si la copia se queda atrás.

## P2 — La 149 espera un build, igual que las reglas de contraseña

> **Escrita, probada y a medio aplicar (2026-10-01).** La migración **148** ya está en producción y no cambia nada visible. La **149**, que es la que de verdad cierra las preferencias, **no se puede aplicar hasta distribuir un build**.

- **Qué cierra:** nueve columnas de `profiles` que hoy puede leer cualquier cuenta con sesión sobre cualquier perfil descubrible — los cuatro `notif_*`, `pref_region`, `pref_comuna`, `search_radius_km` y los dos `privacy_*`. Dicen dónde busca partidos cada persona, en qué radio, si acepta solicitudes y si eligió ocultarse. El control del arnés lo deja por escrito: una cuenta cualquiera lee el radio de otra.
- **El problema se encogió antes de arreglarlo, y conviene saberlo:** cuando se anotó, `profiles` se leía con `using (true)` y hasta `anon` veía las filas enteras. La 143 cerró eso. Lo que queda es que una cuenta con sesión vea las preferencias de quien se dejó descubrible.
- **Por qué privilegios por columna y no una tabla aparte,** al revés que la 138 y la 139: se probó primero, contra producción y revertido. La política de lectura de la 143 lee `privacy_visible_in_search` y **sigue funcionando** con la columna revocada —una política sobre su propia tabla no exige privilegio de columna—, `buscar_jugadores` es `security definer` y `send-push` usa `service_role`, así que a ninguno le afecta. Mover los datos habría exigido además un trigger, un CHECK, migrar filas y tocar la Edge Function.
- **La trampa, medida antes de escribir nada:** la política `friendships_insert` comprobaba `privacy_friend_requests <> 'nobody'` leyendo la columna directo. Con el revoke falla con `42501 permission denied for table profiles`, y falla **cerrada**: nadie podría mandar una solicitud de amistad y ninguna pantalla lo diría. La 148 la rehizo sobre `perfil_acepta_solicitudes()`.
- **Y el dueño también perdía lo suyo:** los privilegios por columna no son por fila, así que sin `mis_ajustes()` una persona no podría leer ni su propio radio de búsqueda. También medido.
- **POR QUÉ LA 149 ESPERA.** Quitar el `select` de tabla hace que `select('*')` falle entero. Las apps instaladas lo usan en cuatro lugares y **no hay OTA** (`expo-updates` no está instalado), así que aplicarla antes del build las deja sin perfil, sin Ajustes y sin Inicio. Es el mismo bloqueo que los tipos de carácter de la contraseña, y **van juntas en el mismo build**.
- **Lo que ya está hecho y es seguro hoy:** la 148 (aplicada) y el cliente, que ya no pide `select('*')` en ninguno de los cuatro sitios y trae las nueve por la RPC. Comprobado contra el esquema aplicado que una app instalada sigue funcionando: `select('*')` todavía pasa.
- **Verificación:** arnés `149_..._test.sql`, que aplica la 149 **dentro de la transacción** y la revierte: control + **8/8**. Y seis pruebas de `npm test` que impiden que vuelva un `select('*')` y que la lista de columnas del cliente se separe de la de la migración.
- **Para cerrarlo:** distribuir el build, aplicar la 149, y recién entonces activar también los tipos de carácter de la contraseña.

## Resuelto el 2026-10-04 — el directorio de canchas tiene umbral de entrada

- **Qué pasaba, y era peor de lo que decía esta nota.** `trg_register_cancha` mete una fila en `public.canchas` por cada partido publicado, con el nombre de cancha que el organizador escribió a mano, y ese directorio alimenta el autocompletado de `LocationAutocomplete` **al publicar un partido**. No era sólo que se acumulara basura: al publicar te podían ofrecer «Nsjsjsj» o «jnkj» como cancha. De las 17 filas de producción, casi todas son basura de prueba o nombres tecleados con error.
- **Y la causa de que nadie pudiera borrarlas era otra que la anotada:** no faltaba un `grant` —`authenticated` tiene `delete`— sino una política. `canchas` tiene UNA sola, `canchas_select_any`, así que RLS bloquea todo lo demás.
- **La decisión (Vicente, 2026-10-04): umbral de entrada, no puerta de salida.** Una cancha entra al directorio público cuando la han usado **dos organizadores distintos**. Corta la basura en la fuente sin juzgar el texto —«jnkj» no se distingue de un nombre raro de verdad— y sin pantallas nuevas. Se acepta que una cancha real tarde un partido más en aparecer; mientras tanto el autocompletado sigue ofreciendo las de Mapbox, que es de donde salen casi todas.
- **Dos organizadores, no dos usos.** `usos_count` ya existía y no servía: `tangus` tiene 2 usos y UN solo organizador. Una persona publicando cinco partidos en su cancha inventada la ascendería sola. Por eso la migración **153** añade `cancha_usos` —el par (cancha, organizador), sin privilegios de cliente porque diría dónde juega cada persona— y el umbral vive en `search_canchas`, **no en la RLS**: la fila tiene que existir desde el primer uso para poder acumular el segundo.
- **Verificación: arnés `153_..._test.sql` 8/8**, en el ensayo revertido y otra vez contra el esquema aplicado, llegando las dos veces a la última línea. El **control de antes/después** se midió aparte con la función vieja en pie: una cancha de una sola persona devolvía **1**. Cubre además que `usos_count` siga contando usos, que la cancha de un desafío siga fuera del directorio y que borrar una cancha se lleve sus usos en cascada.
- **Efecto medido en producción tras aplicar: 15 de las 17 filas quedaban ocultas.** Las dos que pasaban el umbral —`maiclub` (4 organizadores) y `Cancha test` (2)— **también eran de prueba**, así que el umbral por sí solo no limpiaba esta base.
- **La limpieza se hizo aparte y a mano el 2026-10-04, con el visto bueno de Vicente fila por fila:** se borraron **14** y se conservaron tres —`maiclub`, `tangus` y `Canchas de Bonilla`, la única con nombre de cancha de verdad—. Se guardó un respaldo de las 17 **fuera del repositorio**, porque lleva `created_by` y eso identifica personas. El borrado fue por `id`, con una comprobación que abortaba si no eran exactamente 14 las que se iban y 3 las que quedaban. `cancha_usos` se vació en cascada: **cero huérfanos**.

## Resuelto el 2026-10-05 — la 153 rompió el autocompletado, y la 154 lo arregló

> **Esto es un fallo que yo introduje y que mi propio arnés no vio.** Vale la pena que quede escrito con nombre, porque la lección ya estaba anotada y volvió a pasar.

- **Qué pasó.** La 153 metió en `search_canchas` una subconsulta contra `cancha_usos`, que a propósito no tiene privilegios de cliente. Pero `search_canchas` era **`security invoker`**, así que esa subconsulta corría con el rol de quien llama y para `authenticated` reventaba con `42501 permission denied for table cancha_usos`. **El autocompletado de canchas al publicar un partido quedó roto para todo el mundo.**
- **Por qué el arnés de la 153 dio 8/8 sobre una función que no funcionaba:** corre como `postgres`, que se salta los privilegios. Un arnés que no cambia de rol no puede decir nada sobre lo que ve un usuario. Es el mismo error de lente que ya había costado un rojo al contar `club_challenge_events` con el rol equivocado.
- **El arreglo (migración 154): `security definer`.** La función pasa a leer `canchas` sin RLS y eso **no destapa nada**, porque la única política de `canchas` es `canchas_select_any`, que ya es `true` para `authenticated`. Lo que cambia es que puede **contar** `cancha_usos` sin publicarla: sale el conteo, no las filas. Y se vuelve a fijar el `execute` sin `anon`, que con `security definer` importa más que antes: `anon` leería el directorio saltándose esa política, que es sólo para `authenticated`.
- **Verificación: arnés `154_..._test.sql` 5/5**, en el ensayo revertido y otra vez contra el esquema aplicado, y **esta vez con `set local role authenticated`**. Su caso 1 es el control que faltaba: comprueba que `cancha_usos` siga ilegible, para que el arreglo no pueda ser «publicar la tabla».
- **Y comprobado en la pantalla, con la sesión real,** que es lo único que no se puede engañar con el rol equivocado: al publicar un partido, «maiclub» sale con su distintivo «CANCHA FUTFINDER · 4 USOS»; «tangus» —que sigue en la tabla pero tiene un solo organizador— **no sale**, sólo lugares de Mapbox; y «prueba» ya no ofrece ninguna cancha del directorio.

## Resuelto el 2026-10-14 — nadie trunca desde el cliente (migración 155)

- **Qué pasaba.** `authenticated` tenía `TRUNCATE` sobre **58 tablas** de `public`, incluidas `profiles`, `matches`, `messages` y `pagos`. No lo pidió ninguna migración: es el reparto por omisión de Supabase, que `pg_default_acl` volvía a aplicar a cada tabla nueva.
- **Por qué importaba, y por qué no era una alarma.** `TRUNCATE` **no pasa por RLS**: todas las demás escrituras de esas tablas están contenidas por políticas, ésta no. Pero **no era explotable** — PostgREST no emite esa sentencia, así que desde la app no existía el camino. Era defensa en profundidad, no una puerta abierta.
- **El control fue más fuerte de lo esperado, y conviene que quede escrito:** no se dedujo del catálogo, se **ejecutó**. Con `set local role authenticated`, una sesión truncó de verdad una tabla de `public`, y una tabla recién creada nacía con el privilegio puesto. O sea: a nivel de SQL el agujero era real; lo único que lo tapaba era que ningún camino de la app llega a emitir `TRUNCATE`.
- **Se quita SÓLO `truncate`.** `insert`, `update` y `delete` de `authenticated` quedan intactos: ésos sí los usa la app y los gobierna la RLS. `service_role` y `postgres` lo conservan, porque son quienes corren migraciones y mantenimiento.
- **Y un disparador para lo que nazca mañana,** `nadie_trunca_desde_el_cliente`, porque `pg_default_acl` habría vuelto a llenar la lista con la próxima migración que añadiera una tabla. No se tocó `anon_nace_sin_llaves` —que ya cubría a `anon`, y por eso `anon` estaba en cero—: su nombre dice lo que hace y `authenticated` **necesita** las otras tres escrituras. Que los dos se solapen en `anon` es inofensivo.
- **Verificación: arnés `155_..._test.sql` 8/8**, en el ensayo revertido y otra vez contra el esquema aplicado, llegando las dos veces a la última línea. El caso 7 es el que vale: **con la lente de un usuario real**, publica un partido (la escritura más común de la app, pasando por la RLS de `matches`) y **no** puede truncar. El caso 1 es el control que impide confundir «se cerró `TRUNCATE`» con «se rompió la app».

## Resuelto — Restos del rediseño de Clubes (los tres puntos, cerrados)

- **Dominio afectado:** portada y ficha de club, perfil público.
- **Contexto:** el rediseño se integró a `main` —`src/contexts/ClubsHomeContext.js`, `ClubsScreen`, `clubsHomeTasks.js`— y la rama `rediseno/portada-clubes` ya no existe. Su handoff anotaba cinco cosas sueltas: el `window.confirm` de salir del club y los `role="radio"` sin `aria-checked` ya estaban corregidos, y las tres que quedaban se cerraron entre el 2026-09-04 y el 2026-10-04.
- **Los tres puntos:**
  1. ~~`ClubDetailScreen.js:346` navega a `EditClub` pasando el club como objeto.~~ **Corregido el 2026-10-04.** Eran dos mitades y ninguna sola explicaba el fallo: `EditClub` **no estaba en `linking.config.screens`**, así que en web la pantalla no tenía dirección propia y recargar devolvía a la raíz; y el formulario se llenaba de `route.params.club`, de modo que aunque hubiera URL un objeto no cabe en una ruta. Arreglar sólo la primera habría dejado una pantalla accesible por enlace que se abre **vacía**, y «guardar» habría borrado la descripción, la región y la comuna del club: peor que no tener URL. Ahora hay `ClubDetail: 'clubes/:clubId'` y `EditClub: 'clubes/:clubId/editar'`, y la pantalla trae el club con `getClubById()` cuando llega por la URL.
     - **Lo encontró el navegador, no una prueba:** la primera versión seguía mandando el club entero «como camino rápido», y React Navigation serializa los parámetros sobrantes en la query — la dirección quedaba en `…/editar?club=%5Bobject%20Object%5D`. Compartir **esa** URL resucitaba el fallo completo: `route.params.club` llegaba como la **cadena** `'[object Object]'`, que es verdadera, así que la pantalla creía tener el club y no lo pedía. Ahora viaja sólo el id, y un `club` que no sea un objeto se ignora por los enlaces que ya se hayan copiado.
     - **El orden del permiso es deliberado:** se decide por el id ANTES de mirar si el club se pudo leer. Al revés, la diferencia entre «no tienes permiso» y «no se pudo cargar» le contaría a cualquiera qué identificadores de club son reales. Comprobado en el navegador: un club ajeno y un id inventado dan exactamente la misma respuesta.
     - **Verificación:** 10 pruebas en `enlaceEditarClub.test.js` y recorrido con la sesión de Vicente — la URL del editor de SixSiete abre el formulario con `nombre`, `descripcion`, `region` y `comuna` idénticos a los de la base; un club donde sólo es jugador y un id inexistente dan «No tienes permiso»; y entrar desde «Editar» deja la URL limpia, sin query.
  2. ~~El perfil público de un administrador de club muestra «CLUB — Sin club».~~ **Corregido el 2026-10-01.** No era privacidad deliberada ni un hueco de datos: `ProfileScreen` calculaba `clubActual = isOwnProfile ? misClubs[0]?.club?.nombre : null`, así que en un perfil ajeno **siempre** valía `null` y la ficha imprimía «Sin club» sin haberlo consultado nunca. La guarda tampoco era tonta —`misClubs` son MIS clubes, cargados ahí para «Invitar a mi club», y usarlos habría mostrado mi club en el perfil de otro—: lo que faltaba era consultar los suyos. Lo hace `getClubesDe(userId)`, que además distingue «no pertenece a ninguno» de «no pudimos leerlo», y en ese segundo caso la ficha dice «N.A.» y no «Sin club». Comprobado en la app: el perfil de `@vicenteee` muestra «Los Papi Pasty», y el perfil propio sigue igual. Seis pruebas nuevas en `clubEnElPerfilAjeno.test.js`.
  3. ~~Dieciocho comprobaciones manuales del checklist del rediseño nunca se corrieron.~~ **Se corrieron, y se aprobaron las dieciocho el 2026-09-04.** Este punto nunca debió existir: nació de leer la sección «18 puntos bloqueados» del handoff del rediseño sin leer la de más abajo, donde el mismo documento dice «**18 de 18 controles aprobados**» y detalla cada uno con su medición. La evidencia está trasladada a [Pruebas](pruebas.md).
- **Y una lección sobre la limpieza, porque el error fue mío:** al retirar `HANDOFF_CLUBES.md` en la limpieza del 2026-09-30 se movió a esta nota la sección equivocada —la de arriba, ya derogada— y con el archivo se fue la evidencia que la contradecía. Un pendiente falso sobrevivió seis semanas y estuvo a punto de costar un recorrido entero repitiendo trabajo ya hecho. **Lo que se mueve de un informe que se borra es su estado FINAL, no la primera sección que lo mencione**; si el documento es largo, hay que leerlo hasta el final antes de resumirlo.
- **Verificación necesaria:** ninguna. Los tres puntos están cerrados: (1) el 2026-10-04, (2) el 2026-10-01 y (3) el 2026-09-04.

## Resuelto el 2026-09-30 — `push_tickets` ya no tiene privilegios de cliente

- **Dominio afectado:** avisos y push; superficie de la API.
- **Qué pasaba:** el advisor marca ocho tablas con RLS activa y **cero políticas** —`fairplay_reportes`, `fairplay_revisiones`, `feature_flags`, `perfil_telefonos`, `push_tickets`, `truescore_config`, `truescore_reclamos` y `truescore_reclamo_confirmaciones`—. Siete eran correctas por diseño, con doble candado: RLS sin políticas y ni un `grant` al cliente. `push_tickets` era la excepción: conservaba `select`, `insert`, `update`, `delete` y `truncate` para `authenticated`, y `select` para `anon`. No era un agujero —RLS activa sin ninguna política niega todo, y se comprobó que la tabla es de `postgres` y que `authenticated` no tiene `bypassrls`—, pero el permiso y la política decían cosas distintas sobre la misma tabla, y el `truncate` no pasa por RLS. La migración 38 que la creó ya dejaba escrito que «nunca el cliente» la toca; lo que faltaba era que los privilegios lo dijeran también.
- **Resolución:** migración **141**, `revoke all on public.push_tickets from public, anon, authenticated`, una sola tabla a propósito. `push_tokens` y `notifications` tienen la misma forma de permisos y ahí sí corresponde, porque la app registra su token y lee sus avisos por políticas que existen.
- **Verificación de cierre (2026-09-30):** ensayo completo dentro de `begin; … rollback;` contra producción, con **control negativo** que dejó ver el cambio exacto: antes, con sesión iniciada, el `select` estaba permitido y devolvía cero filas por RLS y el `insert` moría con «new row violates row-level security policy»; después, los dos mueren con «permission denied for table push_tickets». El arnés `141_los_tickets_del_push_no_son_del_cliente_test.sql` llegó a su última línea **8/8** dos veces: con la migración en la misma transacción y otra vez contra el esquema ya aplicado. Cubre los siete privilegios de cada rol, que `service_role` conserve los suyos —es quien inserta desde `send-push`—, que una función `security definer` de `postgres` siga leyendo la tabla (el camino de `check_push_receipts()`), que esa función siga sin ser ejecutable por el cliente, y que `push_tokens` y `notifications` no se hayan movido.
- **Lo que el advisor sigue diciendo, y por qué está bien:** las ocho tablas siguen apareciendo como `rls_enabled_no_policy`. Es el diseño: ninguna la toca el cliente, y ahora las ocho se defienden igual.

## Notas relacionadas

- [Estado actual](estado-actual.md)
- [Pruebas](pruebas.md)
- [Base de datos](../arquitectura/base-de-datos.md)
- [Avisos y push](../funcionalidades/avisos-y-push.md)
