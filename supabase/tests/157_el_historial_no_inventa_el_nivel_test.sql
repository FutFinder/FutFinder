-- =============================================================
-- FutFinder — pruebas de la migración 157
--
-- Qué cubre:
--   1. Los encuentros anteriores a la 156 devuelven `null`, no
--      `'recreativo'`. Es lo que pedía la verificación del pendiente con
--      todas sus letras: «uno anterior a ese cambio **no miente**».
--   2. Un encuentro cuyo proponente eligió «competitivo» se lee
--      «competitivo» en el historial.
--
-- EL CONTROL DE ANTES/DESPUÉS se midió en el ensayo revertido, con la
-- función vieja en pie: el único encuentro del historial devolvía
-- **«recreativo»**, un valor que nadie había elegido. Queda anotado acá
-- porque después de aplicar la migración ya no se puede reproducir.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

create temp table r(caso text) on commit drop;

-- El caso 1 necesita un encuentro ANTERIOR a la 156: uno cuya propuesta no
-- tenga nivel, que es como quedaron las once que existían al aplicarla. Se
-- siembra uno —sin pasar 'nivel' en el payload— en vez de buscar el primero
-- que haya en la base: contra una recién construida no hay ninguno, y mi
-- propio arnés tenía el defecto que les critiqué a los demás.
do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_ca uuid; v_cb uuid; v_ch uuid; v_prop record; v_mid uuid;
  v_marca text := 'pre156' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
    v_marca||'-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from (values (v_a), (v_b)) as u(id);
  insert into public.profiles (id, username) values (v_a, v_marca||'a'), (v_b, v_marca||'b')
    on conflict (id) do nothing;
  insert into public.clubs (nombre, slug, created_by) values (v_marca||' A', v_marca||'-a', v_a) returning id into v_ca;
  insert into public.clubs (nombre, slug, created_by) values (v_marca||' B', v_marca||'-b', v_b) returning id into v_cb;
  insert into public.club_members (club_id, user_id, rol) values (v_ca, v_a, 'admin'), (v_cb, v_b, 'admin');
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_ca, v_cb, v_a, 'pendiente') returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  -- SIN 'nivel': así queda una propuesta como las anteriores a la 156.
  v_prop := public.crear_propuesta_oficial(v_ch, jsonb_build_object(
    'fecha', (now() + interval '6 days')::text, 'duracion_min', 90,
    'direccion', 'Calle', 'cancha_nombre', 'Cancha '||v_marca, 'comuna', 'Ñuñoa',
    'region', 'Metropolitana', 'latitud', -33.4569, 'longitud', -70.6483,
    'modalidad', 'futbol7', 'cupos_por_club', 7, 'metodo_inscripcion', 'orden_llegada',
    'cuota_por_persona', 0), gen_random_uuid());
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  perform public.aprobar_propuesta(v_prop.id, p_me_inscribo => false);
  execute 'reset role';

  select id into v_mid from public.matches where challenge_proposal_id = v_prop.id;
  update public.matches set estado = 'finalizado', hora = now() - interval '2 days' where id = v_mid;
  insert into public.club_match_results (match_id, challenge_id, club_local_id, club_visitante_id,
    goles_local, goles_visitante, estado, propuesto_por, club_proponente_id)
  values (v_mid, v_ch, v_ca, v_cb, 1, 1, 'confirmado', v_a, v_ca);
end $$;

do $$
declare v_club uuid; v_n integer; v_nulos integer; v_niveles text;
begin
  select m.club_local_id into v_club from public.matches m
   where m.challenge_proposal_id is not null limit 1;
  if v_club is null then
    raise exception 'SETUP: no hay ningún partido de clubes con el que medir';
  end if;

  -- ── Caso 1: los viejos ya no mienten ──────────────────────────
  select count(*), count(*) filter (where h.nivel is null),
         string_agg(distinct coalesce(h.nivel, 'NULL'), ', ')
    into v_n, v_nulos, v_niveles
    from public.historial_club(v_club, 50) h;
  if v_n > 0 and v_nulos <> v_n then
    raise exception 'CASO 1 FALLA: un encuentro anterior a la 156 devuelve un nivel que nadie eligió (%)', v_niveles;
  end if;
  insert into r values ('CASO 1 OK — los '||v_n||' encuentros anteriores devuelven null');
end $$;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_ca uuid; v_cb uuid; v_ch uuid; v_prop record; v_mid uuid; v_nivel text;
  v_marca text := 'm157' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  v_payload jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
    'm157-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from (values (v_a), (v_b)) as u(id);
  insert into public.profiles (id, username) values (v_a, v_marca||'a'), (v_b, v_marca||'b')
    on conflict (id) do nothing;
  insert into public.clubs (nombre, slug, created_by)
  values (v_marca||' A', v_marca||'-a', v_a) returning id into v_ca;
  insert into public.clubs (nombre, slug, created_by)
  values (v_marca||' B', v_marca||'-b', v_b) returning id into v_cb;
  insert into public.club_members (club_id, user_id, rol) values
    (v_ca, v_a, 'admin'), (v_cb, v_b, 'admin');

  -- La propuesta tiene que ser FUTURA (`crear_propuesta_oficial` lo exige),
  -- así que el partido se retroactiva después para que el historial lo tome.
  v_payload := jsonb_build_object(
    'fecha', (now() + interval '2 days')::text, 'duracion_min', 90,
    'direccion', 'Calle', 'cancha_nombre', 'Cancha '||v_marca, 'comuna', 'Ñuñoa',
    'region', 'Metropolitana', 'latitud', -33.4569, 'longitud', -70.6483,
    'modalidad', 'futbol7', 'cupos_por_club', 7, 'metodo_inscripcion', 'orden_llegada',
    'cuota_por_persona', 0, 'nivel', 'competitivo');

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_ca, v_cb, v_a, 'pendiente') returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  v_prop := public.crear_propuesta_oficial(v_ch, v_payload, gen_random_uuid());
  execute 'reset role';
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  perform public.aprobar_propuesta(v_prop.id, false);
  execute 'reset role';

  select id into v_mid from public.matches where challenge_proposal_id = v_prop.id;
  update public.matches set estado = 'finalizado', hora = now() - interval '2 days' where id = v_mid;
  insert into public.club_match_results (match_id, challenge_id, club_local_id, club_visitante_id,
    goles_local, goles_visitante, estado, propuesto_por, club_proponente_id)
  values (v_mid, v_ch, v_ca, v_cb, 3, 1, 'confirmado', v_a, v_ca);

  -- ── Caso 2: el nuevo sí lo dice ───────────────────────────────
  select h.nivel into v_nivel from public.historial_club(v_ca, 50) h limit 1;
  if v_nivel is distinct from 'competitivo' then
    raise exception 'CASO 2 FALLA: el historial devolvió % en vez de competitivo', coalesce(v_nivel, 'null');
  end if;
  insert into r values ('CASO 2 OK — un encuentro con nivel elegido se lee «competitivo»');

  insert into r values ('=== 157: 2/2, el arnes llego a la ultima linea ===');
end $$;

select * from r;

rollback;
