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
| `supabase/migrations/44_partido_de_clubes.sql` | Columnas de `matches`/`attendees`, RPC `aprobar_propuesta` (crea el partido atómicamente), `join_club_match`, `leave_club_match`, `confirmar_nomina_club`, guarda en `join_match` | Pendiente |
| `supabase/migrations/45_cambios_de_partido.sql` | `club_match_changes`, RPC `proponer_cambio_partido`, `responder_cambio_partido` | Pendiente |
| `supabase/migrations/46_sanciones_y_revisiones.sql` | `club_sanctions`, `club_sanction_reviews`, `club_match_noshow_reports`, RPC `cancelar_encuentro_club`, `aplicar_sancion_club`, `reportar_incomparecencia`, `solicitar_revision_sancion`, `resolver_revision_sancion` (sólo service_role), helper `club_esta_sancionado` | Pendiente |
| `supabase/migrations/47_resultado_y_historial.sql` | `club_match_results`, RPC `proponer_resultado`, `confirmar_resultado`, `club_record()` | Pendiente |

### Pruebas SQL nuevas

`supabase/tests/42_desafio_chat_rls_test.sql`, `43_desafio_plazos_test.sql`,
`44_partido_clubes_cupos_test.sql`, `45_cambios_partido_test.sql`,
`46_sanciones_test.sql`, `47_resultado_test.sql`. Mismo estilo que
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

---

## FASE 4 — Publicación, convocatoria y cambios

**Entregable:** aprobar la propuesta crea el partido en la misma transacción, con
cupos separados por club, y todo cambio posterior necesita el visto bueno del
club contrario.

**Riesgo principal:** partidos duplicados si la aprobación se pulsa dos veces, y
sobrecupo si dos jugadores del mismo club entran a la vez.

### Tarea 4.1 — Aprobación atómica que publica el partido

**Archivos:** crear `supabase/migrations/44_partido_de_clubes.sql`.

- [ ] Columnas en `matches`: `cupos_por_club integer`, `metodo_inscripcion text`,
      `challenge_proposal_id uuid unique references club_challenge_proposals(id)`.
      La unicidad es la garantía **estructural** de que no hay partido duplicado,
      no una comprobación en código.
- [ ] Columna `attendees.club_id uuid references clubs(id)`, índice
      `(id_partido, club_id, estado)`.
- [ ] `aprobar_propuesta(p_proposal_id uuid)`: una sola transacción que verifica
      admin del club contrario, `update … where estado='pendiente'` (0 filas →
      salir sin efecto), inserta el `matches` con `cupos_totales = 2 × cupos_por_club`,
      `aprobacion = case metodo when 'seleccion_admin' then 'manual' else 'inmediata' end`,
      `club_local_id`/`club_visitante_id`/`challenge_id`, pasa el desafío a
      `publicado`, registra el evento y notifica a **todos** los integrantes de
      ambos clubes.
- [ ] Verificar que ningún club esté sancionado antes de publicar (la función
      `club_esta_sancionado` llega en la Fase 5; aquí se declara como *stub* que
      devuelve `false` y se completa entonces — se deja explícito en el comentario
      de la migración).
- [ ] Prueba SQL 44: aprobar dos veces deja un solo partido; el proponente no
      puede aprobar; la unicidad de `challenge_proposal_id` rechaza el duplicado.
- [ ] Commit.

### Tarea 4.2 — Inscripción con cupos por club

- [ ] `join_club_match(p_match_id)`: deriva el club del jugador de `club_members`
      ∩ {local, visitante}; si no pertenece a ninguno, rechaza. Bloquea la fila
      del partido (`select … for update`) y cuenta los inscritos de ese club
      antes de insertar: eso es lo que impide el sobrecupo, no un contador
      global. `orden_llegada` → `inscrito`; `seleccion_admin` → `pendiente`.
- [ ] `leave_club_match(p_match_id)` y `confirmar_nomina_club(p_match_id, p_player_id, p_aprobar)`
      (admin del club **del jugador**, no del otro).
- [ ] Guarda en `join_match`: rechazar si `challenge_proposal_id is not null`
      (decisión C7).
- [ ] `src/screens/ClubMatchRosterScreen.js`: cupos disponibles, confirmados y
      pendientes **por equipo**.
- [ ] Prueba SQL: dos inscripciones concurrentes al último cupo dejan una sola;
      un jugador del club A no puede ocupar cupo del club B; un ajeno no entra.
- [ ] Commit.

### Tarea 4.3 — Partido de clubes visualmente distinto

**Archivos:** modificar `src/components/partidos/PartidoCard.js` (ya tiene la
píldora «CLUBES» en L63-68, sin escudos), `src/components/home/MatchCard.js`
(L74), `src/screens/MatchDetailScreen.js` (héroe, L529-584).

- [ ] Sustituir la píldora de texto por escudos + nombres de ambos clubes,
      manteniendo los tokens `partidos` del módulo.
- [ ] Sección «Partido de clubes» en el detalle: estado del desafío, cupos por
      club, fecha, hora y lugar, con enlace al hilo de negociación para quien sea
      administrador.
- [ ] Commit.

### Tarea 4.4 — Cambios negociados

**Archivos:** crear `supabase/migrations/45_cambios_de_partido.sql`.

- [ ] `club_match_changes` con `campos jsonb` y estado.
- [ ] `proponer_cambio_partido`: rechaza si faltan menos de 2 h para el inicio
      (comparando con `now()` de PostgreSQL). El valor vigente **no** se toca
      mientras la solicitud está pendiente.
- [ ] `responder_cambio_partido(p_change_id, p_aceptar)`: sólo admin del club
      contrario. Al aceptar, actualiza el partido y notifica a todos los
      inscritos; al rechazar, no cambia nada.
- [ ] Evento en el chat con el texto exacto del enunciado: «Club A propone
      cambiar la hora de 17:00 a 18:00».
- [ ] Prueba SQL 45: fuera de plazo rechazado; el proponente no puede aceptar su
      propio cambio; rechazar conserva los valores anteriores.
- [ ] Commit.

**Verificación de fase:** `npm test`, `npm run build:web`, pruebas SQL 44 y 45, y
comprobación de que publicar/unirse a un partido normal sigue igual.

---

## FASE 5 — Cancelaciones, revisiones y sanciones

**Entregable:** cancelación unilateral con motivo obligatorio, sanción automática
de 14 días bajo las 2 horas, y trazabilidad completa de revisiones.

**Riesgo principal:** la pieza de moderación no existe. Hay que dejar el estado y
la trazabilidad correctos **sin** inventar un permiso inseguro.

### Tarea 5.1 — Cancelación y sanción

**Archivos:** crear `supabase/migrations/46_sanciones_y_revisiones.sql`.

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
- [ ] Prueba SQL 46: motivo vacío rechazado; cancelar a 1 h sanciona y a 3 h no;
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

**Verificación de fase:** `npm test`, `npm run build:web`, prueba SQL 46.

---

## FASE 6 — Resultado, asistencia e historial

**Entregable:** resultado propuesto y confirmado, récord V/E/D real en ambos
perfiles de club, y fixtures de demostración apagados.

### Tarea 6.1 — Resultado

**Archivos:** crear `supabase/migrations/47_resultado_y_historial.sql`; crear
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
- [ ] Prueba SQL 47: el proponente no confirma su propio resultado; en disputa el
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
      y sanciones, las migraciones 41–47 y sus pruebas, y la decisión C1–C7.
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
