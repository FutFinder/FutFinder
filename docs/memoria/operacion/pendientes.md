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

## P1 — Falta construir una base nueva desde el repositorio y comprobar que funciona

> **El repositorio ya describe todo lo que la base tiene (migración 146, 2026-10-01).** Lo que queda no es escribir: es construir una base vacía desde `supabase/` y ver que levanta. Eso necesita un PostgreSQL local, que la Mac donde se cerró esto no tiene.

- **Lo que se cerró:** se cruzó el catálogo ENTERO contra todas las migraciones y `schema.sql`, buscando la sentencia que crea cada objeto. El inventario real era **mayor** que el de esta nota: 4 tablas (`canchas`, `notifications`, `push_tokens`, `ratings`), 8 funciones (`norm_text`, `search_canchas`, `recalc_user_ratings`, `tg_ratings_recalc`, `create_notification`, `tg_match_future_only`, `tg_notify_friend_request`, `tg_notify_friend_accept`), **8 disparadores**, 2 columnas de `profiles` y 3 cron. Los describe la migración 146.
- **Los ocho disparadores son el hallazgo que esta nota no tenía**, y es el peor de los casos: seis de sus funciones SÍ estaban versionadas, pero su `create trigger` no. En una base nueva la función existiría y **nadie la llamaría** — todo compila, nada falla, y las reglas simplemente no se aplican. Lo fija el caso 3 del arnés, que comprueba que cada disparador apunte a su función.
- **La 146 no toca nada de lo que ya existe.** Cada objeto va detrás de su comprobación de existencia y no se usa `create or replace function`, que habría reemplazado el cuerpo desplegado por la transcripción. Comprobado con una huella md5 de todo el catálogo de `public` —columnas con tipo y default, restricciones, índices, políticas, disparadores, cuerpos de función y cron— **idéntica antes y después** de aplicarla: `e1baa073…`.
- **Dos cosas quedan fuera a propósito**, y están explicadas en el archivo: `notifications_type_check` (la lista de 53 tipos de aviso, que catorce migraciones posteriores fueron ampliando; copiarla fijaría una versión vieja) y `ratings_insert_eligible` (la migración 124 la reescribió para exigir que el partido no esté cancelado). En una base nueva las pone la migración que corresponda.
- **Verificación necesaria para cerrar esto del todo:** levantar una base vacía corriendo `supabase/migrations/` en orden y comprobar que no falta ningún objeto y que las pruebas SQL pasan. Hasta entonces, lo que está demostrado es que el repositorio lo describe y que aplicarlo sobre producción no cambia nada — no que el resultado arranque.

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

## P1 — Validar el envío push de extremo a extremo en dispositivo físico

- **Dominio afectado:** avisos y push.
- **Evidencia:** `send-push` tiene pruebas de lógica y SQL, mientras que el registro de push nativo se omite en web y simuladores; la entrega final depende de permisos, Expo, tokens, webhook y cron remotos.
- **Acción:** configurar el archivo de servicios Android/secretos EAS y los servicios remotos autorizados; probar registro, preferencias, recepción y tratamiento de token inválido en hardware físico.
- **Verificación necesaria:** una matriz Android/iOS en dispositivos físicos confirma permisos, token, una categoría permitida, una bloqueada por preferencia y la recuperación ante token inválido. Las pruebas web no cierran este pendiente.
- **No se puede avanzar desde la Mac en la que se trabaja hoy:** no tiene Xcode ni el SDK de Android, así que ni siquiera se llega a un build para instalar.

## P1 — Falta decidir quién modera, y después las pantallas

> **El mecanismo ya está (migración 151, 2026-10-01) y el padrón nace VACÍO.** Mientras nadie esté en él no cambia nada. Lo que queda es una decisión tuya y, después, las pantallas.

- **Lo que quedó listo:** la tabla `moderadores` —sin privilegios de cliente: ni la app la lee ni puede nombrar a nadie—, `es_moderador()` como única fuente de la pregunta, `moderacion_cola()` con las tres colas en una llamada, `moderacion_resolver_revision()` como puerta con nombre sobre la función de la 47c, y `moderacion_reabrir_resultado()`.
- **Nombrar a alguien es un `insert` desde el panel:** `insert into public.moderadores (user_id, nota) values ('<uuid>', 'por qué');`. Es la única parte que queda en manos de una persona, a propósito.
- **Lo que sigue sin existir, y es lo que decides tú:** quién modera. La nota original ya lo acotaba —rol propio, no `admin` de club, porque quien modera no puede ser parte interesada— y el padrón respeta eso sin elegir a nadie.
- **Y después, las pantallas:** una bandeja que lea `moderacion_cola()` y dos acciones. No se construyeron porque sin rol no hay a quién mostrárselas.
- **Un dato medido que le hace falta a quien construya esa pantalla:** quien modera **no ve el hilo** del desafío que modera. `club_challenge_events_read` exige `chat_puede_ver_desafio()`, y quien modera no pertenece a ninguno de los dos clubes — que es justamente lo que lo hace imparcial. Se comprobó: ve 0 eventos. Por eso `club_sanction_reviews.contexto` ya guarda el expediente copiado al pedir la revisión; la pantalla usa eso, o necesita su propia puerta `security definer`.
- **Sigue en pie la obligación operativa:** nadie recibe un aviso cuando llega una revisión. Hasta que exista la bandeja hay que mirar la cola a mano — ahora con `select public.moderacion_cola();`, que además trae los resultados en disputa y los reportes sin mirar.
- **Cómo se resuelve HOY, sin pantalla:** nombrarse en el padrón y llamar `moderacion_resolver_revision('<review_id>', 'retirar' | 'mantener', 'nota')`; o seguir con `resolver_revision_sancion(...)` desde el panel con `service_role`, que no cambió. La diferencia es que por la puerta nueva queda registrado **quién** decidió, y por la vieja `resuelta_por` queda en null.
- **Verificación: arnés 9/9.** Mide las dos mitades: con el padrón vacío nadie modera, la cola está cerrada, reabrir está cerrado y el desafío no se mueve; con alguien nombrado, modera, ve las tres colas con datos reales, reabre y deja su evento. Y los dos bordes: nombrar a uno **no** le abre la puerta a otro, y no se reabre lo que no está en disputa.

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

## P3 — El nivel de un encuentro entre clubes no se acuerda en ninguna parte

- **Dominio afectado:** desafíos entre clubes y el historial del club.
- **Evidencia (comprobada el 2026-08-17 contra `jvfoendzblkoxvwvommz`):** `club_challenges` no tiene columna de nivel, `club_challenge_proposals` tampoco —se acuerdan fecha, cancha, modalidad, cupos, método de inscripción y cuota— y `aprobar_propuesta()` (migración 44) crea el `matches` sin `nivel`, así que queda el `default 'recreativo'` de la tabla. Los partidos de clubes que existen —**9** al 2026-09-30, eran 7— están todos en `recreativo`, ninguno por elección. Comprobado ese día: ninguna de las dos tablas tiene columna de nivel.
- **Por qué importa:** la Tarea 6.2 mostraba ese campo en la tarjeta del historial como «tipo de partido», así que un encuentro competitivo se leía «Recreativo». Es un valor por defecto disfrazado de dato, exactamente lo que la 6.2 vino a quitar del historial. En la 6.3 se dejó de mostrar: `historial_club()` sigue devolviendo la columna, pero el cliente no la pinta (ver `NIVEL_POR_OMISION` en `src/utils/historialClub.js`).
- **Acción:** decidir si el nivel se acuerda en la propuesta —quién lo elige, si se negocia como la hora y la cuota, y si condiciona algo— y sólo entonces agregarlo. Volver a mostrarlo son dos líneas: `tipoLabel` en `normalizarPartido()` y la prop en `MatchHistoryCard`.
- **Verificación necesaria:** un encuentro creado con nivel competitivo se lee «Competitivo» en el historial de los dos clubes, y uno anterior a ese cambio no miente.

## P4 — `historial_publico_club()` quedó sin consumidor

- **Dominio afectado:** base de datos y la futura página pública de un club.
- **Evidencia:** la creó la migración 44d como la proyección estrictamente pública de un partido de clubes terminado (clubes, día, marcador y V/E/D) y la 48 le rellenó el marcador. Desde la 49, la aplicación lee el historial con `historial_club()`, que devuelve más —escudos y nivel— y reserva la hora exacta y la cancha para los integrantes de los dos clubes. Ninguna pantalla, servicio ni Edge Function llama ya a `historial_publico_club()`; sólo la usan `44d_partido_privado_test.sql` (caso 15) y `49_historial_test.sql` (caso 5), que la comparan a propósito.
- **Por qué NO se elimina:** sigue siendo el contrato que fija qué es público de un encuentro terminado, y `clubs.slug` existe desde la migración 11 «para la futura página pública `futfinder.com/club/<slug>`», donde el visitante es `anon` — el caso exacto que esta función atiende. Retirar una función aplicada porque hoy no tiene quien la llame es perder la referencia sin ganar nada; su coste es una función `stable security definer` de sólo lectura.
- **El detalle que hay que recordar si se usa:** su `join` contra `club_match_results` es `left`, así que publica cualquier partido `finalizado` **aunque nadie haya confirmado el marcador**, con los goles en `null`. `historial_club()` hace ese join interno justamente para no publicar un partido como jugado sin resultado. Quien construya la página pública tiene que elegir una de las dos a conciencia.
- **Acción:** al construir la página pública del club, decidir si se usa `historial_club()` para todo —recomendado, ya funciona para `anon`— y, si es así, retirar `historial_publico_club()` con una migración nueva que también actualice el caso 15 de la prueba de la 44d. Nunca editando la 44d.
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

## P3 — Resolver o aceptar explícitamente la ausencia de mapa en web

- **Dominio afectado:** descubrimiento de partidos en web.
- **Evidencia:** `MatchMap.web.js` devuelve `null`; la variante nativa utiliza `react-native-maps` y la lista con filtros se conserva en web.
- **Acción:** decidir si la lista/filtros es el alcance web definitivo o implementar una alternativa de mapa compatible.
- **Verificación necesaria:** prueba manual de búsqueda de partidos en navegador documenta la experiencia acordada y, si se implementa un mapa, cubre selección y cambio de región.

## Resuelto el 2026-10-01 — una cancha en (0, 0) no es una cancha

- **Qué pasaba:** `crear_propuesta_oficial` (43c), `aprobar_propuesta` (44) y `cambio_partido_revisa_campos` (46) validaban la latitud y la longitud **por rango**, y (0, 0) cae dentro. En esta app ese par nunca es una cancha: es la marca de que no se eligió ninguna, porque `Number(null)` es 0 en JavaScript. El cliente ya lo rechazaba —`construirCampos()` en `src/utils/cambioPartido.js`— así que la única vía era llamar la RPC a mano. **Comprobado antes de arreglar:** un `insert` directo en `matches` con (0,0) era aceptado.
- **La regla es la del cliente, no una nueva.** Se rechaza el par exacto, no «un punto dentro de Chile». Lo segundo sería más estricto que el cliente y volveríamos a dos reglas distintas según por dónde entre la cancha, que es lo que este pendiente pedía evitar. Si algún día se exige territorio, se cambian los dos lados a la vez.
- **Resolución (migración 145):** cuatro restricciones `check` en vez de editar las tres funciones. Una regla declarativa por tabla, no tres copias de un `if` dentro de cuerpos de 12 KB que pueden divergir — y la divergencia era el problema. Cubre además a **todo** el que escriba, no sólo a esas tres funciones: `matches` también lo escribe la publicación de un partido normal, que tenía el mismo agujero y nadie lo había mirado. Van en `club_challenge_proposals` (corta la propuesta en la fuente, así que `aprobar_propuesta` nunca ve una en cero), `matches` —se comprobó que `aproximar_grado(0)` es `0.00`, o sea que el cero sobrevive al redondeo del punto aproximado—, `club_match_locations` (la ubicación exacta de la 44b) y `club_match_changes.campos` (la cancha anidada en el jsonb).
- **Lo que se acepta a cambio:** el rechazo llega como violación de restricción (23514) y no como un `ok:false` con texto en español. A esta ruta sólo se llega llamando la RPC a mano, saltándose la pantalla que ya explica bien el error.
- **Verificación:** arnés `145_..._test.sql` **8/8**, en el ensayo revertido y otra vez contra el esquema aplicado. Cubre las dos direcciones —rechaza (0,0) y **sigue aceptando** una cancha real de Santiago—, que un punto con **un solo cero** se acepta (la marca es el par, no un cero suelto), que un cambio de sólo hora no queda bloqueado, y que las coordenadas en texto pasan la restricción a propósito, porque de eso se encarga la validación de tipo de la función. Antes de aplicar se confirmó que no había ni una fila en (0,0) en las tres tablas: 27 partidos, 11 propuestas y 3 cambios.

## P3 — La concurrencia de los cambios negociados no tiene prueba de dos sesiones

- **Dominio afectado:** cambios negociados del partido entre clubes (migración 46).
- **Evidencia:** el invariante lo sostienen tres piezas de la base —`select … for update` sobre el partido, el índice único parcial `club_match_changes_pendiente_uidx` y el `update … where estado = 'pendiente'`—, pero `46_cambios_de_partido_test.sql` corre en UNA sola sesión: prueba que el invariante se cumple, no la carrera real.
- **Acción:** repetir el arnés de dos sesiones simultáneas que se usó en U3 (`FOR UPDATE NOWAIT`) para dos aceptaciones a la vez y para dos solicitudes a la vez.
- **Verificación necesaria:** con dos sesiones, sólo una aceptación aplica el cambio y sólo una solicitud queda pendiente; la otra recibe el rechazo esperado y no deja fila.

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

## P3 — Cada partido publicado deja una fila en `public.canchas` que su autor no puede borrar

- **Dominio afectado:** directorio de canchas y datos de prueba.
- **Evidencia (auditoría de Partidos del 2026-09-15):** el trigger `trg_register_cancha` crea una entrada en `public.canchas` por cada partido publicado, y la cuenta que la creó no tiene permiso para eliminarla. Las entradas que dejaron esa auditoría y las comprobaciones posteriores se borraron a mano desde el panel.
- **Por qué importa:** el directorio acumula residuos de partidos de prueba y de canchas escritas con error, sin ninguna vía de limpieza dentro de la app. Además, esa FK sin cascada ya tapó un fallo real en el arnés de concurrencia de la agenda (ver `pruebas.md`).
- **Acción:** decidir si el directorio se cura (dueño, permiso de borrado o baja lógica) o si el trigger deja de escribir por cada partido. Va emparentado con el P1 de arriba: `canchas` y `tg_register_cancha` tampoco están versionados.
- **Verificación necesaria:** publicar y borrar un partido de prueba no deja fila huérfana, o existe un camino documentado para retirarla.

## P4 — Restos del rediseño de Clubes que nunca se cerraron

- **Dominio afectado:** portada y ficha de club, perfil público.
- **Contexto:** el rediseño se integró a `main` —`src/contexts/ClubsHomeContext.js`, `ClubsScreen`, `clubsHomeTasks.js`— y la rama `rediseno/portada-clubes` ya no existe. De su handoff quedaron tres cosas sin cerrar; las otras dos que anotaba (el `window.confirm` de salir del club y los `role="radio"` sin `aria-checked`) **sí** se corrigieron y se comprobó que ya no están en el código.
- **Lo que sigue abierto:**
  1. `ClubDetailScreen.js:346` navega a `EditClub` pasando el club como objeto. Funciona en memoria, pero el enlace no sobrevive a compartirse ni a una recarga profunda en web.
  2. ~~El perfil público de un administrador de club muestra «CLUB — Sin club».~~ **Corregido el 2026-10-01.** No era privacidad deliberada ni un hueco de datos: `ProfileScreen` calculaba `clubActual = isOwnProfile ? misClubs[0]?.club?.nombre : null`, así que en un perfil ajeno **siempre** valía `null` y la ficha imprimía «Sin club» sin haberlo consultado nunca. La guarda tampoco era tonta —`misClubs` son MIS clubes, cargados ahí para «Invitar a mi club», y usarlos habría mostrado mi club en el perfil de otro—: lo que faltaba era consultar los suyos. Lo hace `getClubesDe(userId)`, que además distingue «no pertenece a ninguno» de «no pudimos leerlo», y en ese segundo caso la ficha dice «N.A.» y no «Sin club». Comprobado en la app: el perfil de `@vicenteee` muestra «Los Papi Pasty», y el perfil propio sigue igual. Seis pruebas nuevas en `clubEnElPerfilAjeno.test.js`.
  3. Dieciocho comprobaciones manuales del checklist del rediseño nunca se corrieron: E6–E9 (varios clubes y persistencia), H5–H6 (pila de navegación), K1 (los cuatro temas), L1–L2 (error total), M2–M6 (responsive), C3–C4, D7 y N3. Necesitan sesión iniciada y datos sembrados.
- **Verificación necesaria:** para (1), que `EditClub` se abra desde una URL con el identificador del club; para (2), mirar el perfil público de una cuenta administradora antes de decidir; para (3), recorrer los dieciocho puntos con datos sembrados.

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
