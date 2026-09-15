-- =============================================================
-- FutFinder — pruebas de la migración 108.
--
-- EL CASO QUE IMPORTA: cambiarse de partido no puede dejarte fuera de los
-- dos. La versión que estaba en el repositorio soltaba el cupo viejo ANTES de
-- comprobar el destino; si el destino no aceptaba, el jugador quedaba sin
-- partido y con la sanción cobrada. El cuerpo desplegado ya lo hacía bien y
-- acá queda versionado, con una corrección: la sanción del arrepentido se le
-- cobraba también a quien nunca estuvo en el partido de origen.
--
--   P1. Un destino lleno no rompe nada: sigue en el suyo y no paga.
--   P2. El cambio bueno mueve el cupo y cobra los 3 puntos.
--   P3. Quien no estaba en el origen no paga la sanción del arrepentido…
--   P4. …y aun así entra al destino.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r108 (caso text, ok boolean, detalle text);
grant all on r108 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();
  v_otro uuid := gen_random_uuid();
  v_relleno uuid := gen_random_uuid();
  v_viejo uuid; v_lleno uuid; v_destino uuid; v_res jsonb; v_t int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r108-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_jug, v_otro, v_relleno]) u;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r108 origen', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 day', 5, 5, 'abierto', 90, 'inmediata') returning id into v_viejo;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r108 lleno', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '2 days', 1, 1, 'abierto', 90, 'inmediata') returning id into v_lleno;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r108 destino', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '3 days', 3, 3, 'abierto', 90, 'inmediata') returning id into v_destino;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_jug, 'role', 'authenticated')::text, true);
  perform public.join_match(v_viejo);
  perform set_config('request.jwt.claims', json_build_object('sub', v_relleno, 'role', 'authenticated')::text, true);
  perform public.join_match(v_lleno);

  perform set_config('request.jwt.claims', json_build_object('sub', v_jug, 'role', 'authenticated')::text, true);
  v_res := public.swap_match(v_viejo, v_lleno);
  reset role;
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r108 values ('P1 el destino lleno no rompe el cambio',
    (v_res->>'ok') = 'false'
      and exists (select 1 from public.attendees where id_partido = v_viejo and id_jugador = v_jug)
      and v_t = 100,
    v_res->>'reason' || ' · sigue inscrito, puntaje ' || v_t);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_jug, 'role', 'authenticated')::text, true);
  v_res := public.swap_match(v_viejo, v_destino);
  reset role;
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r108 values ('P2 el cambio bueno mueve el cupo y cobra 3',
    (v_res->>'ok') = 'true'
      and not exists (select 1 from public.attendees where id_partido = v_viejo and id_jugador = v_jug)
      and exists (select 1 from public.attendees where id_partido = v_destino and id_jugador = v_jug)
      and v_t = 97,
    v_res::text || ' · puntaje ' || v_t);

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);
  v_res := public.swap_match(v_viejo, v_destino);
  reset role;
  select trust_score into v_t from public.profiles where id = v_otro;
  insert into r108 values ('P3 quien no estaba en el origen no paga',
    v_t = 100, 'puntaje ' || v_t || ', penalty=' || coalesce(v_res->>'penalty','-'));
  insert into r108 values ('P4 y aun así entra al destino',
    exists (select 1 from public.attendees where id_partido = v_destino and id_jugador = v_otro),
    'inscrito');
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r108 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r108;

rollback;
