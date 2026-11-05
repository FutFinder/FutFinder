-- =============================================================
-- 170. LA BASE AGUANTA MÁS GENTE A LA VEZ
--
-- Revisión de escalado del 2026-11-05. Los avisos de rendimiento de
-- Supabase marcaban dos cosas que no cambian lo que la base permite, pero
-- sí cuánto le cuesta cada consulta cuando hay muchas personas conectadas:
--
-- 1. 96 POLÍTICAS RLS EVALUABAN `auth.uid()` UNA VEZ POR FILA
--    (`auth_rls_initplan`). Escrito a secas, Postgres llama a la función en
--    cada fila que revisa: listar 1.000 avisos son 1.000 llamadas. Envuelto
--    en `(select auth.uid())` se vuelve un initPlan y se calcula UNA vez
--    por consulta. Pesa más en Realtime: cada cambio de `messages` se
--    revisa contra la RLS por cada persona suscrita.
--
--    El resultado es IDÉNTICO: dentro de una consulta `auth.uid()` siempre
--    devuelve lo mismo (lee `request.jwt.claims`), así que calcularlo una o
--    mil veces no cambia qué filas pasan. Ni el comando, ni los roles, ni
--    el resto de la expresión se tocan: `alter policy` sólo reescribe
--    `using` y `with check`, con el mismo texto y la llamada envuelta.
--
--    Se hace con un bloque que recorre `pg_policies` y no con 96
--    `alter policy` escritos a mano, por dos razones: copiar 96 expresiones
--    a mano es la forma segura de cambiarle el sentido a una, y una base
--    construida desde cero (ver 158 y 162) llega acá con las políticas que
--    tenga en ESE momento, que es justo lo que hay que envolver. Antes de
--    aplicarla se comprobó contra producción, en una transacción abortada,
--    que cada política nueva, al quitarle el envoltorio, es carácter por
--    carácter la anterior.
--
--    OJO para lo que venga: una política nueva escrita con `auth.uid()` a
--    secas vuelve a aparecer en el aviso. Escríbela ya envuelta.
--
-- 2. 71 LLAVES FORÁNEAS SIN ÍNDICE (`unindexed_foreign_keys`). Sin índice,
--    buscar por esa columna («los desafíos de este club», «las reservas de
--    este jugador») o borrar la fila referenciada recorre la tabla entera.
--    Hoy son tablas de decenas de filas y no se nota; con miles, sí. Todas
--    son de una sola columna. No se usa `concurrently` porque la migración
--    corre en una transacción y las tablas son chicas: el bloqueo dura
--    milisegundos.
--
-- Lo que NO se tocó, a propósito:
--   · `multiple_permissive_policies` (10): juntar dos políticas en una sí
--     cambia la expresión, y eso merece su propia revisión.
--   · `unused_index` (11): «sin uso» en una base con poco tráfico no
--     significa que sobren.
-- =============================================================

-- ── 1. auth.uid() una vez por consulta ──
do $$
declare
  p record;
  v_envuelto constant text := '( SELECT auth.uid() AS uid)';
  v_marca constant text := '<<auth_uid_envuelto>>';
  v_using text;
  v_check text;
  v_sql text;
  v_n int := 0;
begin
  for p in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (replace(coalesce(qual, ''), v_envuelto, '') like '%auth.uid()%'
            or replace(coalesce(with_check, ''), v_envuelto, '') like '%auth.uid()%')
  loop
    -- Lo que ya venía envuelto se aparta con una marca, se envuelve lo que
    -- quedó a secas y se devuelve la marca: así nada queda envuelto dos veces.
    v_using := replace(replace(replace(p.qual, v_envuelto, v_marca),
                               'auth.uid()', v_envuelto), v_marca, v_envuelto);
    v_check := replace(replace(replace(p.with_check, v_envuelto, v_marca),
                               'auth.uid()', v_envuelto), v_marca, v_envuelto);

    v_sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if v_using is not null then v_sql := v_sql || ' using (' || v_using || ')'; end if;
    if v_check is not null then v_sql := v_sql || ' with check (' || v_check || ')'; end if;
    execute v_sql;
    v_n := v_n + 1;
  end loop;

  raise notice '170: % políticas con auth.uid() envuelto', v_n;
end $$;

-- ── 2. Un índice por cada llave foránea que no lo tenía ──
create index if not exists attendees_club_id_idx on public.attendees (club_id);

create index if not exists autorizaciones_cobro_user_id_idx on public.autorizaciones_cobro (user_id);

create index if not exists autorizaciones_recinto_complejo_id_idx on public.autorizaciones_recinto (complejo_id);

create index if not exists balance_movimientos_reserva_id_idx on public.balance_movimientos (reserva_id);

create index if not exists blocked_users_blocked_id_idx on public.blocked_users (blocked_id);

create index if not exists cancha_bloqueos_creado_por_idx on public.cancha_bloqueos (creado_por);

create index if not exists cancha_usos_user_id_idx on public.cancha_usos (user_id);

create index if not exists canchas_created_by_idx on public.canchas (created_by);

create index if not exists club_challenge_events_actor_id_idx on public.club_challenge_events (actor_id);
create index if not exists club_challenge_events_club_id_idx on public.club_challenge_events (club_id);

create index if not exists club_challenge_extension_replies_club_id_idx on public.club_challenge_extension_replies (club_id);
create index if not exists club_challenge_extension_replies_user_id_idx on public.club_challenge_extension_replies (user_id);

create index if not exists club_challenge_proposals_club_proponente_id_idx on public.club_challenge_proposals (club_proponente_id);
create index if not exists club_challenge_proposals_creada_por_idx on public.club_challenge_proposals (creada_por);
create index if not exists club_challenge_proposals_respondida_por_idx on public.club_challenge_proposals (respondida_por);

create index if not exists club_challenges_creado_por_idx on public.club_challenges (creado_por);
create index if not exists club_challenges_match_id_idx on public.club_challenges (match_id);
create index if not exists club_challenges_respondido_por_idx on public.club_challenges (respondido_por);

create index if not exists club_lineups_updated_by_idx on public.club_lineups (updated_by);

create index if not exists club_match_changes_challenge_id_idx on public.club_match_changes (challenge_id);
create index if not exists club_match_changes_club_proponente_id_idx on public.club_match_changes (club_proponente_id);
create index if not exists club_match_changes_propuesto_por_idx on public.club_match_changes (propuesto_por);
create index if not exists club_match_changes_respondida_por_idx on public.club_match_changes (respondida_por);

create index if not exists club_match_noshow_reports_challenge_id_idx on public.club_match_noshow_reports (challenge_id);
create index if not exists club_match_noshow_reports_club_reportado_id_idx on public.club_match_noshow_reports (club_reportado_id);
create index if not exists club_match_noshow_reports_club_reportante_id_idx on public.club_match_noshow_reports (club_reportante_id);
create index if not exists club_match_noshow_reports_reportado_por_idx on public.club_match_noshow_reports (reportado_por);
create index if not exists club_match_noshow_reports_sancion_id_idx on public.club_match_noshow_reports (sancion_id);

create index if not exists club_match_results_club_local_id_idx on public.club_match_results (club_local_id);
create index if not exists club_match_results_club_proponente_id_idx on public.club_match_results (club_proponente_id);
create index if not exists club_match_results_club_visitante_id_idx on public.club_match_results (club_visitante_id);
create index if not exists club_match_results_confirmado_por_idx on public.club_match_results (confirmado_por);
create index if not exists club_match_results_propuesto_por_idx on public.club_match_results (propuesto_por);

create index if not exists club_member_permission_overrides_user_id_idx on public.club_member_permission_overrides (user_id);

create index if not exists club_members_user_id_idx on public.club_members (user_id);

create index if not exists club_open_challenge_responses_club_id_idx on public.club_open_challenge_responses (club_id);
create index if not exists club_open_challenge_responses_creado_por_idx on public.club_open_challenge_responses (creado_por);

create index if not exists club_open_challenges_creado_por_idx on public.club_open_challenges (creado_por);
create index if not exists club_open_challenges_resultante_challenge_id_idx on public.club_open_challenges (resultante_challenge_id);

create index if not exists club_photos_uploaded_by_idx on public.club_photos (uploaded_by);

create index if not exists club_sanction_reviews_club_id_idx on public.club_sanction_reviews (club_id);
create index if not exists club_sanction_reviews_match_id_idx on public.club_sanction_reviews (match_id);
create index if not exists club_sanction_reviews_resuelta_por_idx on public.club_sanction_reviews (resuelta_por);
create index if not exists club_sanction_reviews_solicitada_por_idx on public.club_sanction_reviews (solicitada_por);

create index if not exists club_sanctions_aplicada_por_idx on public.club_sanctions (aplicada_por);
create index if not exists club_sanctions_challenge_id_idx on public.club_sanctions (challenge_id);
create index if not exists club_sanctions_match_id_idx on public.club_sanctions (match_id);

create index if not exists clubs_created_by_idx on public.clubs (created_by);

create index if not exists complejo_calificaciones_user_id_idx on public.complejo_calificaciones (user_id);

create index if not exists complejos_created_by_idx on public.complejos (created_by);

create index if not exists fairplay_reportes_reported_id_idx on public.fairplay_reportes (reported_id);
create index if not exists fairplay_reportes_reporter_id_idx on public.fairplay_reportes (reporter_id);

create index if not exists fairplay_revisiones_match_id_idx on public.fairplay_revisiones (match_id);
create index if not exists fairplay_revisiones_reporte_id_idx on public.fairplay_revisiones (reporte_id);
create index if not exists fairplay_revisiones_user_id_idx on public.fairplay_revisiones (user_id);

create index if not exists match_expulsiones_expulsado_por_idx on public.match_expulsiones (expulsado_por);
create index if not exists match_expulsiones_jugador_id_idx on public.match_expulsiones (jugador_id);

create index if not exists matches_challenge_id_idx on public.matches (challenge_id);

create index if not exists moderadores_nombrado_por_idx on public.moderadores (nombrado_por);

create index if not exists pagos_reversado_por_idx on public.pagos (reversado_por);

create index if not exists push_tickets_notification_id_idx on public.push_tickets (notification_id);

create index if not exists ratings_rater_id_idx on public.ratings (rater_id);

create index if not exists reserva_cobros_cobro_id_idx on public.reserva_cobros (cobro_id);

create index if not exists reserva_participantes_user_id_idx on public.reserva_participantes (user_id);

create index if not exists reservas_cancelacion_solicitada_por_club_id_idx on public.reservas (cancelacion_solicitada_por_club_id);
create index if not exists reservas_club_organizador_id_idx on public.reservas (club_organizador_id);
create index if not exists reservas_club_rival_id_idx on public.reservas (club_rival_id);

create index if not exists truescore_reclamo_confirmaciones_confirmador_id_idx on public.truescore_reclamo_confirmaciones (confirmador_id);

create index if not exists truescore_reclamos_match_id_idx on public.truescore_reclamos (match_id);
create index if not exists truescore_reclamos_organizador_id_idx on public.truescore_reclamos (organizador_id);
create index if not exists truescore_reclamos_user_id_idx on public.truescore_reclamos (user_id);
