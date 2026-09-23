-- =============================================================
-- FutFinder — pruebas de la migración 133.
--
--   A1  El trigger de aprobación está instalado y sólo mira `pendiente → inscrito`.
--   A2  El ayudante de motivos no es una RPC pública.
--   A3  `approve_join`: la primera aprobación entra.
--   A4  La segunda, en un partido a la misma hora, se rechaza con
--       `code = CHOQUE_HORARIO` y un motivo legible. Es el caso que antes
--       devolvía `ok:true` — reproducido contra producción el 2026-09-23.
--   A5  Y el rechazo no deja rastro: la solicitud sigue pendiente, el cupo
--       sigue libre y no se avisó al jugador que entró.
--   A6  Control: un partido CONTIGUO se aprueba, de modo que A4 no pueda
--       pasar por un trigger que rechace siempre.
--   A7  Las demás transiciones no pasan por la regla: la marca GPS de un
--       jugador suspendido se guarda igual.
--   A8  `confirmar_nomina_club`: confirmar a un jugador que ya quedó inscrito
--       en otro partido a esa hora se rechaza igual, y su postulación sigue.
--   A9  Control de A8: sin choque, el mismo jugador se confirma.
--
-- No reutiliza datos de la base: crea sus usuarios, sus clubes y sus
-- partidos. Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r133 (caso text, ok boolean not null, detalle text);

-- ── A1 y A2: catálogo ────────────────────────────────────────
do $$
declare v_def text; v_priv boolean;
begin
  select pg_get_triggerdef(t.oid) into v_def
    from pg_trigger t
   where t.tgrelid = 'public.attendees'::regclass and t.tgname = 'trg_enforce_join_rules_al_aprobar';
  insert into r133 values ('A1 trigger de aprobación instalado',
    coalesce(v_def like '%BEFORE UPDATE OF estado ON public.attendees%'
      and v_def like '%old.estado = ''pendiente''%'
      and v_def like '%new.estado = ''inscrito''%'
      and v_def like '%tg_enforce_join_rules()%', false),
    coalesce(v_def, 'no existe'));

  if to_regprocedure('public.motivo_aprobacion_rechazada(text)') is null then
    insert into r133 values ('A2 el ayudante no se llama por REST', false, 'no existe');
  else
    select has_function_privilege('authenticated', 'public.motivo_aprobacion_rechazada(text)', 'EXECUTE')
        or has_function_privilege('anon', 'public.motivo_aprobacion_rechazada(text)', 'EXECUTE')
      into v_priv;
    insert into r133 values ('A2 el ayudante no se llama por REST', not v_priv,
      'anon o authenticated con EXECUTE = ' || v_priv::text);
  end if;
end $$;

-- ── A3 a A7: approve_join ────────────────────────────────────
do $$
declare
  v_org uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();
  v_base timestamptz := date_trunc('hour', now()) + interval '40 days';
  v_a uuid; v_b uuid; v_c uuid;
  v_j jsonb; v_estado text; v_cupos int; v_avisos int; v_ok boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r133-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_jug]) u;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, duracion_min, aprobacion)
  values (v_org, 'r133 A', 'Ñuñoa', 'Cancha r133', -33.45, -70.61, v_base, 5, 5, 60, 'manual')
  returning id into v_a;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, duracion_min, aprobacion)
  values (v_org, 'r133 B', 'Ñuñoa', 'Cancha r133', -33.45, -70.61, v_base + interval '30 minutes', 5, 5, 60, 'manual')
  returning id into v_b;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, duracion_min, aprobacion)
  values (v_org, 'r133 C', 'Ñuñoa', 'Cancha r133', -33.45, -70.61, v_base + interval '60 minutes', 5, 5, 60, 'manual')
  returning id into v_c;

  -- Las solicitudes pendientes no ocupan horario: las tres entran.
  insert into public.attendees (id_partido, id_jugador, estado)
  values (v_a, v_jug, 'pendiente'), (v_b, v_jug, 'pendiente'), (v_c, v_jug, 'pendiente');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.approve_join(v_a, v_jug);
  execute 'reset role';
  insert into r133 values ('A3 la primera aprobación entra', (v_j->>'ok')::boolean, v_j::text);

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.approve_join(v_b, v_jug);
  execute 'reset role';
  insert into r133 values ('A4 la aprobación superpuesta se rechaza',
    (v_j->>'ok')::boolean = false
      and v_j->>'code' = 'CHOQUE_HORARIO'
      and v_j->>'reason' = 'Ese jugador ya tiene otro partido a esa hora',
    v_j::text);

  select estado into v_estado from public.attendees where id_partido = v_b and id_jugador = v_jug;
  select cupos_disponibles into v_cupos from public.matches where id = v_b;
  select count(*) into v_avisos from public.notifications
   where user_id = v_jug and type = 'join_approved' and data->>'matchId' = v_b::text;
  insert into r133 values ('A5 el rechazo no deja rastro',
    v_estado = 'pendiente' and v_cupos = 5 and v_avisos = 0,
    format('estado=%s cupos=%s avisos=%s', v_estado, v_cupos, v_avisos));

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.approve_join(v_c, v_jug);
  execute 'reset role';
  insert into r133 values ('A6 control: el partido contiguo se aprueba', (v_j->>'ok')::boolean, v_j::text);

  update public.profiles set estado = 'suspendido', suspended_until = now() + interval '7 days'
   where id = v_jug;
  v_ok := true;
  begin
    update public.attendees set estado = 'confirmado_gps' where id_partido = v_a and id_jugador = v_jug;
  exception when others then
    v_ok := false;
    insert into r133 values ('A7 la marca GPS no pasa por la regla', false, sqlerrm);
  end;
  if v_ok then
    select estado into v_estado from public.attendees where id_partido = v_a and id_jugador = v_jug;
    insert into r133 values ('A7 la marca GPS no pasa por la regla', v_estado = 'confirmado_gps', v_estado);
  end if;
end $$;

-- ── A8 y A9: confirmar_nomina_club ───────────────────────────
do $$
declare
  v_admin_l uuid := gen_random_uuid();
  v_admin_v uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();
  v_otro uuid := gen_random_uuid();
  v_base timestamptz := date_trunc('hour', now()) + interval '41 days';
  v_cl uuid; v_cv uuid; v_des uuid; v_prop uuid; v_m uuid; v_n uuid;
  v_j json; v_estado text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r133-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_admin_l, v_admin_v, v_jug, v_otro]) u;

  insert into public.clubs (nombre, slug, created_by)
  values ('r133 local ' || left(v_admin_l::text, 8), 'r133-l-' || v_admin_l, v_admin_l) returning id into v_cl;
  insert into public.clubs (nombre, slug, created_by)
  values ('r133 visita ' || left(v_admin_v::text, 8), 'r133-v-' || v_admin_v, v_admin_v) returning id into v_cv;
  insert into public.club_members (club_id, user_id, rol)
  select v_cl, v_admin_l, 'admin'
   where not exists (select 1 from public.club_members where club_id = v_cl and user_id = v_admin_l);
  insert into public.club_members (club_id, user_id, rol)
  select v_cv, v_admin_v, 'admin'
   where not exists (select 1 from public.club_members where club_id = v_cv and user_id = v_admin_v);
  insert into public.club_members (club_id, user_id, rol) values (v_cl, v_jug, 'jugador'), (v_cl, v_otro, 'jugador');

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado, modalidad)
  values (v_cl, v_cv, v_admin_l, 'publicado', 'futbol7') returning id into v_des;
  insert into public.club_challenge_proposals (challenge_id, club_proponente_id, creada_por, fecha,
      duracion_min, direccion, cancha_nombre, comuna, region, latitud, longitud, modalidad,
      cupos_por_club, metodo_inscripcion, estado)
  values (v_des, v_cl, v_admin_l, v_base, 60, 'Calle r133 1', 'Cancha r133', 'Ñuñoa', 'Metropolitana',
      -33.45, -70.61, 'futbol7', 7, 'seleccion_admin', 'aprobada') returning id into v_prop;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, duracion_min, aprobacion, modalidad,
      club_local_id, club_visitante_id, challenge_id, challenge_proposal_id,
      cupos_por_club, metodo_inscripcion)
  values (v_admin_l, 'r133 clubes', 'Ñuñoa', 'Cancha r133', -33.45, -70.61,
      v_base, 14, 14, 60, 'inmediata', 'futbol7', v_cl, v_cv, v_des, v_prop, 7, 'seleccion_admin')
  returning id into v_m;

  -- Los dos postulan sin choque: una postulación no ocupa horario.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jug, 'role', 'authenticated')::text);
  perform public.join_club_match(v_m);
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_otro, 'role', 'authenticated')::text);
  perform public.join_club_match(v_m);
  execute 'reset role';

  -- Después, `v_jug` entra a un partido normal a la misma hora.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, duracion_min, aprobacion)
  values (v_admin_v, 'r133 normal', 'Ñuñoa', 'Cancha r133', -33.45, -70.61, v_base, 5, 5, 60, 'inmediata')
  returning id into v_n;
  insert into public.attendees (id_partido, id_jugador, estado) values (v_n, v_jug, 'inscrito');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_l, 'role', 'authenticated')::text);
  v_j := public.confirmar_nomina_club(v_m, v_jug, true);
  execute 'reset role';
  select estado into v_estado from public.attendees where id_partido = v_m and id_jugador = v_jug;
  insert into r133 values ('A8 confirmar en la nómina también mira la agenda',
    (v_j->>'ok')::boolean = false and v_j->>'code' = 'CHOQUE_HORARIO' and v_estado = 'pendiente',
    format('%s estado=%s', v_j, v_estado));

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_l, 'role', 'authenticated')::text);
  v_j := public.confirmar_nomina_club(v_m, v_otro, true);
  execute 'reset role';
  select estado into v_estado from public.attendees where id_partido = v_m and id_jugador = v_otro;
  insert into r133 values ('A9 control: sin choque se confirma',
    (v_j->>'ok')::boolean and v_estado = 'inscrito', format('%s estado=%s', v_j, v_estado));
end $$;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r133 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r133 where not ok;
    raise exception 'FALLARON % casos de la 133: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r133 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r133;

rollback;
