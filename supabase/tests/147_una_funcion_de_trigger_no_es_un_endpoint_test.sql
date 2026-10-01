-- =============================================================
-- FutFinder — pruebas de la migración 147
--
-- Qué cubre:
--   1. `authenticated` no ejecuta NINGUNA de las funciones de trigger de
--      `public`. Antes ejecutaba 42 de 53; el control del ensayo lo dejó
--      por escrito antes de revocar.
--   2. Las RPC de verdad NO se tocaron: siguen siendo 162 las que
--      `authenticated` puede ejecutar. Un revoke que se pasa de ancho
--      rompería la app entera, y el conteo es lo que lo caza.
--   3. Una función de TRIGGER nueva nace cerrada. Es la mitad que
--      importa: `pg_default_acl` le concede `execute` a `authenticated`
--      a toda función que cree `postgres`, así que sin el disparador de
--      eventos esta lista se vuelve a llenar sola, migración a migración.
--   4. Una RPC nueva sigue abierta. El disparador mira el tipo de
--      retorno, así que no puede alcanzar a una RPC — y este caso es el
--      que avisaría si alguien le ampliara el alcance.
--   5-8. **Y los disparadores siguen disparando.** Ésta es la parte que
--      no se puede reemplazar mirando privilegios: revocar el `EXECUTE`
--      no desactiva un trigger —PostgreSQL comprueba ese privilegio al
--      CREAR el trigger, no en cada disparo— pero si alguna vez dejara
--      de aplicarse una regla, el fallo sería SILENCIOSO. Así que se
--      disparan cuatro de verdad: el que rechaza un partido en el
--      pasado, el que crea el aviso de solicitud de amistad, el que
--      inscribe al organizador y el que recalcula las valoraciones.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK y no deja nada.
-- =============================================================

begin;

do $$
declare
  v_n int; v_total int; v_rpc int; v_pudo boolean;
  v_u uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
  v_marca text := 'm147' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_antes int; v_despues int;
begin
  -- ── Caso 1: ninguna la ejecuta el cliente ─────────────────────
  select count(*), count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))
    into v_total, v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prorettype = 'pg_catalog.trigger'::regtype;
  if v_n <> 0 then
    raise exception 'CASO 1 FALLA: authenticated todavía ejecuta % de % funciones de trigger', v_n, v_total;
  end if;

  -- ── Caso 2: las RPC de verdad siguen abiertas ─────────────────
  select count(*) into v_rpc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prorettype <> 'pg_catalog.trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute');
  if v_rpc < 160 then
    raise exception 'CASO 2 FALLA: las RPC que el cliente usa bajaron a % — el revoke se pasó de ancho', v_rpc;
  end if;

  -- ── Caso 3: una función de trigger nueva nace cerrada ─────────
  execute $f$create function public.m147_prueba() returns trigger language plpgsql as 'begin return new; end'$f$;
  if has_function_privilege('authenticated', 'public.m147_prueba()', 'execute') then
    raise exception 'CASO 3 FALLA: una función de trigger nueva nació abierta — el disparador de eventos no está';
  end if;

  -- ── Caso 4: una RPC nueva NO se ve afectada ───────────────────
  execute $f$create function public.m147_rpc() returns int language sql as 'select 1'$f$;
  if not has_function_privilege('authenticated', 'public.m147_rpc()', 'execute') then
    raise exception 'CASO 4 FALLA: el disparador alcanzó a una RPC nueva';
  end if;

  -- ── Y ahora lo que no se puede ver en los privilegios ─────────
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
    'm147-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_u, v_o]) u;
  insert into public.profiles (id, username) values (v_u, v_marca || 'a'), (v_o, v_marca || 'b')
    on conflict (id) do update set username = excluded.username;

  -- ── Caso 5: tg_match_future_only sigue rechazando el pasado ───
  begin
    insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
      latitud, longitud, hora, cupos_totales, cupos_disponibles)
      values (v_m, v_u, v_marca, 'Comuna', 'Cancha', -33.45, -70.64, now() - interval '1 day', 10, 8);
    v_pudo := true;
  exception when others then v_pudo := false; end;
  if v_pudo then raise exception 'CASO 5 FALLA: tg_match_future_only dejó de disparar'; end if;

  -- ── Caso 6: tg_notify_friend_request sigue avisando ───────────
  select count(*) into v_antes from public.notifications where user_id = v_o and type = 'friend_request';
  insert into public.friendships (requester_id, addressee_id, status) values (v_u, v_o, 'pending');
  select count(*) into v_despues from public.notifications where user_id = v_o and type = 'friend_request';
  if v_despues <> v_antes + 1 then
    raise exception 'CASO 6 FALLA: tg_notify_friend_request no creó el aviso (% → %)', v_antes, v_despues;
  end if;

  -- ── Caso 7: add_organizer_as_attendee sigue inscribiendo ──────
  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles)
    values (v_m, v_u, v_marca, 'Comuna', 'Cancha', -33.45, -70.64, now() + interval '2 days', 10, 8);
  select count(*) into v_n from public.attendees where id_partido = v_m and id_jugador = v_u;
  if v_n <> 1 then
    raise exception 'CASO 7 FALLA: add_organizer_as_attendee no inscribió al organizador (%)', v_n;
  end if;

  -- ── Caso 8: tg_ratings_recalc sigue recalculando ──────────────
  insert into public.attendees (id_partido, id_jugador, estado) values (v_m, v_o, 'inscrito');
  insert into public.ratings (match_id, rater_id, rated_id, puntualidad, fairplay, nivel)
    values (v_m, v_u, v_o, 5, 5, 4);
  select rating_count into v_n from public.profiles where id = v_o;
  if coalesce(v_n, 0) < 1 then
    raise exception 'CASO 8 FALLA: tg_ratings_recalc no recalculó (rating_count = %)', v_n;
  end if;

  raise notice 'MIGRACIÓN 147: 8/8 casos OK (0 de % funciones de trigger abiertas, % RPC intactas)', v_total, v_rpc;
end $$;

rollback;
