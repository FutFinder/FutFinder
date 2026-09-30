-- =============================================================
-- FutFinder — pruebas de la migración 141
--
-- Qué cubre:
--   1. `authenticated` no conserva NINGÚN privilegio sobre push_tickets
--      —ni el truncate, que no pasa por RLS.
--   2. `anon` tampoco.
--   3. `service_role` conserva los siete: es quien inserta los tickets
--      desde la Edge Function `send-push`.
--   4. Con sesión iniciada, un `select` sobre la tabla ahora FALLA con
--      permiso denegado. Antes devolvía cero filas: la diferencia es
--      justamente la que busca esta migración — que el permiso diga lo
--      mismo que la política.
--   5. Con sesión iniciada, un `insert` también falla por permiso, no
--      por RLS.
--   6. El camino bueno sigue vivo: una función `security definer` de
--      `postgres` —la misma forma que `check_push_receipts()`— lee la
--      tabla aunque la llame `authenticated`.
--   7. `check_push_receipts()` sigue siendo `security definer`, sigue
--      siendo de `postgres` y sigue sin ser ejecutable por el cliente.
--   8. `push_tokens` y `notifications` NO se tocaron: la app sigue
--      pudiendo registrar su token y leer sus avisos.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_priv text;
  v_n int;
  v_pudo boolean;
  v_motivo text;
  v_leidas int;
begin
  -- ── Caso 1: authenticated sin nada ────────────────────────────
  foreach v_priv in array array['select','insert','update','delete','truncate','references','trigger']
  loop
    if has_table_privilege('authenticated', 'public.push_tickets', v_priv) then
      raise exception 'CASO 1 FALLA: authenticated conserva % sobre push_tickets', v_priv;
    end if;
  end loop;

  -- ── Caso 2: anon sin nada ─────────────────────────────────────
  foreach v_priv in array array['select','insert','update','delete','truncate','references','trigger']
  loop
    if has_table_privilege('anon', 'public.push_tickets', v_priv) then
      raise exception 'CASO 2 FALLA: anon conserva % sobre push_tickets', v_priv;
    end if;
  end loop;

  -- ── Caso 3: service_role conserva los siete ───────────────────
  foreach v_priv in array array['select','insert','update','delete','truncate','references','trigger']
  loop
    if not has_table_privilege('service_role', 'public.push_tickets', v_priv) then
      raise exception 'CASO 3 FALLA: service_role perdió % sobre push_tickets', v_priv;
    end if;
  end loop;

  -- ── Caso 6 (se prepara antes de cambiar de rol) ───────────────
  -- Misma forma que check_push_receipts(): security definer, de
  -- postgres. Tiene que seguir leyendo la tabla aunque la llame una
  -- sesión que ya no tiene ni select.
  create function pg_temp.m141_lee_tickets() returns int
    language sql security definer set search_path = public, pg_temp
    as 'select count(*)::int from public.push_tickets';
  grant execute on function pg_temp.m141_lee_tickets() to authenticated;

  -- ── Caso 4: con sesión, el select ahora es permiso denegado ───
  set local role authenticated;
  begin
    execute 'select count(*) from public.push_tickets' into v_n;
    v_pudo := true;
  exception when insufficient_privilege then
    v_pudo := false;
  end;
  if v_pudo then
    raise exception 'CASO 4 FALLA: authenticated todavía puede hacer select sobre push_tickets (devolvió % filas)', v_n;
  end if;

  -- ── Caso 5: y el insert también, por PERMISO y no por RLS ─────
  -- Los dos rechazos son 42501, así que el código no distingue: lo que
  -- distingue es el mensaje. Antes de la 141 decía «row-level security
  -- policy»; ahora tiene que decir «permission denied».
  begin
    execute $ins$
      insert into public.push_tickets (notification_id, token, ticket_status, ticket_id, receipt_status)
      values (gen_random_uuid(), 'ExponentPushToken[m141]', 'ok', 'm141', 'pending')
    $ins$;
    v_pudo := true;
  exception
    when insufficient_privilege then
      v_pudo := false;
      v_motivo := sqlerrm;
    when others then
      raise exception 'CASO 5 FALLA: el insert se rechazó, pero por % (%), no por permiso', sqlstate, sqlerrm;
  end;
  if v_pudo then
    raise exception 'CASO 5 FALLA: authenticated todavía puede insertar en push_tickets';
  end if;
  if v_motivo ilike '%row-level security%' or v_motivo ilike '%row level security%' then
    raise exception 'CASO 5 FALLA: el insert lo frenó la RLS, no el permiso — el revoke no llegó (%)', v_motivo;
  end if;

  -- ── Caso 6: el camino security definer sigue vivo ─────────────
  begin
    select pg_temp.m141_lee_tickets() into v_leidas;
  exception when insufficient_privilege then
    raise exception 'CASO 6 FALLA: una función security definer de postgres ya no puede leer push_tickets — el revoke se pasó de largo';
  end;
  if v_leidas is null then
    raise exception 'CASO 6 FALLA: la función security definer no devolvió un conteo';
  end if;

  reset role;

  -- ── Caso 7: check_push_receipts() intacta ─────────────────────
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'check_push_receipts'
     and p.prosecdef
     and pg_get_userbyid(p.proowner) = 'postgres';
  if v_n <> 1 then
    raise exception 'CASO 7 FALLA: check_push_receipts() no está como security definer de postgres';
  end if;
  if has_function_privilege('authenticated', 'public.check_push_receipts()', 'execute')
     or has_function_privilege('anon', 'public.check_push_receipts()', 'execute') then
    raise exception 'CASO 7 FALLA: el cliente puede ejecutar check_push_receipts()';
  end if;

  -- ── Caso 8: las dos vecinas no se tocaron ─────────────────────
  foreach v_priv in array array['select','insert','update','delete']
  loop
    if not has_table_privilege('authenticated', 'public.push_tokens', v_priv) then
      raise exception 'CASO 8 FALLA: push_tokens perdió % para authenticated — esta migración no debía tocarla', v_priv;
    end if;
    if not has_table_privilege('authenticated', 'public.notifications', v_priv) then
      raise exception 'CASO 8 FALLA: notifications perdió % para authenticated — esta migración no debía tocarla', v_priv;
    end if;
  end loop;

  raise notice 'MIGRACIÓN 141: 8/8 casos OK';
end $$;

rollback;
