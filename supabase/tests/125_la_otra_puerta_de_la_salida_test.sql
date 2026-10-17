-- =============================================================
-- FutFinder — pruebas de la migración 125.
--
-- Son N01 y N02 comprobados en la OTRA puerta, la del cambio de partido:
--
--   S1  Cambiarse desde un partido cancelado se rechaza…
--   S2  …sin revivirlo y sin cobrarle nada al jugador.
--   S3  El cambio legítimo cobra UNA sola vez lo que diga la regla.
--   S4  Repetirlo cuando ya no estás en el origen no vuelve a cobrar (es la
--       misma rama por la que cae la sesión perdedora de una carrera).
--   S5  «Cancelar y cambiarme» sobre un partido ya cancelado se rechaza…
--   S6  …sin volver a cobrar lo del anfitrión.
--   S7  Y el legítimo sí lo cobra, una vez, cancelando el partido (la 127
--       cambió ese borrado por una cancelación).
--   S8  El partido de origen queda bloqueado aunque la operación se rechace.
--
-- La carrera con dos conexiones vive en partidos_salida_concurrente_test.cjs.
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r125 (caso text, ok boolean, detalle text);
grant all on r125 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();   -- organiza los destinos
  v_jug uuid := gen_random_uuid();   -- el que se cambia
  v_cancelado uuid; v_origen uuid; v_d1 uuid; v_d2 uuid; v_d3 uuid;
  v_mio_cancelado uuid; v_mio_vivo uuid;
  v_res jsonb; v_t int; v_estado text; v_n int; v_bloqueada boolean;
  -- Para medir sin clavar los números: ver la nota de la cabecera.
  v_antes int; v_pen int;
  v_base timestamptz := date_trunc('hour', now());
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r125-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_jug]) u;
  update public.profiles set trust_score = 80 where id = v_jug;

  -- Un partido por día para que ninguna agenda choque con otra.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r125 origen cancelado', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '3 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_cancelado;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r125 origen vivo', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '4 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_origen;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r125 destino 1', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '5 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_d1;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r125 destino 2', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '6 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_d2;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r125 destino 3', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '9 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_d3;

  -- Los dos partidos que organiza el propio jugador, para la variante del
  -- anfitrión. El trigger lo inscribe solo.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_jug, 'r125 mio cancelado', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '7 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_mio_cancelado;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_jug, 'r125 mio vivo', 'Santiago', 'Cancha', -33.45, -70.66,
      v_base + interval '8 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_mio_vivo;

  insert into public.attendees (id_partido, id_jugador, estado)
  select m, v_jug, 'inscrito' from unnest(array[v_cancelado, v_origen]) m;

  update public.matches set estado = 'cancelado' where id in (v_cancelado, v_mio_cancelado);

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_jug, 'role', 'authenticated')::text, true);

  -- ── S1 y S2 ───────────────────────────────────────────────────
  v_res := public.swap_match(v_cancelado, v_d1);
  insert into r125 values ('S1 cambiarse desde un partido cancelado se rechaza',
    (v_res->>'ok') = 'false', v_res::text);

  select estado into v_estado from public.matches where id = v_cancelado;
  insert into r125 values ('S2 el partido cancelado NO revive', v_estado = 'cancelado', v_estado);
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r125 values ('S2 y no le cuesta puntos', v_t = 80, v_t::text);
  select count(*) into v_n from public.attendees where id_partido = v_d1 and id_jugador = v_jug;
  insert into r125 values ('S2 tampoco lo inscribe a medias en el destino', v_n = 0, v_n::text);

  -- ── S8, el bloqueo ────────────────────────────────────────────
  select xmax::text::bigint <> 0 into v_bloqueada from public.matches where id = v_cancelado;
  insert into r125 values ('S8 el partido de origen se bloquea antes de decidir',
    v_bloqueada, coalesce(v_bloqueada::text, 'null'));

  -- ── S3 ────────────────────────────────────────────────────────
  -- LOS NÚMEROS SE MIDEN, NO SE CLAVAN (2026-10-17). Acá decía «cobra 3» y
  -- «80 a 77», que era la regla hasta las migraciones 134-137. Con TrueScore
  -- —encendido en producción desde el 2026-09-24— la salida cuesta según las
  -- horas de aviso. Lo que esta migración promete es que se cobre UNA SOLA
  -- VEZ, así que se compara el puntaje contra lo que la propia RPC dice
  -- haber cobrado.
  select trust_score into v_antes from public.profiles where id = v_jug;
  v_res := public.swap_match(v_origen, v_d1);
  v_pen := coalesce((v_res->>'penalty')::int, -1);
  insert into r125 values ('S3 el cambio legitimo se acepta y cobra algo',
    (v_res->>'ok') = 'true' and v_pen > 0, v_res::text);
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r125 values ('S3 el puntaje baja UNA vez, exactamente lo cobrado',
    v_t = v_antes - v_pen, v_antes || ' -> ' || v_t || ', cobrado ' || v_pen);
  select count(*) into v_n from public.attendees where id_partido = v_d1 and id_jugador = v_jug;
  insert into r125 values ('S3 y queda inscrito en el destino', v_n = 1, v_n::text);

  -- ── S4 ────────────────────────────────────────────────────────
  v_res := public.swap_match(v_origen, v_d2);
  insert into r125 values ('S4 sin inscripcion que soltar, no cobra',
    (v_res->>'ok') = 'true' and (v_res->>'penalty') = '0', v_res::text);
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r125 values ('S4 el puntaje no se movio', v_t = v_antes - v_pen, v_t::text);

  -- ── S5 y S6 ───────────────────────────────────────────────────
  v_res := public.cancel_match_and_join(v_mio_cancelado, v_d3);
  insert into r125 values ('S5 cancelar y cambiarse sobre un cancelado se rechaza',
    (v_res->>'ok') = 'false', v_res::text);
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r125 values ('S6 y no vuelve a cobrar nada', v_t = v_antes - v_pen, v_t::text);
  select count(*) into v_n from public.matches where id = v_mio_cancelado;
  insert into r125 values ('S6 el partido cancelado sigue existiendo', v_n = 1, v_n::text);

  -- ── S7 ────────────────────────────────────────────────────────
  -- LO QUE CUESTA CANCELAR LO DICE LA REGLA, no este archivo. Acá estaba
  -- clavado en 25 y «77 a 52»; con TrueScore el anfitrión que avisa con 12 h
  -- o más no paga nada, y con menos paga según la tabla. Se le pregunta a la
  -- propia función ANTES de cancelar y se compara con eso: el caso sigue
  -- cazando un cobro doble, que es lo suyo, sin romperse cada vez que se
  -- ajusta la tabla.
  select coalesce((public.truescore_costo_salida(v_mio_vivo, 'otro')->>'puntos')::int, 0)
    into v_pen;
  select trust_score into v_antes from public.profiles where id = v_jug;

  v_res := public.cancel_match_and_join(v_mio_vivo, v_d3);
  insert into r125 values ('S7 el legitimo si cancela y cambia',
    (v_res->>'ok') = 'true', v_res::text);
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r125 values ('S7 y cobra UNA vez lo que dice la regla',
    v_t = v_antes - v_pen,
    v_antes || ' -> ' || v_t || ', la regla dice ' || v_pen);
  -- Desde la 127 el partido viejo se CANCELA, no se borra: su gente lo
  -- conserva en el historial y el aviso que reciben apunta a algo que existe.
  select count(*) into v_n from public.matches where id = v_mio_vivo and estado = 'cancelado';
  insert into r125 values ('S7 el partido viejo queda cancelado, no borrado', v_n = 1, v_n::text);

  reset role;
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r125 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r125 where not ok;
    raise exception 'FALLARON % casos de la 125: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r125 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r125;

rollback;
