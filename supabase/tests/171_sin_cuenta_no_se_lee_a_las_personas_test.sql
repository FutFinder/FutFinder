-- =============================================================
-- FutFinder — pruebas de la migración 171.
--
-- Cada caso mira la base COMO el rol que importa (`anon` o `authenticated`
-- con el `sub` de una persona concreta), nunca como `postgres`: como
-- `postgres` todo se ve y todo da verde.
--
--   A1  Sin cuenta no se lee quién va a un partido…
--   A2  …ni quién está en un club…
--   A3  …ni las fotos de galería de nadie.
--   A4  Los partidos normales siguen legibles sin cuenta (no se tocaron: es
--       decisión de producto pendiente y el arnés de la 44d lo exige)…
--   A4b …pero un partido de clubes no.
--   A5  Con cuenta, todo se sigue leyendo igual.
--   A6  Un partido de clubes sigue escondido para quien no es de esos
--       clubes.
--   A7  Lo que no habla de personas sigue legible sin cuenta (`clubs`).
--   B1  Un tercero no averigua si dos personas se tienen bloqueadas…
--   B2  …quien bloqueó sí lo ve…
--   B3  …la persona bloqueada también (la política de amistad lo necesita)…
--   B4  …y sin sesión (cron, service_role) se contesta la verdad.
--   B5  La persona bloqueada no puede mandar solicitud de amistad (42501)…
--   B6  …un tercero sí puede…
--   B7  …y desbloquear sigue funcionando y deja el par libre.
--   B8  `anon` no ejecuta la función; `authenticated` sí.
--   C1  La galería de perfil tiene tope de tamaño y sólo acepta imágenes.
--
-- Donde se espera un rechazo se exige el CÓDIGO (42501), no «algo falló».
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r171 (caso text, ok boolean, detalle text);
grant all on r171 to authenticated, anon;

-- Ejecuta una consulta que devuelve UN entero, como ese rol. `p_uid` nulo
-- con rol `anon` es «sin cuenta». Devuelve el número, o -1 con el sqlstate
-- en `detalle` si la consulta revienta. El rol se repone siempre.
create or replace function pg_temp.cuenta_como(p_rol text, p_uid uuid, p_sql text, out n int, out err text)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null
         then json_build_object('role', p_rol)::text
         else json_build_object('sub', p_uid, 'role', p_rol)::text end, true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql into n;
    execute 'reset role';
  exception when others then
    execute 'reset role';
    n := -1; err := sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Intenta una sentencia COMO ese usuario: 'ok:<filas>' o 'err:<sqlstate>'.
create or replace function pg_temp.intenta(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v_n int; v_r text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql;
    get diagnostics v_n = row_count;
    execute 'reset role';
    v_r := 'ok:' || v_n;
  exception when others then
    execute 'reset role';
    v_r := 'err:' || sqlstate;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v_r;
end $$;

do $$
declare
  u1 uuid := gen_random_uuid();   -- organiza, admin del club A, bloquea a u2
  u2 uuid := gen_random_uuid();   -- persona bloqueada por u1; admin del club B
  u3 uuid := gen_random_uuid();   -- tercero: ni bloquea ni está bloqueado
  v_a uuid; v_b uuid; v_c uuid;
  v_match uuid; v_privado uuid;
  c record; r text; v_b1 boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r171-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2, u3]) u;

  insert into public.clubs (nombre, slug, created_by) values ('r171 A', 'r171-a-' || substr(u1::text,1,8), u1) returning id into v_a;
  insert into public.clubs (nombre, slug, created_by) values ('r171 B', 'r171-b-' || substr(u2::text,1,8), u2) returning id into v_b;
  insert into public.clubs (nombre, slug, created_by) values ('r171 C', 'r171-c-' || substr(u3::text,1,8), u3) returning id into v_c;
  insert into public.club_members (club_id, user_id, rol)
  values (v_a, u1, 'admin'), (v_b, u2, 'admin'), (v_c, u3, 'admin');

  insert into public.profile_photos (user_id, photo_url) values (u1, 'https://x/r171.jpg');

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u1, 'r171 abierto', 'Ñuñoa', 'Cancha 1', -33.45, -70.6, now() + interval '2 days', 10, 10)
  returning id into v_match;

  -- La inscripción se siembra sin disparadores: acá se prueba quién LEE la
  -- fila, no las reglas para inscribirse (eso lo cubren otros arneses).
  set local session_replication_role = replica;
  insert into public.attendees (id_partido, id_jugador, estado, origen)
  values (v_match, u3, 'inscrito', 'legado');
  -- Un partido de clubes (A contra B): sólo lo ven quienes son de A o de B.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora,
                              cupos_totales, cupos_disponibles, club_local_id, club_visitante_id, challenge_proposal_id)
  values (u1, 'r171 de clubes', 'Ñuñoa', 'Cancha 2', -33.45, -70.6, now() + interval '3 days',
          10, 10, v_a, v_b, gen_random_uuid())
  returning id into v_privado;
  set local session_replication_role = origin;

  -- ── A. Sin cuenta ─────────────────────────────────────────────
  c := pg_temp.cuenta_como('anon', null, format($q$select count(*) from public.attendees where id_partido = %L$q$, v_match));
  insert into r171 values ('A1 sin cuenta no se lee quien va a un partido', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('anon', null, format($q$select count(*) from public.club_members where club_id = %L$q$, v_a));
  insert into r171 values ('A2 ni quien esta en un club', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('anon', null, format($q$select count(*) from public.profile_photos where user_id = %L$q$, u1));
  insert into r171 values ('A3 ni las fotos de galeria', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('anon', null, format($q$select count(*) from public.matches where id = %L$q$, v_match));
  insert into r171 values ('A4 los partidos normales siguen legibles sin cuenta (decision pendiente)', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('anon', null, format($q$select count(*) from public.matches where id = %L$q$, v_privado));
  insert into r171 values ('A4b pero un partido de clubes no', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── A5. Con cuenta se lee igual que antes ─────────────────────
  -- (Se filtra por u3: al crear el partido, el organizador queda inscrito solo.)
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.attendees where id_partido = %L and id_jugador = %L$q$, v_match, u3));
  insert into r171 values ('A5 con cuenta si se lee quien va', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.club_members where club_id = %L$q$, v_a));
  insert into r171 values ('A5 con cuenta si se lee el club', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.profile_photos where user_id = %L$q$, u1));
  insert into r171 values ('A5 con cuenta si se leen las fotos', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.matches where id = %L$q$, v_match));
  insert into r171 values ('A5 con cuenta si se lee el partido', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── A6. El partido de clubes sigue siendo de sus clubes ───────
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.matches where id = %L$q$, v_privado));
  insert into r171 values ('A6 el partido de clubes sigue oculto para quien no es de esos clubes', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.matches where id = %L$q$, v_privado));
  insert into r171 values ('A6 y visible para quien si lo es', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── A7. Lo que no habla de personas no se cerró ───────────────
  c := pg_temp.cuenta_como('anon', null, format($q$select count(*) from public.clubs where id = %L$q$, v_a));
  insert into r171 values ('A7 clubs sigue legible sin cuenta (decision de producto pendiente)', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── B. El bloqueo ─────────────────────────────────────────────
  insert into public.blocked_users (blocker_id, blocked_id) values (u1, u2);

  c := pg_temp.cuenta_como('authenticated', u3, format($q$select public.is_blocked_pair(%L, %L)::int$q$, u1, u2));
  insert into r171 values ('B1 un tercero no averigua el bloqueo', c.n = 0, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select public.is_blocked_pair(%L, %L)::int$q$, u2, u1));
  insert into r171 values ('B1 ni preguntando al reves', c.n = 0, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select public.is_blocked_pair(%L, %L)::int$q$, u1, u2));
  insert into r171 values ('B2 quien bloqueo si lo ve', c.n = 1, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u2, format($q$select public.is_blocked_pair(%L, %L)::int$q$, u2, u1));
  insert into r171 values ('B3 la persona bloqueada tambien', c.n = 1, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  -- Sin sesión: aquí mismo, como dueño de la transacción y sin claims.
  perform set_config('request.jwt.claims', '', true);
  v_b1 := public.is_blocked_pair(u1, u2);
  insert into r171 values ('B4 sin sesion se contesta la verdad', v_b1, 'respuesta=' || v_b1);

  r := pg_temp.intenta(u2, format(
    $q$insert into public.friendships (requester_id, addressee_id, status) values (%L, %L, 'pending')$q$, u2, u1));
  insert into r171 values ('B5 la persona bloqueada no manda solicitud de amistad', r = 'err:42501', r);

  r := pg_temp.intenta(u3, format(
    $q$insert into public.friendships (requester_id, addressee_id, status) values (%L, %L, 'pending')$q$, u3, u1));
  insert into r171 values ('B6 un tercero si puede mandarla', r = 'ok:1', r);

  r := pg_temp.intenta(u1, format($q$select public.desbloquear_usuario(%L)$q$, u2));
  c := pg_temp.cuenta_como('authenticated', u1, format($q$select public.is_blocked_pair(%L, %L)::int$q$, u1, u2));
  insert into r171 values ('B7 desbloquear funciona y deja el par libre', r like 'ok:%' and c.n = 0, r || ' respuesta=' || c.n);

  insert into r171 values ('B8 anon no ejecuta is_blocked_pair',
    not has_function_privilege('anon', 'public.is_blocked_pair(uuid, uuid)', 'EXECUTE'), '');
  insert into r171 values ('B8 authenticated si (la politica de amistad la evalua con ese rol)',
    has_function_privilege('authenticated', 'public.is_blocked_pair(uuid, uuid)', 'EXECUTE'), '');

  -- ── C. La galería de perfil ───────────────────────────────────
  insert into r171
  select 'C1 la galeria de perfil tiene tope y solo imagenes',
         b.file_size_limit = 5242880
           and b.allowed_mime_types is not null
           and b.allowed_mime_types @> array['image/jpeg']
           and not b.allowed_mime_types && array['text/html', 'image/svg+xml', 'application/octet-stream'],
         'limite=' || coalesce(b.file_size_limit::text, 'sin limite') || ' tipos=' || coalesce(array_to_string(b.allowed_mime_types, '|'), 'cualquiera')
    from storage.buckets b where b.id = 'profile-gallery';
end $$;

select caso, ok, detalle from r171 order by caso;
do $$
declare v_mal int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_mal, v_total from r171;
  if v_total < 23 then
    raise exception 'el arnes de la 171 no llego al final: % casos de 23', v_total;
  end if;
  if v_mal > 0 then
    raise exception '% caso(s) de la 171 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
