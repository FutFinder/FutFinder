-- =============================================================
-- FutFinder — pruebas de la migración 152
--
-- Qué cubre:
--   1. La columna `clubs.plan` ya no existe.
--   2. `check_club_limits()` ya no nombra `plan` en su cuerpo, y sigue
--      colgada de `trg_check_club_limits` en `club_members`.
--   3. Un club acepta 3 administradores y rechaza el 4.º, entre por
--      INSERT o por ascender a un jugador (UPDATE de `rol`).
--   4. Un club acepta 26 integrantes y rechaza el 27.º. Es el tope que
--      era de Premium, y ahora vale para todos.
--   5. El `capitan` no cuenta contra el tope de administradores (90):
--      con los 3 administradores puestos, se puede seguir nombrando
--      capitanes.
--   6. `check_club_limits()` sigue sin ser invocable desde el cliente:
--      ni `anon` ni `authenticated` tienen su EXECUTE.
--   7. Se conserva el «Club no encontrado»: antes salía de no encontrar
--      el plan, ahora de no encontrar el club.
--
-- Por qué los clubes se arman con usuarios propios y separados: un mismo
-- jugador no puede estar en más de 3 clubes (`check_user_club_limit`, 24),
-- y lo que se mide acá es el tope del CLUB, no el del jugador.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK y no deja nada.
-- =============================================================

begin;

do $$
declare
  v_marca text := 'c152' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  -- Club A: el de los administradores.
  v_a uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  v_cap uuid := gen_random_uuid();
  -- Club B: el de los integrantes (27 personas para un tope de 26).
  v_b uuid[];
  -- Para el «Club no encontrado».
  v_suelto uuid := gen_random_uuid();
  v_club_a uuid; v_club_b uuid;
  v_n int; v_err text;
begin
  -- ── Caso 1: la columna se fue ─────────────────────────────────
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'clubs' and column_name = 'plan';
  if v_n <> 0 then
    raise exception 'CASO 1 FALLA: la columna clubs.plan sigue existiendo';
  end if;

  -- ── Caso 2: la función ya no mira el plan ─────────────────────
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'check_club_limits'
     and p.prosrc ~* '\mplan\M';
  if v_n <> 0 then
    raise exception 'CASO 2 FALLA: check_club_limits() todavía nombra plan en su cuerpo';
  end if;
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and t.tgrelid = 'public.club_members'::regclass
     and t.tgname = 'trg_check_club_limits'
     and p.proname = 'check_club_limits';
  if v_n <> 1 then
    raise exception 'CASO 2 FALLA: trg_check_club_limits no apunta a check_club_limits (%)', v_n;
  end if;

  -- ── Gente de prueba ───────────────────────────────────────────
  select array_agg(gen_random_uuid()) into v_b from generate_series(1, 27);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
    'c152-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(v_a || v_b || array[v_cap, v_suelto]) u;
  insert into public.profiles (id, username)
  select u, v_marca || i
    from unnest(v_a || v_b || array[v_cap, v_suelto]) with ordinality as t(u, i)
    on conflict (id) do update set username = excluded.username;

  insert into public.clubs (nombre, slug, created_by)
  values ('Club A 152', 'club-a-152-' || v_marca, v_a[1]) returning id into v_club_a;
  insert into public.clubs (nombre, slug, created_by)
  values ('Club B 152', 'club-b-152-' || v_marca, v_b[1]) returning id into v_club_b;

  -- ── Caso 3: 3 administradores sí, el 4.º no ───────────────────
  insert into public.club_members (club_id, user_id, rol) values
    (v_club_a, v_a[1], 'admin'), (v_club_a, v_a[2], 'admin'), (v_club_a, v_a[3], 'admin');

  v_err := null;
  begin
    insert into public.club_members (club_id, user_id, rol) values (v_club_a, v_a[4], 'admin');
  exception when raise_exception then
    v_err := sqlerrm;
  end;
  if v_err is null or v_err not like '%límite de 3 administradores%' then
    raise exception 'CASO 3 FALLA: el 4.º administrador por INSERT no se rechazó como se esperaba (%)',
      coalesce(v_err, 'entró');
  end if;

  -- Entra como jugador, y ascenderlo choca con el mismo tope.
  insert into public.club_members (club_id, user_id, rol) values (v_club_a, v_a[4], 'jugador');
  v_err := null;
  begin
    update public.club_members set rol = 'admin' where club_id = v_club_a and user_id = v_a[4];
  exception when raise_exception then
    v_err := sqlerrm;
  end;
  if v_err is null or v_err not like '%límite de 3 administradores%' then
    raise exception 'CASO 3 FALLA: ascender al 4.º administrador no se rechazó como se esperaba (%)',
      coalesce(v_err, 'pasó');
  end if;

  select count(*) into v_n from public.club_members where club_id = v_club_a and rol = 'admin';
  if v_n <> 3 then
    raise exception 'CASO 3 FALLA: el club A quedó con % administradores, se esperaban 3', v_n;
  end if;

  -- ── Caso 5: el capitán no cuenta contra el tope ───────────────
  -- Con los 3 administradores puestos: uno entra directo como capitán y
  -- al jugador de antes se lo nombra capitán.
  begin
    insert into public.club_members (club_id, user_id, rol) values (v_club_a, v_cap, 'capitan');
    update public.club_members set rol = 'capitan' where club_id = v_club_a and user_id = v_a[4];
  exception when raise_exception then
    raise exception 'CASO 5 FALLA: nombrar capitán con el tope de administradores lleno se rechazó (%)', sqlerrm;
  end;
  select count(*) into v_n from public.club_members where club_id = v_club_a and rol = 'capitan';
  if v_n <> 2 then
    raise exception 'CASO 5 FALLA: el club A quedó con % capitanes, se esperaban 2', v_n;
  end if;

  -- ── Caso 4: 26 integrantes sí, el 27.º no ─────────────────────
  insert into public.club_members (club_id, user_id, rol) values (v_club_b, v_b[1], 'admin');
  insert into public.club_members (club_id, user_id, rol)
  select v_club_b, u, 'jugador' from unnest(v_b[2:26]) u;

  select count(*) into v_n from public.club_members where club_id = v_club_b;
  if v_n <> 26 then
    raise exception 'CASO 4 FALLA: el club B debería tener 26 integrantes y tiene %', v_n;
  end if;

  v_err := null;
  begin
    insert into public.club_members (club_id, user_id, rol) values (v_club_b, v_b[27], 'jugador');
  exception when raise_exception then
    v_err := sqlerrm;
  end;
  if v_err is null or v_err not like '%límite de 26 integrantes%' then
    raise exception 'CASO 4 FALLA: el integrante 27 no se rechazó como se esperaba (%)',
      coalesce(v_err, 'entró');
  end if;

  -- ── Caso 6: no es un endpoint ─────────────────────────────────
  if has_function_privilege('anon', 'public.check_club_limits()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.check_club_limits()', 'EXECUTE') then
    raise exception 'CASO 6 FALLA: anon o authenticated pueden ejecutar check_club_limits()';
  end if;

  -- ── Caso 7: «Club no encontrado» ──────────────────────────────
  -- El trigger es BEFORE, así que corre antes que la llave foránea.
  v_err := null;
  begin
    insert into public.club_members (club_id, user_id, rol)
    values (gen_random_uuid(), v_suelto, 'jugador');
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null or v_err not like '%Club no encontrado%' then
    raise exception 'CASO 7 FALLA: un club inexistente no dio «Club no encontrado» (%)',
      coalesce(v_err, 'entró');
  end if;

  raise notice 'MIGRACIÓN 152: 7/7 casos OK';
end $$;

rollback;
