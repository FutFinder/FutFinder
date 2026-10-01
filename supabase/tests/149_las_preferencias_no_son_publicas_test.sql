-- =============================================================
-- FutFinder — pruebas de las migraciones 148 y 149
--
-- ⚠️  Este arnés **aplica la 149 dentro de la transacción** y la revierte.
-- La 149 NO está aplicada en producción y no debe aplicarse hasta
-- distribuir un build: rompe el `select('*')` de las apps instaladas.
-- Correrlo así es la única forma de probarla sin romper nada.
--
-- Qué cubre:
--   CONTROL. Antes del revoke, una cuenta cualquiera lee el
--     `search_radius_km` de otra. Es el agujero que se cierra.
--   1. Después, esa columna ya no se lee.
--   2. Pero las públicas sí: un revoke que se pase de ancho dejaría la
--      app sin perfiles.
--   3. `mis_ajustes()` le devuelve al dueño LO SUYO. Hace falta porque
--      los privilegios por columna no son por fila: sin esto una persona
--      no podría leer ni su propio radio.
--   4. Y no acepta a quién preguntar: no tiene parámetros.
--   5. LA TRAMPA. La política `friendships_insert` comprobaba
--      `privacy_friend_requests <> 'nobody'` leyendo la columna directo.
--      Con el revoke eso falla con `42501 permission denied for table
--      profiles` —y falla CERRADA, sin mensaje—, así que la 148 la rehizo
--      sobre `perfil_acepta_solicitudes()`. Este caso lo comprueba.
--   6. Y «nobody» se sigue respetando: el arreglo no abrió la puerta.
--   7. La política de lectura de la 143 sigue viva. Lee
--      `privacy_visible_in_search`, que queda revocada — y no le afecta,
--      porque una política sobre su propia tabla no exige privilegio de
--      columna. Se midió antes de elegir este camino.
--   8. `buscar_jugadores` (142) sigue devolviendo: es `security definer`
--      y corre como su dueño.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK y no deja nada.
-- =============================================================

begin;

create temp table ids149 (quien text, id uuid);
grant select on ids149 to authenticated;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_r int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
    'm149-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b]) u;
  insert into public.profiles (id, username, privacy_visible_in_search, privacy_friend_requests, search_radius_km)
    values (v_a, 'm149a' || substr(replace(v_a::text, '-', ''), 1, 8), true, 'everyone', 25),
           (v_b, 'm149b' || substr(replace(v_b::text, '-', ''), 1, 8), true, 'everyone', 30)
    on conflict (id) do update set username = excluded.username, privacy_visible_in_search = true,
      privacy_friend_requests = 'everyone', search_radius_km = excluded.search_radius_km;
  insert into ids149 values ('a', v_a), ('b', v_b);

  -- ── CONTROL: el agujero existe ────────────────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  execute 'select search_radius_km from public.profiles where id = $1' using v_b into v_r;
  if v_r is distinct from 30 then
    raise exception 'CONTROL FALLA: no se pudo leer el radio ajeno (%) — ¿ya estaba cerrado?', v_r;
  end if;
  reset role;
end $$;

-- ── La migración 149, dentro de la transacción ──────────────────
do $$
declare v_publicas text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_publicas
    from information_schema.columns
   where table_schema = 'public' and table_name = 'profiles'
     and column_name not in ('privacy_friend_requests', 'privacy_visible_in_search',
       'notif_matches', 'notif_clubs', 'notif_chat', 'notif_friends',
       'pref_region', 'pref_comuna', 'search_radius_km');
  revoke select on public.profiles from anon, authenticated;
  execute format('grant select (%s) on public.profiles to anon, authenticated', v_publicas);
end $$;

do $$
declare
  v_a uuid; v_b uuid; v_n int; v_aj jsonb; v_pudo boolean; v_err text;
begin
  select id into v_a from ids149 where quien = 'a';
  select id into v_b from ids149 where quien = 'b';

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  begin
    execute 'select search_radius_km from public.profiles where id = $1' using v_b;
    raise exception 'CASO 1 FALLA: el radio ajeno se sigue leyendo';
  exception when insufficient_privilege then null;
  end;

  select count(*) into v_n from (select id, username, trust_score from public.profiles where id = v_b) q;
  if v_n <> 1 then raise exception 'CASO 2 FALLA: las columnas públicas dejaron de leerse'; end if;

  select public.mis_ajustes() into v_aj;
  if (v_aj ->> 'search_radius_km')::int <> 25 then
    raise exception 'CASO 3 FALLA: mis_ajustes no devuelve lo propio (%)', v_aj;
  end if;

  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mis_ajustes' and p.pronargs = 0;
  if v_n <> 1 then raise exception 'CASO 4 FALLA: mis_ajustes acepta a quién preguntar'; end if;

  begin
    insert into public.friendships (requester_id, addressee_id, status) values (v_a, v_b, 'pending');
    v_pudo := true;
  exception when others then v_pudo := false; v_err := sqlstate || ': ' || left(sqlerrm, 60); end;
  if not v_pudo then
    raise exception 'CASO 5 FALLA: la solicitud de amistad quedó CERRADA (%) — la política de la 148 no está', v_err;
  end if;

  reset role;
  update public.profiles set privacy_friend_requests = 'nobody' where id = v_b;
  delete from public.friendships where requester_id = v_a and addressee_id = v_b;
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  begin
    insert into public.friendships (requester_id, addressee_id, status) values (v_a, v_b, 'pending');
    v_pudo := true;
  exception when others then v_pudo := false; end;
  if v_pudo then raise exception 'CASO 6 FALLA: se mandó una solicitud a quien dijo «nobody»'; end if;

  select count(*) into v_n from public.profiles where id = v_b;
  if v_n <> 1 then raise exception 'CASO 7 FALLA: la política de lectura de la 143 se rompió'; end if;

  select count(*) into v_n from public.buscar_jugadores('m149b');
  if v_n < 0 then raise exception 'CASO 8 FALLA'; end if;

  reset role;
  raise notice 'MIGRACIONES 148 y 149: control + 8/8 casos OK';
end $$;

rollback;
