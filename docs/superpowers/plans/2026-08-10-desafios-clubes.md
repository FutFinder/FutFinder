# Ciclo formal de desafíos y partidos entre clubes — Plan de implementación

> **Para agentes:** ejecutar con `superpowers:subagent-driven-development` o
> `superpowers:executing-plans`. Los pasos usan `- [ ]` para seguimiento.

**Objetivo:** convertir el desafío entre clubes (hoy: una fila con cinco estados y
un DM entre dos administradores) en una máquina de estados formal con chat grupal
de negociación, plazos con vencimiento en servidor, propuesta oficial aprobada por
el club rival, partido publicado con cupos por club, cambios negociados,
cancelaciones con sanción, y resultado confirmado que alimenta el historial real.

**Arquitectura:** toda transición de estado vive en una RPC `SECURITY DEFINER`
sobre PostgreSQL, con hora de servidor y guardas de autorización derivadas de
`club_members` (nunca de datos del cliente). El cliente sólo lee estado y dibuja.
Las reglas numéricas se declaran una vez en `src/services/clubChallengeRules.js`
(puro, testeable con `node:test`) y se espejan en la función SQL
`desafio_reglas()`. El chat de negociación es un **tipo de hilo nuevo**
(`challenge:<id>`), no un DM ampliado.

**Stack:** Expo SDK 54 / React Native 0.81, Supabase (Postgres + RLS + RPC +
Realtime + pg_cron), `node:test` para unitarias, SQL plano transaccional para RLS.

---

## Restricciones globales

Aplican a **todas** las tareas de este plan.

- Texto visible al usuario: **español de Chile**. Sin excepciones.
- Migraciones **nuevas** (41 en adelante). Nunca editar 01–40.
- Toda operación crítica es una RPC atómica. El cliente no escribe estados.
- Ninguna RPC confía en `club_id`, `user_id`, rol ni timestamp enviado por el
  cliente: se derivan de `auth.uid()` y de `now()` de PostgreSQL.
- Idempotencia obligatoria en publicación y aprobación (`client_token`,
  `where estado = <estado esperado>` en el `update`).
- El aviso interno (`notifications`) se inserta siempre; las preferencias sólo
  apagan el push externo. Ya es así — mantenerlo.
- El módulo Partidos usa `partidos`/`partidosRadius`; Clubes usa
  `dsColors`/`clubColors`. **No mezclar familias** ni sustituir la paleta global.
- Sin datos demo nuevos. Los fixtures existentes de `clubMatches.js` se apagan en
  la Fase 6, no antes.
- Ninguna afirmación de "migración aplicada" sin comprobarlo contra el proyecto.
- Compatibilidad: los partidos que no vienen de un desafío no cambian de
  comportamiento en ningún punto.

---

## Contradicciones y decisiones que hay que aprobar

Estas son las discrepancias reales entre el enunciado y el esquema/código
verificados. Ninguna reduce alcance en silencio.

### C1 — «Propuesta oficial» y «Esperando aprobación» son el mismo instante

El enunciado los lista como dos estados del ciclo, pero la Fase 3 no describe
ningún paso intermedio: la propuesta se crea y queda esperando al club rival en
la misma operación. **Decisión:** un solo estado persistido,
`esperando_aprobacion`, etiquetado en la interfaz como «Propuesta oficial
enviada». Si más adelante se quiere un borrador editable antes de enviar, se
agrega `propuesta_borrador` sin tocar el resto de la máquina.

### C2 — «Club sancionado» no es un estado del desafío

Una sanción es del club y dura 14 días; puede alcanzar a varios desafíos a la
vez. Modelarla como estado del desafío obliga a inventar cómo se sale de él.
**Decisión:** la sanción vive en `club_sanctions`; el desafío bloqueado por una
sanción queda en `bloqueado_sancion` (estado real, reversible si la revisión
retira la sanción). Así «Club sancionado» existe como estado visible del desafío
sin duplicar la fuente de verdad.

### C3 — Qué pasa con los partidos ya publicados dentro de la ventana de sanción

El enunciado pide «resolver de forma coherente» sin definirlo. Cancelar
automáticamente todos los partidos del club sancionado castiga al club rival y a
los jugadores ya inscritos, que no hicieron nada. **Decisión:** el partido que
originó la sanción se cancela (es la causa). Los demás partidos ya publicados se
mantienen y se juegan; la sanción bloquea **crear, enviar, aceptar y publicar**
partidos nuevos durante 14 días. Los administradores del club sancionado ven el
motivo y la fecha de término. Si se prefiere lo contrario, es un cambio de una
línea en `aplicar_sancion_club()`.

### C4 — Mínimo de 4 cupos por club contra el techo de 30 de `matches`

`matches.cupos_totales` tiene `check (cupos_totales > 0 and cupos_totales <= 30)`
en `supabase/schema.sql:51`. Con cupos por club y `cupos_totales = 2 × por_club`,
el rango real queda en **4 a 15 por club**. **Decisión:** `cupos_por_club` se
valida entre 4 y 15; `cupos_totales` sigue siendo el total y ningún RPC ni
trigger existente cambia de significado.

### C5 — El esquema desplegado y las migraciones del repositorio no coinciden

Comprobado en el proyecto `jvfoendzblkoxvwvommz` el 2026-08-10 con consultas de
solo lectura al catálogo:

- `profiles.estado` y `profiles.suspended_until` **sí existen** en la base
  desplegada, pero **ninguna migración ni `schema.sql` las crea**. Se aplicaron a
  mano. El comentario de `src/services/reports.js:15` que dice «ya existen» es
  correcto sobre la base real e incorrecto sobre el repositorio.
- Es el mismo patrón que ya documentó la migración 33 para
  `request_join`/`approve_join`/`cancel_match`: cambios aplicados por consola sin
  versionar.

**Decisión:** este plan no depende de esas columnas — las sanciones de club son
tabla propia. Pero queda registrado que el repositorio no reproduce la base
desplegada, y eso es lo que hace peligroso aplicar migraciones a ciegas.

### C9 — ~~Las migraciones 39 y 40 NO están aplicadas~~ (resuelto el 2026-08-10)

> **Al día:** verificado contra el catálogo, hoy están aplicadas la **39, 40 y
> 41**: `get_my_threads()`, `messages.mention_all`, `desafio_reglas()` y
> `club_challenges_valida_rival()` existen en el proyecto. La consecuencia que
> este punto anunciaba sobre la Fase 2 ya no aplica. **La 42 está escrita y
> verificada pero NO aplicada.** Lo que sigue se conserva como registro de lo
> que se encontró al escribir el plan.

Verificado el 2026-08-10: `get_my_threads()` no existe y `messages.mention_all`
tampoco. Es decir, las migraciones 39 (`/todos`) y 40 (bandeja por RPC) están en
el repositorio pero **no** en la base. Sí están aplicadas la 32, 36, 37 y 38
(`chat_reads`, `chat_mutes`, `mark_chat_read`, `chat_are_friends`,
`chat_valid_club_challenge_dm`, `push_tickets`, `check_push_receipts`) y la 33/34
(`partido_reglas`, `save_match_attendance`, `match_waitlist`). `pg_cron` 1.6.4
está instalado, así que el vencimiento por cron de la Fase 3 es viable.

**Consecuencia directa sobre la Fase 2:** la tarea 2.1 planeaba añadir una cuarta
rama a `get_my_threads()`. Esa función no existe en la base, así que
`listMyThreads()` (`src/services/messages.js:517`) hoy no puede funcionar contra
este proyecto. **Antes de la Fase 2 hay que aplicar las migraciones 39 y 40**, o
la bandeja del chat —y con ella el hilo de negociación— no tiene dónde apoyarse.

**Además, no existe un proyecto Supabase de desarrollo:** hay uno solo, y es el
que usa `.env`. Las pruebas SQL de este plan terminan en `rollback` y son seguras,
pero aplicar una migración ahí es tocar el entorno real. Ninguna migración de este
plan se aplica sin autorización explícita.

### C6 — El chat de desafío actual es un DM, no un grupo

Hoy aceptar un desafío manda un mensaje a `dm:<creado_por>` y la RLS lo permite
vía `chat_valid_club_challenge_dm()` (migración 37). Eso no puede cumplir «todos
los administradores actuales de ambos clubes». **Decisión:** se agrega el tipo de
hilo `challenge:<id>` como grupo real. `chat_valid_club_challenge_dm()` **no se
borra**: los desafíos ya aceptados (`estado = 'aceptado'`) conservan su DM
funcionando. Los desafíos nuevos entran a `negociacion` y usan el hilo grupal.
No se migran filas históricas.

### C8 — No existe infraestructura de pruebas de integración

El enunciado pide «pruebas unitarias, de integración y SQL/RLS». En el repositorio
hay exactamente dos mecanismos: `npm test` (`node --test` sobre funciones puras de
`src/**/__tests__`, sin ningún doble de Supabase salvo constructores de consulta
falsos escritos a mano) y las pruebas SQL de `supabase/tests/`, que **se pegan a
mano** en el editor de Supabase y no las ejecuta ningún script ni CI. No hay Jest,
ni `supabase start` local, ni pipeline. **Decisión:** las pruebas de integración
reales de este plan son las SQL —que sí ejercitan RPC, RLS, concurrencia e
idempotencia de extremo a extremo dentro de Postgres— y se declaran como tales.
Montar un arnés de integración en JavaScript es un proyecto aparte, no una
subtarea escondida dentro de éste.

### C7 — `join_match` permitiría saltarse los cupos por club

Si un jugador llama `join_match` sobre un partido de clubes, entra sin pasar por
el reparto por club. **Decisión:** `join_match` rechaza los partidos que tengan
`challenge_proposal_id is not null` (los de este flujo nuevo). Los partidos de
club creados con el flujo antiguo (`club_local_id` puesto, sin propuesta) siguen
funcionando igual que hoy.

---

## Máquina de estados

`club_challenges.estado`. Valores existentes en negrita, nuevos en cursiva.

```
                       ┌─────────────┐
                       │ **pendiente** │
                       └──────┬──────┘
          rechazar │          │ aceptar          │ 7 días
                   ▼          ▼                  ▼
          **rechazado**   *negociacion*    **expirado**
                              │
              72 h sin propuesta → prórroga 24 h (misma fila,
              prorroga_vence_at) ──► un "No" o falta respuesta
                              │                    └──► *sin_acuerdo*
              crear propuesta │
                              ▼
                  *esperando_aprobacion*
                     │              │ rechazar propuesta
        aprobar rival │              └──► vuelve a *negociacion*
                     ▼
                 *publicado*  ──(hora de inicio)──► *en_juego*
                     │                                  │
        cancelar     │                     (fin + duración)
                     ▼                                  ▼
              **cancelado**                    *esperando_resultado*
                                                        │
                                      confirmar │       │ rechazar
                                                ▼       ▼
                                        *finalizado*  *resultado_en_disputa*

Transversal: cualquier estado activo ──(sanción del club)──► *bloqueado_sancion*
             *bloqueado_sancion* ──(revisión retira la sanción)──► estado previo
Legado: **aceptado** (sólo filas anteriores a la migración 41; no se produce más)
```

Transiciones autorizadas, con quién puede dispararlas:

| Desde | Hacia | Quién | RPC |
|---|---|---|---|
| `pendiente` | `negociacion` | admin del club retado | `aceptar_desafio` |
| `pendiente` | `rechazado` | admin del club retado | `rechazar_desafio` |
| `pendiente` | `cancelado` | admin del club retador | `cancelar_desafio` |
| `pendiente` | `expirado` | sistema (7 días) | `procesar_vencimientos_desafios` |
| `negociacion` | `esperando_aprobacion` | admin de cualquiera de los dos | `crear_propuesta_oficial` |
| `negociacion` | `sin_acuerdo` | sistema (prórroga vencida o un «No») | `procesar_vencimientos_desafios` / `responder_prorroga` |
| `esperando_aprobacion` | `publicado` | admin del club **contrario** al proponente | `aprobar_propuesta` |
| `esperando_aprobacion` | `negociacion` | admin del club contrario | `rechazar_propuesta` |
| `publicado` | `en_juego` | sistema (hora de inicio) | `procesar_vencimientos_desafios` |
| `publicado` \| `en_juego` | `cancelado` | admin de cualquiera de los dos | `cancelar_encuentro_club` |
| `en_juego` | `esperando_resultado` | sistema (fin + duración) | `procesar_vencimientos_desafios` |
| `esperando_resultado` | `finalizado` | admin del club contrario al proponente | `confirmar_resultado` |
| `esperando_resultado` | `resultado_en_disputa` | admin del club contrario | `confirmar_resultado(false)` |
| cualquiera activo | `bloqueado_sancion` | sistema | `aplicar_sancion_club` |

---

## Estructura de archivos

### Migraciones nuevas

> **Renumeración (2026-08-10).** La migración 41 se aplicó en el proyecto real
> con las secciones de reglas y anti-autodesafío únicamente. El chat grupal NO
> se le agregó encima —editar una migración ya aplicada es justo lo que prohíbe
> `CLAUDE.md`—, así que pasó a ser la **42** y todo lo posterior corrió un
> número. La tabla ya refleja la numeración real.

| Archivo | Contenido | Estado |
|---|---|---|
| `supabase/migrations/41_desafios_estados_y_chat.sql` | Estados nuevos, columnas de plazos, `desafio_reglas()`, trigger anti-autodesafío | Aplicada |
| `supabase/migrations/42_desafios_chat_negociacion.sql` | Tipo de hilo `challenge:` (columna `messages.challenge_id`, CHECK de destino a cuatro ramas, helpers `chat_puede_ver_desafio`/`chat_puede_escribir_desafio`, RLS, `get_my_threads`, `get_chat_unread_counts`, `chat_notify_mention_all`, `messages_block_content_edits`), `club_challenge_events`, RPC `aceptar_desafio` | Aplicada |
| `supabase/migrations/42b_desafio_rpc_revoke_public.sql` | Quita el `EXECUTE` de `PUBLIC` sobre `aceptar_desafio()`. Va aparte porque la 42 ya estaba aplicada | Aplicada |
| `supabase/migrations/43_desafios_plazos_y_propuesta.sql` | `club_challenge_extension_replies`, `club_challenge_proposals`, RPC `procesar_vencimientos_desafios` (+ `cron.schedule`), `procesar_vencimiento_desafio`, `refrescar_desafio`, `responder_prorroga`, `crear_propuesta_oficial`, `rechazar_propuesta`, helper `desafio_avisar` | Aplicada |
| `supabase/migrations/43b_propuesta_autoriza_antes_del_token.sql` | `crear_propuesta_oficial()` resuelve el `client_token` DESPUÉS de autorizar y atado al desafío. Va aparte porque la 43 ya estaba aplicada | Aplicada |
| `supabase/migrations/43c_propuesta_ubicacion_obligatoria.sql` | `crear_propuesta_oficial()` exige latitud y longitud válidas. Sin ellas la propuesta nacía imposible de aprobar, porque `matches.latitud`/`longitud` son NOT NULL | Aplicada |
| `supabase/migrations/43d_rechazo_doble_pertenencia.sql` | `rechazar_propuesta()` con la regla estricta: no responde quien pertenece al club proponente, ni siquiera como jugador | Aplicada |
| `supabase/migrations/44_partido_de_clubes.sql` | Columnas de `matches`/`attendees`, RPC `aprobar_propuesta` (crea el partido atómicamente), marcador `club_esta_sancionado`, guarda en `add_organizer_as_attendee` | Aplicada |
| `supabase/migrations/44b_ubicacion_protegida_clubes.sql` | `club_match_locations` (ubicación exacta con RLS), `matches.ubicacion_aproximada`, `aproximar_grado()`, guarda en `tg_register_cancha`, GPS sólo con la exacta, `aprobar_propuesta` publica la aproximada | Aplicada |
| `supabase/migrations/44c_notify_match_updated_texto.sql` | `notify_match_updated()` con `array_append`. **Independiente de la 44b**: corrige un fallo preexistente que impedía editar cualquier partido | Aplicada |
| `supabase/migrations/44d_partido_de_clubes_privado.sql` | El partido de clubes es privado hasta que termina: RLS de `matches`, `attendees` y `match_waitlist`, triggers que atrapan a las RPC de inscripción, y `historial_publico_club()` como única salida pública | Aplicada |
| `supabase/migrations/44e_attendees_solo_por_rpc.sql` | Cierra toda escritura directa de `attendees`/`match_waitlist`, agrega `cancel_join_request` y serializa `approve_join` | Aplicada el 2026-08-13 |
| `supabase/migrations/45_inscripcion_por_club.sql` | RPC de nómina por club, `attendees.origen`, reserva voluntaria al proponer/aprobar, Realtime y aviso de reserva omitida | Aplicada el 2026-08-13 |
| `supabase/migrations/46_cambios_de_partido.sql` | `club_match_changes`, RPC `proponer_cambio_partido`, `responder_cambio_partido` | Pendiente |
| `supabase/migrations/47_sanciones_y_revisiones.sql` | `club_sanctions`, `club_sanction_reviews`, `club_match_noshow_reports`, RPC `cancelar_encuentro_club`, `aplicar_sancion_club`, `reportar_incomparecencia`, `solicitar_revision_sancion`, `resolver_revision_sancion` (sólo service_role), y el cuerpo real de `club_esta_sancionado` | Pendiente |
| `supabase/migrations/48_resultado_y_historial.sql` | `club_match_results`, RPC `proponer_resultado`, `confirmar_resultado`, `club_record()` | Pendiente |

> **Renumeración (2026-08-12).** La Fase 4 se partió en cuatro unidades y cada
> una lleva su propia migración aplicable sola, en vez de meter aprobación e
> inscripción en la 44. Por eso inscripción pasó a la 45, cambios a la 46,
> sanciones a la 47 y resultado a la 48. La tabla ya refleja la numeración
> nueva.

### Pruebas SQL nuevas

`supabase/tests/42_desafio_chat_rls_test.sql`, `43_desafio_plazos_test.sql`,
`44_partido_clubes_cupos_test.sql`, `44e_attendees_solo_por_rpc_test.sql`,
`45_inscripcion_por_club_test.sql`, `45b_origen_compatibilidad_test.sql`,
`45c_reserva_voluntaria_test.sql`, `45d_escritores_attendees_test.sql`,
`46_cambios_de_partido_test.sql`,
`47_sanciones_test.sql`, `48_resultado_test.sql`. Mismo estilo que
`36_chat_security_test.sql`: `begin; do $$ … raise exception 'FALLÓ (caso N): …' … $$; rollback;`,
usuarios de prueba insertados en `auth.users`, identidad simulada con
`set local role authenticated` + `set local request.jwt.claims`.

### Código nuevo

| Archivo | Responsabilidad |
|---|---|
| `src/services/clubChallengeRules.js` | Única fuente de reglas del ciclo (plazos, cupos, transiciones, etiquetas, CTA, motivos de bloqueo). Puro, sin React ni Supabase. Espejo de `desafio_reglas()`. |
| `src/services/clubChallenges.js` | *(existente, se amplía)* llamadas a las RPC nuevas |
| `src/services/clubProposals.js` | Propuesta oficial, prórroga, cambios post-publicación |
| `src/services/clubSanctions.js` | Sanciones, incomparecencia, revisiones |
| `src/services/clubResults.js` | Resultado, asistencia real, récord V/E/D |
| `src/utils/challengeThread.js` | Puro: `challengeThreadKey`, `parseChallengeThread`, `resolveThreadAccent`, etiquetas de la tarjeta del chat |
| `src/components/clubes/` | Sistema visual del módulo (ver Fase 1) |
| `src/screens/ClubChallengeWizardScreen.js` | Crear desafío (propuesta preliminar) |
| `src/screens/ClubProposalScreen.js` | Crear / revisar propuesta oficial |
| `src/screens/ClubMatchRosterScreen.js` | Nómina e inscripción por club |
| `src/screens/ClubResultScreen.js` | Proponer / confirmar resultado |

### Pruebas unitarias nuevas

`src/services/__tests__/clubChallengeRules.test.js`,
`src/utils/__tests__/challengeThread.test.js`, y ampliaciones de
`src/utils/__tests__/notificationTargets.test.js` y `chatMeta.test.js`.

---

## FASE 1 — Explorador, creación y desafío

**Entregable:** las cinco superficies de entrada renovadas sobre `dsColors`, con
los cinco estados obligatorios, y la exclusión de clubes propios aplicada en
interfaz, servicio y base de datos.

**Riesgo principal:** `CreateClubScreen`, `ClubChallengeScreen` y
`ClubChallengesScreen` usan hoy la paleta global `colors` (`#201F1D`/`#71B533`),
distinta de `dsColors` (`#0B0D0C`/`#5AE06A`) que usa el resto de Clubes. Migrarlas
cambia su aspecto de forma visible. Es exactamente lo que pide el enunciado
(«sigue el sistema visual actual documentado en la memoria»), pero hay que
hacerlo pantalla por pantalla y revisar cada una.

### Tarea 1.1 — Reglas del ciclo (núcleo puro y testeable)

**Archivos:** crear `src/services/clubChallengeRules.js`; crear
`src/services/__tests__/clubChallengeRules.test.js`.

**Produce:** `ESTADOS`, `TRANSICIONES`, `CUPOS_POR_CLUB = {min:4, max:15}`,
`NEGOCIACION_HORAS = 72`, `PRORROGA_HORAS = 24`, `CAMBIO_LIMITE_HORAS = 2`,
`SANCION_DIAS = 14`, `METODOS_INSCRIPCION`, `puedeTransicionar(desde, hacia)`,
`estadoLabel(estado)`, `validarPropuestaPreliminar(draft)`,
`validarPropuestaOficial(draft)`, `getChallengeCta(ctx)`,
`getChallengeBlockReason(ctx)`.

- [ ] Escribir las pruebas primero: transiciones válidas/ inválidas, cupos por
      debajo de 4 y por encima de 15 rechazados, misma cantidad para ambos clubes,
      etiquetas en español, CTA por estado y por rol (admin del retador, admin del
      retado, miembro sin rol).
- [ ] `npm test` → fallan por módulo inexistente.
- [ ] Implementar el módulo.
- [ ] `npm test` → pasan.
- [ ] Commit.

### Tarea 1.2 — Migración 41 (parte de reglas y anti-autodesafío)

**Archivos:** crear `supabase/migrations/41_desafios_estados_y_chat.sql`
(sección 1 y 2).

- [ ] Ampliar `club_challenges_estado_check` con los estados nuevos, conservando
      `aceptado` (filas legadas, C6).
- [ ] Agregar columnas: `negociacion_vence_at`, `prorroga_vence_at`,
      `prorroga_abierta_at`, `motivo_cierre`, `estado_previo_sancion`,
      `client_token uuid` con índice único parcial.
- [ ] Crear `desafio_reglas()` `immutable` devolviendo el JSON espejo de
      `clubChallengeRules.js`.
- [ ] Crear trigger `before insert on club_challenges` →
      `club_challenges_valida_rival()`: rechaza si `creado_por` es miembro de
      `club_retado_id`, o si los dos clubes comparten cualquier administrador.
      Este es el cierre de backend pedido en la Fase 1 punto 3.
- [ ] Escribir `supabase/tests/41_desafio_chat_rls_test.sql` casos 1–3
      (autodesafío bloqueado, desafío a club propio bloqueado, desafío legítimo
      permitido).
- [ ] Commit.

### Tarea 1.3 — Servicio: candidatos rivales con exclusión

**Archivos:** modificar `src/services/clubs.js` (agregar
`listRivalCandidates({ retadorClubId, query, limit })`); modificar
`src/services/clubChallenges.js` (`createChallenge` acepta los campos nuevos de la
propuesta preliminar).

**Consume:** `getMyClubs()`. **Produce:** `listRivalCandidates` devolviendo
`{ data, error }` con los clubes propios del usuario **y** el club retador
excluidos en la consulta, no después de traerla.

- [ ] Prueba con el cliente falso encadenable (patrón de
      `src/utils/__tests__/searchPlayersQuery.test.js`): verificar que la
      exclusión viaja como filtro `not.in` en la consulta, no como `filter()` en
      memoria.
- [ ] Implementar y hacer pasar.
- [ ] Ampliar `createChallenge` con `modalidad`, `fecha_desde`, `fecha_hasta`,
      `cupos_por_club`, `metodo_inscripcion`, validando con
      `validarPropuestaPreliminar`.
- [ ] Migración 41: columnas correspondientes en `club_challenges`.
- [ ] Commit.

### Tarea 1.4 — Sistema visual del módulo Clubes

**Archivos:** crear `src/components/clubes/ui.js`, `StateViews.js`, `Sheet.js`,
`ClubPickerSheet.js`.

Espeja `src/components/partidos/ui.js` y `StateViews.js` (que ya resuelven bien
loading / vacío / error / sin conexión) pero sobre `dsColors`/`dsRadius`/`dsSizes`,
que es la familia del módulo Clubes. No se reutilizan los de Partidos para no
mezclar paletas.

- [ ] `ui.js`: `PrimaryButton` (≥48 px), `GhostButton`, `SurfaceButton`,
      `IconButton`, `Pill`, `OptionChip`, `Input`, `SelectField`, `Stepper`
      (con `min`/`max` inyectables — aquí 4/15), `RadioRow`, `FieldLabel`,
      `SectionLabel`, `Note`, `Callout`, `Divider`.
- [ ] `StateViews.js`: `LoadingList`, `ErrorState`, `OfflineNotice`, `EmptyState`
      —usando `services/connectivity.js`, que ya existe.
- [ ] `Sheet.js` + `ClubPickerSheet.js`: selector de club propio y de club rival,
      con buscador y exclusión ya aplicada por el servicio.
- [ ] Commit.

### Tarea 1.5 — Explorador y selector de clubes

**Archivos:** modificar `src/components/club/ClubExplorer.js` (745 líneas) y
`ClubExplorerCard.js`; modificar `src/screens/ExploreClubsScreen.js`.

- [ ] Migrar de `clubsExplorer`/`clubsExplorerRadius` a `dsColors`/`dsRadius`
      para unificar el verde (`#55DF69` → `#5AE06A`). Los tokens
      `clubsExplorer*` quedan en `colors.js` sin uso; **no se borran** en esta
      fase para no romper nada fuera de la vista.
- [ ] Reemplazar los estados ad-hoc por `StateViews`.
- [ ] `puedoDesafiar` deja de sólo ocultar el botón: los clubes propios se
      excluyen de la lista cuando la vista está en modo «elegir rival».
- [ ] Commit.

### Tarea 1.6 — Crear club

**Archivos:** modificar `src/screens/CreateClubScreen.js` (412 líneas).

- [ ] Migrar de `colors`/`radius` a `dsColors`/`dsRadius`/`dsSizes`.
- [ ] Sustituir controles por las primitivas de `components/clubes/ui.js`.
- [ ] Agregar estado sin conexión y botón deshabilitado con motivo visible.
- [ ] Commit.

### Tarea 1.7 — Asistente de creación de desafío

**Archivos:** crear `src/screens/ClubChallengeWizardScreen.js`; registrar la ruta
en `src/navigation/AppNavigator.js` (con `withAuthGuard`, animación
`slide_from_bottom`); dejar `ClubChallengeScreen.js` como redirección para no
romper los `navigate('ClubChallenge', …)` existentes de `ClubDetailScreen`.

Paso 1 club retador (sólo donde soy admin) → paso 2 club rival (`ClubPickerSheet`,
excluye propios) → paso 3 propuesta preliminar: modalidad, fecha o rango
tentativo, zona aproximada, cupos por equipo (stepper 4–15, etiqueta explícita
«por club»), método de inscripción (`RadioRow` con las dos descripciones del
enunciado) y mensaje opcional.

- [ ] Implementar el asistente con los cinco estados.
- [ ] Verificar que el rival elegido nunca puede ser un club propio ni el retador.
- [ ] Commit.

**Verificación de fase:** `npm test`, `npm run build:web`, prueba SQL 41 en el
Supabase de desarrollo, y repaso manual de que Partidos, Chat y el detalle de club
siguen intactos.

---

## FASE 2 — Aceptación y chat grupal de negociación

**Entregable:** aceptar un desafío abre un hilo grupal `challenge:<id>` con todos
los administradores de ambos clubes, protegido por RLS, con aviso de CTA «IR
AHORA» y tarjeta de acento rojo neón que se apaga por administrador.

**Riesgo principal:** `get_my_threads()` (migración 40) y
`get_chat_unread_counts()` (migración 36) hay que reescribirlas enteras para
añadir la cuarta rama. Si sólo se toca una, la bandeja muestra el hilo con 0 no
leídos para siempre. `chatMeta.test.js` tiene 859 líneas: cambiar
`TYPE_BY_FILTER` puede romperlas.

### Tarea 2.1 — Migración 42 (chat de negociación)

- [x] `alter table messages add column challenge_id uuid references club_challenges(id) on delete cascade`.
- [x] **Ampliar `messages_target_exactly_one` a cuatro alternativas.** No estaba
      en el plan y es bloqueante: el CHECK desplegado exige que uno de los tres
      destinos antiguos esté puesto, así que sin esto ningún mensaje de desafío
      se puede insertar.
- [x] Actualizar `messages_block_content_edits()` para que `challenge_id` también
      sea inmutable tras el insert.
- [x] **Dos helpers, no uno.** El plan pedía un `chat_puede_ver_desafio` que
      exigiera estado activo, pero la tarea 3.1 pide archivar el hilo cerrado
      *en solo lectura*: con un helper único, cerrar el desafío borraría la
      conversación de la bandeja. Quedaron `chat_puede_ver_desafio` (leer, en
      cualquier estado) y `chat_puede_escribir_desafio` (admin + estado activo,
      leído desde `desafio_reglas()`). Los dos `security invoker` y `stable`,
      derivados de `club_members` en vivo.
- [x] Cuarta rama en las políticas `messages_read` y `messages_insert`.
- [x] Cuarta rama en `get_chat_unread_counts()` y cuarta rama `union all` en el
      CTE `raw` de `get_my_threads()`, con `payload` que incluye `estado`,
      `club_retador`, `club_retado`, `mi_club_id`, `vence_at`,
      `prorroga_abierta` y `abierto_alguna_vez`. Además `dm_peers`/`last_dm_msg`
      ahora exigen `challenge_id is null`: sin eso un mensaje de desafío propio
      generaba una fila DM fantasma con `other_id` nulo.
- [x] **Rama de desafío en `chat_notify_mention_all()`.** Tampoco estaba en el
      plan: `/todos` habría marcado el mensaje como mención sin avisar a nadie,
      porque la función salía por el `else`.
- [x] `club_challenge_events` + RLS de lectura para los mismos administradores.
- [x] RPC `aceptar_desafio(p_challenge_id uuid)`: `select … for update` +
      `update … where estado='pendiente'` (idempotente ante doble pulsación),
      fija `negociacion_vence_at = now() + 72h`, inserta el evento, inserta el
      mensaje de sistema y notifica a los administradores de ambos clubes con
      `type='club_challenge_accepted'` y `data.threadKey='challenge:'||id`.
- [x] Tipos nuevos en `notifications_type_check`: **no hicieron falta**.
      `club_challenge_accepted` y `chat_mention_all` ya existían, y el trigger
      antiguo `notify_club_challenge_responded` no se dispara con
      `negociacion`, así que no hay avisos duplicados.
- [x] Pruebas SQL (`42_desafio_chat_rls_test.sql`), 12 casos: admin de cada club
      lee y escribe; jugador sin rol de cualquiera de los dos clubes **no** lee
      ni escribe; tercero ajeno no lee ni ve la bitácora; degradar a un admin a
      jugador le quita el acceso; `aceptar_desafio` dos veces deja una sola
      transición; el hilo cerrado queda legible pero mudo; el DM entre los dos
      administradores sigue siendo otra conversación; `challenge_id` inmutable.
      **Corridas contra el esquema desplegado dentro de `begin … rollback`:
      pasan las 12 y no queda nada en la base.**
- [x] Commit.

> **Sobre los clubes premium.** `check_club_limits()` permite 1 administrador en
> el plan estándar y 3 en premium. El hilo grupal es entonces 1+1 hoy y hasta
> 3+3 en premium; la prueba SQL usa clubes premium a propósito, porque con un
> solo administrador por club no se estaría probando que el hilo es grupal.

### Tarea 2.2 — Hilo de desafío en el cliente

**Archivos:** crear `src/utils/challengeThread.js` + su prueba; modificar
`src/services/messages.js`, `src/utils/chatMeta.js`.

`messages.js` tiene cinco puntos donde se ramifica por tipo de hilo, y todos
necesitan la rama nueva: `getThreadAccess` (L360), `listThreadMessages` (L558),
`sendMessage` (L638, columna `challenge_id`), `getThreadParticipants` (L727) y
`messageBelongsToThread` (L879).

- [x] Pruebas de `challengeThread.js`: construir y parsear la clave, longitud
      dentro del rango 3–120 que exige `chat_reads`, y `resolveThreadAccent`
      devolviendo el acento neón sólo mientras `abierto_alguna_vez` sea falso.
- [x] Rama nueva en `mapThreadRow` (título = «Club A vs Club B», subtítulo =
      etiqueta de estado).
- [x] `TYPE_BY_FILTER`: el filtro «Clubes» pasa a aceptar `['club','challenge']`.
      `filterThreads` admite valor único o arreglo; `filterCounts` cuenta lo
      mismo que muestra el filtro. Ninguna prueba existente se editó.
- [x] `canUseMentionAll`: aceptar `'challenge'` (es un grupo). Se extrajo
      `isGroupType()` como definición única de «grupo», que antes estaba escrita
      a mano en cuatro lugares.
- [x] `threadKindLabel`: etiqueta «DESAFÍO».
- [x] `npm test`, incluida la suite de 859 líneas: 270 pruebas, 0 fallos.
- [x] Commit.

### Tarea 2.3 — Tarjeta de chat con acento rojo neón

**Archivos:** modificar `src/theme/colors.js` (agregar `neon` a `chatColors`);
modificar `src/components/chat/ConversationCard.js` y `ThreadAvatar.js`.

`ConversationCard` ya tiene el punto exacto de inyección: el arreglo `style`
(L46-53) y el `LinearGradient` condicional (L54-66), hoy gobernados por
`isClub`.

- [x] Añadir `isChallenge` y `styles.cardChallenge` con borde rojo neón. Sin
      animación ni parpadeo, tal como pide el enunciado.
- [x] Texto «Nuevo desafío aceptado» mientras no se haya abierto; después,
      etiqueta discreta «Negociación activa».
- [x] El acento se resuelve con `resolveThreadAccent(thread)` — una función, no
      un color literal en el componente. Ese es el punto donde más adelante
      entrará el color temático del club, sin implementarlo ahora.
- [x] Rama `challenge` en `ThreadAvatar` (escudos cruzados sobre degradado
      neón, no la inicial de DM).
- [x] Commit.

### Tarea 2.4 — CTA «IR AHORA» de extremo a extremo

**Archivos:** modificar `src/utils/notificationTargets.js` y su prueba;
modificar `src/components/notifications/NotificationCard.js` (177 líneas);
modificar `src/utils/notificationPreferences.js` y el espejo Deno
`supabase/functions/send-push/pushLogic.ts`; modificar `AppNavigator.js`
(`linking`).

- [x] `club_challenge_accepted` con `data.threadKey` presente pasa a resolver
      `{ screen: 'ChatThread', params: { threadKey } }`. Si falta `threadKey`
      (avisos antiguos), conserva el destino actual `ClubChallenges`. Prueba
      unitaria para ambas ramas.
- [x] Botón verde «IR AHORA» en `NotificationCard` para los tipos de desafío que
      traigan `threadKey`. Dispara el mismo `onPress` de la tarjeta, así que no
      hay dos caminos de navegación que mantener.
- [x] Mapear los tipos nuevos a `notif_clubs` en las dos copias del mapa: **no
      hizo falta**, porque no se agregó ningún tipo de notificación nuevo. Los
      dos mapas siguen sincronizados y la prueba que los compara pasa.
- [x] Añadir `ChatThread: 'chat/:threadKey'` a `linking.config.screens` para que
      el destino funcione con la app cerrada.
- [x] `npm test` (270 pruebas) y `deno test … pushLogic.test.ts` (13 pruebas).
- [x] Commit.

### Tarea 2.5 — Cabecera de negociación dentro del hilo

**Archivos:** modificar `src/screens/ChatThreadScreen.js` (la barra fija sobre el
compositor, L774-840, ya existe para desafíos); crear
`src/components/clubes/ChallengeHeader.js` y `ChallengeEventBubble.js`.

- [x] Cabecera con los dos clubes, estado actual, contador de negociación
      (calculado desde `vence_at` del servidor, nunca desde la hora del
      dispositivo) y acciones contextuales según `getChallengeCta`.
- [x] Los `club_challenge_events` se intercalan como burbujas de sistema en el
      historial, sin desplazar los mensajes normales entre administradores: se
      mezclan por hora **después** de `decorateMessages`, así que no parten la
      tanda de burbujas de ningún administrador.
- [x] Commit.

> **Acciones que todavía no existen.** `getChallengeCta` ya devuelve
> `crear_propuesta`, `responder_prorroga`, `aprobar_propuesta` y las de
> resultado, pero esas transiciones llegan con las migraciones 43 en adelante.
> `ChallengeHeader` solo dibuja un botón cuando la app sabe ejecutar la acción
> —hoy, únicamente «Ver el partido»—; el resto se muestra como información. Un
> botón que no hace nada es peor que no tener botón.

**Verificación de fase:** `npm test` (270 ✓), `npm run build:web` (✓),
`deno test … pushLogic.test.ts` (13 ✓) y la prueba SQL 42 completa corrida
**contra el esquema ya aplicado** en una transacción con `rollback` (12 casos ✓,
sin dejar filas). Migraciones 42 y 42b aplicadas y verificadas contra el
catálogo el 2026-08-10.

> **Advisor de seguridad.** Tras aplicar la 42, el advisor de Supabase marcó
> «Public Can Execute SECURITY DEFINER Function» sobre `aceptar_desafio()`:
> `revoke ... from anon` no quita el `EXECUTE` que PostgreSQL concede a
> `PUBLIC` por defecto. Cerrado en la 42b y comprobado que `authenticated`
> sigue pudiendo ejecutarla y `anon` no. **Para las RPC de las fases
> siguientes: revocar de `public`, no de `anon`.**

**Comprobación manual hecha el 2026-08-11:** aceptar un desafío real abre el
hilo grupal, se ve la conversación y se pueden enviar mensajes. Fase 2
cerrada.

> **Dos fallos que salieron en esa comprobación**, los dos ya corregidos:
>
> 1. El hilo quedaba **en blanco** por un `ReferenceError: myClubId is not
>    defined`: variable local en español (`miClubId`) contra la clave en
>    inglés del contrato de `getChallengeCta`, unidas por la forma abreviada
>    de objeto. Ahora el contexto lo arma `challengeCtaContext()`, función
>    pura con pruebas que fijan el nombre de la clave. Ver
>    `docs/memoria/decisiones/2026-08-11-contexto-cta-desafio.md`.
> 2. `supabase.channel(topic)` **reutiliza** el canal existente, así que un
>    segundo suscriptor al mismo topic reventaba con «cannot add
>    postgres_changes callbacks … after subscribe()». Preexistente, en los
>    avisos; resuelto con `createSharedChannel`.
>
> **Dos carencias que dejó al descubierto, y que siguen abiertas:** el
> proyecto no tiene **ESLint** (`no-undef` habría atrapado el primero en un
> segundo) ni ningún **error boundary** (sin él, cualquier excepción de
> render deja la app en blanco y sin mensaje, que es lo que hizo caro el
> diagnóstico). Las dos son trabajo aparte de este plan.

---

## FASE 3 — Plazos y propuesta oficial

**Entregable:** vencimientos procesados por el servidor de forma idempotente,
prórroga de 24 h con una respuesta por club, y propuesta oficial que sólo el club
contrario puede aprobar.

**Riesgo principal:** doble aprobación por doble pulsación, y un administrador
aprobando en nombre de ambos clubes si pertenece a los dos. La segunda ya está
cubierta por el trigger de la Tarea 1.2, pero la RPC debe volver a comprobarlo.

### Tarea 3.1 — Vencimientos en servidor

**Archivos:** crear `supabase/migrations/43_desafios_plazos_y_propuesta.sql`
(secciones 1–2); crear `supabase/tests/43_desafio_plazos_test.sql`.

- [x] `club_challenge_extension_replies` con `unique (challenge_id, club_id)` —
      la unicidad es lo que hace idempotente «basta un administrador por club».
- [x] `procesar_vencimientos_desafios()`: en una sola pasada, `pendiente`
      vencido → `expirado`; `negociacion` vencida sin prórroga → abre prórroga de
      24 h + evento + aviso «¿Este partido se disputará?»; prórroga vencida sin
      dos «Sí» → `sin_acuerdo` + archivar el hilo como sólo lectura + avisar;
      `publicado` con hora pasada → `en_juego`; `en_juego` pasado fin+duración →
      `esperando_resultado`. Todo con `where` sobre el estado esperado, de modo
      que ejecutarla dos veces seguidas no cambia nada.
- [x] `revoke execute … from anon, authenticated` y `cron.schedule('futfinder-desafios','*/5 * * * *', …)`,
      siguiendo el patrón de `38_push_reliability.sql:174`.
- [x] Además, una RPC pública y delgada `refrescar_desafio(p_challenge_id uuid)`
      que aplique los mismos vencimientos **sólo a esa fila**, para que la
      pantalla no dependa de esperar al cron. El cron es la fuente fiable; esto
      es sólo latencia.
- [x] Sólo lectura del hilo cuando el desafío está cerrado: la política
      `messages_insert` consulta el estado vía `chat_puede_ver_desafio`, que ya
      exige estado activo. Comprobarlo en la prueba SQL.
- [x] Prueba SQL: correr `procesar_vencimientos_desafios()` dos veces seguidas y
      verificar que el segundo pase no produce eventos ni avisos nuevos.
- [x] Commit.

### Tarea 3.2 — Respuesta de prórroga

- [x] RPC `responder_prorroga(p_challenge_id uuid, p_respuesta boolean)`: exige
      prórroga abierta y no vencida, deriva el club del `auth.uid()`, inserta con
      `on conflict do nothing` (idempotente). Un «No» cierra el desafío en
      `sin_acuerdo` de inmediato.
- [x] Servicio `src/services/clubProposals.js` + interfaz en `ChallengeHeader`.
- [x] Prueba SQL: dos administradores del mismo club responden, queda una fila;
      un «No» cierra; falta de respuesta al vencer cierra.
- [x] Commit.

### Tarea 3.3 — Propuesta oficial

**Archivos:** migración 43 (sección 3); crear `src/screens/ClubProposalScreen.js`.

- [x] Tabla `club_challenge_proposals` con todos los campos del enunciado:
      `fecha`, `duracion_min`, `direccion`, `cancha_nombre`, `comuna`, `region`,
      `latitud`, `longitud`, `modalidad`, `cupos_por_club` (check 4–15),
      `metodo_inscripcion`, `cuota_por_persona`, `instrucciones`, `estado`,
      `client_token` con índice único parcial.
- [x] Índice único parcial `where estado = 'pendiente'`: **una sola propuesta
      abierta por desafío**.
- [x] `crear_propuesta_oficial(p_challenge_id, p_payload jsonb, p_client_token uuid)`:
      admin de cualquiera de los dos clubes, desafío en `negociacion`, pasa a
      `esperando_aprobacion`. Reintento con el mismo `client_token` devuelve la
      propuesta existente sin crear otra.
- [x] `rechazar_propuesta(p_proposal_id, p_motivo)`: sólo admin del club
      contrario; vuelve a `negociacion` conservando el registro.
- [x] Pantalla de creación y de revisión con todos los campos, validados por
      `validarPropuestaOficial` antes de llamar.
- [x] Dirección exacta, cuota e información oficial visibles para **todos** los
      integrantes de ambos clubes: política de `select` sobre
      `club_challenge_proposals` para `club_members` de cualquiera de los dos
      clubes (no sólo administradores).
- [x] Prueba SQL: el proponente no puede aprobar su propia propuesta; un miembro
      no admin no puede crear ni aprobar; un miembro sin rol **sí** puede leer.
- [x] Commit.

**Verificación de fase:** `npm run lint` (0 errores), `npm test` (293 ✓),
`npm run build:web` (✓), `deno test … pushLogic.test.ts` (13 ✓) y la prueba
SQL 43 corrida **contra el esquema ya aplicado** en una transacción con
`rollback` (15 casos ✓, sin dejar filas). Migraciones 43 y 43b aplicadas y
verificadas contra el catálogo el 2026-08-11: las siete funciones nuevas dan
`has_function_privilege('public', …) = false` y el job `futfinder-desafios`
está activo cada 5 minutos.

> **Tres cosas que salieron al implementar y no estaban en el plan.**
>
> 1. **Las respuestas de prórroga se borran al reabrir la negociación.** El
>    plan pedía `unique (challenge_id, club_id)` sin más, pero esas filas
>    sobrevivían a la reapertura: una segunda prórroga nacía con dos «Sí»
>    viejos, el desafío se reabría solo indefinidamente y nadie podía volver
>    a responder por el conflicto de unicidad. El historial queda en
>    `club_challenge_events`.
> 2. **Proponer durante la prórroga la cierra.** Si no, un rechazo devolvía
>    el desafío a un plazo ya vencido y el barrido lo cerraba sin acuerdo
>    justo cuando los dos clubes estaban negociando.
> 3. **El `client_token` no puede resolverse antes de autorizar.** La 43
>    devolvía la propuesta a cualquiera que acertara un token, porque el
>    `return` temprano de la idempotencia estaba antes de consultar
>    `club_members`, y la función es `security definer`. Cerrado en la
>    **43b**, que además ata el token al desafío pedido. Adivinar un uuid no
>    es realista, pero el token lo genera el cliente y no hay ninguna
>    garantía sobre su entropía.
>
> **Los vencimientos automáticos no escriben mensajes:** `messages.sender_id`
> es NOT NULL y el sistema no es un usuario, así que dejan sólo un evento de
> bitácora, que el hilo ya intercala como burbuja.
>
> **Aprobar la propuesta no está en esta fase** (es la tarea 4.1, migración
> 44, porque publica el partido). `ClubProposalScreen` deja leer la propuesta
> entera y pedir cambios, y dice explícitamente que aprobar llega después.

**Comprobación manual hecha el 2026-08-11:** el chat de negociación carga, se
abre «Crear propuesta oficial», la propuesta se guarda y vuelve a mostrarse
con sus datos. Sin pantalla blanca ni error visible. **Fase 3 cerrada.**

> **Lo que esa comprobación NO cubrió**, porque depende del paso del tiempo o
> de un segundo club administrado, y queda para cuando ocurra solo:
> la apertura de la prórroga a las 72 h y su cierre a las 24 h (los ejercita
> el cron; en la prueba SQL se fuerzan moviendo las fechas hacia atrás, no el
> reloj), el «No» que cierra el desafío sin acuerdo, y el rechazo de la
> propuesta desde el club contrario. Los tres están cubiertos por los 15
> casos SQL contra el esquema aplicado.

---

## FASE 4 — Publicación, convocatoria y cambios

**Entregable:** aprobar la propuesta crea el partido en la misma transacción, con
cupos separados por club, y todo cambio posterior necesita el visto bueno del
club contrario.

**Riesgo principal:** partidos duplicados si la aprobación se pulsa dos veces, y
sobrecupo si dos jugadores del mismo club entran a la vez.

### Tarea 4.1 — Aprobación atómica que publica el partido ✅

**Archivos:** `supabase/migrations/43c_propuesta_ubicacion_obligatoria.sql`,
`43d_rechazo_doble_pertenencia.sql`, `44_partido_de_clubes.sql`; pruebas
`supabase/tests/43c_propuesta_ubicacion_test.sql`,
`43d_rechazo_doble_pertenencia_test.sql`, `44_partido_clubes_test.sql`;
`src/services/clubProposals.js`, `clubChallengeRules.js`,
`src/utils/challengeThread.js`, `src/screens/ClubProposalScreen.js`,
`ChatThreadScreen.js`, `src/components/clubes/ChallengeHeader.js`.

- [x] Columnas en `matches`: `cupos_por_club`, `metodo_inscripcion`,
      `challenge_proposal_id` con índice único parcial. La unicidad es la
      garantía **estructural** de que no hay partido duplicado.
- [x] Columna `attendees.club_id`, índice `(id_partido, club_id, estado)`.
- [x] `aprobar_propuesta(p_proposal_id uuid)` en una sola transacción, con
      `cupos_totales = 2 × cupos_por_club`, el desafío a `publicado`, el evento
      y el aviso `club_match_published` a **todos** los integrantes.
- [x] `club_esta_sancionado` como marcador documentado que devuelve `false`
      siempre, revocado de los tres roles del cliente para que ninguna pantalla
      se apoye en él. El cuerpo real llega en la 47.
- [x] Prueba SQL 44, 13 casos.
- [x] Commit.

> **Cuatro cosas que salieron al implementar y no estaban en el plan.**
>
> 1. **La propuesta oficial no capturaba coordenadas.** `matches.latitud` y
>    `longitud` son NOT NULL, pero `ClubProposalScreen` pedía la dirección
>    como texto libre y la 43 no exigía el punto en el mapa: **toda propuesta
>    creada hasta entonces era imposible de aprobar**. Se integró
>    `LocationAutocomplete` (el mismo componente de `PublishMatchScreen`) y se
>    exigen coordenadas en `validarPropuestaOficial`, en
>    `crear_propuesta_oficial` (43c) y otra vez en `aprobar_propuesta`, que no
>    confía en que otra función validara antes.
> 2. **`propuestaOficialPayload` convertía una coordenada ausente en 0.**
>    `Number(null)` es 0 en JavaScript, así que el guardia
>    `Number.isFinite(Number(v))` la dejaba pasar. Una propuesta sin ubicación
>    habría publicado el partido en medio del Atlántico. Por eso el servidor
>    valida el RANGO y no sólo la nulidad.
> 3. **`rechazar_propuesta` tenía el mismo hueco de doble pertenencia** que
>    cierra `aprobar_propuesta`: quien administra el club rival y además
>    pertenece al proponente podía responderse a sí mismo. Cerrado en la 43d
>    con la regla estricta, y espejado en `getChallengeCta`
>    (`conflicto_pertenencia`) para no ofrecer un botón que el servidor
>    rechaza.
> 4. **El organizador se autoinscribía.** `add_organizer_as_attendee` metía al
>    administrador que aprueba como 'inscrito': le gastaba un cupo a su club
>    sin pedirlo y dejaba una fila con `club_id` NULL, que es justo lo que el
>    conteo por club no sabe contar. Ahora el trigger salta en los partidos de
>    clubes; en los normales no cambia nada.
>
> **Dos fallos que las pruebas encontraron antes de aplicar nada:**
> `jsonb_typeof(x) <> 'number'` vale NULL cuando la clave no existe, así que
> el `if` no disparaba y dejaba pasar justamente el caso de la clave ausente
> (hay que usar `is distinct from`); y `set local role anon` **no borra**
> `request.jwt.claims`, de modo que una prueba de acceso anónimo seguía
> autenticada como el usuario anterior y pasaba midiendo otra cosa.

> **`add_organizer_as_attendee` es ejecutable por `anon` vía RPC.** Es estado
> heredado —lo comparten `matches_guard_cupos`, `tg_notify_match_join`,
> `tg_register_cancha` y otras 50 funciones—, no algo que introdujera la 44:
> `create or replace` conserva la ACL. Los triggers no comprueban EXECUTE, así
> que revocarlo es seguro; queda anotado en pendientes como limpieza aparte.

### Tarea 4.2 — Inscripción con cupos por club ✅ (U3 CERRADA el 2026-08-13)

> **Antes de empezar, un agujero que hay que cerrar acá.** Las políticas
> `attendees_insert_self`, `attendees_update_self` y `attendees_delete_self`
> dejan a cualquier `authenticated` escribir en `attendees` directo por
> PostgREST, saltándose `join_match`. Sin cerrarlo, el reparto por club no
> sirve de nada: un jugador se mete al partido con un `insert`. El cliente ya
> usa sólo RPC, así que acotar esas tres políticas con
> `challenge_proposal_id is null` no cambia el comportamiento de los partidos
> normales. Además, `join_match` **no está versionada** (es de las aplicadas
> por consola, como `request_join`, `approve_join` y `cancel_match`): para
> ponerle la guarda C7 hay que versionar su definición actual con la guarda
> añadida, y aprovechar de revocarle el `EXECUTE` de `public`.

- [x] `join_club_match(p_match_id)`: deriva el club del jugador de `club_members`
      ∩ {local, visitante}; si no pertenece a ninguno, rechaza. Bloquea la fila
      del partido (`select … for update`) y cuenta los inscritos de ese club
      antes de insertar: eso es lo que impide el sobrecupo, no un contador
      global. `orden_llegada` → `inscrito`; `seleccion_admin` → `pendiente`.
- [x] `leave_club_match(p_match_id)` y `confirmar_nomina_club(p_match_id, p_player_id, p_aprobar)`
      (admin del club **del jugador**, no del otro).
- [x] Guarda en `join_match`: rechazar si `challenge_proposal_id is not null`
      (decisión C7).
- [x] `src/screens/ClubMatchRosterScreen.js`: cupos disponibles, confirmados y
      pendientes **por equipo**.
- [x] Prueba SQL: el intento N+1 no supera el límite; una prueba real de dos
      sesiones confirma que el bloqueo de la fila serializa a la segunda;
      un jugador del club A no puede ocupar cupo del club B; un ajeno no entra.
- [x] Despliegue coordinado en producción: 44e, comprobación inmediata y luego 45.
- [x] Cliente U3 integrado y verificado para móvil y web.
- [x] Comprobación manual autenticada con cuentas de ambos clubes (2026-08-13,
      tras el arreglo de la nómina), en web a 904 px y a 390 × 845.
- [x] Commit y push autorizados para el cierre de U3.

> **Verificación U3 del 2026-08-13.** Antes de desplegar, cada arnés se
> ejecutó dentro de `BEGIN/ROLLBACK`: 44e sola 8/8; 45 sola 14/14; ambas juntas
> 45b 13/13, reserva voluntaria 18/18 y escritores residuales 5/5. El catálogo
> encontró 12 funciones que escriben `attendees`; todas quedaron ejercitadas.
> `aa_attendees_completa_origen` dispara primero, sólo completa NULL y conserva
> orígenes explícitos. La concurrencia se comprobó además con dos sesiones y
> `FOR UPDATE NOWAIT`. Después se aplicaron 44e y 45 en ese orden y se repitieron
> los arneses seguros contra el esquema final: mismos resultados, 44d 16/16,
> 25 asistentes `legado`, cero NULL, cero residuos y ningún 5xx nuevo. Falta
> únicamente la comprobación manual autenticada con cuentas de ambos clubes.

> **La primera pasada manual encontró un fallo, y era del cliente.** El desafío,
> la negociación, la propuesta, la publicación con 7 cupos por club, las dos
> reservas y `join_club_match` funcionaron; pero la nómina mostraba «0 de 7» en
> los dos clubes, las listas vacías y «Inscribirme» a quien la RPC confirmaba
> inscrito. La causa no era la nómina sino el `select`: pedía `profiles.nombre`,
> una columna que no existe en ningún sitio. PostgREST no ignora un embed
> inventado, rechaza la consulta ENTERA — reproducido contra producción:
> `400 {"code":"42703","message":"column profiles_1.nombre does not exist"}`.
> Y el error no se veía porque `getNominaPartido()` traducía `42703` a lista
> vacía: la pantalla quedaba coherente y equivocada. Se corrigieron las dos
> cosas —la consulta sale ahora de `src/utils/nominaQuery.js`, con una prueba
> que contrasta cada columna contra el esquema versionado, y un fallo de carga
> ya no se disfraza de nómina vacía—.

> **La comprobación manual se repitió y pasó (2026-08-13).** Dos sesiones
> autenticadas a la vez, clubes `chatgpt` y `chatgpt2`, partido de 7 cupos por
> club. Las dos cuentas abrieron la nómina, vieron **1 de 7** en cada club, las
> dos listas y los `username` reales. Al salir `chatgpt2` bajó a 0 de 7 y
> `chatgpt` se quedó en 1 de 7: el cupo liberado es sólo el del club de quien
> se va. La otra sesión reflejó cada cambio sola, por el sondeo de respaldo y
> sin recargar, al salir y al volver a inscribirse. Dos inscripciones seguidas
> dieron «Ya estabas en la nómina», una sola fila y el contador quieto. La web
> se comprobó a 904 px con las dos columnas.
>
> El corte de 720 px se comprobó después en Chrome a 390 × 845: las dos
> nóminas apiladas, sin cortes ni superposiciones, los nombres de club
> legibles, los dos contadores en «1 de 7», «de tu club» en el propio, los
> `username` completos y «Salir del partido» alcanzable bajo las listas. Lo
> único que sigue sin evidencia es el render NATIVO en un dispositivo físico:
> todo lo comprobado es web, a 904 px y a 390 px.
>
> Los permisos de administración se cubrieron por el servidor, no por la
> interfaz: este partido es `orden_llegada` y ahí nadie queda `pendiente`, así
> que los botones de confirmar/rechazar no llegan a dibujarse. El arnés
> `45_inscripcion_por_club_test.sql` se ejecutó contra producción dentro de su
> `BEGIN/ROLLBACK` — **14/14 en verde**—, y su caso 9 es exactamente el punto:
> el administrador del club RIVAL no puede confirmar y el del club propio sí;
> el caso 11 añade que nadie se confirma a sí mismo. Se comprobó después que el
> `rollback` no dejó nada: la nómina del partido quedó idéntica fila por fila,
> cero usuarios de fixture y cero partidos de fixture.
>
> **Con esto U3 queda cerrada.**

> **La interfaz de U3 es funcional, no definitiva.** Se acepta tal cual y no se
> rediseña ahora: lo que se prioriza de aquí en adelante es que lógica,
> permisos, estados y flujos queden completos, para que el trabajo visual
> posterior sea principalmente de interfaz y no obligue a rehacer
> funcionalidad. Eso obliga a seguir dejando las reglas en el servidor y en
> módulos puros —`clubMatchRules.js`, `nominaQuery.js`— y no dentro de los
> componentes. Registrado en
> [decisiones/2026-08-13-funcionalidad-antes-que-rediseno.md](../../memoria/decisiones/2026-08-13-funcionalidad-antes-que-rediseno.md).
> Lo que sí se sigue corrigiendo es lo que impide usar una pantalla: texto
> cortado, algo inalcanzable, un estado indistinguible de otro.

### Tarea 4.3 — Avisos, tarjeta destacada y presencia en Inicio ✅ (U2 COMPLETADA)

**Archivos:** crear `src/services/clubMatchRules.js` + su prueba,
`src/components/partidos/ClubMatchCard.js`; modificar
`src/utils/notificationTargets.js` y su prueba, `notificationPreferences.js`,
`supabase/functions/send-push/pushLogic.ts`,
`src/components/notifications/NotificationCard.js`,
`src/screens/PartidosScreen.js`, `HomeScreen.js`, `MatchDetailScreen.js`,
`src/services/matches.js`, `src/services/clubs.js`.

- [x] `ClubMatchCard`: borde verde marcado, halo contenido, franja superior con
      degradado, escudos + nombres + VS, etiqueta «PARTIDO DE CLUBES», la fecha
      con más peso y CTA «Ver partido». Sin rojo — ese color queda para lo que
      necesita atención. Variante `compacta` para Inicio.
- [x] **Los cupos dejan de mostrarse como compartidos.** Un partido de 9 por
      club tiene `cupos_totales = 18`, y «18 de 18 cupos» hacía creer que
      cualquiera podía quedarse con los 18. Ahora: «9 cupos para tu club» a los
      integrantes y «9 cupos por club» al resto, siempre desde
      `cupos_por_club`, nunca dividiendo el total.
- [x] Sección «Próximo partido de tu club» en Inicio, la primera de la
      pantalla, sólo para integrantes de alguno de los dos clubes y sin
      duplicar: `seleccionInicio()` decide destacado y resto a la vez, porque
      el partido que sube es exactamente el que hay que quitar de «Partidos
      cerca de ti».
- [x] Aviso `club_match_published` a todos los integrantes de los dos clubes,
      con destino al PARTIDO y no al hilo, bajo `notif_clubs` en los dos mapas
      espejo, y con atajo «VER PARTIDO» en la tarjeta del aviso.
- [x] Sección «Partido de clubes» en el detalle, con los dos escudos, los cupos
      por club y el método de inscripción.
- [x] Commit.

> **La dirección exacta también se reserva al pintar.** La RLS de
> `club_challenge_proposals` la protege, pero el partido publicado vive en
> `matches`, que es de **lectura pública**: la reserva no sobrevive sola a la
> publicación. `lugarLabel()` entrega cancha y comuna a cualquiera —hacen falta
> para saber si el partido queda cerca— y la calle sólo a los dos clubes, y el
> botón «Cómo llegar» del detalle se apaga para el resto, porque abrir el mapa
> en el punto exacto es enseñar la dirección por otra puerta. Es una defensa de
> interfaz: cerrar la columna de verdad es trabajo de servidor y queda anotado
> en pendientes.

> **El conteo real de inscritos por club no existe todavía y no se simula.**
> En U3, con `attendees.club_id` poblado, la etiqueta pasa a «3 de 9 inscritos
> de tu club». Hasta entonces no se muestra numerador: un «0 de 9» sería falso
> en cuanto alguien se inscriba. Hay una prueba que lo fija.

> **Revisión visual hecha el 2026-08-12** a 320, 390 y 1280 px, renderizando el
> componente real en el navegador. Salieron dos ajustes: sin tope de ancho los
> escudos se iban a los extremos en web y dejaban un vacío enorme (`maxWidth`
> + centrado), y al envolverse el CTA quedaba pegado a la izquierda
> (`marginLeft: 'auto'` en vez de un separador flexible). Comprobados nombres
> largos, clubes sin escudo y estado cancelado.

### Tarea 4.4 — Cambios negociados ✅ (desplegada el 2026-08-13, falta la comprobación manual)

**Archivos:** `supabase/migrations/46_cambios_de_partido.sql`, prueba
`supabase/tests/46_cambios_de_partido_test.sql`; crear
`src/utils/cambioPartido.js`, `cambioQuery.js`, `cambioRpc.js` (los tres con
prueba), `src/services/clubMatchChanges.js`,
`src/components/clubes/CambioPartidoCard.js`,
`src/screens/ClubMatchChangeScreen.js`; modificar `ChatThreadScreen.js`,
`AppNavigator.js`, `ChallengeEventBubble.js`, `NotificationCard.js`,
`notificationTargets.js`, `notificationPreferences.js`, `pushLogic.ts`.

- [x] `club_match_changes` con `campos jsonb`, `valores_anteriores`, estado y
      `motivo` opcional del rechazo.
- [x] `proponer_cambio_partido`: rechaza si faltan menos de 2 h para el inicio
      (comparando con `now()` de PostgreSQL). El valor vigente **no** se toca
      mientras la solicitud está pendiente.
- [x] `responder_cambio_partido(p_change_id, p_aceptar, p_motivo)`: sólo admin
      del club contrario. Al aceptar, actualiza el partido y notifica a todos
      los inscritos; al rechazar, no cambia nada.
- [x] Evento en el chat con el texto del enunciado, armado en el cliente desde
      el payload: «Club A (@usuario) propone cambiar la hora de 17:00 a 18:00».
- [x] Prueba SQL `46_cambios_de_partido_test.sql`: 22 casos.
- [x] Interfaz completa: pedir, revisar, aceptar y rechazar desde el hilo.
- [x] Commit.
- [ ] Comprobación manual con `chatgpt` y `chatgpt2` — primera pasada hecha el
      2026-08-13: pasó hasta el rechazo con motivo y encontró dos fallos, los
      dos corregidos. Falta repetirla desde una solicitud nueva.

> **La primera pasada manual encontró dos fallos, y ninguno era del servidor.**
> El rechazo quedó bien persistido y bien notificado; lo que fallaba era la
> pantalla.
>
> 1. **La otra sesión no se enteraba.** `ChatThreadScreen` sólo se suscribe a
>    `messages`, y la publicación `supabase_realtime` lleva únicamente
>    `messages`, `attendees` y `notifications`: `club_challenge_events` y
>    `club_match_changes` no emiten nada. Los eventos del ciclo tampoco
>    escriben un mensaje del que colgarse, porque `messages.sender_id` es NOT
>    NULL. Se cargaban al montar y sólo se recargaban tras una acción PROPIA,
>    así que quien esperaba respuesta veía «pendiente» indefinidamente. La
>    laguna venía de la 42/43 y afecta igual a prórroga y propuesta; 4.4 la
>    hizo visible por ser la primera negociación de dos partes con una tarjeta
>    de estado. Arreglado con `utils/sondeo.js`, el mismo remedio que la nómina
>    de U3 —pero acá es la única vía, no la reserva—.
> 2. **Al proponente se le mostraba una negación.** La tarjeta pintaba
>    `bloqueoResponder` («No puedes responder tu propia solicitud») en vez de
>    «Esperando la respuesta de X», y lo hacía aunque el estado estuviera
>    fresco. Quien pide un cambio no está bloqueado: está esperando. Lo decide
>    ahora `mensajeDeEspera()`, con prueba.
>
> **Dos riesgos que el propio sondeo introducía y se cerraron con él:** un
> fallo transitorio de red habría pintado un error permanente en la tarjeta
> (el sondeo de fondo falla en silencio y se queda con lo último bueno), y
> reemplazar la bitácora cada 15 segundos habría re-montado las burbujas sin
> novedad (sólo se toca el estado si la firma de eventos cambió).

> **Tres cosas que salieron al implementar y no estaban en el plan.**
>
> 1. **El aviso a los inscritos ya existía y se reutiliza.**
>    `tg_notify_match_updated` es AFTER UPDATE sobre `matches`, así que
>    aceptar un cambio lo dispara solo. No se inventó un aviso nuevo: se le
>    añadió una rama para los partidos de clubes, porque «El organizador
>    cambió la hora» es falso cuando el cambio lo acordaron dos clubes, y
>    porque excluir al organizador —que ahí puede no ser quien cambió nada—
>    le escondía un cambio que le afecta. En los partidos normales no cambia
>    nada, y el caso 20 del arnés lo demuestra.
> 2. **Quien administra los DOS clubes no puede pedir cambios.** No hay forma
>    de decir en nombre de quién los pide, y quien los respondiera se estaría
>    respondiendo a sí mismo. Es el conflicto de doble pertenencia de la 43d,
>    un paso antes.
> 3. **El plazo se mira DOS veces.** Se pidió con tiempo, pero el partido se
>    acerca mientras la solicitud está pendiente: al responder dentro de las
>    2 h la solicitud caduca en vez de quedarse abierta para siempre.
>
> **El arnés encontró dos fallos, los dos de la propia prueba:** el `update`
> de preparación disparaba `notify_match_updated` y contaminaba el conteo, y
> el caso de la doble pulsación reusaba un token viejo, con lo que medía el
> reencuentro con una fila anterior en vez de la idempotencia.

**Verificación de fase:** `npm test`, `npm run build:web`, pruebas SQL 44 a 46, y
comprobación de que publicar/unirse a un partido normal sigue igual.

### Regla definitiva de privacidad (2026-08-13) — el partido es privado hasta que termina

**Ésta es la regla que manda.** Lo de más abajo describe un paso intermedio que
la 44d dejó atrás: durante unas horas el partido fue público con la ubicación
aproximada, y ya no lo es.

Mientras el partido no esté **finalizado**, sólo existe para los integrantes de
los dos clubes —integrantes, no sólo administradores—. Un externo o un anónimo
no obtiene nada: ni por id, ni listando, ni en la nómina, ni en la cola, ni en
la ubicación, ni en Inicio, Partidos, mapa, filtros o búsquedas. Tampoco puede
inscribirse: ni con un insert directo, ni por `join_match`, `request_join` o
`join_waitlist`.

El predicado vive en una sola política, la de `matches`:
`challenge_proposal_id is null` (partido normal, público) **o** soy integrante
de alguno de los dos clubes. `attendees` y `match_waitlist` se cuelgan de ella
con un `exists`, de modo que la regla no está copiada en tres sitios.

Las RPC que inscriben son `security definer` y no pasan por RLS. En vez de
reescribir cinco funciones largas y no versionadas, hay un **trigger** en
`attendees` y otro en `match_waitlist`: se disparan venga la fila de donde
venga, incluida cualquier función futura que nadie recuerde tapar. El trigger
deja pasar la fila que trae `club_id`, que es por donde entrará
`join_club_match()` en U3 sin tener que acordarse de tocarlo.

Al finalizar, lo único público es el resultado, por `historial_publico_club()`:
clubes, **día** (nunca la hora), marcador y V/E/D. Es una proyección, no una
ventana a la fila, y filtra `estado = 'finalizado'`, así que un partido
cancelado o no disputado no se publica.

**El chat de negociación sigue siendo exclusivo de administradores**, sin
cambios.

### Paso intermedio (2026-08-13, superado por la 44d) — la ubicación deja de ser pública

La protección de la dirección exacta vivía **sólo en la interfaz**. Al
publicarse, el partido pasa a `matches`, cuya política de lectura es
`using (true)`: `direccion`, `latitud` y `longitud` quedaban legibles por
cualquiera, incluido `anon`. Y había una segunda fuga: `tg_register_cancha`
copiaba además la dirección a la tabla pública `canchas`, consultable por
`anon` con `search_canchas()`.

**Separar, no cerrar.** Cerrar la lectura de `matches` habría roto el resto de
la app, que vive de listar partidos abiertos.

- La exacta pasa a `club_match_locations`, con RLS para los integrantes de los
  dos clubes y **sin políticas de escritura**: sólo la escriben las RPC
  `security definer`.
- `matches` conserva un punto **aproximado** —rejilla de 0,01°, ~1 km— marcado
  con `ubicacion_aproximada`, para que el partido se siga descubriendo.
- `matches.direccion` queda en NULL: la calle no se aproxima, se omite.

La aproximación va en las **mismas columnas** porque todo el descubrimiento
—`listMatchesInBounds`, `applyFilters`, los marcadores del mapa y el radio de
Inicio— las lee directo. Así esas cuatro rutas siguen funcionando sin tocarlas
y **sin una consulta por tarjeta**.

**Precisión: la distancia pública puede errar hasta ~0,73 km** (media diagonal
de la celda). En el partido real, la aproximada quedó a 189 m de la exacta. Se
guarda el nodo de la rejilla y no un desplazamiento aleatorio: al ser
determinista no se puede promediar entre lecturas para afinarlo, y no se corre
el riesgo de caer en otra comuna y romper el filtro por zona.

**El GPS usa exclusivamente la exacta y falla cerrado sin ella.** Confirmar
contra un punto redondeado a un kilómetro habría dejado marcarse presente desde
una cuadra de distancia.

**El nombre de la cancha sigue siendo público**, como el resto de la
información de descubrimiento. Si el recinto es conocido, su nombre identifica
el lugar mejor que la celda de 1 km: la aproximación protege la coordenada, no
el nombre.

**Verificación de la Tarea 4.1 (2026-08-12):** `npm run lint` (0 errores),
`npm test` (305 ✓), `npm run build:web` (✓) y las tres pruebas SQL en
transacción con `rollback` contra el esquema desplegado: 43c (8 casos ✓),
43d (8 ✓) y 44 (13 ✓), sin dejar filas. Migraciones 43c, 43d y 44 aplicadas
en ese orden y verificadas contra el catálogo: `aprobar_propuesta` y
`crear_propuesta_oficial` dan `public`/`anon` en falso y `authenticated` en
verdadero, y `club_esta_sancionado` en falso para los tres.

**Recorrido completo del flujo (2026-08-12), contra las funciones ya
aplicadas y dentro de una transacción con `rollback`:** el club retado acepta
el desafío → el retador crea la propuesta oficial con la cancha ubicada en el
mapa → el club rival la lee entera, y también la lee un jugador sin rol
mientras que un anónimo no ve nada → el proponente intenta aprobarla y se le
rechaza → el administrador rival aprueba y se publica «Deportivo vs Atlético»
con 16 cupos, 8 por club → vuelve a pulsar aprobar y recibe el mismo partido,
con un total de 1 → 3 avisos `club_match_published`, 0 inscritos y 1 evento
`partido_publicado`. **Falta la comprobación en la app**, que necesita dos
cuentas administrando clubes distintos, igual que en las fases 2 y 3.

---

## FASE 5 — Cancelaciones, revisiones y sanciones

**Entregable:** cancelación unilateral con motivo obligatorio, sanción automática
de 14 días bajo las 2 horas, y trazabilidad completa de revisiones.

**Riesgo principal:** la pieza de moderación no existe. Hay que dejar el estado y
la trazabilidad correctos **sin** inventar un permiso inseguro.

### Tarea 5.1 — Cancelación y sanción

**Archivos:** crear `supabase/migrations/47_sanciones_y_revisiones.sql`.

- [ ] `club_sanctions` (motivo `not null` con `check (length(trim(motivo)) > 0)`,
      `inicio_at`, `fin_at = inicio_at + 14 días`, `estado`).
- [ ] `cancelar_encuentro_club(p_challenge_id, p_motivo)`: motivo no vacío,
      unilateral, sin aprobación del rival; registra club, administrador, motivo
      y hora de servidor; cancela el partido reutilizando la lógica de
      `cancel_match` (migración 34, que ya conserva el historial); notifica a
      administradores y a los inscritos.
- [ ] `aplicar_sancion_club`: si faltan menos de 2 h, sanción de 14 días.
      **No toca `profiles.trust_score`** — comprobado en la prueba SQL.
- [ ] `club_esta_sancionado(p_club_id)` completa el *stub* de la Tarea 4.1 y se
      llama desde `createChallenge`, `aceptar_desafio`,
      `crear_propuesta_oficial` y `aprobar_propuesta`.
- [ ] Acción «Cancelar encuentro» siempre visible en la parte superior del hilo.
- [ ] Prueba SQL 47: motivo vacío rechazado; cancelar a 1 h sanciona y a 3 h no;
      el `trust_score` de los jugadores no cambia; el club sancionado no puede
      crear ni aceptar desafíos; **sí** puede seguir en los partidos ya
      publicados (decisión C3).
- [ ] Commit.

### Tarea 5.2 — Incomparecencia y revisión

- [ ] `club_match_noshow_reports`: sólo después de la hora del partido; sanción
      provisional de 14 días con `estado='provisional'`.
- [ ] `club_sanction_reviews`: «Solicitar revisión» visible para el club
      afectado ante cualquier cancelación o sanción; guarda motivo, historial del
      partido, tiempos y eventos relevantes.
- [ ] `resolver_revision_sancion(p_review_id, p_decision, p_nota)` con
      `revoke execute … from anon, authenticated` — **sólo `service_role`**.
      Retirar la sanción devuelve el desafío a `estado_previo_sancion`.
- [ ] Documentar la pieza pendiente en
      `docs/memoria/operacion/pendientes.md`: no existe interfaz de moderación;
      hoy la resolución se ejecuta desde el panel de Supabase con `service_role`.
- [ ] Prueba SQL: un `authenticated` no puede ejecutar la resolución.
- [ ] Commit.

**Verificación de fase:** `npm test`, `npm run build:web`, prueba SQL 47.

---

## FASE 6 — Resultado, asistencia e historial

**Entregable:** resultado propuesto y confirmado, récord V/E/D real en ambos
perfiles de club, y fixtures de demostración apagados.

### Tarea 6.1 — Resultado

**Archivos:** crear `supabase/migrations/48_resultado_y_historial.sql`; crear
`src/screens/ClubResultScreen.js`, `src/services/clubResults.js`.

- [ ] `club_match_results` con `goles_local`, `goles_visitante`,
      `estado ('propuesto','confirmado','rechazado')`, único parcial `where estado <> 'rechazado'`.
- [ ] `proponer_resultado(p_challenge_id, p_goles_local, p_goles_visitante, p_asistencia jsonb)`:
      admin de cualquiera de los dos; marca la asistencia real sobre `attendees`
      (`confirmado_gps` / `no_asistio`) reutilizando la semántica existente.
- [ ] `confirmar_resultado(p_result_id, p_aceptar)`: admin del club contrario.
      Aceptar → `finalizado` y `matches.estado='finalizado'`. Rechazar →
      `resultado_en_disputa`, **sin** tocar estadísticas, conservando propuesta y
      rechazo.
- [ ] `club_record(p_club_id)` devuelve V/E/D contando sólo resultados
      confirmados.
- [ ] Prueba SQL 48: el proponente no confirma su propio resultado; en disputa el
      récord no cambia.
- [ ] Commit.

### Tarea 6.2 — Historial real

**Archivos:** modificar `src/services/clubMatches.js`,
`src/components/club/MatchHistoryCard.js`, `ClubStatsRow.js`,
`src/screens/ClubDetailScreen.js`.

- [ ] `getClubMatchHistory` lee `club_match_results` y devuelve marcador y
      resultado reales en lugar de `null`.
- [ ] `DEMO_HISTORIAL = false` y borrar `getDemoMatchHistory()`/`usarHistorialDemo()`
      con sus llamadas. Éste es el punto —y no antes— en que se retiran los
      fixtures, porque hasta aquí no había datos reales que mostrar.
- [ ] `calcularRecord` pasa a apoyarse en `club_record()` cuando hay sesión.
- [ ] Commit.

### Tarea 6.3 — Memoria

**Archivos:** modificar `docs/memoria/funcionalidades/clubes.md`,
`chat.md`, `avisos-y-push.md`, `producto/reglas-de-negocio.md`,
`arquitectura/base-de-datos.md`, `arquitectura/seguridad-y-privacidad.md`,
`operacion/pendientes.md`, `operacion/pruebas.md`; crear
`docs/memoria/decisiones/2026-08-10-ciclo-desafios-clubes.md`.

- [ ] Registrar la máquina de estados, el tipo de hilo nuevo, las reglas de cupos
      y sanciones, las migraciones 41–48 y sus pruebas, y la decisión C1–C7.
- [ ] Commit.

**Verificación final:** `npm test`, `npm run build:web`,
`deno test supabase/functions/send-push/pushLogic.test.ts`, y las seis pruebas SQL
en un Supabase de desarrollo.

---

## Riesgos transversales

| Riesgo | Mitigación |
|---|---|
| Reescribir `get_my_threads()` rompe la bandeja | Prueba SQL 42 reutiliza los casos de `40_bandeja_chat_rpc_test.sql` antes de añadir la cuarta rama |
| `chatMeta.test.js` (859 líneas) falla al tocar `TYPE_BY_FILTER` | `filterThreads` acepta valor único **y** arreglo; las pruebas viejas no se editan |
| Doble pulsación crea propuestas o partidos duplicados | `client_token` + índice único parcial + `update … where estado = <esperado>` |
| Sobrecupo en inscripción concurrente | `select … for update` sobre `matches` y conteo por club dentro de la transacción |
| El cron no está configurado en el entorno destino | `refrescar_desafio()` cubre la latencia en pantalla; el cron sigue siendo la fuente fiable. No afirmar que está activo sin comprobarlo |
| Migrar la paleta de tres pantallas cambia su aspecto | Una pantalla por tarea, con revisión visual entre cada una |
| Las migraciones no están aplicadas en el proyecto remoto | Cada servicio nuevo traduce el error de función/columna ausente a un mensaje de «migración pendiente», como ya hace `matches.js:481` |
