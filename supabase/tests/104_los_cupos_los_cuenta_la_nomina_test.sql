-- =============================================================
-- FutFinder — pruebas de la migración 104.
--
-- EL CASO QUE IMPORTA: la disponibilidad se calculaba en sitios distintos y
-- ninguno miraba la nómina vigente. Un partido lleno dejaba de ocupar la
-- hora del jugador —quedaba inscrito en dos a la vez— y editar los cupos con
-- una pantalla vieja creaba plazas que no existían.
--
--   P1. `get_schedule_conflict` ve el partido LLENO, no solo el abierto.
--   P2. Y la escritura usa el mismo conjunto: no se entra a la misma hora.
--   P3. Editar 2→3 con un inscrito deja 2 libres, no 3.
--   P4. La disponibilidad no se recibe del cliente: se deduce de la nómina.
--
-- (El partido de un solo cupo vive en `partidos_cupo_unico_test.sql`.)
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r104 (caso text, ok boolean, detalle text);
grant all on r104 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_a   uuid := gen_random_uuid();
  v_b   uuid := gen_random_uuid();
  v_lleno uuid; v_mismaHora uuid; v_editar uuid;
  v_conf jsonb; v_libres int; v_totales int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r104-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_a, v_b]) u;

  -- Dos partidos a la MISMA hora y uno aparte para editar.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r104 lleno', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 day', 1, 1, 'abierto', 90, 'inmediata')
  returning id into v_lleno;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r104 misma hora', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 day', 5, 5, 'abierto', 90, 'inmediata')
  returning id into v_mismaHora;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r104 editar', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '2 days', 2, 2, 'abierto', 90, 'inmediata')
  returning id into v_editar;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.join_match(v_lleno);   -- lo deja lleno: era de un cupo

  -- P1: la consulta que usa la pantalla antes de ofrecer el botón.
  v_conf := public.get_schedule_conflict(v_mismaHora);
  insert into r104 values ('P1 get_schedule_conflict ve el partido lleno',
    (v_conf->>'conflict') = 'true', v_conf::text);

  -- P2: y la escritura. El trigger es el que de verdad lo impide.
  begin
    perform public.join_match(v_mismaHora);
    insert into r104 values ('P2 no se entra a dos partidos de la misma hora',
      false, 'entró a los dos');
  exception when others then
    insert into r104 values ('P2 no se entra a dos partidos de la misma hora',
      sqlerrm like '%CHOQUE_HORARIO%', sqlerrm);
  end;

  -- P3 y P4: editar los cupos con una nómina que ya cambió.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.join_match(v_editar);

  reset role;
  -- Lo que mandaría una pantalla abierta hace diez minutos: «3 de 3 libres».
  update public.matches set cupos_totales = 3, cupos_disponibles = 3 where id = v_editar;
  select cupos_disponibles, cupos_totales into v_libres, v_totales
    from public.matches where id = v_editar;

  insert into r104 values ('P3 editar 2→3 con un inscrito deja 2 libres',
    v_libres = 2 and v_totales = 3, v_libres || ' libres de ' || v_totales);

  -- P4: el mismo principio, al revés. Aunque se pidan cero libres con la
  -- cancha medio vacía, la nómina manda.
  update public.matches set cupos_disponibles = 0 where id = v_editar;
  select cupos_disponibles into v_libres from public.matches where id = v_editar;
  insert into r104 values ('P4 la disponibilidad se deduce, no se recibe',
    v_libres = 2, v_libres::text);
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r104 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r104;

rollback;
