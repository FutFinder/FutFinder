-- =============================================================
-- FutFinder — pruebas de la migración 173.
--
-- Cada caso mira la base COMO el rol que importa (`authenticated` con el
-- `sub` de una persona concreta, `anon`, `service_role`), nunca como
-- `postgres` salvo donde se prueba justamente el «sin sesión».
--
-- Tres personas: u1 organiza la reserva, u2 participa, u3 no tiene nada
-- que ver.
--
--   A1  Un tercero no averigua si otra persona participa en una reserva…
--   A2  …ni si otra persona la organizó.
--   A3  Tampoco se contesta por otro aunque quien pregunte sea parte de la
--       reserva: la función responde por quien llama, y nada más.
--   B1  Quien participa, preguntando por sí mismo: sí.
--   B2  Quien organiza, preguntando por sí mismo: sí.
--   B3  Preguntar por uno mismo sigue diciendo la verdad cuando es «no».
--   B4  Sin sesión (cron, editor SQL) se contesta la verdad…
--   B5  …y como `service_role` también.
--   C1  `reservas`: la leen quien organiza y quien participa; el tercero no.
--   C2  `reserva_participantes`: quien organiza ve la nómina; quien
--       participa, su fila; el tercero, nada.
--   C3  `reserva_contacto`: sólo quien organiza.
--   C4  `reserva_cobros`: quien organiza y quien participa; el tercero no.
--   C5  `detalle_reserva`: abre para quien organiza y para quien participa;
--       al tercero le dice que no es suya.
--   C6  `mis_reservas`: cada uno ve la suya; el tercero, ninguna.
--   C7  `actualizar_contacto_reserva`: quien organiza puede; quien
--       participa no.
--   D1  `anon` no ejecuta ninguna de las dos (42501)…
--   D2  …`authenticated` sí (las políticas se evalúan con ese rol)…
--   D3  …y siguen siendo `security definer` con `search_path` fijo.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r173 (caso text, ok boolean, detalle text);
grant all on r173 to authenticated, anon, service_role;

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
  u1 uuid := gen_random_uuid();   -- organiza la reserva
  u2 uuid := gen_random_uuid();   -- participa
  u3 uuid := gen_random_uuid();   -- tercero
  v_cpl uuid := gen_random_uuid(); v_cancha uuid := gen_random_uuid();
  v_hoy date; v_h time; v_res json; v_r uuid;
  c record; v_n int; v_b boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r173-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u2, u3]) u;
  insert into public.profiles (id, username)
  select u, 'r173' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u2, u3]) u
  on conflict (id) do nothing;

  -- Su propio recinto, abierto los siete días (mismo montaje que el 86).
  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
  values (v_cpl, 'Recinto arnés 173', 'Ñuñoa', -33.45, -70.60, true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_cpl, 'Cancha arnés 173', 'futbol_7', 20000, 60, true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '00:00', time '23:00' from generate_series(0, 6) as d;
  v_hoy := (now() at time zone 'America/Santiago')::date;

  -- La reserva la crea u1 por la puerta real.
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select (s->>'hora_inicio')::time into v_h
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_hoy + 3)->'slots') s
   where (s->>'disponible')::boolean limit 1;
  v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_hoy + 3, p_hora_inicio := v_h,
    p_modalidad := 'completa', p_medio_pago := 'tarjeta', p_n_jugadores := 10,
    p_contacto_nombre := 'QA', p_contacto_telefono := '+56911111111', p_cobros := null);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  v_r := (v_res->>'reserva_id')::uuid;
  if v_r is null then raise exception 'la siembra del arnés 173 no creó la reserva: %', v_res; end if;

  -- u2 entra a la nómina y la reserva gana un cobro, sin disparadores: acá
  -- se prueba quién LEE, no las reglas para armar una reserva dividida.
  set local session_replication_role = replica;
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
  values (v_r, u2, 'jugador', 'aceptado')
  on conflict (reserva_id, user_id) do nothing;
  insert into public.reserva_cobros (reserva_id, cobro_id, nombre, precio)
  values (v_r, gen_random_uuid(), 'Petos arnés 173', 1000);
  insert into public.reserva_contacto (reserva_id, nombre, telefono)
  values (v_r, 'QA', '+56911111111')
  on conflict (reserva_id) do nothing;
  set local session_replication_role = origin;

  -- ── A. Preguntar por otra persona ─────────────────────────────
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select public.es_participante_de_reserva(%L, %L)::int$q$, v_r, u2));
  insert into r173 values ('A1 un tercero no averigua si otra persona participa', c.n = 0, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u3, format($q$select public.es_organizador_de_reserva(%L, %L)::int$q$, v_r, u1));
  insert into r173 values ('A2 ni si otra persona la organizo', c.n = 0, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select public.es_participante_de_reserva(%L, %L)::int$q$, v_r, u2));
  insert into r173 values ('A3 quien organiza tampoco pregunta por otro a la funcion', c.n = 0, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select public.es_organizador_de_reserva(%L, %L)::int$q$, v_r, u1));
  insert into r173 values ('A3 ni quien participa', c.n = 0, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── B. Preguntar por uno mismo, y sin sesión ──────────────────
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select public.es_participante_de_reserva(%L, %L)::int$q$, v_r, u2));
  insert into r173 values ('B1 quien participa, por si mismo: si', c.n = 1, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select public.es_organizador_de_reserva(%L, %L)::int$q$, v_r, u1));
  insert into r173 values ('B2 quien organiza, por si mismo: si', c.n = 1, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u3, format($q$select public.es_participante_de_reserva(%L, %L)::int$q$, v_r, u3));
  insert into r173 values ('B3 el tercero, por si mismo: no participa', c.n = 0, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select public.es_organizador_de_reserva(%L, %L)::int$q$, v_r, u2));
  insert into r173 values ('B3 quien participa, por si mismo: no organiza', c.n = 0, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  -- Sin sesión: aquí mismo, como dueño de la transacción y sin claims.
  perform set_config('request.jwt.claims', '', true);
  v_b := public.es_participante_de_reserva(v_r, u2) and public.es_organizador_de_reserva(v_r, u1)
         and not public.es_participante_de_reserva(v_r, u3) and not public.es_organizador_de_reserva(v_r, u2);
  insert into r173 values ('B4 sin sesion se contesta la verdad', v_b, 'respuesta=' || v_b);

  c := pg_temp.cuenta_como('service_role', null, format(
    $q$select (public.es_participante_de_reserva(%L, %L) and public.es_organizador_de_reserva(%L, %L))::int$q$, v_r, u2, v_r, u1));
  insert into r173 values ('B5 como service_role tambien', c.n = 1, 'respuesta=' || c.n || coalesce(' err=' || c.err, ''));

  -- ── C. Lo que se apoya en ellas sigue igual ───────────────────
  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.reservas where id = %L$q$, v_r));
  insert into r173 values ('C1 reservas: quien organiza la lee', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.reservas where id = %L$q$, v_r));
  insert into r173 values ('C1 reservas: quien participa la lee', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.reservas where id = %L$q$, v_r));
  insert into r173 values ('C1 reservas: el tercero no', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.reserva_participantes where reserva_id = %L and user_id = %L$q$, v_r, u2));
  insert into r173 values ('C2 nomina: quien organiza ve a quien participa', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.reserva_participantes where reserva_id = %L and user_id = %L$q$, v_r, u2));
  insert into r173 values ('C2 nomina: quien participa ve su fila', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.reserva_participantes where reserva_id = %L$q$, v_r));
  insert into r173 values ('C2 nomina: el tercero no ve nada', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.reserva_contacto where reserva_id = %L$q$, v_r));
  insert into r173 values ('C3 contacto: quien organiza lo lee', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.reserva_contacto where reserva_id = %L$q$, v_r));
  insert into r173 values ('C3 contacto: quien participa no', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.reserva_cobros where reserva_id = %L$q$, v_r));
  insert into r173 values ('C4 cobros: quien organiza los lee', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.reserva_cobros where reserva_id = %L$q$, v_r));
  insert into r173 values ('C4 cobros: quien participa tambien', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.reserva_cobros where reserva_id = %L$q$, v_r));
  insert into r173 values ('C4 cobros: el tercero no', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  -- `detalle_reserva` niega con «Esta reserva no es tuya»; cualquier otra
  -- respuesta significa que pasó la guarda.
  c := pg_temp.cuenta_como('authenticated', u1, format($q$select (coalesce(public.detalle_reserva(%L)->>'reason', '') <> 'Esta reserva no es tuya')::int$q$, v_r));
  insert into r173 values ('C5 detalle: abre para quien organiza', c.n = 1, 'paso=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select (coalesce(public.detalle_reserva(%L)->>'reason', '') <> 'Esta reserva no es tuya')::int$q$, v_r));
  insert into r173 values ('C5 detalle: abre para quien participa', c.n = 1, 'paso=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select (coalesce(public.detalle_reserva(%L)->>'reason', '') = 'Esta reserva no es tuya')::int$q$, v_r));
  insert into r173 values ('C5 detalle: al tercero le dice que no es suya', c.n = 1, 'negado=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u1, format($q$select count(*) from public.mis_reservas() where id = %L$q$, v_r));
  insert into r173 values ('C6 mis_reservas: quien organiza la ve', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u2, format($q$select count(*) from public.mis_reservas() where id = %L$q$, v_r));
  insert into r173 values ('C6 mis_reservas: quien participa la ve', c.n = 1, 'vio=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u3, format($q$select count(*) from public.mis_reservas() where id = %L$q$, v_r));
  insert into r173 values ('C6 mis_reservas: el tercero no', c.n = 0, 'vio=' || c.n || coalesce(' err=' || c.err, ''));

  c := pg_temp.cuenta_como('authenticated', u2, format($q$select ((public.actualizar_contacto_reserva(%L, 'Otro nombre', '+56922222222')->>'ok')::boolean)::int$q$, v_r));
  insert into r173 values ('C7 contacto: quien participa no lo cambia', c.n = 0, 'ok=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('authenticated', u1, format($q$select ((public.actualizar_contacto_reserva(%L, 'Nombre nuevo', '+56933333333')->>'ok')::boolean)::int$q$, v_r));
  select count(*) into v_n from public.reserva_contacto where reserva_id = v_r and nombre = 'Nombre nuevo';
  insert into r173 values ('C7 contacto: quien organiza si', c.n = 1 and v_n = 1, 'ok=' || c.n || ' filas=' || v_n || coalesce(' err=' || c.err, ''));

  -- ── D. Privilegios y forma ────────────────────────────────────
  c := pg_temp.cuenta_como('anon', null, format($q$select public.es_participante_de_reserva(%L, %L)::int$q$, v_r, u2));
  insert into r173 values ('D1 anon no ejecuta es_participante_de_reserva (42501)', c.n = -1 and c.err = '42501', 'n=' || c.n || coalesce(' err=' || c.err, ''));
  c := pg_temp.cuenta_como('anon', null, format($q$select public.es_organizador_de_reserva(%L, %L)::int$q$, v_r, u1));
  insert into r173 values ('D1 anon no ejecuta es_organizador_de_reserva (42501)', c.n = -1 and c.err = '42501', 'n=' || c.n || coalesce(' err=' || c.err, ''));
  insert into r173 values ('D2 authenticated si ejecuta las dos',
    has_function_privilege('authenticated', 'public.es_participante_de_reserva(uuid, uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.es_organizador_de_reserva(uuid, uuid)', 'EXECUTE'), '');
  insert into r173
  select 'D3 siguen siendo security definer con search_path fijo',
         bool_and(p.prosecdef and p.proconfig @> array['search_path=public']) and count(*) = 2,
         string_agg(p.proname || ' definer=' || p.prosecdef, ' · ')
    from pg_proc p
   where p.oid in ('public.es_participante_de_reserva(uuid, uuid)'::regprocedure,
                   'public.es_organizador_de_reserva(uuid, uuid)'::regprocedure);
end $$;

select caso, ok, detalle from r173 order by caso;
do $$
declare v_mal int; v_total int;
begin
  select count(*) filter (where not ok), count(*) into v_mal, v_total from r173;
  if v_total < 33 then
    raise exception 'el arnes de la 173 no llego al final: % casos de 33', v_total;
  end if;
  if v_mal > 0 then
    raise exception '% caso(s) de la 173 fallaron (mira la tabla de arriba)', v_mal;
  end if;
end $$;

rollback;
