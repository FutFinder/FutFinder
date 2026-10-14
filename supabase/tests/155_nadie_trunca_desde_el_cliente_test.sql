-- =============================================================
-- FutFinder — pruebas de la migración 155
--
-- Qué cubre:
--   1. CONTROL — `authenticated` conserva `insert`, `update` y `delete`
--      sobre `matches`. Sin este caso, un cero en el 2 podría significar
--      «se revocó todo» en vez de «se revocó TRUNCATE», y eso sería el
--      producto roto en lugar de arreglado.
--      (El control de ANTES se midió en el ensayo revertido, con el
--      privilegio todavía puesto: 58 tablas. Queda en la cabecera de la
--      migración.)
--   2. `authenticated` no tiene TRUNCATE en NINGUNA tabla de `public`.
--   3. `anon` tampoco (ya estaba en cero gracias a `anon_nace_sin_llaves`;
--      se fija para que siga así).
--   4. `service_role` SÍ lo conserva. Es quien corre el mantenimiento;
--      quitárselo sería romper lo que funciona para cerrar una puerta por
--      la que no se entra.
--   5. Una tabla creada DESPUÉS nace sin TRUNCATE para `authenticated`.
--      Es el caso que importa: sin el disparador, `pg_default_acl` vuelve
--      a conceder `all` y la lista se llena sola con la próxima migración.
--   6. Y esa tabla nueva SÍ nace con `insert`/`update`/`delete` para
--      `authenticated`. El disparador tiene que ser quirúrgico; si se
--      llevara las cuatro, cada tabla nueva nacería inservible para la app.
--   7. Con la lente de un usuario real: `authenticated` sigue pudiendo
--      ESCRIBIR de verdad —se publica un partido— y **no** puede truncar.
--      Los privilegios del catálogo son una cosa; que la app siga
--      funcionando es la que importa.
--   8. La función del disparador no la ejecuta el cliente.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

create temp table resultado(caso text) on commit drop;
grant all on resultado to authenticated;

do $$
declare v_n integer;
begin
  -- ── Caso 1: control, las otras escrituras siguen ahí ──────────
  if not (has_table_privilege('authenticated', 'public.matches', 'insert')
          and has_table_privilege('authenticated', 'public.matches', 'update')
          and has_table_privilege('authenticated', 'public.matches', 'delete')) then
    raise exception 'CASO 1 FALLA: se llevó por delante insert/update/delete. '
      'Eso no es cerrar TRUNCATE, es romper la app.';
  end if;
  insert into resultado values ('CASO 1 OK — control: insert/update/delete de authenticated intactos');

  -- ── Caso 2: cero TRUNCATE para authenticated ──────────────────
  select count(distinct table_name) into v_n
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
     and privilege_type = 'TRUNCATE';
  if v_n <> 0 then
    raise exception 'CASO 2 FALLA: authenticated todavía puede truncar % tablas', v_n;
  end if;
  insert into resultado values ('CASO 2 OK — authenticated no trunca ninguna tabla de public');

  -- ── Caso 3: anon tampoco ──────────────────────────────────────
  select count(distinct table_name) into v_n
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon' and privilege_type = 'TRUNCATE';
  if v_n <> 0 then
    raise exception 'CASO 3 FALLA: anon puede truncar % tablas', v_n;
  end if;
  insert into resultado values ('CASO 3 OK — anon tampoco');

  -- ── Caso 4: service_role lo conserva ──────────────────────────
  if not has_table_privilege('service_role', 'public.matches', 'truncate') then
    raise exception 'CASO 4 FALLA: service_role perdió TRUNCATE; el mantenimiento queda roto';
  end if;
  insert into resultado values ('CASO 4 OK — service_role lo conserva');
end $$;

-- ── Casos 5 y 6: una tabla nacida después ───────────────────────
create table public.m155_recien_nacida (id uuid primary key default gen_random_uuid());

do $$
begin
  if has_table_privilege('authenticated', 'public.m155_recien_nacida', 'truncate') then
    raise exception 'CASO 5 FALLA: una tabla nueva nació con TRUNCATE. El disparador no corrió, '
      'y la lista se va a volver a llenar sola con la próxima migración.';
  end if;
  insert into resultado values ('CASO 5 OK — una tabla nueva nace sin TRUNCATE');

  if not (has_table_privilege('authenticated', 'public.m155_recien_nacida', 'insert')
          and has_table_privilege('authenticated', 'public.m155_recien_nacida', 'update')
          and has_table_privilege('authenticated', 'public.m155_recien_nacida', 'delete')) then
    raise exception 'CASO 6 FALLA: la tabla nueva nació sin insert/update/delete. '
      'El disparador tiene que quitar SÓLO truncate.';
  end if;
  insert into resultado values ('CASO 6 OK — y nace con insert/update/delete, como debe');

  -- ── Caso 8: la función no es del cliente ──────────────────────
  if has_function_privilege('authenticated', 'public.nadie_trunca_desde_el_cliente()', 'execute')
     or has_function_privilege('anon', 'public.nadie_trunca_desde_el_cliente()', 'execute') then
    raise exception 'CASO 8 FALLA: la función del disparador la puede ejecutar el cliente';
  end if;
  insert into resultado values ('CASO 8 OK — la función del disparador no es del cliente');
end $$;

-- ── Caso 7: con la lente de un usuario real ─────────────────────
-- Se crea el usuario como postgres (authenticated no puede escribir en
-- auth.users) y recién después se cambia de rol.
do $$
declare v_u uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_u, 'authenticated', 'authenticated',
    'm155-' || v_u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  insert into public.profiles (id, username)
    values (v_u, 'm155' || substr(replace(v_u::text, '-', ''), 1, 8))
    on conflict (id) do nothing;
  create temp table m155_usuario(id uuid) on commit drop;
  grant all on m155_usuario to authenticated;
  insert into m155_usuario values (v_u);
end $$;

set local role authenticated;

do $$
declare
  v_u uuid; v_pudo boolean; v_n integer;
begin
  select id into v_u from m155_usuario;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u::text, 'role', 'authenticated')::text, true);

  -- Escribe de verdad: publicar un partido es la escritura más común de
  -- la app y pasa por la RLS de `matches`.
  begin
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre,
      latitud, longitud, hora, cupos_totales, cupos_disponibles)
      values (v_u, 'm155', 'Ñuñoa', 'Cancha m155', -33.4569, -70.6483,
              now() + interval '2 days', 10, 8);
    v_pudo := true;
  exception when others then v_pudo := false; end;
  if not v_pudo then
    raise exception 'CASO 7 FALLA: un usuario real ya no puede publicar un partido';
  end if;

  -- Y no puede truncar.
  begin
    execute 'truncate table public.matches';
    v_pudo := true;
  exception when insufficient_privilege then v_pudo := false;
            when others then v_pudo := false; end;
  if v_pudo then
    raise exception 'CASO 7 FALLA: un usuario real TRUNCÓ public.matches';
  end if;

  insert into resultado values ('CASO 7 OK — un usuario real escribe, y no puede truncar');
  insert into resultado values ('=== 155: 8/8, el arnes llego a la ultima linea ===');
end $$;

reset role;
select * from resultado;

rollback;
