-- =============================================================
-- FutFinder — pruebas de la migración 126.
--
--   P1  `authenticated` ya no tiene EXECUTE sobre la función de trigger.
--   P2  Y el trigger SIGUE disparando: mover la hora encima del partido de un
--       inscrito se rechaza igual. Este es el caso que importa —la lección de
--       la 47b—: PostgreSQL comprueba el privilegio al CREAR el trigger, no en
--       cada disparo, así que si revocarlo lo desactivara, el fallo sería
--       silencioso y ninguna pantalla se rompería.
--   P3  Y el control contrario: un cambio de hora SIN conflicto se guarda, de
--       modo que P2 no pueda pasar por un trigger que rechace siempre.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r126 (caso text, ok boolean, detalle text);

do $$
declare
  v_org uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_hora timestamptz; v_ok boolean; v_priv boolean;
  v_base timestamptz := date_trunc('hour', now()) + interval '3 days';
begin
  select has_function_privilege('authenticated', 'public.tg_reprogramar_mira_la_agenda()', 'EXECUTE')
    into v_priv;
  insert into r126 values ('P1 authenticated ya no puede ejecutarla por REST',
    v_priv = false, 'has_function_privilege = ' || v_priv::text);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r126-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_jug]) u;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r126 A', 'Ñuñoa', 'Cancha', -33.45, -70.60,
      v_base, 5, 5, 'abierto', 90, 'inmediata') returning id into v_a;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r126 B', 'Ñuñoa', 'Cancha', -33.46, -70.59,
      v_base + interval '6 hours', 5, 5, 'abierto', 90, 'inmediata') returning id into v_b;

  insert into public.attendees (id_partido, id_jugador, estado) values (v_a, v_jug, 'inscrito');
  insert into public.attendees (id_partido, id_jugador, estado) values (v_b, v_jug, 'inscrito');

  v_ok := true;
  begin
    update public.matches set hora = v_base + interval '30 minutes' where id = v_b;
  exception when others then
    v_ok := false;
    insert into r126 values ('P2 el trigger sigue disparando sin EXECUTE',
      sqlerrm like '%CHOQUE_AGENDA_INSCRITOS:%', sqlerrm);
  end;
  if v_ok then
    insert into r126 values ('P2 el trigger sigue disparando sin EXECUTE',
      false, 'la edición conflictiva pasó: revocar el EXECUTE lo desactivó');
  end if;

  update public.matches set hora = v_base + interval '20 hours' where id = v_b;
  select hora into v_hora from public.matches where id = v_b;
  insert into r126 values ('P3 y no rechaza lo que no choca',
    v_hora = v_base + interval '20 hours', v_hora::text);
end $$;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r126 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r126 where not ok;
    raise exception 'FALLARON % casos de la 126: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r126 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r126;

rollback;
