-- =============================================================
-- FutFinder — pruebas de la migración 124 (N10, la mitad del servidor).
--
-- La revisión demostró que la INTERFAZ ofrecía calificar un partido cancelado
-- y dejó abierto si el servidor además lo aceptaba. Lo aceptaba. Acá quedan
-- los dos lados de la regla:
--
--   P1  Un partido jugado se puede calificar (la política no se rompió).
--   P2  Un partido cancelado, no, aunque los dos hayan confirmado GPS.
--   P3  Y lo que ya protegía sigue protegido: no calificarse a uno mismo.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r124 (caso text, ok boolean, detalle text);
grant all on r124 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_uno uuid := gen_random_uuid();
  v_dos uuid := gen_random_uuid();
  v_jugado uuid; v_cancelado uuid;
  v_ok boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r124-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_uno, v_dos]) u;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r124 jugado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '2 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_jugado;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r124 cancelado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '3 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_cancelado;

  -- Los dos alcanzaron a marcar GPS en los dos partidos. La cancelación NO
  -- borra esas marcas: ese es justo el escenario del informe.
  insert into public.attendees (id_partido, id_jugador, estado)
  select m, j, 'confirmado_gps'
    from unnest(array[v_jugado, v_cancelado]) m, unnest(array[v_uno, v_dos]) j;

  -- Las horas se mueven después (`trg_match_future_only`) y en distinto
  -- horario, para no chocar con la agenda de los inscritos (migración 123).
  update public.matches set hora = now() - interval '4 hours' where id = v_jugado;
  update public.matches set hora = now() - interval '9 hours' where id = v_cancelado;
  update public.matches set estado = 'cancelado' where id = v_cancelado;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uno, 'role', 'authenticated')::text, true);

  v_ok := true;
  begin
    insert into public.ratings (match_id, rater_id, rated_id, puntualidad, fairplay, nivel)
    values (v_jugado, v_uno, v_dos, 5, 5, 4);
  exception when others then
    v_ok := false;
    insert into r124 values ('P1 un partido jugado se puede calificar', false, sqlerrm);
  end;
  if v_ok then
    insert into r124 values ('P1 un partido jugado se puede calificar', true, 'insertada');
  end if;

  v_ok := true;
  begin
    insert into public.ratings (match_id, rater_id, rated_id, puntualidad, fairplay, nivel)
    values (v_cancelado, v_uno, v_dos, 5, 5, 4);
  exception when others then
    v_ok := false;
    insert into r124 values ('P2 un partido cancelado NO se puede calificar', true, sqlerrm);
  end;
  if v_ok then
    insert into r124 values ('P2 un partido cancelado NO se puede calificar',
      false, 'la evaluación se guardó igual');
  end if;

  v_ok := true;
  begin
    insert into public.ratings (match_id, rater_id, rated_id, puntualidad, fairplay, nivel)
    values (v_jugado, v_uno, v_uno, 5, 5, 5);
  exception when others then
    v_ok := false;
    insert into r124 values ('P3 nadie se califica a si mismo', true, sqlerrm);
  end;
  if v_ok then
    insert into r124 values ('P3 nadie se califica a si mismo', false, 'se guardó');
  end if;

  reset role;
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r124 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r124 where not ok;
    raise exception 'FALLARON % casos de la 124: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r124 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r124;

rollback;
