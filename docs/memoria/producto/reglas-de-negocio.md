# Reglas de negocio

Última revisión: 2026-09-24

## Propósito

Reunir las reglas de producto que cambian el resultado para jugadores, organizadores y clubes, sin duplicar la implementación de sus servicios o migraciones.

## Estado verificado

Las reglas de partidos se centralizan en `src/services/matchRules.js` y su espejo versionado es la función `partido_reglas()` de la migración 33. Las reglas de clubes y asistencia también tienen validación en servicios y/o PostgreSQL.

## Ubicación de un partido

- La ubicación de un partido es la de la dirección escrita, nunca la del teléfono: el GPS del dispositivo solo ordena las sugerencias del buscador. Las coordenadas viajan junto a la dirección de la que salieron (`src/utils/ubicacionPropuesta.js`) y dejan de valer en cuanto el texto cambia sin confirmar una ubicación nueva.

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
- **El resultado lo firman los dos clubes.** Propone el marcador un administrador de uno de los dos; lo confirma o lo rechaza un administrador del **otro**, que además no puede pertenecer al club proponente en ningún rol. Quien administra los dos clubes no participa en ninguna de las dos puntas.
- **Una disputa no la reabre ningún club.** Rechazar deja el desafío en `resultado_en_disputa`, y de ahí sólo lo saca la moderación: ni el proponente ni el contrario pueden proponer un resultado nuevo. Nada de lo que se lee en la aplicación —el aviso, el motivo de error, la burbuja del hilo o el CTA— ofrece esa acción.
- **Un resultado que no está confirmado no mueve nada:** ni el récord, ni las estadísticas, ni el historial. Un partido que se cerró sin que el club contrario confirmara el marcador **no es un partido jugado**.
- **El marcador se lee desde el club que se mira.** «Club A 3-1 Club B» es «Victoria 3-1» en el perfil de A y «Derrota 1-3» en el de B; quién fue local se dice aparte. En el hilo del encuentro, donde están los dos clubes, el marcador va anclado como «3-1 (local-visitante)».
- **De un encuentro terminado es público** el nombre y el escudo de los dos clubes, el día, el marcador y el V/E/D. La hora exacta y la cancha sólo las ven los integrantes de los dos clubes. Antes de terminar, el partido no existe para nadie más.
- **El nivel de un encuentro entre clubes no se acuerda todavía** en ninguna parte del ciclo, así que no se muestra en el historial: el `nivel` del partido queda en el valor por defecto de la tabla y no representa ninguna decisión.
- **La asistencia y el cierre de un encuentro entre clubes viajan con el resultado**, no por la vía del partido normal: nadie pierde Trust Score por un encuentro entre clubes, y un solo club no puede darlo por jugado.

## TrueScore (reemplaza al Trust Score cuando se active)

La fuente de verdad es `docs/truescore-spec.md`, incluida su sección 8 de decisiones. La fase 1 está en producción desde la migración 134 **con el flag `truescore_fase1` apagado**: mientras no se active, rige el Trust Score descrito más abajo. Con el flag activo:

- Hay **un solo puntaje global**, entre 0 y 100, y todos parten en 75. Asistir a tiempo suma según la racha (+6, +8, +10, +12); llegar tarde resta 8 y no ir sin avisar resta 35, y los dos rompen la racha. Salirse cuesta según las horas de aviso, interpolado en la tabla de la spec (5 h = −13, 2 h = −23, 48 h = −1), igual para quien entró desde la lista de espera; con 24 h o más no rompe la racha.
- El organizador **confirma la asistencia una sola vez** y a toda la nómina (Asistió, Llegó tarde, No fue) dentro de las 24 h desde el fin del partido. Si no lo hace, el partido queda neutro para los jugadores y el organizador pierde 10.
- Cancelar es neutro para los jugadores. Al organizador no le cuesta con 12 h o más de aviso ni por lluvia o cierre de cancha; con menos de 12 h pierde 15, o 25 si faltan 2 h o menos.
- El GPS ya no da puntos: queda como evidencia de llegada.
- El organizador puede **sacar a un jugador**: no le resta puntos y no puede volver a ese partido.
- El mínimo de puntaje que pone el organizador se mantiene; la suspensión automática en 0 no existe.
- Los encuentros entre clubes quedan fuera de TrueScore.

## Trust Score

- El puntaje se almacena entre 0 y 100 y puede condicionar el ingreso cuando un partido define `min_trust_score`.
- **Nadie edita su propio puntaje.** Desde la migración 102, `profiles` no tiene UPDATE abierto: los permisos son por columna y dejan fuera `trust_score`, `partidos_jugados`, `asistencias_confirmadas`, `mvps`, los promedios de rating, `estado` y `suspended_until`. Esas columnas solo cambian desde las operaciones del servidor.
- Confirmar presencia por GPS suma 1 punto, con tope de 100, y registra una asistencia confirmada.
- Al registrar asistencia, el organizador puede marcar presente o ausente: una presencia no confirmada previamente por GPS suma 2 puntos; una ausencia resta 15. La operación evita repetir ese efecto si el estado no cambia.
- Salirse de un partido **siempre cuesta**: 3 puntos con más de 2 horas de anticipación y 20 después (`leave_match_penalized`). Las 2 horas separan la sanción leve de la grave; no son una ventana gratis, y los textos de la app dicen los puntos que se cobran. Cancelar como organizador cuesta 15 y 25 con el mismo corte.
- **De un partido cancelado o ya terminado no se sale, y por lo tanto no se cobra** (migración 122). Antes `leave_match_penalized` no miraba el estado: salirse de un partido que el organizador había cancelado devolvía éxito, escribía `estado = 'abierto'` —el partido revivía en el buscador— y le restaba 3 puntos a quien no había hecho nada. Ahora la salida se rechaza sin tocar nada y la inscripción se conserva, que es lo que el historial del jugador lee. Reabrir es reabrir lo que estaba **lleno**, no escribir 'abierto' encima de cualquier estado.
- **Cada efecto de reputación se aplica una sola vez, aunque la petición llegue dos veces a la vez** (migración 122). Las tres operaciones que mueven el puntaje reclaman su fila con la misma sentencia que la escribe —la salida con `delete … returning`, el GPS con `update … where estado = 'inscrito' returning`— y bloquean primero el partido y después la inscripción, siempre en ese orden. Antes, dos sesiones simultáneas cobraban dos veces la misma salida (80 → 74), daban dos veces el punto del GPS y sumaban dos asistencias por un partido.
- **Cambiarse de partido es la otra puerta de la salida y cuesta lo mismo** (migración 125). `swap_match` y `cancel_match_and_join` tenían intactos los dos defectos de arriba: cambiarse desde un partido cancelado lo revivía y cobraba 3, y «cancelar y cambiarme» sobre uno ya cancelado volvía a cobrar 25. Desde la 125 las dos puertas validan el estado bajo bloqueo y reclaman la inscripción con la sentencia que la borra.
- **Cancelar para cambiarse CANCELA el partido; no lo borra** (migración 127). `cancel_match_and_join` terminaba en un `delete from matches` y el `cascade` se llevaba a los inscritos y el chat: el aviso «se canceló tu partido» apuntaba a un `matchId` inexistente, el partido desaparecía del historial de todos y se perdía la conversación que la 34 conserva en sólo lectura. Ahora hace lo mismo que `cancel_match` —estado `cancelado`, aviso a los inscritos, aviso a la cola y cierre de la cola—, con la sanción cobrada sólo si esa llamada fue la que canceló. Los 25 se mantienen, y no son los 15 de `cancel_match`: cancelar para irse a jugar a otra parte se castiga más caro.
- El chat de un partido es para el organizador y los inscritos: una solicitud pendiente todavía no lo abre y un partido cancelado lo deja en solo lectura (`accesoAlChatDelPartido`).

## Estados de partidos y asistencia

- Los estados de partido son `abierto`, `lleno`, `en_curso`, `finalizado` y `cancelado`.
- Los estados de asistencia son `pendiente` (solicitud con aprobación manual, sin reservar cupo), `inscrito`, `confirmado_gps`, `no_asistio` y `cancelado`.
- **Las reglas de ingreso se exigen en el servidor, no en la pantalla** (migración 103). `join_match` rechaza los partidos con `aprobacion = 'manual'` —ese camino es `request_join`— y el rango de edad se comprueba al inscribir, al solicitar, al aprobar y en el trigger `tg_enforce_join_rules`. Política explícita de la edad: **un perfil sin edad no queda fuera**, porque no se puede demostrar que incumple; el día que la edad sea obligatoria, la regla se endurece en `edad_fuera_de_rango()`.
- `approve_join` comprueba el estado y la hora del partido dentro del bloqueo de fila: no se acepta a nadie en un partido cancelado ni después de su hora de inicio.
- **Rechazar una solicitud no saca a quien ya está dentro** (migración 128). `reject_join` borraba por id lo que había leído como `pendiente`, sin bloquear el partido: aprobar y rechazar al mismo jugador a la vez dejaba al jugador aceptado y después borrado, con el cupo mal contado. Ahora toma el bloqueo del partido —el mismo orden que el resto— y el borrado exige que siga pendiente. `approve_join` hace lo simétrico: si el jugador retira su solicitud en ese instante, no se aprueba ni se le avisa que entró.
- **Los cupos son las plazas para OTROS jugadores: el organizador está en `attendees` pero no ocupa una.** La guarda `matches_guard_cupos` lo excluye (salvo en partidos entre clubes, donde el organizador es un administrador del club rival y sí puede jugar) y, desde la migración 104, **deduce** `cupos_disponibles` de la nómina vigente en lugar de aceptar el conteo que manda el cliente.
- `abierto` y `lleno` se deducen juntos con la disponibilidad: ampliar los cupos de un partido lleno vuelve a abrirlo, sin que nadie tenga que acordarse de cambiar el estado.
- Un partido que ocupa la hora del jugador es el que está `abierto`, `lleno` o `en_curso`: ese conjunto vive en `estados_que_ocupan_horario()` y lo usan por igual la consulta (`get_schedule_conflict`) y la escritura (el trigger de elegibilidad).
- **Mover la hora de un partido también mira la agenda de los inscritos** (migración 123). La protección de la 109 vive en `attendees` y sólo corre cuando alguien ENTRA; cambiar `matches.hora` no volvía a validar nada, así que el organizador podía correr su partido encima de otro y dejar a un inscrito en los dos. El trigger `tg_matches_reprogramar` toma los mismos bloqueos por jugador de la 109 y rechaza el cambio con `CHOQUE_AGENDA_INSCRITOS:<n>`. El organizador de un partido normal queda fuera de la regla, igual que en `tg_enforce_join_rules`.
- **Cambiar el LUGAR avisa a los inscritos** (migración 123): `notify_match_updated` vigila ahora la dirección y las coordenadas, además de la hora, la cancha, la comuna y la cuota. Elegir otro punto del buscador dentro de la misma comuna, conservando el nombre escrito de la cancha, no generaba ningún aviso y el inscrito llegaba a la cancha vieja.
- El organizador solo puede guardar asistencia después de que termine el partido y hasta 72 horas después de su hora de término; al guardarla, el partido queda `finalizado`, salvo si ya estaba cancelado o finalizado. **Esto vale sólo para los partidos normales:** desde la migración 50, un partido nacido de una propuesta entre clubes rechaza `save_match_attendance()` y `cancel_match()`, porque su asistencia viaja con el resultado y su cierre lo firma el club contrario. **Desde la 127 lo rechazan también `swap_match` y `cancel_match_and_join`**, que eran las dos puertas que la 50 no cerró: comprobado contra producción, la primera sacaba a un jugador de la nómina de su club y la segunda borraba el encuentro entero, sin sanción de club ni aviso al rival.

## Avisos automáticos del partido

- **El recordatorio de 1 hora es para los partidos que ocupan la hora, no sólo para los `abierto`** (migración 128). `send_match_reminders` filtraba `estado = 'abierto'`, así que un partido que se llenaba —los que de verdad se juegan— dejaba de recibirlo. Ahora usa `estados_que_ocupan_horario()`, el mismo sitio único que usan la agenda y los choques de horario, y le llega sólo a quien tiene cupo (`inscrito`/`confirmado_gps`): una solicitud pendiente no es un partido tuyo.
- **El recordatorio de calificar no se manda en un partido cancelado** (migración 128). No miraba el estado, y cancelar no borra las marcas de GPS: quien alcanzó a confirmar antes de la cancelación recibía «califica a tus compañeros» por un partido que no se jugó. Desde la 124 esa evaluación además no se puede guardar, así que el aviso llevaba a una pantalla que dice que no.
- Los dos corren cada cinco minutos por `cron` (`send_match_reminders`, `send_rating_reminders`) y se marcan con `reminder_sent_at` y `rating_reminder_sent_at` para no repetirse.

## Confirmación GPS

- El radio máximo es de 200 metros respecto de las coordenadas de la cancha.
- La fuente temporal para la validación es `now()` de PostgreSQL, comparada con la hora y duración del partido: abre 30 minutos antes y cierra 30 minutos después del término calculado. No se valida con la hora del dispositivo.
- La ventana se ofrece completa en la app: el botón aparece desde 30 minutos antes y no solo «durante el partido» (`ventanaGps`/`enVentanaGps` en `matchRules`).
- **Estar en la cancha a la hora no convierte a nadie en jugador del partido.** Confirmar exige una inscripción válida (`inscrito`) y un partido en pie: una solicitud `pendiente` ya no se confirma sola, y un partido cancelado no reparte asistencias ni Trust Score.

## Evaluaciones entre jugadores

- Se evalúa a los compañeros que confirmaron GPS en el mismo partido, pasados 90 minutos de su hora, y una sola vez a cada uno.
- **Un partido cancelado no se califica** (migración 124). Cancelar no borra las confirmaciones de GPS, así que dos jugadores que alcanzaron a marcar antes de la cancelación podían calificarse por un partido que no se jugó, y esas notas entraban al promedio público del otro. La condición está en la política `ratings_insert_eligible` —que hasta el 2026-09-21 no miraba el estado y sí lo aceptaba— y en `puedeCalificar()` del cliente, que es el espejo y no la autoridad.

## Lista de espera

- Solo se permite entrar a la cola de un partido abierto o lleno que aún no comienza y para el que el jugador cumple los mismos requisitos de elegibilidad.
- El orden es de llegada (`created_at`). Al liberarse cupos se avisa a **tantos de la cola como cupos haya** —antes siempre a uno— y cada avisado tiene 30 minutos (`confirmar_antes_de`).
- **El turno reserva el cupo de verdad** (migración 105): mientras el plazo corra, `join_match` y el trigger de elegibilidad rechazan a cualquier otro con `CUPO_RESERVADO`. La aprobación del organizador (`approve_join`) es la excepción: es su nómina.
- El plazo vence solo. `barrer_lista_de_espera()` corre cada 5 minutos: al vencido se le avisa, pierde su lugar en la cola —puede volver a entrar— y el turno pasa al siguiente. Salir de la cola con el turno en la mano también despierta al siguiente.
- Salir de la lista no modifica el Trust Score. Al unirse al partido, el jugador sale automáticamente de su entrada en la cola.

## Rutas de código relacionadas

- `src/services/matchRules.js`, `src/services/matches.js` y `src/services/attendance.js`
- `src/services/clubs.js`
- `supabase/migrations/11_clubes.sql`, `supabase/migrations/24_multi_club_membership.sql` y `supabase/migrations/33_partidos_flujo_completo.sql`
- `supabase/migrations/22_settings_radius_trust_history.sql`
- `supabase/migrations/102_el_trust_score_no_se_edita_solo.sql`, `supabase/migrations/103_las_reglas_del_partido_en_el_servidor.sql` y `supabase/migrations/104_los_cupos_los_cuenta_la_nomina.sql`

## Limitaciones conocidas

Las migraciones describen el estado versionado; antes de cambiar una regla que afecte producción, comprueba de forma segura que las migraciones correspondientes estén aplicadas en ese entorno.

## Notas relacionadas

- [Visión y alcance](vision-y-alcance.md)
- [Stack y estructura](../arquitectura/stack-y-estructura.md)
- [Inicio de la memoria](../00-inicio.md)
