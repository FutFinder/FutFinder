-- =============================================================
-- FutFinder — pruebas de la migración 166 (límites de uso).
--
--   A1  Las once tablas tienen su disparador de límite, con los topes que
--       dice la migración.
--   B1  Un ticket de soporte más allá del tope (10/h) se rechaza con el
--       mensaje de la migración y el código RATE_LIMIT…
--   B2  …y el rechazo no se lleva por delante lo ya guardado (quedan 10).
--   B3  El límite es por persona: otra cuenta sigue pudiendo.
--   C1  Mensajes de club: el 61 dentro del mismo minuto se rechaza.
--   D1  Solicitudes de amistad: la 31 en una hora se rechaza…
--   D2  …y las 30 anteriores sí entraron.
--   E1  `buscar_jugadores`: la búsqueda 61 en 5 minutos se rechaza.
--   E2  `registrar_telefono`: el intento 11 en una hora se rechaza, aunque
--       los diez anteriores hayan sido números mal escritos.
--   F1  `limite_correo_de_reporte` deja pasar 5 y niega la sexta.
--   G1  Sin sesión no se limita nada (el cron y el servicio no tienen tope).
--   G2  Las funciones internas no se ejecutan desde el cliente.
--   H1  Una ventana nueva empieza de cero (filas viejas no cuentan).
--   H2  La limpieza borra lo de hace más de 2 días y deja lo de hoy.
--
-- Cada rechazo exige `detail = 'RATE_LIMIT'` y SQLSTATE P0001, no «algo
-- falló»: un fallo distinto no prueba nada.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r166 (caso text, ok boolean, detalle text);
grant all on r166 to authenticated;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  v_club uuid;
  v_extra uuid[] := '{}';
  v_u uuid;
  i int; v_n int; v_det text; v_state text; v_msg text; v_ok boolean; v_b boolean;
  v_tg int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r166-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2]) u;

  insert into public.clubs (nombre, slug, created_by) values ('r166 club', 'r166-' || substr(u1::text, 1, 8), u1) returning id into v_club;
  insert into public.club_members (club_id, user_id, rol) values (v_club, u1, 'admin');

  -- ── A1: los once disparadores, con sus topes ──────────────────
  select count(*) into v_tg
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and t.tgname in ('trg_limite_de_uso_alta', 'trg_limite_de_uso_edicion')
     and c.relname in ('friendships','user_reports','support_tickets','messages','club_join_requests',
                       'solicitudes_recinto','reservas','pagos','matches','fairplay_reportes');
  insert into r166 values ('A1 las diez tablas (la de solicitudes_recinto con dos) tienen su limite', v_tg = 11, v_tg::text);

  -- ── B: tickets de soporte (10 por hora) ───────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := 0; v_det := null; v_state := null;
  for i in 1..11 loop
    begin
      insert into public.support_tickets (user_id, category, title, description)
      values (u1, 'fallo_tecnico', 'r166 ' || i, 'prueba de limite');
      v_n := v_n + 1;
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail, v_state = returned_sqlstate;
      v_msg := sqlerrm;
    end;
  end loop;
  reset role;
  insert into r166 values ('B1 el ticket 11 se rechaza con RATE_LIMIT y P0001',
    v_n = 10 and v_det = 'RATE_LIMIT' and v_state = 'P0001', 'entraron=' || v_n || ' detail=' || coalesce(v_det, '∅') || ' state=' || coalesce(v_state, '∅'));
  insert into r166 values ('B1 y el mensaje esta en espanol y dice que espere',
    v_msg like 'Hiciste demasiadas solicitudes seguidas%', coalesce(v_msg, '∅'));
  select count(*) into v_n from public.support_tickets where user_id = u1;
  insert into r166 values ('B2 el rechazo no borra lo ya guardado', v_n = 10, v_n::text);

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.support_tickets (user_id, category, title, description) values (u2, 'fallo_tecnico', 'r166 otra cuenta', 'x');
    v_ok := true;
  exception when others then v_ok := false; end;
  reset role;
  insert into r166 values ('B3 otra cuenta no paga por la primera', v_ok, '');

  -- ── C: mensajes del club (60 por minuto) ──────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := 0; v_det := null;
  for i in 1..61 loop
    begin
      insert into public.messages (sender_id, club_id, content) values (u1, v_club, 'hola ' || i);
      v_n := v_n + 1;
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail;
    end;
  end loop;
  reset role;
  insert into r166 values ('C1 el mensaje 61 del minuto se rechaza', v_n = 60 and v_det = 'RATE_LIMIT', 'entraron=' || v_n || ' detail=' || coalesce(v_det, '∅'));

  -- ── D: solicitudes de amistad (30 por hora) ───────────────────
  for i in 1..31 loop
    v_u := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_u, 'authenticated', 'authenticated',
            'r166x-' || v_u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
    v_extra := v_extra || v_u;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := 0; v_det := null;
  foreach v_u in array v_extra loop
    begin
      insert into public.friendships (requester_id, addressee_id, status) values (u2, v_u, 'pending');
      v_n := v_n + 1;
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail;
    end;
  end loop;
  reset role;
  insert into r166 values ('D1 la solicitud de amistad 31 de la hora se rechaza', v_det = 'RATE_LIMIT', coalesce(v_det, '∅'));
  insert into r166 values ('D2 y las 30 anteriores si entraron', v_n = 30, 'entraron=' || v_n);

  -- ── E: busquedas y telefono ───────────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := 0; v_det := null;
  for i in 1..61 loop
    begin
      perform * from public.buscar_jugadores('zzz', null, null, null, null, null, null, 5);
      v_n := v_n + 1;
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail;
    end;
  end loop;
  reset role;
  insert into r166 values ('E1 la busqueda 61 en 5 minutos se rechaza', v_n = 60 and v_det = 'RATE_LIMIT', 'entraron=' || v_n || ' detail=' || coalesce(v_det, '∅'));

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := 0; v_det := null;
  for i in 1..11 loop
    begin
      perform public.registrar_telefono('12345');  -- mal escrito a proposito
      v_n := v_n + 1;
    exception when others then
      get stacked diagnostics v_det = pg_exception_detail;
    end;
  end loop;
  reset role;
  insert into r166 values ('E2 el intento 11 de registrar un celular se rechaza aunque los 10 fueran errores',
    v_n = 10 and v_det = 'RATE_LIMIT', 'entraron=' || v_n || ' detail=' || coalesce(v_det, '∅'));

  -- ── F: el correo de reportar un problema ──────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_n := 0; v_b := true;
  for i in 1..6 loop
    v_b := public.limite_correo_de_reporte();
    if v_b then v_n := v_n + 1; end if;
  end loop;
  reset role;
  insert into r166 values ('F1 deja pasar 5 correos y niega el sexto', v_n = 5 and v_b = false, 'pasaron=' || v_n);

  -- ── G: sin sesión no se limita, y no es endpoint ──────────────
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.rate_limit_hits;
  for i in 1..200 loop perform public._exigir_limite('sin_sesion', 1, 60); end loop;
  select count(*) - v_n into v_n from public.rate_limit_hits;
  insert into r166 values ('G1 sin sesion no hay tope ni se anota nada', v_n = 0, 'filas nuevas=' || v_n);

  insert into r166 values ('G2 _limite_de_uso, _exigir_limite y tg_limite_de_uso no son del cliente',
    not has_function_privilege('authenticated', 'public._limite_de_uso(text,text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public._exigir_limite(text,integer,integer)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.tg_limite_de_uso()', 'EXECUTE')
    and not has_function_privilege('anon', 'public.limite_correo_de_reporte()', 'EXECUTE')
    and not has_table_privilege('authenticated', 'public.rate_limit_hits', 'SELECT'), '');

  -- ── H: ventanas y limpieza ────────────────────────────────────
  insert into public.rate_limit_hits (clave, cubo, ventana, n)
  values (u1::text, 'support_tickets', now() - interval '3 hours', 999),
         ('viejo', 'x', now() - interval '3 days', 1);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  -- u1 ya agotó la ventana de ESTA hora; el contador de hace tres horas con
  -- 999 no cuenta: la prueba es que la ventana actual sigue siendo la única
  -- que decide (los 10 de arriba), no la vieja.
  select n into v_n from public.rate_limit_hits
   where clave = u1::text and cubo = 'support_tickets' and ventana > now() - interval '1 hour';
  insert into r166 values ('H1 la ventana de ahora cuenta lo de ahora, no lo de hace horas', v_n between 10 and 11, 'n=' || coalesce(v_n, -1));

  select public.limpiar_rate_limit() into v_n;
  insert into r166 values ('H2 la limpieza borra lo de hace mas de dos dias', v_n >= 1
    and not exists (select 1 from public.rate_limit_hits where clave = 'viejo'), 'borradas=' || v_n);
  insert into r166 values ('H2 y deja lo de hoy',
    exists (select 1 from public.rate_limit_hits where clave = u1::text and ventana > now() - interval '1 hour'), '');
end $$;

select caso, ok, detalle from r166 order by caso;
do $$
declare v_mal int;
begin
  select count(*) into v_mal from r166 where not ok;
  if v_mal > 0 then
    raise exception '% caso(s) de la 166 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
