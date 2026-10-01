-- =============================================================
-- FutFinder — pruebas de la migración 150
--
-- Qué cubre:
--   1. `tg_notify_message_new()` ya no existe.
--   2. La que SÍ avisa sigue en su sitio, con su disparador:
--      `trg_notify_message_new -> notify_message_new`. Los nombres se
--      parecen tanto que ése es exactamente el error que había que no
--      cometer al borrar.
--   3. **Y el chat sigue avisando de verdad.** Es la única comprobación
--      que vale: que el objeto ya no esté no demuestra que no hiciera
--      falta. Se manda un DM y se cuenta el aviso antes y después.
--   4. Las diez funciones `notify_*` siguen ahí: un `drop` que se lleve
--      algo de más se vería acá.
--
-- Por qué `drop function if exists` SIN `cascade`: si algo dependiera de
-- ella, esto falla en vez de llevarse por delante lo que cuelgue. Un
-- `cascade` sería lo contrario de lo que se quiere al retirar código que
-- se cree muerto.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK y no deja nada.
-- =============================================================

begin;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_marca text := 'm150' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_antes int; v_despues int; v_n int;
begin
  -- ── Caso 1 ────────────────────────────────────────────────────
  if to_regprocedure('public.tg_notify_message_new()') is not null then
    raise exception 'CASO 1 FALLA: tg_notify_message_new() sigue existiendo';
  end if;

  -- ── Caso 2 ────────────────────────────────────────────────────
  select count(*) into v_n
    from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and t.tgname = 'trg_notify_message_new'
     and p.proname = 'notify_message_new';
  if v_n <> 1 then
    raise exception 'CASO 2 FALLA: el disparador vivo no apunta a notify_message_new (%)', v_n;
  end if;

  -- ── Caso 3: el chat avisa ─────────────────────────────────────
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
    'm150-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b]) u;
  insert into public.profiles (id, username) values (v_a, v_marca || 'a'), (v_b, v_marca || 'b')
    on conflict (id) do update set username = excluded.username;
  -- Un DM exige amistad aceptada: lo pide `chat_are_friends` en la
  -- política de `messages`. Sin esto el insert se rechaza y el caso
  -- mediría otra cosa.
  insert into public.friendships (requester_id, addressee_id, status) values (v_a, v_b, 'accepted');

  select count(*) into v_antes from public.notifications where user_id = v_b and type = 'message_new';
  insert into public.messages (sender_id, receiver_id, content) values (v_a, v_b, 'hola ' || v_marca);
  select count(*) into v_despues from public.notifications where user_id = v_b and type = 'message_new';
  if v_despues <> v_antes + 1 then
    raise exception 'CASO 3 FALLA: el chat dejó de avisar (% → %)', v_antes, v_despues;
  end if;

  -- ── Caso 4 ────────────────────────────────────────────────────
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'notify\_%';
  if v_n < 10 then
    raise exception 'CASO 4 FALLA: quedan sólo % funciones notify_* — el drop se llevó algo de más', v_n;
  end if;

  raise notice 'MIGRACIÓN 150: 4/4 casos OK';
end $$;

rollback;
