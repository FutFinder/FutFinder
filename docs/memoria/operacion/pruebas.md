# Pruebas

Última revisión: 2026-09-23

## Comprobaciones locales del proyecto

```bash
npm test
```

Ejecuta las pruebas de Node de `src/**/__tests__/*.test.js`: utilidades de chat, privacidad de amistades, bandeja y preferencias de avisos, destinos de avisos, edición de perfil, rutas y búsqueda.

```bash
npm run build:web
```

Genera la exportación web de Expo y detecta fallos de empaquetado o compatibilidad web. No ejecuta las pruebas SQL ni valida servicios remotos.

## Pruebas SQL de RLS y contratos de base de datos

Los archivos `supabase/tests/35_privacy_test.sql`, `36_chat_security_test.sql`, `38_push_reliability_test.sql`, `39_chat_mention_all_test.sql`, `40_bandeja_chat_rpc_test.sql`, `41_desafio_ciclo_test.sql`, `42_desafio_chat_rls_test.sql`, `43_desafio_plazos_test.sql`, `43c_propuesta_ubicacion_test.sql`, `43d_rechazo_doble_pertenencia_test.sql`, `44_partido_clubes_test.sql`, `44b_ubicacion_protegida_test.sql`, `44c_notify_match_updated_test.sql`, `44d_partido_privado_test.sql`, `44e_attendees_solo_por_rpc_test.sql`, `45_inscripcion_por_club_test.sql`, `45b_origen_compatibilidad_test.sql`, `45c_reserva_voluntaria_test.sql`, `45d_escritores_attendees_test.sql` , `46_cambios_de_partido_test.sql`, `47_cancelacion_y_sancion_test.sql`, `47b_valida_sancion_sin_execute_test.sql`, `48_resultado_test.sql`, `49_historial_test.sql`, `50_una_sola_puerta_test.sql` y `53_tema_del_club_test.sql` verifican privacidad, RLS de chat, fiabilidad de push, `/todos`, la RPC de bandeja y el ciclo de desafíos entre clubes hasta inscripción, reservas, nómina por club, cambios negociados, cancelación con sanción, el resultado del encuentro, el historial real del club, las dos puertas por las que un encuentro entre clubes NO se cierra ni se cancela y quién puede cambiar el tema de color de un club.

`53_tema_del_club_test.sql` corrió **9/9 el 2026-08-21**, contra el esquema con la 53 ya aplicada. Se comprobó además que su `ROLLBACK` no dejó rastro —ni los cuatro usuarios de prueba, ni los dos clubes, ni una membresía de más— y se pasó un CONTROL NEGATIVO: el mismo arnés afirmando algo falso a propósito (que el club nace en `blue`) revienta con `P0001`. Sin ese control, «terminó sin error» no distingue un arnés que pasa de uno que no comprueba nada. Sus nueve casos separan las dos cosas que la interfaz confunde con facilidad: que el CHECK rechace un valor inventado o un HEX (casos 5 y 6, medidos por `check_violation` y no por «algo falló») y que la RLS deje el UPDATE en 0 filas para un integrante sin rol admin, para un ajeno y para el administrador de otro club (casos 3, 4a y 4b). El caso 9 comprueba lo contrario, que cualquiera pueda LEER el tema: sin eso, el resto de la gente no vería el color nuevo al recargar el club.

`48_resultado_test.sql` corre 19 casos con DOS encuentros entre el mismo par de clubes: el primero termina en disputa (rechazo) y prueba, entre otras cosas, que ni el proponente ni el contrario pueden proponer un resultado nuevo mientras el desafío sigue en `resultado_en_disputa` (caso 11) — la regla que la migración 48b vino a corregir, porque la 48 sí lo permitía. El segundo encuentro, sin disputa, es el único camino para llegar a `confirmado` y comprobar que `club_record()` y `historial_publico_club()` sólo cuentan ese resultado y no el 3-1 rechazado del primero (casos 17 y 18). Se corrió completo dos veces contra el esquema real: 19/19 antes de aplicar la 48b (con la corrección todavía sólo en un ensayo con `rollback`) y 19/19 después de aplicarla de verdad. El arnés de la 47 corre 25 casos. Antes de aplicar la migración se ejecutó con la propia 47 dentro de la misma transacción, y después de aplicarla se repitió solo, 25/25 las dos veces; midió el Trust Score del jugador inscrito y del administrador antes y después de sancionar para comprobar que la sanción es del club, y exige que los bloqueos de crear, aceptar y proponer fallen con un mensaje que diga «sancionado», no con cualquier error, porque un fallo de RLS daría el caso por bueno sin haber probado nada. El de la 47b son 5 casos y su valor está en el tercero: comprueba que quitarle el `EXECUTE` a la función de trigger no la deja de disparar. Los dos primeros casos —privilegios y trigger instalado— no bastarían: si PostgreSQL comprobara ese privilegio en cada disparo, la revocación habría desactivado la regla sin romper ninguna pantalla. El quinto cierra la trampa contraria, que un trigger que rechazara SIEMPRE también pasaría los casos 3 y 4. `47c_incomparecencia_y_revisiones_test.sql` cubre la incomparecencia y la revisión de sanciones con 26 casos, y a diferencia del arnés de la 47 **no reutiliza ningún partido de la base**: crea sus cuatro clubes, sus dos encuentros y su gente dentro de la transacción, porque necesita un partido con la hora ya pasada y moverle la hora a un partido real —aunque sea dentro de una transacción— es tocar datos de prueba que alguien está usando para otra cosa. Su caso 17 es el que sostiene toda la unidad: un `authenticated` que llama `resolver_revision_sancion` recibe `permission denied`, y se exige ese mensaje y no cualquier error, porque un fallo de RLS daría el caso por bueno sin haber probado nada. Los casos 5, 6 y 7 fijan la ventana de 24 horas por los dos bordes —antes de la hora no, a las 25 horas tampoco, a las 23:30 sí—; el 11 comprueba que cada club puede acusar al otro y quedan dos informes y dos sanciones, uno por club acusado; y el 8 fija lo que NO pasa al informar: el desafío sigue publicado y el hilo abierto, porque el congelado empieza cuando alguien pide la revisión (caso 14) y termina cuando se resuelve la última (casos 19 y 20).

`49_historial_test.sql` corre 13 casos sobre el historial real, 13/13 contra el esquema ya aplicado. Los tres que sostienen la unidad son el 5, el 2 y el 3. El 5 comprueba las DOS funciones a la vez: un partido `finalizado` sin resultado confirmado no aparece en `historial_club()` **y sí** en `historial_publico_club()`, de modo que la diferencia que justifica la migración 49 queda medida y no supuesta. El 2 y el 3 leen la MISMA fila desde los dos clubes —3-1 es V para el local y D para el visitante; 0-2 es V para el visitante y D para el local— porque asumir que el club consultado es el local invierte la mitad del historial y una derrota mostrada como victoria no se ve como un error, se ve como un dato. Los pares de clubes del arnés no son decorativos: `club_challenges_unique_activo` admite un solo desafío activo por par y `esperando_resultado` está entre los estados que cuenta, así que el encuentro del resultado propuesto se juega contra un tercer club, que de paso queda como el caso del historial vacío. Del lado del cliente, `src/utils/__tests__/historialClub.test.js` son 28 casos e incluye tres que no miran datos sino archivos: que el `join` de la migración no vuelva a ser `left`, que `club_estadisticas()` siga delegando en `club_record()`, y que ningún archivo de `src/` mencione `getDemoMatchHistory`, `usarHistorialDemo` ni `DEMO_HISTORIAL` — es lo único que impide que los fixtures vuelvan por la puerta de atrás. Una de esas pruebas encontró un fallo real antes de llegar a producción: `Number(null)` es 0, así que un marcador nulo se leía como un 0-0 y un partido sin confirmar aparecía como empate, justo lo contrario de lo que la tarea venía a arreglar.

`50_una_sola_puerta_test.sql` corre 8 casos y **prueba las dos direcciones**, que es lo que le da valor: que `save_match_attendance()` y `cancel_match()` rechacen un partido nacido de una propuesta (casos 1 y 4) y que sigan funcionando igual en un partido NORMAL (casos 3 y 5), porque una guarda que además rompe el flujo que sí debía pasar no es una corrección. Los dos partidos de clubes se preparan DENTRO de la ventana de 72 horas de asistencia y con el organizador correcto, y se exige que el motivo diga «entre clubes»: sin eso, un fallo de plazo o de permiso habría dado los casos por buenos sin probar la guarda nueva — la misma lección que la 47 y la 47c. El caso 2 comprueba que el intento rechazado no dejó rastro: el partido no quedó `finalizado`, el inscrito sigue `inscrito` y su Trust Score sigue en 100. El 6 y el 7 leen el aviso y el motivo de error del rechazo para comprobar que ya no dicen «Propongan uno nuevo», y el 8 vuelve a fijar la regla de la 48b junto al récord en 0-0-0. **Los tres arneses del resultado se corrieron de nuevo el 2026-08-17 después de aplicar la 50 y la 50b: 48 19/19, 49 13/13 y 50 8/8**, cada uno en su transacción y todos terminados en `rollback`. Antes de correrlos se comprobó que las tres funciones desplegadas fueran **byte a byte** las del repositorio, comparando `md5(prosrc)` contra el archivo de la migración: es la única forma de saber que un `create or replace` copiado a mano no introdujo un cambio invisible.

Del lado del cliente, la Tarea 6.3 añadió pruebas para lo que corrigió: las tres frases de los eventos del resultado en `resultadoRpc.test.js` —con el marcador anclado a «local-visitante», sin `undefined` cuando el payload no trae goles, y comprobando que la burbuja del hilo use esas funciones y no los textos fijos que ignoraban el payload—, y en `historialClub.test.js` el resumen compartido de estadísticas, el tope real de la RPC, que «Ver todo» ya no navegue a `ClubChallenges`, que la ruta `ClubHistory` exista de verdad en el navegador —un `navigate` a una pantalla no registrada no falla al compilar, falla al tocarlo—, que la tarjeta no ofrezca destino a quien no es del club, y que ninguna de las dos pantallas confunda «no se pudo leer» con «no hay partidos». Varias de esas pruebas leen archivos como las demás leen migraciones: es lo único que impide que el enlace equivocado o el texto fijo vuelvan.

**Los arneses no son inmunes a los datos reales.** Al preparar la 47c, el de la 47 falló dos veces por la comprobación manual de la U5.1, sin que el código hubiera cambiado: toma el ÚLTIMO partido de clubes que exista —que pasó a ser uno de los P51, ya cancelado de verdad— y dos de sus conteos no estaban acotados a ese partido. El caso 9 contaba los `club_match_cancelled` de un administrador real sin filtrar por `matchId`, y el 15 contaba los eventos `encuentro_cancelado` de un desafío que ya traía uno. Se corrigieron acotando los conteos al partido de la prueba y borrando la bitácora del encuentro dentro de la transacción, junto a las sanciones que ya se borraban. Es el precio de reutilizar datos reales, y la razón por la que el arnés de la 47c crea los suyos. **Tras aplicar la 47c el 2026-08-15 los tres se corrieron de nuevo contra el esquema ya aplicado, uno por transacción y todos terminados en `rollback`: 47c 26/26, 47 25/25 y 47b 5/5**, sin dejar informes, revisiones, clubes ni usuarios de prueba, y con el partido protegido, `chatgpt`, `chatgpt2` y los tres clubes P51 intactos —éstos últimos de vuelta en plan `estandar`, que es la prueba directa de que el `rollback` deshizo hasta las escrituras del arnés sobre filas reales—.

**La comprobación manual de la 5.2 encontró lo que ninguna prueba SQL podía ver, y por segunda vez en esta fase.** El servidor tenía todo bien —las dos sanciones provisionales, los dos informes, el congelado y su reverso— pero el hilo leía sanciones, informes y revisiones sólo al montar y después de una acción PROPIA, así que tras la acusación cruzada el club acusado no veía «Solicitar revisión» hasta recargar la página. La premisa venía de la 47 y la 47c la invirtió: informar deja la sanción sobre el club CONTRARIO, y la resolución no la ejecuta ninguna de las dos sesiones. Corregido en `90e8f92` y cubierto por `src/utils/__tests__/expedienteSancion.test.js`, que es la primera prueba de este repositorio que simula DOS sesiones a la vez: monta un cliente con la forma de PostgREST sobre una base en memoria con la RLS de la 47c aplicada a mano, y hace correr los cargadores reales, el sondeo real con su intervalo por defecto y `accionesDeRevision()` tal como los llama la pantalla. La sanción se escribe en la base falsa —que es lo que hace el servidor al informar— y tiene que llegar hasta el botón sola; pasársela a la función que decide el botón habría probado lo único que nunca estuvo roto. Dos de sus casos leen `ChatThreadScreen.js` como los demás leen las migraciones, y fijan que el sondeo siga pasando por el expediente: es lo único que las otras no pueden demostrar, y sin ello el fallo vuelve entero el día que alguien lo saque del refresco periódico. Repetida la comprobación el 2026-08-17, pasó entera y **U5.2 quedó cerrada**.

**Hay fallos que una sola conexión no puede reproducir, y conviene que el arnés lo diga.** Las migraciones 122 y 123 (revisión del 21 de septiembre) tienen sus arneses SQL —`122_una_salida_y_una_asistencia_se_cobran_una_sola_vez_test.sql` (19/19) y `123_mover_el_partido_avisa_y_mira_la_agenda_test.sql` (10/10), corridos primero con la migración dentro de la misma transacción y después contra el esquema aplicado, y los dos juntos en una sola transacción para ver que no se estorban—, pero lo que esos arneses miden de la concurrencia es el MECANISMO, no la carrera: que el segundo intento caiga en «esto ya estaba hecho» y que la fila del partido quede bloqueada aunque la operación se rechace, comprobado leyendo el `xmax` de la fila dentro de la misma transacción. La carrera de verdad —dos transacciones abiertas a la vez, la segunda leyendo antes del COMMIT de la primera— está en `supabase/tests/partidos_salida_concurrente_test.cjs`, que además de contar el efecto exige que la segunda sesión ESPERE (`wait_event_type = 'Lock'` en `pg_stat_activity`): sin eso, un arnés pasaría igual con un `if` optimista. Necesita PostgreSQL local, igual que el de la agenda del jugador (`partidos_horario_concurrente_test.cjs`, migración 109); **los tres `.cjs` de concurrencia se corrieron por primera vez el 2026-09-23 en la Mac de Johan** (ver más abajo): salida 4/4.

`125_la_otra_puerta_de_la_salida_test.sql` (16/16) es el que salió de revisar lo que el informe NO había mirado: la salida por `swap_match`. Antes de escribir el arreglo se corrió un **control negativo** contra la función desplegada, y el fallo se reprodujo tal cual —`ok=true`, `penalty=3`, el partido cancelado de vuelta en `abierto` y el jugador de 80 a 77—. Ese control es lo que separa «el arnés pasa» de «el arnés mide algo»: sin él, dieciséis casos en verde no distinguen una corrección de una función que nunca estuvo rota.

`124_no_se_califica_un_partido_que_no_se_jugo_test.sql` (3/3) prueba una POLÍTICA y no una función, y por eso necesita sus dos direcciones: que un partido jugado se siga pudiendo calificar (si no, la corrección sería un candado) y que uno cancelado ya no. La revisión que lo pidió decía explícitamente que no había comprobado si el servidor aceptaba esas evaluaciones; leer `pg_policy` antes de escribir nada mostró que sí las aceptaba, y el arnés lo deja fijado.

`128_los_avisos_automaticos_miran_el_estado_test.sql` (12/12) corre los DOS cron de verdad, no una copia de su consulta. Para que no arrastren partidos reales que caigan en la ventana, lo primero que hace es marcarlos como ya avisados dentro de la misma transacción; el `rollback` lo devuelve todo. Su control negativo contra las funciones vivas reprodujo tres fallas —el partido lleno sin recordatorio, el aviso de calificar en un partido cancelado y la salida de un encuentro cancelado sumando un cupo— y **dejó ver un caso que pasaba por la razón equivocada**: «al pendiente no le llega el recordatorio» salía verde con la función vieja sólo porque el partido lleno no entraba al bucle. Con el arreglo, ese caso recién mide lo que dice.

`127_cancelar_para_cambiarse_no_borra_el_partido_test.sql` (16/16) dejó su propia lección sobre QUIÉN LEE. Su primera versión falló cuatro casos y ninguno era de la migración: comprobaba los avisos de otro usuario y la nómina de un partido entre clubes mientras suplantaba a un jugador, así que la RLS le devolvía cero filas y el arnés lo leía como «no se avisó» y «el encuentro se borró». Las acciones van como `authenticated`; las comprobaciones, después de `reset role`. Es el mismo error de fondo que el `set local role anon` que no borra las claims: medir con el lente puesto.

`126_la_reprogramacion_no_se_llama_a_mano_test.sql` (3/3) repite la lección de la 47b sobre la función de trigger nueva: revocarle el `EXECUTE` a `authenticated` no la desactiva, y el arnés vuelve a mover una hora conflictiva para demostrarlo en vez de suponerlo. Sin ese caso, el privilegio revocado se vería igual de bien con la validación apagada, y el fallo sería silencioso.

Los arneses de Clubes del 21 de septiembre (129 y 130) repiten la receta que ya venía funcionando: **reproducir primero contra producción**. El informe decía explícitamente que no había consultado las ACL de producción y que dos de sus tres P1 dependían de que siguiera concedida la escritura de ciertas columnas; se consultó, estaba concedida, y los tres se reprodujeron en una transacción revertida antes de escribir una línea de arreglo. `129_el_permiso_muere_con_la_membresia_test.sql` (14/14) prueba las dos direcciones de cada uno —el expulsado ya no edita **pero el delegado que sigue en el club sí**, el plan no se toca **pero el nombre y la descripción se siguen guardando**, la invitación no se puede mover **pero sí aceptar**—, porque un candado que además rompe lo que debía funcionar no es una corrección. `130_las_membresias_del_club_se_serializan_test.sql` (4/4) sólo puede medir el mecanismo con una conexión: que la escritura tome los dos bloqueos (leyendo `pg_locks`) y que los tres topes sigan vigentes; las carreras viven en `clubes_membresia_concurrente_test.cjs`, que pasó 3/3 el 2026-09-23 (ver más abajo).

**Los tres arneses de concurrencia corrieron el 2026-09-23, y ninguno había corrido antes.** En la Mac de Johan se instaló PostgreSQL 17 (Homebrew, la misma versión mayor que producción) y se armó una base `futfinder_test_*` **copiando la estructura del catálogo de producción**, sin datos: tablas, restricciones, índices, las 219 funciones de `public`, triggers, RLS, políticas y privilegios, sobre una imitación mínima de Supabase (roles, `auth.users` y `auth.uid()`, y `vault`, `net` y `cron` falsos, que no salen a la red). No se pudo rearmar desde `supabase/migrations/`: la P1 de [Pendientes](pendientes.md) sigue abierta y faltan, entre otras, `notifications` y `ratings`. La copia se comprobó contra producción: mismos conteos de tablas, triggers, políticas y restricciones, y la misma huella md5 de las 219 funciones. Resultados: **salida 4/4, clubes 3/3 y agenda 4/5**; con la 133 aplicada, la agenda pasó a **5/5**. El control negativo de clubes (quitar `aa_club_members_serializa`) falla con «la segunda baja no esperó», así que el arnés sí mide la 130.

Hasta llegar al verde hubo que corregir cinco fallos **de los arneses**, todos del tipo «nunca se ejecutó entero»: el arnés de clubes usaba `$1` a la vez como `uuid` y como `text` (PostgreSQL rechaza la consulta con `42P08`, dos veces); todos sus clubes se llamaban igual y `clubs_nombre_ci_idx` rechazaba el segundo; la limpieza borraba la nómina antes que el club y `el_club_no_se_queda_sin_admin` lo impedía (borrar el club arrastra la nómina); y los tres arneses dejaban una fila en `canchas` —la siembra `tg_register_cancha` al crear el partido— cuya FK sin cascada impedía borrar el usuario de prueba. En el de la agenda, ese error de limpieza además **tapaba el fallo real** del caso 2.

**El fallo real es el caso 2 de la agenda y no es de concurrencia:** `approve_join` pasa la fila de `pendiente` a `inscrito` con un UPDATE, y `tg_enforce_join_rules` —donde viven el lock por jugador de la 109 y la revisión de choque— es sólo `BEFORE INSERT`. Aprobar al mismo jugador en dos partidos a la misma hora, **uno después del otro**, devuelve `ok` las dos veces. El encabezado de la 109 dice que cubre la aprobación; en producción no. Lo corrigió la 133 el mismo día (ver [Pendientes](pendientes.md)).

`133_aprobar_mira_la_agenda_test.sql` (9/9) crea sus propios usuarios, clubes, desafío, propuesta y partidos, sin tocar datos reales, y prueba las dos RPC que aprueban: `approve_join` y `confirmar_nomina_club`. Cada una se prueba en las dos direcciones: el choque se rechaza con `code = CHOQUE_HORARIO` y sin dejar rastro (la solicitud sigue pendiente, el cupo libre y sin aviso), y un partido contiguo o sin choque se sigue aprobando. El caso A7 fija lo que el `WHEN` deja afuera: la marca GPS de un jugador suspendido se guarda igual. El **control negativo** contra la estructura previa falló en cinco casos, y con `{"ok": true}` en el choque. Recorrido completo el 2026-09-23: reproducción contra producción en un bloque revertido; ensayo local con la migración en la misma transacción; los tres `.cjs` y los siete arneses relacionados que corren sin datos reales, iguales con y sin la 133; ensayo en producción de la 133 junto con el arnés de la 45 (9/9 y 14/14, revertido); aplicación; `md5(prosrc)` de las tres funciones igual al archivo, y el arnés otra vez contra el esquema aplicado, 9/9.

`141_los_tickets_del_push_no_son_del_cliente_test.sql` (8/8) prueba un REVOKE, y la lección es que un revoke se ve igual de bien que no hacer nada si sólo se miran los privilegios. Lo que lo distingue es el **control negativo con el mensaje de error**: antes de la 141, una sesión `authenticated` podía hacer `select` sobre `push_tickets` —devolvía cero filas, frenada por la RLS— y su `insert` moría con «new row violates row-level security policy»; después, los dos mueren con «permission denied for table push_tickets». Los dos rechazos son `42501`, así que el código de error no sirve para distinguirlos y el arnés compara el texto. El caso 6 es el que impide que la corrección se pase de largo: una función `security definer` de `postgres` —la misma forma que `check_push_receipts()`— tiene que seguir leyendo la tabla aunque la llame una sesión que ya no tiene ni `select`. Y el caso 8 fija lo que NO se tocó, `push_tokens` y `notifications`, porque el revoke más fácil de escribir de más es el que alcanza a la tabla de al lado.

Dos trampas al escribir estas pruebas. `set local role anon` **no borra** `request.jwt.claims`: sin poner unas claims sin `sub`, `auth.uid()` sigue devolviendo el usuario del bloque anterior y la comprobación de acceso anónimo pasa midiendo otra cosa. Y para provocar un vencimiento se envejece la fila, nunca el reloj, de modo que lo que se prueba es la comparación contra `now()` que hace el servidor.

Cada archivo se abre con `begin;` y termina en `rollback;`, así que ejecutarlo no deja filas guardadas ni siquiera si se corre contra el proyecto real — que hoy es el único que existe, porque no hay un Supabase de desarrollo separado. Lo que sí exige autorización explícita es **aplicar** una migración, no correr una prueba.

La verificación U3 del 2026-08-13 compuso también cada migración con su arnés dentro de una transacción exterior: 44e sola 8/8, 45 sola 14/14, ambas juntas 45b 13/13, 45c 18/18 y 45d 5/5. Se probó una carrera real con dos sesiones: la segunda recibió `lock_not_available` mientras la primera retenía la fila de `matches`, y ambas hicieron rollback. Tras aplicar 44e y 45 en producción se repitieron los arneses seguros —todos con su propio `BEGIN/ROLLBACK`— con los mismos resultados, más 44d 16/16. El catálogo confirmó 25 asistentes `legado`, cero NULL, ACL, Realtime y orden de triggers; la consulta final confirmó cero fixtures, objetos temporales, avisos duplicados y sesiones `idle in transaction`.

La comprobación local posterior al despliegue pasó `npm run lint` con 0 errores y 25 advertencias conocidas, `npm test` 376/376, Deno 13/13 y `npm run build:web`.

La prueba manual autenticada se hizo el 2026-08-13, con dos sesiones a la vez, y encontró un fallo de cliente que ninguna prueba SQL podía ver: la nómina pedía `profiles.nombre`, columna inexistente, y PostgREST rechazaba la consulta entera con `400 / 42703`. Corregido y cubierto por `src/utils/__tests__/nominaQuery.test.js`, que contrasta cada columna pedida contra `schema.sql` y las migraciones. Repetida la comprobación, pasó entera, incluido el corte de 720 px en Chrome a 390 × 845. Todo lo verificado es web; el render nativo en un dispositivo físico no tiene evidencia. `45_inscripcion_por_club_test.sql` se volvió a ejecutar contra producción, 14/14, y se verificó después que su `ROLLBACK` dejó la nómina idéntica fila por fila, sin usuarios ni partidos de fixture.

U4.4 lo repitió y subió la apuesta: `46_cambios_de_partido_test.sql` estuvo en 22/22 desde el primer día mientras la comprobación manual encontraba **tres** fallos, todos de cliente. Uno tumbaba el hilo entero en web (`Illegal invocation`) y sus nueve pruebas estaban en verde, porque todas inyectaban temporizadores falsos y el camino por defecto —el único que corre— no se ejecutaba nunca. Otro leía el nombre del club de una fila que nunca lo trae, y su prueba pura pasaba porque el nombre se le pasaba a mano: probaba la función, no la fuente. De ahí salen dos reglas: cuando algo se puede inyectar hay que probar **también** el valor por defecto, y una prueba que fabrica su propia entrada no dice nada sobre de dónde sale esa entrada en la aplicación — para eso las pruebas nuevas usan las formas reales de los cargadores y fijan el contrato de las fuentes contra el código y las migraciones.

U5.1 volvió a dar la razón a esa regla y añadió una vuelta más. El arnés SQL estuvo en 25/25 desde el primer día y la comprobación manual encontró igual un fallo de cliente: el hilo de un encuentro cancelado mostraba, como motivo, el de una sanción anterior del club por OTRO encuentro. La regresión que lo fija (`cancelacionEncuentro.test.js`) usa las fuentes reales del cargador —`sancionVigente()` sobre filas con la forma de `club_sanctions` y `challengeCtaContext()`, que es lo que arma `ChatThreadScreen`— y no un contexto escrito a mano. La vuelta de tuerca: escrita así, esa prueba **pasó en verde antes de existir el arreglo**, porque el `inicio_at` del fixture era posterior al «ahora» de la prueba y `sancionVigente()` devolvía null: no había ninguna sanción que mezclar. Verde por la razón equivocada es peor que rojo, y sólo se detectó porque se exigió ver el rojo antes de tocar el código. Cuando una prueba nueva pasa a la primera, la pregunta no es si el código está bien: es si la prueba está midiendo algo.

Una prueba SQL en verde no dice que la pantalla funcione. El arnés de la 45 llevaba 14/14 desde el despliegue mientras la nómina se veía vacía en las dos cuentas: el servidor estaba bien y quien mentía era el `select` del cliente. Por eso ninguna fase se cierra sólo con SQL.

**Un arnés no cuenta como escrito hasta que corre de punta a punta.** La migración 119 llegó al repositorio con el commit diciendo «escrita y probada»; al aplicarla el 2026-09-18, su arnés **falló cuatro veces seguidas**, cada una más adelante que la anterior, o sea que nunca se había ejecutado entero. Los cuatro fallos eran del arnés, no de la migración:

1. Un `update` directo sobre `club_role_permissions` mientras el arnés ya suplantaba a `authenticated` — y la propia 119 le revoca esa escritura. Moría con `42501`. Que la prueba no pudiera escribir a mano **era la migración funcionando**; la salida es pasar por la RPC, que es la puerta que la migración deja abierta.
2. Un `insert` en `club_lineups` sin `modo` ni `formacion`, las dos NOT NULL con CHECK.
3. Un `insert` en `matches` con columnas inventadas (`creado_por`, `tipo`); las reales son otras, y `tg_match_future_only` rechaza una hora pasada, así que el partido se crea a futuro y se mueve con un update.
4. Y el importante: **el caso 18 no probaba lo que decía.** Pedía que un jugador del club RETADOR aceptara su propio desafío, cuando eso lo acepta el retado. Fallaba por no pertenecer al otro club, no por faltarle `answerChallenge` — y sus sub-casos previos **pasaban vacíos**: habrían pasado igual sin la migración. Es la misma lección de U5.1 escrita otra vez: verde por la razón equivocada.

De ahí la regla, que vale tanto para una migración propia como para una que llegue de la otra Mac: **antes de aplicar, correr el arnés en la misma transacción que la migración y terminar en `rollback`**; y si ya está aplicada, correrlo contra el esquema aplicado. Hasta que el arnés llegue a su última línea sin excepción, «probada» significa «compila». Los cuatro fallos de la 119 estaban detrás unos de otros: cada arreglo destapaba el siguiente, y sólo llegar al final los sacó todos.

**Y el ensayo paga aunque la migración esté bien.** El de la 120 (2026-09-21) terminó en 22/24 y ninguno de los dos fallos era el que se esperaba: uno destapó que `authenticated` seguía pudiendo ejecutar la función validadora nueva —los privilegios por defecto de `supabase_admin` se la conceden y el disparador de la 115 sólo cierra a `public` y `anon`—, y el otro era un caso de prueba mal escrito, con un nombre de un carácter que la validación frenaba antes de llegar a lo que la prueba quería medir. El primero se arregló en la migración, el segundo en el arnés, y recién entonces 24/24. Un arnés que sale verde a la primera casi siempre está midiendo menos de lo que dice.

## Pruebas de Edge Function

La lógica pura de la función `send-push` se prueba aparte:

```bash
deno test supabase/functions/send-push/pushLogic.test.ts
```

Esa suite cubre clasificación de tickets y recibos, deduplicación/validez de tokens y preferencias de push. No invoca Expo ni un proyecto Supabase reales.

## Flujos manuales autenticados

Con una instancia de desarrollo configurada y cuentas de prueba, comprobar al menos:

- acceso a rutas privadas sin sesión y retorno al destino después de login;
- privacidad de búsqueda y solicitudes de amistad entre dos usuarios;
- permisos de chat directo, de partido y de club, lectura, silencio y `/todos` grupal;
- publicación/solicitud/gestión de partido, asistencia y estados de error;
- membresía, administración y desafío de club;
- U3 con ambos clubes: reservar o no al proponer/aprobar, publicar, inscribirse/postular, confirmar o rechazar desde el club propio, salir/retirar y observar los cambios en la otra sesión sin recargar;
- edición de perfil con una imagen válida y una operación que falle para observar la reversión;
- bandeja de avisos: lectura, borrado, reintento y navegación al destino.

## Push sólo en dispositivo físico

La validación de push nativo exige dispositivos físicos Android/iOS, permisos concedidos, configuración de Firebase/EAS y servicios remotos autorizados. Probar registro de token, cada preferencia de categoría, recepción en primer plano y arranque frío, además de un token inválido. Web y simuladores omiten el registro nativo; por tanto, ni `npm test` ni `npm run build:web` validan push nativo.

## El recorrido manual del rediseño de Clubes — 18/18 el 2026-09-04

Se rescata acá porque vivía en `HANDOFF_CLUBES.md`, que se retiró en la limpieza del 2026-09-30, y al irse el archivo se fue la evidencia: `pendientes.md` quedó afirmando durante seis semanas que estos dieciocho controles «nunca se corrieron». Sí se corrieron.

El recorrido usó Playwright con clics por JavaScript —la comprobación de estabilidad no funciona con las animaciones de React Native Web— y **0 `pageerror`** en las cuatro sesiones.

| Control | Qué se comprobó |
|---|---|
| C3 / C4 | Aceptar y rechazar una invitación, dos veces cada uno: desde el explorador y desde la tarjeta nueva |
| E6–E9 | Cambio de club activo, persistencia al salir de la pestaña, persistencia tras recargar, y caída al club restante al salir del activo |
| D7 | El último elemento termina **82 px** por encima de la barra |
| H5 / H6 | Tres idas y vueltas al detalle: siempre vuelve a la portada |
| K1 | Los cuatro temas. Los elementos que se quedan verdes son las tarjetas de rival, que usan **el tema del rival**: conducta documentada, no un fallo |
| L1 / L2 | Error total y recuperación con «Reintentar» |
| M2 / M3 / M6 | 390, 360 y 1280 px sin desborde horizontal |
| M4 | Nombre de **76 caracteres**: tres apariciones, todas con elipsis, ninguna se sale |
| M5 | El carrusel desplaza **1850 px** sobre 390 visibles |
| N3 | Chat de mensaje directo y de partido normal futuro, en los dos sentidos: historial, compositor, enviar y recibir |

**N3 necesitó una segunda pasada, y el motivo importa:** la primera no falló por el código sino porque **la base no tenía ni un solo partido futuro**, así que el único chat de partido disponible era de un partido ya jugado y en solo lectura. Es el mismo vacío de datos que sigue hoy (ver [Estado actual](estado-actual.md)) y que vuelve a morder cada vez que algo hay que mirarlo en pantalla.

**Los datos de prueba quedaron restaurados**, y se comprobó: tema de «Club prueba» de vuelta en rojo, su comuna de vuelta en vacío **sin tocar la región** —que ya estaba puesta antes, así que borrar las dos habría destruido un dato ajeno—, el nombre largo de «Los Papi Pasty» revertido, las membresías e invitaciones deshechas, y el partido, desafío, propuesta, amistad temporal y la cancha sembrada eliminados. **La cuenta cuadra: 24 partidos antes de sembrar y 24 después de limpiar.**

## Los 123 arneses, todos en verde (2026-10-16)

Se escriben uno por migración y se corren cuando se escriben, pegándolos a mano en el editor SQL. **Nadie los había corrido juntos contra el esquema actual**, porque contra producción cada uno siembra y revierte y hacerlo 120 veces a mano no es realista. Con la base local sí lo es: `node scripts/correr-arneses.mjs`.

**Resultado final: 123 de 123** (2026-10-16). El camino: 76 en la primera pasada del 2026-10-15, 84 tras arreglar los viejos, 95 tras el recinto sembrado, 99 tras el partido de clubes sembrado, 101 tras el fallo que el caso 11 del arnés de la 48 llevaba cinco meses denunciando, 109 tras los tres que NUNCA habían pasado, 115 tras los que se habían quedado en el mundo anterior, 120 tras los de chat y 123 al final. Lo que fallaba se repartía así:

- **~10 necesitan datos de producción.** Mueren en el montaje: «No hay ningún partido de clubes en la base contra el que probar», «Club no encontrado», «La prueba necesita al menos un complejo con dueño cargado». No están rotas: **no son autosuficientes**, y por eso sólo sirven contra una base con historia. Es una propiedad, no un fallo, pero conviene saber cuáles son antes de confiar en un «pasó».
- **Las que estaban VIEJAS ya están arregladas (2026-10-15).** Eran menos de las que parecía: la primera estimación dijo «~14» contando por el texto del error, y varias de esas —`null value in column cancha_id`, `complejo_id`— resultaron ser del primer grupo: el arnés hace `select … from complejos where publicado limit 1` y en una base vacía no hay ninguno. El error parecía mecánico y no lo era. **Contar errores por su mensaje tampoco es clasificar.**

  Lo que sí estaba viejo y quedó corregido:
  - **Diez arneses del vertical de Reservas** insertaban sin `reservas.precio_cancha`, que la migración **68** hizo `not null`. Llevaban rotos desde entonces. El valor correcto es el mismo `precio_total`, y lo dice la propia 68 al rellenar las filas viejas: «hasta acá `precio_total` ERA el precio de la cancha».
  - **El arnés de la 55** llamaba `crear_reserva` sin el contacto que la **67** hizo obligatorio (18 llamadas). Ahora va por nombre de parámetro, no por posición: la firma ya creció dos veces.
  - **Su caso 26 se había vuelto imposible.** Montaba dos jugadores, los dos autorizando antes de recalcular la cuota; después llegó el auto-confirmado y con dos el grupo se completaba, la reserva salía de `armando` y `recalcular_cuota_reserva` la rechazaba con razón. Se rehízo con un tercero que no autoriza, de modo que **las dos aserciones siguen midiendo lo suyo** — bajar a una sola autorización habría dejado la segunda pasando sin probar nada.
  - **El arnés de la 44** llamaba `aprobar_propuesta(uuid)`, que dejó de existir cuando la 45c añadió `p_me_inscribo`. Y su caso 11, el de permisos, preguntaba por esa misma firma: `has_function_privilege` con una función que no existe **no devuelve false, lanza**. Ese caso no medía permisos, reventaba.
- **El resto** son fallos de montaje encadenados al primer grupo, más unos pocos que merecen mirarse uno por uno.

**Lo que este ejercicio encontró y ya está arreglado** (ver `pendientes.md`):

- Cuatro columnas de `profiles` sin versionar —`rating_count` y las tres medias de valoración—, que hacían morir cuatro arneses con `column p.rating_count does not exist`.
- `reactivate_suspended()` ejecutable por `authenticated` en una base nueva y no en producción. Lo cierra la migración **158**.

**Ocho arneses de Reservas ya no dependen de datos de producción.** Tomaban el primer complejo publicado que hubiera, o el primer `complejo_admins` con rol dueño; ahora cada uno crea su recinto, su cancha y sus horarios. Dos detalles que costaron una vuelta: el horario se siembra para **los siete días** —varios casos piden disponibilidad de `hoy + 2`, que cae en otro día de la semana— y el del 81 va **despublicado**, porque su caso 15 comprueba justamente que sin sesión no se ve ni una foto de un recinto no publicado.

**Y cuatro arneses destaparon lo de la migración 114** (ver el P2 de [Pendientes](pendientes.md)): los casos que corrían como `anon` ya no pueden, porque esa migración cerró las catorce funciones que el producto le había abierto. Se ajustaron para medir lo que de verdad pasa, con el conflicto escrito dentro de cada uno y la indicación de cómo revertirlos si se decide reabrir.

**Cuatro arneses de clubes ya siembran su propio partido** (44d, 45, 46 y 47). Recorren el flujo real —desafío, aceptación, propuesta, aprobación— en vez de forzar estados, así que el partido que queda es el que la app habría creado. El 44d siembra además un partido NORMAL y un tercer usuario ajeno a los dos clubes, porque sus casos 12 y 14 los necesitan.

**Y el 46 tenía un defecto latente que sólo se ve con datos sembrados:** buscaba el evento del rechazo con `order by created_at desc limit 1`, y **dentro de una transacción `now()` no avanza**, así que todos los eventos comparten `created_at` y esa consulta devuelve cualquiera. Acusaba a la función de inventarse un motivo que venía de un caso anterior. Ahora se busca por `change_id`. Contra una base con historia el defecto estaba igual de presente; sólo que no se notaba.

**Y el ejercicio encontró un fallo de verdad en producción.** El caso 11 del arnés de la 48 —«en disputa nadie debería poder proponer de nuevo»— llevaba rojo desde mayo, y tenía razón: la migración **119** reescribió `proponer_resultado` para añadirle los permisos de club y la reconstruyó desde una copia **anterior a la 48b**, devolviendo la guarda laxa que aquella había cerrado. Lo arregla la **159**. Detalle en `pendientes.md`.

**La última tanda (2026-10-16) no era trabajo mecánico.** De los que quedaban rojos, casi ninguno estaba «roto»: cada uno pedía una regla que una migración posterior cambió a propósito, y nadie volvió a correrlos. Vale la pena la lista, porque es el catálogo de cómo envejece un arnés:

- **La 67** hizo obligatorio el contacto de la reserva: el 60, el 62 y el 64 morían en «Escribe un nombre de contacto» antes de llegar a lo suyo.
- **La 43c** hizo obligatoria la ubicación en el mapa de la propuesta oficial: los casos 9 a 15 del 43 nunca llegaban a correr.
- **La 65** dejó de entregar disponibilidad de un recinto sin publicar, y varios arneses creaban el suyo sin publicar. El 57 ni siquiera llegaba al caso 1: la policy de insert de las calificaciones se une a `canchas_reservables`, que sólo muestra las de un recinto publicado.
- **La 77** añadió `canchas_reservables_select_admin`, y el caso 1 del 72 seguía exigiendo que el dueño NO viera sus canchas.
- **La 83** partió el cargo de administrador en tres permisos y dejó a los nuevos naciendo sin ninguno: el caso 3 del 60 editaba la ficha con un admin recién agregado.
- **La 44d** cambió la regla entera del partido de clubes —privado hasta que termina—, así que los casos 6 y 7 del 44b pedían lo contrario de lo vigente, y su caso 9 se inscribía a mano en un partido que la 44d cerró.
- **Un tope de 3 clubes por usuario** hacía imposible el caso 9 del 40, que creaba 30. La escala es lo que importa, no el tipo de hilo: se arma con 30 partidos.

**Y dos arneses de chat no medían nada de lo que creían.** El del `/todos` (39) contaba los avisos sin salir del rol de quien acababa de escribir, y `notifications` sólo deja ver lo propio: el remitente nunca es destinatario de su propia mención, así que contaba cero y culpaba al disparador. El de la bandeja (40) ponía el `sender_id` a mano, pero desde la migración **32** el disparador `messages_force_server_fields` hace `sender_id := auth.uid()`: **todos** sus mensajes se guardaban como de una sola persona y la bandeja medía una conversación de uno consigo mismo. El DM lo delataba —nadie es amigo de sí mismo— y por eso moría ahí.

**El reloj de la transacción, otra vez.** Ese mismo disparador estampa `created_at := now()`, que es la hora de ARRANQUE de la transacción: los `pg_sleep` del arnés 40 no separaban nada y «el mensaje más nuevo» quedaba indefinido. Su propio caso 8 lo comprobaba y habría gritado, si hubiera llegado a correr. Ahora los mensajes, las lecturas y el escondite van en un reloj propio del arnés, **hacia atrás** y de a un segundo —hacia adelante ninguna lectura los alcanzaría—. Es la misma lección del 46, en otra tabla: *dentro de una transacción `now()` no avanza*.

**Y una de SQL que cuesta una tarde:** el caso 7 del 40 comprobaba `v_payload->'last_message' is not null` contra una RPC que devuelve `'last_message': null`. `->` entrega el valor JSON `null`, que no es un NULL de SQL, así que la condición era cierta siempre. Para preguntar por «vacío» hay que usar `->>`.

**Y una lección sobre cómo se compara.** El 2026-10-14 se dio por buena la equivalencia con producción comparando **conteos de objetos** —72 tablas, 285 funciones, 118 políticas— y coincidían. Lo que no coincidía eran las columnas de una tabla y el privilegio de una función. **Contar no es comparar.**

## Comparar las dos bases objeto por objeto (2026-10-16)

Comparar dos huellas tampoco bastaba: columnas y privilegios cuadraban desde el 14 de octubre, y aun así la base que construye el repositorio **no era** producción. Se comparan ahora **siete dimensiones**, y la 162 cerró lo que faltaba:

| | base nueva | producción |
|---|---|---|
| Columnas (658 en 72 tablas) | `65dea24a…` | `65dea24a…` |
| `execute` y `security` de las 285 funciones | `bb7d1ccf…` | `bb7d1ccf…` |
| **Cuerpos** de las 285 funciones | `addf38f8…` | `addf38f8…` |
| Políticas (118) | `bb2a653a…` | `bb2a653a…` |
| Disparadores (58) | `f549a45a…` | `f549a45a…` |
| Restricciones (431) | `cd15f320…` | `cd15f320…` |
| Índices (202) | `e7f820a4…` | `e7f820a4…` |

**EL `prosrc` DE PRODUCCIÓN NO ES EL DEL ARCHIVO, y por eso casi nadie compara cuerpos.** Lo que se aplica por el editor o por el MCP llega **sin comentarios y con los saltos de línea comidos**. Un `md5(prosrc)` a secas da 285 diferencias de 285 y ninguna es real; quitando comentarios y colapsando espacios quedan 14, que siguen sin serlo —son `(select` contra `( select`—. Hay que quitar **todo** el espacio en blanco, la misma transformación en los dos lados. Entonces quedan **dos**, y las dos importan. Es el mismo trabajo que hacía falta para no volver a perder una decisión como la de la 48b.

**Lo que encontró, y que ninguna de las otras seis dimensiones habría visto:**

- **`solicitar_revision_sancion` estaba MEJOR en producción que en el repositorio.** Filtra el informe de incomparecencia por `club_reportado_id = v_club`; el archivo 47c lo busca sólo por `challenge_id`. La función hermana de esa misma migración sí filtra, con el comentario que lo explica. Sin el filtro, un club que no fue reportado puede pedir revisión apoyándose en el informe del otro, y el expediente que se congela retrata al club equivocado. El arnés de la 162 lo demuestra con un control que degrada la función dentro de la transacción: con el cuerpo viejo, `ok:true` y revisión creada.
- **Tres CHECK que producción tiene y `schema.sql` no declara**: `matches_duracion_min_check`, `matches_min_trust_score_check` y `profiles_estado_check`. Una base nueva aceptaba un partido de 5000 minutos, un `min_trust_score` de -3 y un perfil en estado inventado.
- **`idx_profiles_username`**, que existe en producción y nunca se versionó.
- **`idx_matches_con_reserva`**, al revés: lo crea la migración 99 y producción no lo tiene. Es un índice no único sobre exactamente la misma columna y el mismo predicado que `matches_reserva_uidx`, que sí es único. Peso muerto; la 162 lo retira.
- **Dos textos de aviso** que el repositorio dice más largos de lo que la gente recibe. Se conservó lo que recibe hoy; la elección está anotada en `pendientes.md`.

## Correr la APP contra la base local (2026-10-16)

`npm run web:local`. Lo que desbloquea no es poco: hasta ahora cualquier prueba de un flujo real —registrarse, crear un partido, escribir en el chat— habría escrito en producción, así que no se hacía. Las trampas y la razón de cada defensa están en la cabecera de `scripts/web-local.mjs`; lo que importa recordar es que **pasar las variables en el proceso no alcanza** (Expo incrusta el `.env` en el bundle y ése gana) y que el respaldo del `.env` **tiene que estar ignorado por git**, comprobado con `git check-ignore` antes de tocar nada.

**El registro completo ya corre en local (2026-10-16):** crear cuenta → código de 6 dígitos por correo → verificar → términos → Inicio, con la contraseña fijada y comprobada pidiendo un token a `/auth/v1/token`. Costó tres cosas, y las tres valen para cualquiera que levante el stack:

- **La plantilla de correo.** El registro no deja una cuenta usable hasta verificar el OTP —la contraseña se fija después, en `completeSignUpPassword`— y la plantilla por omisión manda un **enlace mágico**, no `{{ .Token }}`. Con esa plantilla la cuenta se crea, el perfil se crea, la contraseña nunca queda fijada, y el login siguiente dice «Correo o contraseña incorrectos»: parece un fallo de la app y es del entorno. La plantilla está versionada en `supabase/plantillas-correo/`. Va en `confirmation` **y** en `magic_link`: «Reenviar código» pasa por `signInWithOtp`.
- **colima sólo comparte `/Users/...`.** El proyecto del stack vivía en `/private/tmp` y Docker montó la plantilla dentro del contenedor como un **directorio vacío**, sin quejarse; gotrue mandó un listado de directorio en vez del código. El proyecto del stack local vive ahora en `~/.futfinder-local` — fuera del repositorio, para que `supabase db reset` no pueda aplicar las migraciones en orden alfabético.
- **`[api]` y `[realtime]` estaban apagados.** Para los arneses da igual —se habla con Postgres directo— pero con la app encima el `/auth` funciona y **cada `supabase.from(...)` vuelve 503**: Inicio decía «¡Hola, jugador!» y «No pudimos cargar tu reputación». Parecían dos fallos de la app y eran uno solo del entorno.

## Lo que los arneses miden sin querer: el reloj y el calendario (2026-10-17)

El caso M7 de la **86** salió por casualidad —se corrió la suite de mañana y no de noche—, así que se buscaron los demás a propósito. Hay dos familias y se distinguen bien.

**1. Depende de la HORA del día.** Pasa cuando un escenario mezcla una hora del reloj con una ventana relativa. Son dos, las dos arregladas:

- **86**: ponía la reserva «hoy a las 23:30» y comprobaba que ya no se pudiera cancelar. A las 21:00 faltaban dos horas y pasaba; a las 10:30 faltaban trece y fallaba. Ahora la pone **a una hora de ahora**, sobre la hora de Chile y partiendo fecha y hora juntas para que cruzar la medianoche no la deje en el día equivocado. El modelo a copiar estaba al lado: la **70** ya lo hacía así (`v_ts := v_ahora + interval '13 hours'`, y después `v_ts::date` y `v_ts::time`).
- **84**: su caso C2 —«reservar una hora de hoy que ya pasó se rechaza»— vivía dentro de un `if v_h is not null`, y `v_h` es «un bloque de hoy que ya empezó». Entre las 00:00 y las 00:59 de Chile no existe ninguno: **el caso desaparecía sin dejar rastro y el arnés terminaba en verde**. Ahora, si no hay bloque pasado, lo dice y falla. Un caso que no corre no es un caso que pasa.

Lo que NO es hora-dependiente aunque lo parezca: `now() ± N horas` y `date_trunc('hour', now()) + N días`. Son relativos y se comportan igual a cualquier hora. Están en 25 arneses y ninguno es un problema.

**2. Depende del CALENDARIO, y tenía fecha de estallido.** Once arneses del vertical de Reservas montaban su escenario sobre `date '2027-03-01'`. **El 2 de marzo de 2027, los ocho que crean una reserva ahí se habrían puesto rojos a la vez**: desde la migración 84, `crear_reserva` rechaza el pasado. Ocho arneses en rojo por el calendario, sin que nadie tocara una línea.

Se cambiaron por **el lunes de dentro de dos semanas**, calculado sobre la hora de Chile:

```sql
(date_trunc('week', (now() at time zone 'America/Santiago')::date) + interval '14 days')::date
```

Lunes porque las reglas de horario de esos arneses lo dan por supuesto, y a dos semanas porque así nunca cae en pasado. Los tres que conservan una fecha fija —**66**, **67** y **70**— comprueban una **conversión** (el desfase de zona horaria, el cruce de la medianoche), no reservan nada, y lo dicen en un comentario.

**El guardián:** `scripts/__tests__/arnesesSinFechaCaduca.test.js` falla si un arnés escribe una fecha del calendario a mano. La exención se declara en el propio archivo —un comentario con las palabras «no caduca»— y no en una lista que vive en otra parte y que nadie vuelve a leer. Control comprobado: una fecha de 2028 colada en el arnés de la 63 lo pone en rojo con el archivo y la línea.

## El recorrido de la app, caminado de verdad (2026-10-17 al 19)

Con `npm run web:local` se puede usar FutFinder sin escribir en producción, así que se caminó el recorrido real con **dos cuentas**. Esto es lo que ya está comprobado de punta a punta, para no repetirlo:

| Paso | Comprobado en la base, no sólo en pantalla |
|---|---|
| Registro con código por correo | la cuenta queda confirmada y **la contraseña fijada** (se pide un token a `/auth/v1/token`) |
| Publicar un partido | dirección real, coordenadas y **comuna correcta**; la cancha se registra en `canchas` |
| Segunda cuenta se une | `cupos_disponibles` baja, el inscrito queda con `origen = orden_llegada`, al organizador le llega `match_join` |
| Chat del partido | el mensaje queda en `messages` con su `match_id` |
| Crear club | queda con comuna, modalidad y tema, y el fundador entra como `admin` |
| Solicitar unirse / aceptar | `club_join_requests` pasa a `approved`, el jugador entra como `jugador`, y salen **dos** avisos: «fue aceptada» a quien pidió y «se unió» al club |
| `/todos` en el chat del club | el mensaje queda con `mention_all`, y el aviso le llega al OTRO integrante y **no a quien lo escribió** — que es justo lo que afirma el arnés 39, ahora visto en la app |
| Bandeja de avisos | filtra por categoría con sus conteos y marca la solicitud ya resuelta |

**Cuatro fallos de interfaz salieron de este recorrido** —la pista de la contraseña que mentía, el «¡Todo listo!» que no guardaba nada, la hora en 12 horas y el botón de crear club que no hacía nada— y **los cuatro comparten forma**: la app hace algo distinto de lo que dice, o no dice nada. Ninguno se encuentra leyendo código ni corriendo arneses.

### El vertical de Reservas, entero (2026-10-19)

Era el que **nunca había transaccionado**: producción tiene 13 canchas, 19 tarifas y 73 reglas de horario, y **cero reservas y cero pagos**. Se caminó completo contra la base local, de las dos puntas: el dueño y el jugador.

| Paso | Comprobado en la base, no sólo en pantalla |
|---|---|
| «Quiero sumar mi recinto» | queda en `solicitudes_recinto`, el teléfono normalizado a `+569…`, `avisada_at` en null (sin proveedor de correo local, que es el «no falla, sólo no avisa» de diseño) |
| Autorización y crear el recinto | la autorización se gasta en la misma transacción (`usada_at` **y** `complejo_id`, que es lo que exige el CHECK), el complejo queda con comuna y coordenadas, y el dueño entra en `complejo_admins` |
| Cargar una cancha | `canchas_reservables`, con el aviso correcto de que sin horario no es reservable ni se puede publicar |
| Horarios y tarifas | 7 reglas 09:00–23:00, y una tarifa 19:00–23:00 que la pantalla desglosa bien: «10 bloques a $28.000 y 4 a $34.000», con la comisión del 5 % |
| Mandar a revisión → aprobar → publicar | `revision_pedida_at`, luego `aprobado_futfinder`, luego `publicado`; aprobar **no** publica |
| El jugador busca y elige hora | `buscar_complejos` lo trae con su «desde» y su próxima hora libre; las horas pasadas no se ofrecen y **cada bloque trae el precio de SU franja** |
| Reservar | la reserva se crea con `precio_total = 34000` **calculado por el servidor**, no por el precio que mandó el cliente |
| El pago | se detiene donde tiene que detenerse: sin pasarela, «No pudimos iniciar el pago · no se te descontó nada». La reserva queda en `procesando` y **no bloquea la hora** — sigue ofreciéndose, que es lo que el resumen le promete al jugador |

**Cinco cosas salieron de este recorrido**, y ninguna la encuentra un arnés:

1. **El buscador se quedaba pegado** en lo que vio al abrir la app: la lista se pedía sólo al montar, y en un navegador de pestañas esa pantalla vive toda la sesión.
2. **La dirección del recinto quedaba tapada** por el botón «Ver horarios», sin forma de destaparla.
3. **Quitar una tarifa no preguntaba nada**, y esas horas vuelven al precio base de inmediato.
4. **El basurero era un botón dentro de otro botón**, marcado inválido en web.
5. **Nadie se enteraba cuando un recinto pedía revisión** — el más grave, y el único que ya estaba pasando en producción: 35 días de espera. Ver [Aprobar recintos](aprobar-recintos.md).

**Lo que todavía no se ha caminado:** el desafío entre clubes de punta a punta (hace falta un segundo club), confirmar la asistencia al terminar un partido, y las valoraciones. Del vertical de Reservas quedan sin caminar las partes que no se pueden sin pasarela: el pago dividido entre jugadores, cancelar con devolución y la agenda del dueño con reservas de verdad.

## El barrido del reloj, hecho de verdad (2026-10-17)

La búsqueda de arriba fue leyendo los 126. Después se comprobó **moviendo el reloj**: `bash scripts/barrido-reloj.sh horas` y `… fechas`.

**Resultado: 126/126 a las nueve horas del día** (00:30 a 23:30 de Chile) **y en las nueve fechas** probadas, de fin de año a 2029, pasando por el 2 de marzo de 2027 —el día en que habrían estallado las fechas clavadas—, los dos cambios de hora de Chile (abril y septiembre) y el 29 de febrero de 2028.

**El control, que es lo que lo convierte en una prueba:** las versiones ANTERIORES de esos arneses, sacadas de git y corridas con el reloj en el 2027-03-02, fallan. El arnés 55 lo dice con todas sus letras:

```
FALLÓ (caso 1): crear_reserva completa debería aceptar,
respondió {"ok": false, "reason": "Esa hora ya pasó. Elige otra."}
```

**Cómo se mueve el reloj, porque los dos caminos obvios no sirven:**

- `date -s` a secas **no dura dos segundos**: `lima-guestagent` lo devuelve a la hora real. Hay que pararlo — y `docker` desde el host sigue funcionando sin él, comprobado.
- `libfaketime` dentro del contenedor **revienta**: el postgres de la imagen es de Nix y la libfaketime de Alpine es musl. `Fatal glibc error: malloc.c`. No insistir.

El script para el guestagent, mueve la hora, corre la suite entera a cada paso y **repone todo en un `trap`**, también si te vas con Ctrl-C. Al terminar deja el reloj sincronizado con el host.

**Y REINICIA POSTGRES, que no es por gusto.** `pg_cron` se queda colgado después del viaje en el tiempo: anota corridas con fecha futura y deja de disparar. Se vio el 2026-10-19 —**37 horas sin ejecutar ninguna de las 12 tareas**, con 99 corridas fechadas en 2028 y 2029 en el registro—. No se nota enseguida, y lo que se pierde en silencio son los recordatorios, el cierre de los partidos sin confirmar y el vencimiento de las reservas. Reiniciar el contenedor levanta de nuevo el lanzador y todo vuelve a su hora.

**Y encontró uno que la lectura no había visto.** El C09 del arnés de la **137** —«las cuentas reales no se movieron»— contaba cuántos perfiles de la base tenían un puntaje distinto de 75, excluyendo sus cuatro fixtures. Daba por hecho que cualquier otra cuenta vale 75: cierto en una base recién construida y en ninguna otra. Con el reloj en junio de 2027 y una cuenta de prueba creada por la app, el job de inactividad **hace exactamente su trabajo** —la cuenta lleva ocho meses sin jugar— y el arnés lo llamaba fallo. Ahora toma una foto de los perfiles ajenos antes de correr el job y comprueba que no se movió ninguno **que estuviera al día**. Es el mismo defecto que «no es autosuficiente», en otra forma: el caso se apoyaba en datos que no son suyos.

## La diferencia que no es de esquema: los interruptores (2026-10-16)

Las siete huellas de la base construida cuadran con producción. **Los datos de configuración, no.** Una base nueva nace con **las cuatro fases de TrueScore apagadas** y producción las tiene encendidas desde el 2026-09-24.

**Y eso cambia el resultado de la suite.** Con los interruptores como los tiene producción, **119 de 125** pasan: seis arneses dan por buena la regla PRE-TrueScore y nunca se corrieron con la configuración de verdad.

| arnés | lo que afirma |
|---|---|
| `122_una_salida_y_una_asistencia…` | la salida legítima cobra **3** (con TrueScore cobra 1) |
| `125_la_otra_puerta_de_la_salida` | el cambio legítimo cobra **3** |
| `127_cancelar_para_cambiarse…` | cobra 25 de una vez, 80 → 55 |
| `50_una_sola_puerta` | el jugador del club rival no pierde puntaje |
| `134_truescore_fase1` | enciende la fase él mismo y ya estaba encendida |
| `profiles_reputacion_protegida` | la sanción vigente son 3 puntos |

Los cinco primeros no estaban rotos: estaban **viejos**, igual que los doce que se repararon esta misma semana. **Cerrado el 2026-10-17, y con 126/126** (los 125 más el guardián nuevo).

**Lo que se cambió, y por qué no es «ajustar el número esperado».** Lo que esas migraciones prometen no es «3 puntos»: es que **se cobre UNA SOLA VEZ**. Clavar el número ataba el arnés a una tabla de penalizaciones que no es suya. Ahora:

- se lee el puntaje antes, se llama una vez, y se exige que la baja sea **exactamente lo que la propia RPC dice haber cobrado**;
- cuando el cobro no viene en la respuesta —cancelar— se le pregunta a `truescore_costo_salida` **antes** de cancelar;
- el segundo intento tiene que dejar el puntaje donde estaba, que es el caso de verdad.

**`construir-base.mjs` enciende ahora las cuatro fases** al terminar, y `interruptores_como_produccion_test.sql` falla si alguna está apagada —o si las de teléfono están encendidas sin proveedor de SMS—. Control comprobado: apagar la fase 3 lo pone en rojo nombrándola.

**Y tres trampas que cazó el ejercicio, ninguna sobre TrueScore:**

- El arnés de la 122 contaba los apuntes del historial **con el rol puesto**, y los dos libros tienen RLS de «sólo lo mío»: la sesión era la del organizador mirando los del jugador. Contaba 0 y parecía que el registro de puntos no se había hecho. Misma trampa que el arnés 39.
- El de la 134 contaba *todos* los eventos del partido y exigía 3; con la fase 2 encendida aparece un cuarto, el bono del organizador.
- Y el de la **86** no tenía nada que ver: su caso M7 ponía la reserva «hoy a las 23:30» y comprobaba que ya no se pudiera cancelar. A las 21:00 faltaban dos horas y pasaba; a las 10:30 faltaban trece y fallaba. **No probaba la regla, probaba el reloj.** Ahora la pone a una hora de AHORA, sobre la hora de Chile y partiendo fecha y hora juntas para que cruzar la medianoche no la deje en el día equivocado.

**Y lo que sí se puede comprobar sin eso:** que la app arrancó contra la base local se verifica leyendo el bundle servido, no mirando la pantalla — `curl` al `index.bundle` y contar apariciones del proyecto de producción. Tiene que haber cero. Mirar la pantalla engaña: la primera corrida abrió con la sesión y los datos de producción y parecía correcta.

## Y una octava diferencia, en `storage` (2026-10-16)

Las siete dimensiones de arriba miran `public`. `storage` se mira igual, y ahí apareció la última: producción tenía **27** políticas sobre `storage.objects` y el repositorio construye **28**. La que faltaba era `match_covers_organizer_delete`, o sea que **nadie podía borrar la portada de un partido, ni siquiera quien lo organiza**. Todos los demás buckets tienen su puerta de borrado; `match-covers` era el único asimétrico, y la asimetría no estaba escrita en ninguna parte: es un accidente de cómo se aplicó la 08. Lo repone la **163**.

No amplía nada que no se pudiera hacer: el organizador ya sube con `upsert: true` y tiene la política de `update`, así que podía SOBRESCRIBIR la portada con cualquier cosa. Borrarla es estrictamente menos. Hoy no la llama nadie —`storage.js` no exporta un `removeMatchCoverFile`—; se repone para que las dos bases digan lo mismo y para que la puerta esté donde la 08 dijo.

**Un detalle para quien escriba el próximo arnés de `storage`:** `storage.objects` trae un disparador, `storage.protect_delete`, que rechaza cualquier borrado por SQL —«use la Storage API»— salvo que esté puesto `storage.allow_delete_query`. Eso es lo que pone la API antes de borrar, así que ponerlo en el arnés es ponerse en su lugar; quién puede y quién no lo sigue decidiendo la RLS. Sin eso, los cuatro casos de borrado mueren todos igual y el arnés no prueba nada.

**Lo que también se comparó y SÍ cuadraba:** las 12 tareas de `cron` (nombre, horario, comando y activas), los 8 buckets de `storage` con sus límites y tipos, los privilegios de las 72 tablas, los de las 41 columnas con ACL propia, y los privilegios por omisión de `public` y `storage` —los de la 115—. Los `pg_default_acl` de los esquemas que administra Supabase (`cron`, `extensions`, `graphql`, `realtime`, `auth`, `supabase_functions`) sí difieren, y eso es del alojamiento, no del repositorio: no se persigue.

**La prueba de que la 162 cierra el círculo:** contenedores nuevos, base vacía, `node scripts/construir-base.mjs --sin-149` (schema.sql + 173 migraciones), y las siete huellas iguales a producción. Después, **124/124 arneses** contra esa base recién construida. La 162 se aplicó a producción el 2026-10-16 y **no cambió ni una huella**, que era justamente lo que tenía que pasar: lo que arregla es la base que el repositorio levanta, no la que está corriendo.

## Notas relacionadas

- [Estado actual](estado-actual.md)
- [Pendientes](pendientes.md)
- [Despliegue y entornos](../arquitectura/despliegue-y-entornos.md)
