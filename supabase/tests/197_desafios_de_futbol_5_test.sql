-- Arnés de la migración 197 (desafíos y alineación de Fútbol 5).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 197 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Todo lo que hace la app va como `authenticated`.
--
--   D1  Un desafío de Fútbol 5: se acepta, se propone en Fútbol 5 con 5 por
--       club, se aprueba y el partido sale de Fútbol 5 con 10 cupos.
--   D2  Control negativo: una modalidad inventada se rechaza en la propuesta.
--   O1  Se publica un desafío abierto de Fútbol 5.
--   L1  El admin guarda una alineación de 5 (arquero + 4).
--   L2  Control negativo: un tablero de 6 se rechaza.
begin;

create temp table r197 (caso text) on commit drop;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_ca uuid; v_cb uuid; v_cc uuid; v_cd uuid; v_ch uuid; v_prop record; v_match record;
  v_marca text := 'f197' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_payload jsonb; v_pudo boolean; v_msg text; v_mod text; v_modo int;
begin
  update public.feature_flags set activo = false where nombre in ('telefono_obligatorio', 'mfa_obligatoria_staff');
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
    'f197-' || u.id || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
  from (values (v_a), (v_b)) as u(id);
  insert into public.profiles (id, username) values
    (v_a, v_marca || 'a'), (v_b, v_marca || 'b') on conflict (id) do nothing;

  -- Dos pares de clubes sin administrador en común (`club_challenges_valida_rival`).
  insert into public.clubs (nombre, slug, created_by, modalidad) values (v_marca || ' A', v_marca || '-a', v_a, 'futbol5') returning id into v_ca;
  insert into public.clubs (nombre, slug, created_by, modalidad) values (v_marca || ' B', v_marca || '-b', v_b, 'futbol5') returning id into v_cb;
  insert into public.clubs (nombre, slug, created_by) values (v_marca || ' C', v_marca || '-c', v_a) returning id into v_cc;
  insert into public.clubs (nombre, slug, created_by) values (v_marca || ' D', v_marca || '-d', v_b) returning id into v_cd;
  insert into public.club_members (club_id, user_id, rol) values
    (v_ca, v_a, 'admin'), (v_cb, v_b, 'admin'), (v_cc, v_a, 'admin'), (v_cd, v_b, 'admin')
  on conflict do nothing;

  v_payload := jsonb_build_object(
    'fecha', (now() + interval '3 days')::text, 'duracion_min', 60,
    'direccion', 'Av. Grecia 2001', 'cancha_nombre', 'Complejo ' || v_marca,
    'comuna', 'Ñuñoa', 'region', 'Metropolitana',
    'latitud', -33.4569, 'longitud', -70.6107, 'modalidad', 'futbol5',
    'cupos_por_club', 5, 'metodo_inscripcion', 'orden_llegada',
    'cuota_por_persona', 3000);

  -- ── D1 ───────────────────────────────────────────────────────
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado, modalidad)
  values (v_ca, v_cb, v_a, 'pendiente', 'futbol5') returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_prop := public.crear_propuesta_oficial(v_ch, v_payload, gen_random_uuid());
  execute 'reset role';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role', 'authenticated')::text);
  v_match := public.aprobar_propuesta(v_prop.id, false);
  execute 'reset role';

  select m.modalidad, m.cupos_totales into v_mod, v_modo from public.matches m where m.challenge_proposal_id = v_prop.id;
  if v_mod is distinct from 'futbol5' or v_modo is distinct from 10 then
    raise exception 'FALLÓ D1: el partido salió en % con % cupos', v_mod, v_modo;
  end if;
  insert into r197 values ('D1 OK: desafío de Fútbol 5 aceptado, propuesto, aprobado y publicado con 10 cupos');

  -- ── D2 ───────────────────────────────────────────────────────
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_cc, v_cd, v_a, 'pendiente') returning id into v_ch;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role', 'authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';

  v_pudo := true;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role', 'authenticated')::text);
  begin
    perform public.crear_propuesta_oficial(v_ch, v_payload || jsonb_build_object('modalidad', 'futbol6'), gen_random_uuid());
  exception when check_violation then
    v_pudo := false; v_msg := sqlerrm;
  end;
  execute 'reset role';
  if v_pudo or v_msg not like 'Modalidad no válida%' then
    raise exception 'FALLÓ D2: «futbol6» no se rechazó como modalidad (%)', coalesce(v_msg, 'pasó');
  end if;
  insert into r197 values ('D2 OK: una modalidad inventada se rechaza en la propuesta');

  -- ── O1 ───────────────────────────────────────────────────────
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role', 'authenticated')::text);
  insert into public.club_open_challenges (club_id, creado_por, modalidad, fecha_propuesta, zona)
  values (v_cc, v_a, 'futbol5', (now() + interval '5 days')::date, 'Ñuñoa');
  execute 'reset role';
  insert into r197 values ('O1 OK: un desafío abierto de Fútbol 5 se publica');

  -- ── L1 ───────────────────────────────────────────────────────
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role', 'authenticated')::text);
  insert into public.club_lineups (club_id, modo, formacion, asignaciones, updated_by)
  values (v_ca, 5, '1-2-1', '{}'::jsonb, v_a);
  execute 'reset role';
  insert into r197 values ('L1 OK: el admin guarda una alineación de 5');

  -- ── L2 ───────────────────────────────────────────────────────
  v_pudo := true;
  begin
    update public.club_lineups set modo = 6 where club_id = v_ca;
  exception when check_violation then v_pudo := false;
  end;
  if v_pudo then raise exception 'FALLÓ L2: se guardó un tablero de 6'; end if;
  insert into r197 values ('L2 OK: un tablero de 6 se rechaza');
end $$;

select caso from r197;
rollback;
