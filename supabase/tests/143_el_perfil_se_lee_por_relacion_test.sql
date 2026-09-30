-- =============================================================
-- FutFinder — pruebas de la migración 143
--
-- Qué cubre:
--   1. `anon` no lee NINGÚN perfil. Antes leía las 32 filas enteras.
--   2. Leo el mío.
--   3. Leo uno descubrible aunque no compartamos nada.
--   4. NO leo el oculto de un desconocido. Es el corazón del cambio.
--   5-10. Sí leo el oculto de un amigo, de un compañero de club, de un
--      compañero de partido, de alguien en la lista de espera de un
--      partido mío, de alguien a quien bloqueé y de quien administra mi
--      recinto.
--  11. Mandar una solicitud de amistad sigue funcionando. `friendships_
--      insert` (migración 35) consulta `profiles` desde su política: si
--      el destinatario deja de leerse, falla CERRADO y sin mensaje.
--  12. `get_my_threads()` sigue trayendo el DM. Es SECURITY INVOKER y
--      hace INNER JOIN contra `profiles` para el otro lado del hilo.
--  13. `lista_de_espera()` conserva a un jugador OCULTO. Es el caso que
--      más caro salía: hace INNER JOIN, así que el oculto no aparecía
--      vacío — desaparecía de la cola y el `row_number()` corría un
--      puesto a todos los de abajo.
--  14-15. `buscar_jugadores()` sigue devolviendo (es SECURITY DEFINER y
--      la política no la alcanza) y sigue dejando fuera al oculto.
--
-- POR QUÉ HAY MÁS CASOS QUE REGLAS: cuatro de las siete relaciones no
-- salieron de pensar el modelo, sino de buscar quién hacía INNER JOIN
-- contra `profiles`. Una política que niega de más no rompe ninguna
-- pantalla: con un LEFT JOIN deja un nombre vacío, y con un INNER JOIN
-- hace desaparecer la fila entera y lo que queda se ve sano.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado. Si algún caso falla, la
-- ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_yo uuid := gen_random_uuid(); v_amigo uuid := gen_random_uuid();
  v_club uuid := gen_random_uuid(); v_partido uuid := gen_random_uuid();
  v_desc uuid := gen_random_uuid(); v_extrano uuid := gen_random_uuid();
  v_espera uuid := gen_random_uuid(); v_bloq uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_marca text := 'm143' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  v_club_id uuid := gen_random_uuid(); v_match_id uuid := gen_random_uuid();
  v_cx uuid := gen_random_uuid();
  v_n int; v_pudo boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'm143-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_yo,v_amigo,v_club,v_partido,v_desc,v_extrano,v_espera,v_bloq,v_admin]) u;

  -- Sólo `yo` y `desc` quedan descubribles. Todos los demás, ocultos:
  -- así cada caso mide la RELACIÓN y no el interruptor.
  insert into public.profiles (id, username, privacy_visible_in_search, privacy_friend_requests)
  select u, v_marca || n, (u = v_yo or u = v_desc), 'everyone'
    from unnest(array[v_yo,v_amigo,v_club,v_partido,v_desc,v_extrano,v_espera,v_bloq,v_admin],
                array['yo','amigo','club','partido','desc','extrano','espera','bloq','admin']) as t(u, n)
  on conflict (id) do update
    set username = excluded.username,
        privacy_visible_in_search = excluded.privacy_visible_in_search,
        privacy_friend_requests = 'everyone';

  insert into public.friendships (requester_id, addressee_id, status) values (v_yo, v_amigo, 'accepted');
  insert into public.clubs (id, nombre, slug, created_by)
    values (v_club_id, v_marca || ' FC', v_marca || '-fc', v_yo);
  insert into public.club_members (club_id, user_id, rol)
    values (v_club_id, v_yo, 'admin'), (v_club_id, v_club, 'jugador');
  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles)
    values (v_match_id, v_yo, v_marca || ' partido', 'Comuna', 'Cancha',
            -33.45, -70.66, now() + interval '2 days', 10, 8);
  insert into public.attendees (id_partido, id_jugador, estado) values (v_match_id, v_partido, 'inscrito');
  insert into public.match_waitlist (id_partido, id_jugador) values (v_match_id, v_espera);
  insert into public.blocked_users (blocker_id, blocked_id) values (v_yo, v_bloq);
  insert into public.complejos (id, nombre, direccion, region, comuna, latitud, longitud, created_by)
    values (v_cx, v_marca || ' Complejo', 'Calle 1', 'Region', 'Comuna', -33.4, -70.6, v_yo);
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_cx, v_admin, 'admin');

  -- ── Caso 1: anon no lee nada ──────────────────────────────────
  set local role anon;
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.profiles;
  if v_n <> 0 then raise exception 'CASO 1 FALLA: anon todavía lee % perfiles', v_n; end if;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_yo, 'role', 'authenticated')::text, true);

  -- ── Casos 2 a 10: quién se lee y quién no ─────────────────────
  select count(*) into v_n from public.profiles where id = v_yo;
  if v_n <> 1 then raise exception 'CASO 2 FALLA: no leo mi propio perfil'; end if;
  select count(*) into v_n from public.profiles where id = v_desc;
  if v_n <> 1 then raise exception 'CASO 3 FALLA: no leo un perfil descubrible'; end if;
  select count(*) into v_n from public.profiles where id = v_extrano;
  if v_n <> 0 then raise exception 'CASO 4 FALLA: leo el perfil oculto de un desconocido'; end if;
  select count(*) into v_n from public.profiles where id = v_amigo;
  if v_n <> 1 then raise exception 'CASO 5 FALLA: un amigo oculto dejó de verse'; end if;
  select count(*) into v_n from public.profiles where id = v_club;
  if v_n <> 1 then raise exception 'CASO 6 FALLA: un compañero de club oculto dejó de verse'; end if;
  select count(*) into v_n from public.profiles where id = v_partido;
  if v_n <> 1 then raise exception 'CASO 7 FALLA: un compañero de partido oculto dejó de verse'; end if;
  select count(*) into v_n from public.profiles where id = v_espera;
  if v_n <> 1 then raise exception 'CASO 8 FALLA: alguien en la lista de espera de mi partido dejó de verse'; end if;
  select count(*) into v_n from public.profiles where id = v_bloq;
  if v_n <> 1 then raise exception 'CASO 9 FALLA: no puedo ver a quien bloqueé'; end if;
  select count(*) into v_n from public.profiles where id = v_admin;
  if v_n <> 1 then raise exception 'CASO 10 FALLA: no veo a quien administra mi recinto'; end if;

  -- ── Caso 11: la solicitud de amistad no falla cerrada ─────────
  begin
    insert into public.friendships (requester_id, addressee_id, status) values (v_yo, v_desc, 'pending');
    v_pudo := true;
  exception when others then v_pudo := false;
  end;
  if not v_pudo then
    raise exception 'CASO 11 FALLA: no se puede mandar una solicitud a un descubrible — friendships_insert falló CERRADA';
  end if;

  -- ── Caso 12: la bandeja de chat no se vacía ───────────────────
  insert into public.messages (sender_id, receiver_id, content) values (v_yo, v_amigo, 'hola ' || v_marca);
  select count(*) into v_n from public.get_my_threads() t where t.thread_key = 'dm:' || v_amigo::text;
  if v_n <> 1 then
    raise exception 'CASO 12 FALLA: get_my_threads() no devuelve el DM (% filas) — su INNER JOIN contra profiles se quedó corto', v_n;
  end if;

  -- ── Caso 13: la lista de espera conserva al oculto ────────────
  select count(*) into v_n from public.lista_de_espera(v_match_id);
  if v_n <> 1 then
    raise exception 'CASO 13 FALLA: lista_de_espera() perdió al jugador oculto (% filas) — las posiciones de abajo se corrieron', v_n;
  end if;

  -- ── Casos 14 y 15: la búsqueda del 142 sigue en pie ───────────
  select count(*) into v_n from public.buscar_jugadores(v_marca);
  if v_n < 1 then
    raise exception 'CASO 14 FALLA: buscar_jugadores() devolvió % — la política alcanzó a una función SECURITY DEFINER', v_n;
  end if;
  select count(*) into v_n from public.buscar_jugadores(v_marca) where username = v_marca || 'extrano';
  if v_n <> 0 then raise exception 'CASO 15 FALLA: el oculto sale en la búsqueda'; end if;

  reset role;
  raise notice 'MIGRACIÓN 143: 15/15 casos OK';
end $$;

rollback;
