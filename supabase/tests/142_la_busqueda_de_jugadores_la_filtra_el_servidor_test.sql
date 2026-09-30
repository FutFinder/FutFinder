-- =============================================================
-- FutFinder — pruebas de la migración 142
--
-- Qué cubre:
--   1. La consulta DIRECTA a `profiles` ya NO devuelve al jugador que
--      apagó «Visible en búsquedas». Este caso era al revés: mientras la
--      142 fue la única corrección, comprobaba que la puerta vieja
--      seguía abierta y que por eso el arreglo estaba incompleto a
--      propósito. **La migración 143 la cerró el 2026-09-30**, así que
--      ahora comprueba lo contrario — y las dos puertas dicen lo mismo.
--   2. `buscar_jugadores()` NO lo devuelve, aunque el texto calce y
--      tenga más trust_score que el visible.
--   3. El visible sí aparece.
--   4. Quien busca no sale en sus propios resultados.
--   5. Sin sesión, la función no corre: `anon` no la puede ejecutar, y
--      un `authenticated` sin claims recibe SIN_SESION.
--   6. El límite se topa en 50 aunque se pidan 1000.
--   7. Los filtros de region, comuna, posición y edad filtran.
--   8. `flanco = 'derecho'` incluye a quien juega 'ambos'.
--   9. Quien busca se excluye ANTES del límite. El cliente viejo pedía
--      30 y se sacaba a sí mismo después, en JavaScript: quien estaba
--      entre los 30 primeros veía 29. Medido con datos reales el
--      2026-09-30, le pasaba a dos de cada cuatro cuentas.
--  10. El orden es repetible. Las 32 cuentas de producción tienen el
--      mismo `trust_score`, así que el `order by trust_score desc` del
--      cliente viejo elegía un conjunto arbitrario entre los empatados y
--      podía cambiar entre dos llamadas iguales.
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
  v_tercero uuid := gen_random_uuid();
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
    from unnest(array[v_yo, v_visible, v_oculto, v_tercero]) u;

  -- El trigger de alta puede haber creado ya la fila de perfil.
  insert into public.profiles (id, username, privacy_visible_in_search, trust_score, region, comuna, edad, flanco, posicion_preferida)
  values
    (v_yo,      v_marca || 'yo',      true, 70, 'Region Test', 'Comuna Test', 25, 'derecho',   array['defensa']),
    (v_visible, v_marca || 'visible', true, 60, 'Region Test', 'Comuna Test', 30, 'ambos',     array['delantero']),
    (v_oculto,  v_marca || 'oculto',  false, 99, 'Region Test', 'Comuna Test', 30, 'izquierdo', array['delantero']),
    -- El tercero existe sólo para el caso 9: sin DOS candidatos visibles
    -- que no sean yo, «pedir 2 y recibir 2» no puede medir nada.
    (v_tercero, v_marca || 'tercero', true,  75, 'Region Test', 'Comuna Test', 28, 'derecho',   array['defensa'])
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

  -- ── Caso 1: la puerta vieja también está cerrada (migración 143)
  -- `v_oculto` no comparte nada con quien busca, así que la política de
  -- lectura por relación no lo deja pasar. Antes de la 143 esta misma
  -- consulta devolvía su fila, y ése era el límite declarado de la 142.
  select count(*) into v_n
    from public.profiles
   where username like v_marca || '%' and privacy_visible_in_search is false;
  if v_n <> 0 then
    raise exception 'CASO 1 FALLA: la consulta directa a profiles todavía devuelve al oculto (%) — la política de la 143 no está puesta', v_n;
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
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, 'defensa');
  if v_n <> 1 then
    raise exception 'CASO 7 FALLA: el filtro de posición dejó fuera al tercero (% filas)', v_n;
  end if;

  -- ── Caso 8: 'derecho' incluye a los 'ambos' ───────────────────
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, null, 'derecho');
  if v_n <> 2 then
    raise exception 'CASO 8 FALLA: buscar flanco derecho tiene que traer al derecho Y al que juega ambos (% filas)', v_n;
  end if;
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, null, 'ambos');
  if v_n <> 1 then
    raise exception 'CASO 8 FALLA: buscar flanco ambos no devolvió al que juega ambos (% filas)', v_n;
  end if;

  -- ── Caso 9: quien busca se excluye ANTES del límite ───────────
  -- El cliente viejo pedía 30 y después se sacaba a sí mismo en JS, así
  -- que quien estaba entre los 30 primeros veía 29. Comprobado con datos
  -- reales el 2026-09-30: dos de cuatro cuentas recibían 29.
  select count(*) into v_n from public.buscar_jugadores(v_marca, null, null, null, null, null, null, 2);
  if v_n <> 2 then
    raise exception 'CASO 9 FALLA: pidiendo 2 con dos candidatos visibles devolvió % — quien busca se está descontando del límite', v_n;
  end if;

  -- ── Caso 10: el orden no depende del azar ─────────────────────
  -- Las 32 cuentas de producción tienen el MISMO trust_score, así que
  -- `order by trust_score desc` a secas devolvía un conjunto arbitrario
  -- que podía cambiar entre dos llamadas iguales. El desempate por `id`
  -- es lo que lo vuelve repetible.
  select count(*) into v_n
    from (
      select id from public.buscar_jugadores(v_marca, null, null, null, null, null, null, 1)
      except
      select id from public.buscar_jugadores(v_marca, null, null, null, null, null, null, 1)
    ) d;
  if v_n <> 0 then
    raise exception 'CASO 10 FALLA: la misma búsqueda devolvió conjuntos distintos';
  end if;

  reset role;
  raise notice 'MIGRACIÓN 142: 10/10 casos OK';
end $$;

rollback;
