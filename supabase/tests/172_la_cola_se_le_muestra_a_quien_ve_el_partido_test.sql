-- =============================================================
-- FutFinder — pruebas de la migración 172.
--
-- Cada caso llama a `lista_de_espera()` COMO el rol que importa
-- (`authenticated` con el `sub` de una persona concreta, `anon`,
-- `service_role`), nunca como `postgres` salvo donde se prueba justamente
-- el «sin sesión».
--
--   A1  Quien no es de ninguno de los dos clubes no ve la cola de un
--       partido de clubes (antes de la 172: la veía)…
--   A2  …el integrante del club local sí…
--   A3  …y el del club visitante también.
--   A4  Sin sesión (cron, editor SQL) se contesta la verdad…
--   A5  …y como `service_role` también.
--   A6  La función y la tabla dicen lo mismo: el ajeno tampoco lee esas
--       filas en `match_waitlist`, y el integrante sí.
--   B1  En un partido normal cualquiera con cuenta sigue viendo la cola…
--   B2  …con su orden y su posición…
--   B3  …y el organizador también.
--   C1  `join_waitlist` sigue devolviendo la posición de quien entra (es la
--       única función que llama a `lista_de_espera`).
--   C2  Un partido que no existe: lista vacía, sin error.
--   D1  `anon` no la ejecuta (42501)…
--   D2  …y `authenticated` sí.
--   D3  Sigue siendo `security definer` con `search_path` fijo.
--
-- La cola del partido de clubes se siembra SIN disparadores: en la base
-- real `trg_waitlist_no_en_partido_de_clubes` no deja crearla, y eso es
-- justo lo que esta migración no quiere dar por sentado.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r172 (caso text, ok boolean, detalle text);
grant all on r172 to authenticated, anon, service_role;

-- Ejecuta una consulta que devuelve UN entero, como ese rol. `p_uid` nulo
-- es «sin persona» (anon, service_role). Devuelve el número, o -1 con el
-- sqlstate en `err` si la consulta revienta. El rol se repone siempre.
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

do $$
declare
  u1 uuid := gen_random_uuid();   -- organiza el partido normal; admin del club A (local)
  u2 uuid := gen_random_uuid();   -- admin del club B (visitante)
  u3 uuid := gen_random_uuid();   -- ajeno: admin de un tercer club, C
  u4 uuid := gen_random_uuid();   -- espera en los dos partidos; llegó primero
  u5 uuid := gen_random_uuid();   -- espera en el partido normal; llegó después
  v_a uuid; v_b uuid; v_c uuid;
  v_normal uuid; v_privado uuid;
  c record; v_n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r172-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2, u3, u4, u5]) u;
  -- `lista_de_espera` hace INNER JOIN contra `profiles`: sin perfil no hay
  -- fila, y el arnés daría «0» por el motivo equivocado.
  insert into public.profiles (id, username)
  select u, 'r172' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u2, u3, u4, u5]) u
  on conflict (id) do nothing;
  update public.profiles set trust_score = 75 where id in (u1, u2, u3, u4, u5);

  insert into public.clubs (nombre, slug, created_by) values ('r172 A', 'r172-a-' || substr(u1::text,1,8), u1) returning id into v_a;
  insert into public.clubs (nombre, slug, created_by) values ('r172 B', 'r172-b-' || substr(u2::text,1,8), u2) returning id into v_b;
  insert into public.clubs (nombre, slug, created_by) values ('r172 C', 'r172-c-' || substr(u3::text,1,8), u3) returning id into v_c;
  insert into public.club_members (club_id, user_id, rol)
  values (v_a, u1, 'admin'), (v_b, u2, 'admin'), (v_c, u3, 'admin')
  on conflict do nothing;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u1, 'r172 abierto', 'Ñuñoa', 'Cancha 1', -33.45, -70.6, now() + interval '2 days', 10, 10)
  returning id into v_normal;

  -- El partido de clubes (A contra B) y las colas se siembran sin
  -- disparadores: acá se prueba quién LEE la cola, no las reglas para
  -- entrar a ella (eso lo cubren la 44d, la 105 y la 135).
  set local session_replication_role = replica;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora,
                              cupos_totales, cupos_disponibles, club_local_id, club_visitante_id, challenge_proposal_id)
  values (u1, 'r172 de clubes', 'Ñuñoa', 'Cancha 2', -33.45, -70.6, now() + interval '3 days',
          10, 10, v_a, v_b, gen_random_uuid())
  returning id into v_privado;
  insert into public.match_waitlist (id_partido, id_jugador, created_at) values
    (v_normal,  u4, now() - interval '2 minutes'),
    (v_normal,  u5, now() - interval '1 minute'),
    (v_privado, u4, now() - interval '2 minutes');
  set local session_replication_role = origin;

  -- La siembra tiene que haber quedado: si no, todo lo de abajo daría «0».
  select count(*) into v_n from public.match_waitlist where id_partido in (v_normal, v_privado);
  if v_n <> 3 then raise exception 'la siembra del arnés 172 dejó % filas en la cola, no 3', v_n; end if;

  -- ── A. El partido de clubes ───────────────────────────────────
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.lista_de_espera(%L)$q$, v_privado));
  insert into r172 values ('A1 un ajeno no ve la cola de un partido de clubes', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.lista_de_espera(%L)$q$, v_privado));
  insert into r172 values ('A2 el integrante del club local si', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.lista_de_espera(%L)$q$, v_privado));
  insert into r172 values ('A3 el del club visitante tambien', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- Sin sesión: aquí mismo, como dueño de la transacción y sin claims.
  perform set_config('request.jwt.claims', '', true);
  select count(*) into v_n from public.lista_de_espera(v_privado);
  insert into r172 values ('A4 sin sesion se contesta la verdad', v_n = 1, 'vio=' || v_n);

  c := pg_temp.cuenta_como('service_role', null, format($q$select count(*) from public.lista_de_espera(%L)$q$, v_privado));
  insert into r172 values ('A5 como service_role tambien', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.match_waitlist where id_partido = %L$q$, v_privado));
  insert into r172 values ('A6 la tabla dice lo mismo: el ajeno no lee esas filas', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.match_waitlist where id_partido = %L$q$, v_privado));
  insert into r172 values ('A6 y el integrante si', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── B. El partido normal no cambia ────────────────────────────
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.lista_de_espera(%L)$q$, v_normal));
  insert into r172 values ('B1 en un partido normal cualquiera con cuenta ve la cola', c.n = 2, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u4, format($q$select posicion from public.lista_de_espera(%L) where id_jugador = %L$q$, v_normal, u4));
  insert into r172 values ('B2 quien llego primero va primero', c.n = 1, 'posicion=' || coalesce(c.n::text, 'nula') || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u5, format($q$select posicion from public.lista_de_espera(%L) where id_jugador = %L$q$, v_normal, u5));
  insert into r172 values ('B2 y quien llego despues, segundo', c.n = 2, 'posicion=' || coalesce(c.n::text, 'nula') || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.lista_de_espera(%L)$q$, v_normal));
  insert into r172 values ('B3 el organizador tambien la ve', c.n = 2, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── C. Quien la llama por dentro ──────────────────────────────
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select (public.join_waitlist(%L)->>'posicion')::int$q$, v_normal));
  insert into r172 values ('C1 join_waitlist sigue devolviendo la posicion de quien entra', c.n = 3, 'posicion=' || coalesce(c.n::text, 'nula') || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.lista_de_espera(%L)$q$, gen_random_uuid()));
  insert into r172 values ('C2 un partido que no existe: lista vacia, sin error', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── D. Privilegios y forma ────────────────────────────────────
  c := pg_temp.cuenta_como('anon', null, format($q$select count(*) from public.lista_de_espera(%L)$q$, v_normal));
  insert into r172 values ('D1 anon no la ejecuta (42501)', c.n = -1 and c.err = '42501', 'n=' || c.n || coalesce(' err=' || c.err, ''));
  insert into r172 values ('D2 authenticated si',
    has_function_privilege('authenticated', 'public.lista_de_espera(uuid)', 'EXECUTE'), '');
  insert into r172
  select 'D3 sigue siendo security definer con search_path fijo',
         p.prosecdef and p.proconfig @> array['search_path=public'],
         'definer=' || p.prosecdef || ' config=' || coalesce(array_to_string(p.proconfig, '|'), 'sin fijar')
    from pg_proc p where p.oid = 'public.lista_de_espera(uuid)'::regprocedure;
end $$;

select caso, ok, detalle from r172 order by caso;
do $$
declare v_mal int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_mal, v_total from r172;
  if v_total < 16 then
    raise exception 'el arnes de la 172 no llego al final: % casos de 16', v_total;
  end if;
  if v_mal > 0 then
    raise exception '% caso(s) de la 172 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
