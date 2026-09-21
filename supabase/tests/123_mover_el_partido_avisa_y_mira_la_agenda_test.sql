-- =============================================================
-- FutFinder — pruebas de la migración 123 (N05 y N06).
--
--   N05  Mover el LUGAR avisa, aunque la cancha y la comuna conserven el
--        nombre. Con el control obligatorio: una edición que no mueve nada
--        vigilado sigue sin mandar avisos.
--   N06  Mover la HORA (o la duración) encima de otro partido de un inscrito
--        se rechaza, y el partido queda como estaba. Con sus dos límites: si
--        no hay choque se guarda, y la agenda del organizador de un partido
--        normal no la administra esta regla.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r123 (caso text, ok boolean, detalle text);

do $$
declare
  v_org uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_solo uuid; v_del_org uuid;
  v_antes int; v_n int; v_body text; v_hora timestamptz; v_ok boolean;
  v_base timestamptz := date_trunc('hour', now()) + interval '3 days';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r123-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_jug]) u;

  -- A a las 10:00 y B a las 16:00 del mismo día: no se superponen, así que el
  -- jugador puede inscribirse en los dos (que es justo el escenario de N06).
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, direccion,
      latitud, longitud, hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r123 A', 'Ñuñoa', 'Cancha Uno', 'Irarrázaval 100', -33.45, -70.60,
      v_base, 5, 5, 'abierto', 90, 'inmediata') returning id into v_a;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, direccion,
      latitud, longitud, hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r123 B', 'Ñuñoa', 'Cancha Dos', 'Grecia 200', -33.46, -70.59,
      v_base + interval '6 hours', 5, 5, 'abierto', 90, 'inmediata') returning id into v_b;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, direccion,
      latitud, longitud, hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r123 sin nadie', 'Ñuñoa', 'Cancha Tres', 'Vespucio 300', -33.47, -70.58,
      v_base + interval '12 hours', 5, 5, 'abierto', 90, 'inmediata') returning id into v_solo;

  insert into public.attendees (id_partido, id_jugador, estado) values (v_a, v_jug, 'inscrito');
  insert into public.attendees (id_partido, id_jugador, estado) values (v_b, v_jug, 'inscrito');

  -- ── N05 ───────────────────────────────────────────────────────
  select count(*) into v_antes from public.notifications
   where user_id = v_jug and type = 'match_updated';

  -- Otro punto del buscador dentro de la misma comuna: cambian dirección y
  -- coordenadas, y NADA más. Es exactamente el caso del informe.
  update public.matches
     set direccion = 'Irarrázaval 4500', latitud = -33.4560, longitud = -70.5900
   where id = v_a;

  select count(*), max(body) into v_n, v_body from public.notifications
   where user_id = v_jug and type = 'match_updated'
     and (data->>'matchId') = v_a::text;
  insert into r123 values ('N05 mover el lugar avisa al inscrito', v_n = v_antes + 1,
    v_n || ' avisos: ' || coalesce(v_body, 'ninguno'));
  insert into r123 values ('N05 el aviso nombra la direccion',
    coalesce(v_body, '') like '%la dirección%', coalesce(v_body, 'sin aviso'));

  -- Control: una edición que no toca nada vigilado sigue sin avisar.
  update public.matches set descripcion = 'Llevar peto' where id = v_a;
  select count(*) into v_n from public.notifications
   where user_id = v_jug and type = 'match_updated' and (data->>'matchId') = v_a::text;
  insert into r123 values ('N05 cambiar la descripcion NO avisa', v_n = v_antes + 1, v_n::text);

  -- ── N06 ───────────────────────────────────────────────────────
  -- B se mueve encima de A, donde el mismo jugador ya está inscrito.
  v_ok := true;
  begin
    update public.matches set hora = v_base + interval '30 minutes' where id = v_b;
  exception when others then
    v_ok := false;
    insert into r123 values ('N06 mover la hora encima de otro partido se rechaza',
      sqlerrm like '%CHOQUE_AGENDA_INSCRITOS:%', sqlerrm);
  end;
  if v_ok then
    insert into r123 values ('N06 mover la hora encima de otro partido se rechaza',
      false, 'la edición pasó sin error');
  end if;

  select hora into v_hora from public.matches where id = v_b;
  insert into r123 values ('N06 el partido queda como estaba',
    v_hora = v_base + interval '6 hours', v_hora::text);

  -- Estirar la duración hasta solaparse es el mismo problema por el otro lado.
  update public.matches set hora = v_base + interval '3 hours' where id = v_b; -- 13:00, sin choque
  v_ok := true;
  begin
    update public.matches set duracion_min = 600 where id = v_a; -- A se come el día entero
  exception when others then
    v_ok := false;
    insert into r123 values ('N06 estirar la duracion hasta chocar tambien se rechaza',
      sqlerrm like '%CHOQUE_AGENDA_INSCRITOS:%', sqlerrm);
  end;
  if v_ok then
    insert into r123 values ('N06 estirar la duracion hasta chocar tambien se rechaza',
      false, 'la edición pasó sin error');
  end if;

  -- Mover a una hora libre sí se guarda: la regla no bloquea reprogramar.
  update public.matches set hora = v_base + interval '20 hours' where id = v_b;
  select hora into v_hora from public.matches where id = v_b;
  insert into r123 values ('N06 mover a una hora libre se guarda',
    v_hora = v_base + interval '20 hours', v_hora::text);

  -- Un partido sin inscritos se mueve donde quiera.
  update public.matches set hora = v_base where id = v_solo;
  select hora into v_hora from public.matches where id = v_solo;
  insert into r123 values ('N06 un partido sin inscritos se mueve libre', v_hora = v_base, v_hora::text);

  -- La agenda del organizador de un partido normal no la administra esta
  -- regla, igual que en `tg_enforce_join_rules`: él ya está en A (es su
  -- partido) y puede mover este encima sin que nadie se lo impida.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, direccion,
      latitud, longitud, hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r123 del organizador', 'Ñuñoa', 'Cancha Cuatro', 'Dublé 400', -33.48, -70.57,
      v_base + interval '30 hours', 5, 5, 'abierto', 90, 'inmediata') returning id into v_del_org;
  update public.matches set hora = v_base where id = v_del_org;
  select hora into v_hora from public.matches where id = v_del_org;
  insert into r123 values ('N06 el organizador no se bloquea a si mismo', v_hora = v_base, v_hora::text);

  -- Cancelar no es reprogramar: la rama temprana deja pasar el cambio.
  update public.matches set estado = 'cancelado' where id = v_b;
  update public.matches set hora = v_base where id = v_b;
  select hora into v_hora from public.matches where id = v_b;
  insert into r123 values ('N06 un partido cancelado no pasa por la regla', v_hora = v_base, v_hora::text);
end $$;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r123 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r123 where not ok;
    raise exception 'FALLARON % casos de la 123: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r123 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r123;

rollback;
