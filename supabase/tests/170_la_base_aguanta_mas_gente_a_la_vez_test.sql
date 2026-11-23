-- =============================================================
-- FutFinder — pruebas de la migración 170 (escalado de la base).
--
--   E1. Ninguna política de `public` llama `auth.uid()` a secas: todas lo
--       llevan envuelto en `(select auth.uid())`.
--   E2. Ninguna llave foránea de `public` queda sin índice que la cubra.
--
--   Las dos de arriba miden la FORMA. Las de abajo, que envolver no cambió
--   QUIÉN pasa (con la sesión de cada uno, sobre dos tablas cuyas
--   políticas se reescribieron):
--
--   B1. Ana bloquea a Beto: el insert con su propio `blocker_id` pasa.
--   B2. Ana no puede crear un bloqueo a nombre de Beto: 42501.
--   B3. Ana ve su bloqueo; Beto no lo ve.
--   B4. Beto no puede borrar el bloqueo de Ana (0 filas)…
--   B5. …y Ana sí puede borrar el suyo (1 fila).
--   N1. Ana ve su aviso; Beto no lo ve.
--   N2. Beto no puede borrar el aviso de Ana (0 filas).
--   N3. Sin sesión (`auth.uid()` nulo) no se ve ningún aviso.
--
-- La comprobación de que cada política nueva es, sin el envoltorio, la
-- anterior carácter por carácter se hizo al aplicar (ver la migración):
-- después de aplicada ya no queda el «antes» con qué compararla.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r170 (caso text, ok boolean, detalle text);
grant all on r170 to authenticated;

-- ── E1 y E2: la forma ──
insert into r170
select 'E1 ninguna política llama auth.uid() a secas', count(*) = 0,
       coalesce(string_agg(tablename || '.' || policyname, ', '), '')
  from pg_policies
 where schemaname = 'public'
   and (replace(coalesce(qual, ''), '( SELECT auth.uid() AS uid)', '') like '%auth.uid()%'
        or replace(coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '') like '%auth.uid()%');

insert into r170
select 'E2 toda llave foránea tiene índice', count(*) = 0,
       coalesce(string_agg(c.conrelid::regclass || '.' || c.conname, ', '), '')
  from pg_constraint c
  join pg_namespace n on n.oid = c.connamespace and n.nspname = 'public'
 where c.contype = 'f'
   and not exists (
     select 1 from pg_index i
      where i.indrelid = c.conrelid
        and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey
        and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] <@ c.conkey);

-- ── B y N: quién pasa ──
do $$
declare
  v_ana uuid := gen_random_uuid();
  v_beto uuid := gen_random_uuid();
  v_n int;
  v_codigo text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r170-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_ana, v_beto]) u;

  insert into public.notifications (user_id, type, title) values (v_ana, 'match_reminder', 'r170 aviso de prueba');

  -- B1: Ana bloquea a Beto
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ana, 'role', 'authenticated')::text);
  begin
    insert into public.blocked_users (blocker_id, blocked_id) values (v_ana, v_beto);
    insert into r170 values ('B1 bloquear con el propio blocker_id pasa', true, '');
  exception when others then
    insert into r170 values ('B1 bloquear con el propio blocker_id pasa', false, sqlstate || ' ' || sqlerrm);
  end;

  -- B2: Ana intenta un bloqueo a nombre de Beto
  v_codigo := 'sin error';
  begin
    insert into public.blocked_users (blocker_id, blocked_id) values (v_beto, v_ana);
  exception when others then
    v_codigo := sqlstate;
  end;
  insert into r170 values ('B2 bloquear a nombre de otro: 42501', v_codigo = '42501', v_codigo);

  -- B3 (Ana) y N1 (Ana)
  select count(*) into v_n from public.blocked_users where blocker_id = v_ana;
  insert into r170 values ('B3a Ana ve su bloqueo', v_n = 1, v_n::text);
  select count(*) into v_n from public.notifications where user_id = v_ana and title = 'r170 aviso de prueba';
  insert into r170 values ('N1a Ana ve su aviso', v_n = 1, v_n::text);

  -- Ahora con la sesión de Beto
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_beto, 'role', 'authenticated')::text);
  select count(*) into v_n from public.blocked_users where blocker_id = v_ana;
  insert into r170 values ('B3b Beto no ve el bloqueo de Ana', v_n = 0, v_n::text);
  select count(*) into v_n from public.notifications where user_id = v_ana;
  insert into r170 values ('N1b Beto no ve el aviso de Ana', v_n = 0, v_n::text);

  delete from public.blocked_users where blocker_id = v_ana;
  get diagnostics v_n = row_count;
  insert into r170 values ('B4 Beto no borra el bloqueo de Ana', v_n = 0, v_n::text);
  delete from public.notifications where user_id = v_ana;
  get diagnostics v_n = row_count;
  insert into r170 values ('N2 Beto no borra el aviso de Ana', v_n = 0, v_n::text);

  -- N3: sin sesión
  set local request.jwt.claims to '{}';
  select count(*) into v_n from public.notifications where user_id = v_ana;
  insert into r170 values ('N3 sin sesión no se ve ningún aviso', v_n = 0, v_n::text);

  -- B5: Ana borra su bloqueo
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ana, 'role', 'authenticated')::text);
  delete from public.blocked_users where blocker_id = v_ana;
  get diagnostics v_n = row_count;
  insert into r170 values ('B5 Ana borra su propio bloqueo', v_n = 1, v_n::text);

  reset role;
  set local request.jwt.claims to '{}';
end $$;

select caso, ok, detalle from r170 order by caso;
do $$
declare v_mal int;
begin
  select count(*) into v_mal from r170 where not ok;
  if v_mal > 0 then
    raise exception '% caso(s) de la 170 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
