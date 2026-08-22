-- =============================================================
-- FutFinder — pruebas del tema de color del club (migración 53)
--
-- QUÉ CUBRE:
--   1. Un club creado sin elegir tema queda en 'green'. Los clubes
--      anteriores a la migración conservan el verde.
--   2. Un administrador puede guardar cada uno de los cuatro temas.
--   3. Un INTEGRANTE QUE NO ES ADMINISTRADOR no puede cambiarlo, ni
--      siquiera saltándose la interfaz: el UPDATE no alcanza ninguna fila.
--   4. Un usuario AJENO al club tampoco. Y no puede cambiar el tema de
--      un club ajeno usando el suyo como excusa.
--   5. Un valor inventado ('purple') lo rechaza el CHECK del servidor,
--      no la interfaz.
--   6. Un HEX ('#FF0000') tampoco entra: el tema es una clave, no un
--      color libre.
--   7. Dos clubes con temas distintos no se contaminan.
--   8. Cambiar el tema no toca `plan` ni `verificado`.
--   9. Cualquiera puede LEER el tema de un club: sin eso, el resto de
--      la gente no vería el color nuevo al recargar el club.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run, en un proyecto de desarrollo, con la migración 53
-- ya aplicada (o corrida dentro de esta misma transacción). Todo pasa
-- dentro de una transacción que termina en ROLLBACK, así que no queda
-- nada guardado. Si un caso falla, la ejecución se corta con RAISE
-- EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_admin_a   uuid := gen_random_uuid();
  v_jugador_a uuid := gen_random_uuid();
  v_admin_b   uuid := gen_random_uuid();
  v_ajeno     uuid := gen_random_uuid();

  v_club_a uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();

  v_tema      text;
  v_temas     text[] := array['green', 'blue', 'red', 'yellow'];
  v_uno       text;
  v_filas     int;
  v_plan      text;
  v_verificado boolean;
  v_rechazado boolean;
begin
  -- ── Setup: cuatro usuarios ───────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values
    ('00000000-0000-0000-0000-000000000000', v_admin_a,   'authenticated', 'authenticated', 'tema-admin-a-'   || v_admin_a   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_jugador_a, 'authenticated', 'authenticated', 'tema-jugador-a-' || v_jugador_a || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_admin_b,   'authenticated', 'authenticated', 'tema-admin-b-'   || v_admin_b   || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
    ('00000000-0000-0000-0000-000000000000', v_ajeno,     'authenticated', 'authenticated', 'tema-ajeno-'     || v_ajeno     || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  -- ── Setup: dos clubes, SIN nombrar la columna `tema` ─────────
  -- Es exactamente lo que hace `createClub()`: el color lo pone el
  -- default de la migración, no el cliente.
  insert into public.clubs (id, nombre, slug, created_by) values
    (v_club_a, 'Tema Club A ' || left(v_club_a::text, 8), 'tema-club-a-' || left(v_club_a::text, 8), v_admin_a),
    (v_club_b, 'Tema Club B ' || left(v_club_b::text, 8), 'tema-club-b-' || left(v_club_b::text, 8), v_admin_b);

  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_admin_a,   'admin'),
    (v_club_a, v_jugador_a, 'jugador'),
    (v_club_b, v_admin_b,   'admin');

  -- ── Caso 1: sin elegir tema, el club nace verde ──────────────
  select tema into v_tema from public.clubs where id = v_club_a;
  if v_tema is distinct from 'green' then
    raise exception 'FALLÓ (caso 1): un club sin tema debería quedar en green, quedó en %', v_tema;
  end if;
  raise notice 'OK (caso 1): un club sin tema elegido queda en verde';

  -- ── Actuar como el administrador del club A ──────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_a, 'role', 'authenticated')::text);

  -- ── Caso 2: el administrador puede guardar los cuatro temas ──
  foreach v_uno in array v_temas loop
    update public.clubs set tema = v_uno where id = v_club_a;
    get diagnostics v_filas = row_count;
    if v_filas <> 1 then
      raise exception 'FALLÓ (caso 2): el administrador debería poder guardar el tema %, afectó % filas', v_uno, v_filas;
    end if;

    select tema into v_tema from public.clubs where id = v_club_a;
    if v_tema is distinct from v_uno then
      raise exception 'FALLÓ (caso 2): el tema guardado debería ser %, quedó en %', v_uno, v_tema;
    end if;
  end loop;
  raise notice 'OK (caso 2): el administrador guardó los cuatro temas';

  -- Lo dejamos en azul para los casos siguientes.
  update public.clubs set tema = 'blue' where id = v_club_a;

  -- ── Caso 5: un valor inventado lo rechaza el servidor ────────
  begin
    update public.clubs set tema = 'purple' where id = v_club_a;
    v_rechazado := false;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 5): el CHECK debería rechazar un tema inventado';
  end if;
  raise notice 'OK (caso 5): el servidor rechaza un tema inventado';

  -- ── Caso 6: un HEX tampoco es un tema ────────────────────────
  begin
    update public.clubs set tema = '#FF0000' where id = v_club_a;
    v_rechazado := false;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 6): el CHECK debería rechazar un color HEX';
  end if;
  raise notice 'OK (caso 6): el servidor rechaza un HEX';

  -- ── Caso 8: cambiar el tema no toca plan ni verificado ───────
  update public.clubs set tema = 'red' where id = v_club_a;
  select plan, verificado into v_plan, v_verificado from public.clubs where id = v_club_a;
  if v_plan is distinct from 'estandar' or v_verificado is distinct from false then
    raise exception 'FALLÓ (caso 8): cambiar el tema alteró plan=% verificado=%', v_plan, v_verificado;
  end if;
  raise notice 'OK (caso 8): el tema no arrastra plan ni verificado';

  -- ── Actuar como el INTEGRANTE que no administra ──────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador_a, 'role', 'authenticated')::text);

  -- ── Caso 3: un integrante sin permiso no cambia el tema ──────
  update public.clubs set tema = 'yellow' where id = v_club_a;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 3): un integrante sin rol admin no debería poder cambiar el tema (afectó % filas)', v_filas;
  end if;

  select tema into v_tema from public.clubs where id = v_club_a;
  if v_tema is distinct from 'red' then
    raise exception 'FALLÓ (caso 3): el tema debería seguir en red, quedó en %', v_tema;
  end if;
  raise notice 'OK (caso 3): un integrante sin permiso no puede cambiar el tema ni llamando directo';

  -- ── Actuar como un usuario AJENO al club ─────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  -- ── Caso 4a: un ajeno no cambia el tema ──────────────────────
  update public.clubs set tema = 'yellow' where id = v_club_a;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 4a): un usuario ajeno no debería poder cambiar el tema (afectó % filas)', v_filas;
  end if;
  raise notice 'OK (caso 4a): un usuario ajeno no puede cambiar el tema';

  -- ── Caso 9: pero SÍ puede leerlo ─────────────────────────────
  select tema into v_tema from public.clubs where id = v_club_a;
  if v_tema is distinct from 'red' then
    raise exception 'FALLÓ (caso 9): cualquiera debería poder leer el tema del club, leyó %', v_tema;
  end if;
  raise notice 'OK (caso 9): el tema se lee desde fuera del club, así el resto ve el color nuevo';

  -- ── Actuar como el administrador del club B ──────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin_b, 'role', 'authenticated')::text);

  -- ── Caso 4b: administrar un club no da permiso sobre otro ────
  update public.clubs set tema = 'yellow' where id = v_club_a;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 4b): el administrador del club B no debería poder cambiar el tema del club A (afectó % filas)', v_filas;
  end if;
  raise notice 'OK (caso 4b): ser administrador de un club no da permiso sobre otro';

  -- ── Caso 7: dos clubes, dos temas, sin contaminación ─────────
  update public.clubs set tema = 'yellow' where id = v_club_b;
  get diagnostics v_filas = row_count;
  if v_filas <> 1 then
    raise exception 'FALLÓ (caso 7): el administrador del club B debería poder cambiar SU tema';
  end if;

  select tema into v_tema from public.clubs where id = v_club_b;
  if v_tema is distinct from 'yellow' then
    raise exception 'FALLÓ (caso 7): el club B debería quedar en yellow, quedó en %', v_tema;
  end if;

  select tema into v_tema from public.clubs where id = v_club_a;
  if v_tema is distinct from 'red' then
    raise exception 'FALLÓ (caso 7): el club A debería seguir en red, quedó en %', v_tema;
  end if;
  raise notice 'OK (caso 7): dos clubes conservan sus propios temas';

  raise notice 'TODAS LAS PRUEBAS DEL TEMA DEL CLUB PASARON';
end $$;

rollback;
