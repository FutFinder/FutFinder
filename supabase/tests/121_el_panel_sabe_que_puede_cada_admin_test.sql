-- =============================================================
-- FutFinder — pruebas de la migración 121.
--
-- Lo único que hace la 121 es DECIRLE al panel lo que ya decidía el
-- servidor. Así que lo que hay que probar no es «devuelve tres
-- booleanos», sino que esos tres booleanos digan EXACTAMENTE lo mismo
-- que `puede_en_complejo()` — porque si se separan, el panel esconde
-- filas que sí se pueden usar, o peor, muestra las que no.
--
--   A1. El dueño ve sus recintos con los tres permisos en true, sin
--       tener ninguna bandera encendida en la tabla. No las necesita.
--   A2. Un administrador nuevo (sin permisos) los ve los tres en false.
--   A3. Encender uno enciende ese y NO los otros.
--   A4. LO QUE IMPORTA: para cada recinto y cada permiso, lo que
--       devuelve la función y lo que responde `puede_en_complejo()`
--       coinciden. Es la prueba que caza que se separen.
--   A5. Cada quien ve sólo los recintos que administra.
--
--   C1. La función sigue cerrada a `anon` y abierta a `authenticated`
--       — el drop/create de la 121 se lleva los permisos por delante, y
--       olvidarse de volver a concederlos dejaría el panel en blanco.
--   C2. Sin sesión no devuelve NADA. `puede_en_complejo()` contesta
--       `true` sin sesión a propósito (ver su comentario), así que vale
--       la pena dejar escrito que esta función no hereda eso.
--
-- Se ejecuta entero dentro de begin/rollback: no deja nada.
-- =============================================================

begin;
create temp table r121 (caso text, ok boolean, detalle text);
grant all on r121 to authenticated;

do $$
declare
  v_dueno uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_ajeno uuid := gen_random_uuid();
  v_cx uuid;
  v_f record;
  v_n int;
  v_desacuerdos int;
begin
  -- ── C1: los permisos, antes de tocar nada ────────────────────
  insert into r121 values ('C1 anon no la ejecuta y authenticated si',
    not has_function_privilege('anon', 'public.admin_mis_complejos()', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.admin_mis_complejos()', 'EXECUTE'),
    'anon=' || has_function_privilege('anon', 'public.admin_mis_complejos()', 'EXECUTE')::text
      || ' authenticated=' || has_function_privilege('authenticated', 'public.admin_mis_complejos()', 'EXECUTE')::text);

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r121-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_admin, v_ajeno]) u;

  insert into public.complejos (nombre, comuna, latitud, longitud)
  values ('R121 Recinto', 'Maipú', -33.45, -70.66) returning id into v_cx;

  -- El dueño va SIN banderas encendidas a propósito: A1 comprueba que
  -- igual puede todo, que es lo que hace que el cliente no tenga que
  -- acordarse de mirar el rol.
  insert into public.complejo_admins (complejo_id, user_id, rol,
    puede_canchas, puede_cobros, puede_ficha)
  values (v_cx, v_dueno, 'dueño', false, false, false);
  insert into public.complejo_admins (complejo_id, user_id, rol,
    puede_canchas, puede_cobros, puede_ficha)
  values (v_cx, v_admin, 'admin', false, false, false);

  -- ── C2: sin sesión, nada ─────────────────────────────────────
  select count(*) into v_n from public.admin_mis_complejos();
  insert into r121 values ('C2 sin sesion no devuelve ningun recinto', v_n = 0, v_n || ' fila(s)');

  set local role authenticated;

  -- ── A1: el dueño ─────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role', 'authenticated')::text, true);
  select * into v_f from public.admin_mis_complejos() where id = v_cx;
  insert into r121 values ('A1 el dueno puede los tres sin tener ninguna bandera',
    v_f.rol = 'dueño' and v_f.puede_canchas and v_f.puede_cobros and v_f.puede_ficha,
    'rol=' || coalesce(v_f.rol,'-') || ' canchas=' || v_f.puede_canchas::text
      || ' cobros=' || v_f.puede_cobros::text || ' ficha=' || v_f.puede_ficha::text);

  -- ── A2: el administrador recién agregado ─────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select * into v_f from public.admin_mis_complejos() where id = v_cx;
  insert into r121 values ('A2 un admin nuevo no puede ninguno de los tres',
    v_f.rol = 'admin' and not v_f.puede_canchas and not v_f.puede_cobros and not v_f.puede_ficha,
    'canchas=' || v_f.puede_canchas::text || ' cobros=' || v_f.puede_cobros::text
      || ' ficha=' || v_f.puede_ficha::text);

  -- ── A3: encender uno no enciende los otros ───────────────────
  set local role postgres;
  update public.complejo_admins set puede_cobros = true
   where complejo_id = v_cx and user_id = v_admin;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  select * into v_f from public.admin_mis_complejos() where id = v_cx;
  insert into r121 values ('A3 encender cobros no contagia canchas ni ficha',
    v_f.puede_cobros and not v_f.puede_canchas and not v_f.puede_ficha,
    'canchas=' || v_f.puede_canchas::text || ' cobros=' || v_f.puede_cobros::text
      || ' ficha=' || v_f.puede_ficha::text);

  -- ── A4: la prueba que importa ────────────────────────────────
  -- Para cada recinto que ve y cada uno de los tres permisos, lo que
  -- dice la función tiene que ser lo mismo que responde el servidor.
  -- Se corre con las DOS sesiones, porque el dueño y el admin son los
  -- dos casos que la función resuelve distinto.
  v_desacuerdos := 0;
  for v_f in select * from public.admin_mis_complejos() loop
    if v_f.puede_canchas <> public.puede_en_complejo(v_f.id, 'canchas')
       or v_f.puede_cobros <> public.puede_en_complejo(v_f.id, 'cobros')
       or v_f.puede_ficha <> public.puede_en_complejo(v_f.id, 'ficha') then
      v_desacuerdos := v_desacuerdos + 1;
    end if;
  end loop;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_dueno, 'role', 'authenticated')::text, true);
  for v_f in select * from public.admin_mis_complejos() loop
    if v_f.puede_canchas <> public.puede_en_complejo(v_f.id, 'canchas')
       or v_f.puede_cobros <> public.puede_en_complejo(v_f.id, 'cobros')
       or v_f.puede_ficha <> public.puede_en_complejo(v_f.id, 'ficha') then
      v_desacuerdos := v_desacuerdos + 1;
    end if;
  end loop;
  insert into r121 values (
    'A4 lo que dice la funcion y lo que responde el servidor COINCIDEN',
    v_desacuerdos = 0, v_desacuerdos || ' desacuerdo(s)');

  -- ── A5: cada quien ve lo suyo ────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_ajeno, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.admin_mis_complejos() where id = v_cx;
  insert into r121 values ('A5 quien no administra el recinto no lo ve', v_n = 0, v_n || ' fila(s)');

  set local role postgres;
end $$;

reset role;
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r121 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r121;

rollback;
