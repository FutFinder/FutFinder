-- =============================================================
-- FutFinder — pruebas de la migración 106.
--
-- EL CASO QUE IMPORTA: `leave_match` es la RPC heredada. Borraba la
-- inscripción y liberaba el cupo SIN descontar nada, y seguía concedida a
-- `authenticated` aunque ninguna pantalla la llame. Era una segunda puerta
-- para salirse gratis de un partido al que ya te habías comprometido.
--
--   P1. Salirse con anticipación cuesta 3 puntos, también por esta puerta.
--   P2. A menos de 2 horas, 20.
--   P3. El Trust Score baja de verdad.
--   P4. El cupo vuelve a quedar libre.
--   P5. El organizador sigue sin poder salirse por acá: cancela el partido.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r106 (caso text, ok boolean, detalle text);
grant all on r106 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_lejos uuid := gen_random_uuid();
  v_cerca uuid := gen_random_uuid();
  v_p_lejos uuid; v_p_cerca uuid;
  v_res jsonb; v_antes int; v_despues int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r106-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_lejos, v_cerca]) u;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r106 lejos', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 day', 3, 3, 'abierto', 90, 'inmediata')
  returning id into v_p_lejos;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r106 cerca', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 hour', 3, 3, 'abierto', 90, 'inmediata')
  returning id into v_p_cerca;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_lejos, 'role', 'authenticated')::text, true);
  perform public.join_match(v_p_lejos);
  perform set_config('request.jwt.claims', json_build_object('sub', v_cerca, 'role', 'authenticated')::text, true);
  perform public.join_match(v_p_cerca);

  reset role;
  select trust_score into v_antes from public.profiles where id = v_lejos;

  -- P1: la puerta heredada, con el partido lejos.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_lejos, 'role', 'authenticated')::text, true);
  v_res := public.leave_match(v_p_lejos)::jsonb;
  insert into r106 values ('P1 salir con anticipación cuesta 3',
    (v_res->>'penalty') = '3', v_res::text);

  -- P2: y a una hora del partido.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cerca, 'role', 'authenticated')::text, true);
  v_res := public.leave_match(v_p_cerca)::jsonb;
  insert into r106 values ('P2 a menos de 2 horas cuesta 20',
    (v_res->>'penalty') = '20', v_res::text);

  reset role;
  select trust_score into v_despues from public.profiles where id = v_lejos;
  insert into r106 values ('P3 el Trust Score baja de verdad',
    v_despues = v_antes - 3, v_antes || ' → ' || v_despues);

  insert into r106 values ('P4 el cupo vuelve a quedar libre',
    (select cupos_disponibles from public.matches where id = v_p_lejos) = 3,
    (select cupos_disponibles::text from public.matches where id = v_p_lejos));

  -- P5: el anfitrión no se «sale» de su propio partido.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  v_res := public.leave_match(v_p_lejos)::jsonb;
  insert into r106 values ('P5 el organizador no se sale por acá',
    (v_res->>'ok') = 'false', v_res->>'reason');
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r106 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r106;

rollback;
