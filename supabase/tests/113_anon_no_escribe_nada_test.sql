-- =============================================================
-- FutFinder — pruebas de la migración 113.
--
-- Lo que se cierra, y —tanto o más importante— lo que TENÍA que seguir
-- funcionando. Quitar un permiso es fácil; quitarlo sin romper el camino
-- normal es lo que prueban las R.
--
--   Lo que ya no se puede
--   C1. anon no tiene INSERT en ninguna tabla de public.
--   C2. anon no tiene UPDATE en ninguna.
--   C3. anon no tiene DELETE en ninguna.
--   C4. anon no tiene TRUNCATE en ninguna. Es el que más importaba: es el
--       único de los cuatro que NO pasa por RLS.
--   C5. Un intento real de escritura como anon falla por PERMISO, no por
--       política. La diferencia importa: si fallara por política, el día
--       que alguien escriba una policy laxa volvería a abrirse.
--
--   Lo que sigue igual
--   R1. anon sigue leyendo lo que es público (`clubs`).
--   R2. `authenticated` conserva sus permisos de escritura.
--   R3. Un usuario con sesión sigue creando su club y quedando de admin.
--   R4. `service_role` no se tocó.
--
-- Se ejecuta entero dentro de begin/rollback: no deja nada.
-- =============================================================

begin;
create temp table r113 (caso text, ok boolean, detalle text);
-- El arnés escribe sus resultados mientras SUPLANTA a anon y a
-- authenticated, así que la tabla de resultados tiene que dejarles
-- escribir. Vive en `pg_temp`, no en `public`: el revoke de la migración
-- no la alcanza.
grant all on r113 to anon, authenticated;

do $$
declare
  v_u uuid := gen_random_uuid();
  v_club uuid;
  v_n int;
begin
  -- ── C1 a C4: el permiso ya no está en ninguna tabla ──────────
  select count(*) into v_n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type = 'INSERT';
  insert into r113 values ('C1 anon sin INSERT', v_n = 0, v_n || ' tabla(s)');

  select count(*) into v_n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type = 'UPDATE';
  insert into r113 values ('C2 anon sin UPDATE', v_n = 0, v_n || ' tabla(s)');

  select count(*) into v_n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type = 'DELETE';
  insert into r113 values ('C3 anon sin DELETE', v_n = 0, v_n || ' tabla(s)');

  -- El que no pasa por RLS. Se comprueba por privilegio y no ejecutándolo,
  -- por razones obvias.
  select count(*) into v_n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type = 'TRUNCATE';
  insert into r113 values ('C4 anon sin TRUNCATE (el que salta la RLS)', v_n = 0, v_n || ' tabla(s)');

  -- ── C5: el intento real falla por permiso, no por política ───
  set local role anon;
  set local request.jwt.claims to '{}';
  begin
    insert into public.clubs (nombre, slug) values ('R113 anon', 'r113-anon');
    insert into r113 values ('C5 anon no inserta un club', false, 'LO INSERTO');
  exception when insufficient_privilege then
    insert into r113 values ('C5 anon no inserta un club', true, 'permiso: ' || sqlerrm);
  when others then
    -- Falla, pero por la razón equivocada: la RLS lo tapó y el permiso
    -- sigue ahí. Eso es exactamente lo que esta migración viene a evitar.
    insert into r113 values ('C5 anon no inserta un club', false, 'falló por política, no por permiso: ' || sqlerrm);
  end;

  -- ── R1: anon sigue leyendo lo público ────────────────────────
  begin
    select count(*) into v_n from public.clubs;
    insert into r113 values ('R1 anon sigue leyendo los clubes', true, v_n || ' club(es)');
  exception when others then
    insert into r113 values ('R1 anon sigue leyendo los clubes', false, sqlerrm);
  end;

  reset role; set local request.jwt.claims to '{}';

  -- ── R2: authenticated conserva la escritura ──────────────────
  select count(*) into v_n from information_schema.role_table_grants
   where grantee = 'authenticated' and table_schema = 'public'
     and privilege_type in ('INSERT','UPDATE','DELETE');
  insert into r113 values ('R2 authenticated conserva sus permisos', v_n > 100, v_n || ' permiso(s)');

  -- ── R4: service_role intacto ─────────────────────────────────
  select count(*) into v_n from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'public'
     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE');
  insert into r113 values ('R4 service_role intacto', v_n > 100, v_n || ' permiso(s)');

  -- ── R3: el camino normal sigue funcionando ───────────────────
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_u, 'authenticated', 'authenticated',
          'r113-' || v_u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_u, 'role', 'authenticated')::text);
  insert into public.clubs (nombre, slug, created_by)
  values ('R113 C', 'r113-c-' || substr(v_u::text, 1, 8), v_u) returning id into v_club;
  insert into public.club_members (club_id, user_id, rol) values (v_club, v_u, 'admin');
  insert into r113 values ('R3 con sesion se crea un club y se queda de admin',
    exists (select 1 from public.club_members where club_id = v_club and user_id = v_u and rol = 'admin'),
    'ok');

  reset role; set local request.jwt.claims to '{}';
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r113 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r113;

rollback;
