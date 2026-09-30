-- =============================================================
-- FutFinder — pruebas de la migración 142
--
-- Qué cubre:
--   1. CONTROL NEGATIVO, y es el caso que da sentido a todo lo demás:
--      la consulta DIRECTA a `profiles` —la que arma cualquiera con la
--      clave publicable— sigue devolviendo al jugador que apagó
--      «Visible en búsquedas». Si este caso dejara de pasar, sería
--      porque alguien cerró las filas de `profiles` y esta migración
--      quedó chica.
--   2. `buscar_jugadores()` NO lo devuelve, aunque el texto calce y
--      tenga más trust_score que el visible.
--   3. El visible sí aparece.
--   4. Quien busca no sale en sus propios resultados.
--   5. Sin sesión, la función no corre: `anon` no la puede ejecutar, y
--      un `authenticated` sin claims recibe SIN_SESION.
--   6. El límite se topa en 50 aunque se pidan 1000.
--   7. Los filtros de region, comuna, posición y edad filtran.
--   8. `flanco = 'derecho'` incluye a quien juega 'ambos'.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_yo      uuid := gen_random_uuid();
  v_visible uuid := gen_random_uuid();
  v_oculto  uuid := gen_random_uuid();
  v_marca   text := 'm142' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_n       int;
  v_pudo    boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'm142-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_yo, v_visible, v_oculto]) u;

  -- El trigger de alta puede haber creado ya la fila de perfil.
  insert into public.profiles (id, username, privacy_visible_in_search, trust_score, region, comuna, edad, flanco, posicion_preferida)
  values
    (v_yo,      v_marca || 'yo',      true, 70, 'Region Test', 'Comuna Test', 25, 'derecho',   array['defensa']),
    (v_visible, v_marca || 'visible', true, 60, 'Region Test', 'Comuna Test', 30, 'ambos',     array['delantero']),
    (v_oculto,  v_marca || 'oculto',  false, 99, 'Region Test', 'Comuna Test', 30, 'izquierdo', array['delantero'])
  on conflict (id) do update
    set username = excluded.username,
        privacy_visible_in_search = excluded.privacy_visible_in_search,
        trust_score = excluded.trust_score,
        region = excluded.region,
        comuna = excluded.comuna,
        edad = excluded.edad,
        flanco = excluded.flanco,
        posicion_preferida = excluded.posicion_preferida;

  -- ── Caso 5a: anon no puede ejecutar la función ────────────────
  if has_function_privilege('anon',
       'public.buscar_jugadores(text,text,text,text,text,integer,integer,integer)', 'execute') then
    raise exception 'CASO 5a FALLA: anon puede ejecutar buscar_jugadores()';
  end if;

  set local role authenticated;

  -- ── Caso 5b: con sesión vacía, SIN_SESION ─────────────────────
  -- Claims válidas pero sin `sub`: es lo que ve una petición sin sesión.
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  begin
    perform public.buscar_jugadores(v_marca);
    v_pudo := true;
  exception when insufficient_privilege then
    v_pudo := false;
  end;
  if v_pudo then
    raise exception 'CASO 5b FALLA: sin claims la función devolvió resultados';
  end if;

  -- A partir de acá, sesión de v_yo.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_yo, 'role', 'authenticated')::text, true);

  -- ── Caso 1: CONTROL NEGATIVO — la tabla sigue abierta ─────────
  select count(*) into v_n
    from public.profiles
   where username like v_marca || '%' and privacy_visible_in_search is false;
  if v_n <> 1 then
    raise exception 'CASO 1 FALLA: la consulta directa a profiles ya no devuelve al oculto (%). Si se cerraron las filas, esta prueba hay que rehacerla', v_n;
  end if;

  -- ── Caso 2: la RPC no devuelve al oculto ──────────────────────
  select count(*) into v_n
    from public.buscar_jugadores(v_marca)
   where username = v_marca || 'oculto';
  if v_n <> 0 then
    raise exception 'CASO 2 FALLA: buscar_jugadores() devolvió al perfil oculto';
  end if;

  -- ── Caso 3: el visible sí aparece ─────────────────────────────
  select count(*) into v_n
    from public.buscar_jugadores(v_marca)
   where username = v_marca || 'visible';
  if v_n <> 1 then
    raise exception 'CASO 3 FALLA: el perfil visible no aparece (% filas)', v_n;
  end if;

  -- ── Caso 4: quien busca no sale ───────────────────────────────
  select count(*) into v_n
    from public.buscar_jugadores(v_marca)
   where id = v_yo;
  if v_n <> 0 then
    raise exception 'CASO 4 FALLA: quien busca aparece en sus propios resultados';
  end if;

  -- ── Caso 6: el límite se topa en 50 ───────────────────────────
  select count(*) into v_n from public.buscar_jugadores(null, null, null, null, null, null, null, 1000);
  if v_n > 50 then
    raise exception 'CASO 6 FALLA: pidiendo 1000 devolvió % filas', v_n;
  end if;

  -- ── Caso 7: los filtros filtran ───────────────────────────────
  select count(*) into v_n from public.buscar_jugadores(v_marca, 'Region Que No Existe');
  if v_n <> 0 then
    raise exception 'CASO 7 FALLA: el filtro de región no filtró (% filas)', v_n;
  end if;
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, 'arquero');
  if v_n <> 0 then
    raise exception 'CASO 7 FALLA: el filtro de posición no filtró (% filas)', v_n;
  end if;
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, null, null, 40, null);
  if v_n <> 0 then
    raise exception 'CASO 7 FALLA: el filtro de edad mínima no filtró (% filas)', v_n;
  end if;
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, 'delantero');
  if v_n <> 1 then
    raise exception 'CASO 7 FALLA: el filtro de posición dejó fuera al visible (% filas)', v_n;
  end if;

  -- ── Caso 8: 'derecho' incluye a los 'ambos' ───────────────────
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, null, 'derecho');
  if v_n <> 1 then
    raise exception 'CASO 8 FALLA: buscar flanco derecho no incluyó al que juega ambos (% filas)', v_n;
  end if;
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, null, 'ambos');
  if v_n <> 1 then
    raise exception 'CASO 8 FALLA: buscar flanco ambos no devolvió al que juega ambos (% filas)', v_n;
  end if;

  reset role;
  raise notice 'MIGRACIÓN 142: 8/8 casos OK';
end $$;

rollback;
