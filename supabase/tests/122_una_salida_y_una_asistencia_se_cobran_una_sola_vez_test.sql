-- =============================================================
-- FutFinder — pruebas de la migración 122 (N01–N04).
--
-- QUÉ PRUEBA ESTE ARCHIVO Y QUÉ NO. Acá corre UNA sola conexión, así que lo
-- que se comprueba es el estado que la concurrencia dejaba mal y el mecanismo
-- que ahora lo impide:
--
--   · Que de un partido cancelado o terminado no se pueda «salir» (N01).
--   · Que el segundo intento no vuelva a cobrar (N02): es la misma rama por la
--     que cae la sesión perdedora de una carrera, porque ahora la reclamación
--     de la inscripción ES el propio DELETE.
--   · Que la fila del partido quede BLOQUEADA aunque la salida se rechace
--     (el `xmax` de la fila es el xid de esta transacción): esa es la prueba
--     de que la decisión se toma bajo bloqueo y no antes de tomarlo.
--   · Que confirmar el GPS dos veces premie una sola vez (N03).
--   · Que guardar la asistencia dos veces deje el mismo puntaje (N04) y que
--     el partido quede bloqueado al hacerlo.
--
-- LA CARRERA DE VERDAD —dos conexiones, dos transacciones— está en
-- supabase/tests/partidos_salida_concurrente_test.cjs. Repetir llamadas una
-- después de otra NO reproduce N02–N04, y por eso existen las dos pruebas.
--
-- DOS JUGADORES A PROPÓSITO: el que se sale y el que confirma asistencia son
-- personas distintas para que ningún partido de prueba se superponga con otro
-- del mismo jugador. Si se superpusieran, la reprogramación de la 123 —que
-- mira la agenda de los inscritos— rechazaría las mismas líneas que arman el
-- escenario.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r122 (caso text, ok boolean, detalle text);
grant all on r122 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();   -- el que se sale
  v_otro uuid := gen_random_uuid();  -- el que confirma y al que le registran asistencia
  v_can uuid; v_fut uuid; v_lleno uuid; v_curso uuid; v_pasado uuid; v_jugado uuid;
  v_res jsonb; v_gps json; v_t int; v_asis int; v_estado text; v_cupos int;
  v_bloqueada boolean; v_n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r122-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_jug, v_otro]) u;
  update public.profiles set trust_score = 80, asistencias_confirmadas = 0
   where id in (v_jug, v_otro);

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r122 cancelado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '3 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_can;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r122 futuro', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '4 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_fut;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r122 lleno', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '5 days', 1, 1, 'abierto', 90, 'inmediata') returning id into v_lleno;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r122 en curso', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '6 days', 5, 5, 'abierto', 60, 'inmediata') returning id into v_curso;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r122 pasado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '7 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_pasado;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r122 jugado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '8 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_jugado;

  insert into public.attendees (id_partido, id_jugador, estado)
  select m, v_jug, 'inscrito' from unnest(array[v_can, v_fut, v_lleno, v_curso, v_pasado]) m;
  insert into public.attendees (id_partido, id_jugador, estado) values (v_jugado, v_otro, 'inscrito');

  -- El partido lleno se llena por la nómina, no a mano: la guarda de cupos
  -- (105) recalcula la disponibilidad y el estado desde los inscritos. Y
  -- ninguna inscripción se puede hacer sobre un partido ya sin cupos.
  update public.matches set cupos_disponibles = 0 where id = v_lleno;

  -- Las horas se mueven DESPUÉS de crear: `trg_match_future_only` no deja
  -- nacer un partido en el pasado. Ninguna de las dos se superpone con otra
  -- del mismo jugador.
  update public.matches set estado = 'cancelado' where id = v_can;
  update public.matches set hora = now() - interval '10 minutes', estado = 'en_curso' where id = v_curso;
  update public.matches set hora = now() - interval '5 hours' where id = v_pasado;
  update public.matches set hora = now() - interval '20 minutes' where id = v_jugado;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_jug, 'role', 'authenticated')::text, true);

  -- ── N01 ───────────────────────────────────────────────────────
  v_res := public.leave_match_penalized(v_can);
  insert into r122 values ('N01 a salir de un partido cancelado se le dice que no',
    (v_res->>'ok') = 'false', v_res::text);

  select estado into v_estado from public.matches where id = v_can;
  insert into r122 values ('N01 el partido cancelado NO revive', v_estado = 'cancelado', v_estado);

  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r122 values ('N01 no le cuesta puntos al jugador', v_t = 80, v_t::text);

  select count(*) into v_n from public.attendees where id_partido = v_can and id_jugador = v_jug;
  insert into r122 values ('N01 la inscripcion se conserva para el historial', v_n = 1, v_n::text);

  -- La decisión se tomó con la fila del partido bloqueada: su `xmax` quedó
  -- escrito por esta transacción aunque la salida se haya rechazado.
  select xmax::text::bigint <> 0 into v_bloqueada from public.matches where id = v_can;
  insert into r122 values ('N01/N02 el partido se bloquea ANTES de decidir',
    v_bloqueada, coalesce(v_bloqueada::text, 'null'));

  v_res := public.leave_match_penalized(v_pasado);
  insert into r122 values ('N01 de un partido terminado no se sale',
    (v_res->>'ok') = 'false', v_res::text);
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r122 values ('N01 y tampoco cobra los 20 puntos', v_t = 80, v_t::text);

  -- ── N02 ───────────────────────────────────────────────────────
  v_res := public.leave_match_penalized(v_fut);
  insert into r122 values ('N02 la salida legitima cobra 3',
    (v_res->>'ok') = 'true' and (v_res->>'penalty') = '3', v_res::text);
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r122 values ('N02 el puntaje baja UNA vez (80 a 77)', v_t = 77, v_t::text);

  v_res := public.leave_match_penalized(v_fut);
  insert into r122 values ('N02 el segundo intento no encuentra inscripcion',
    (v_res->>'ok') = 'false', v_res::text);
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r122 values ('N02 y NO vuelve a cobrar (sigue en 77)', v_t = 77, v_t::text);

  -- ── Reabrir es reabrir lo que estaba lleno ────────────────────
  v_res := public.leave_match_penalized(v_lleno);
  select estado, cupos_disponibles into v_estado, v_cupos from public.matches where id = v_lleno;
  insert into r122 values ('N01 salirse de un partido LLENO si lo reabre',
    (v_res->>'ok') = 'true' and v_estado = 'abierto' and v_cupos = 1,
    v_estado || ' / cupos ' || v_cupos);

  v_res := public.leave_match_penalized(v_curso);
  select estado into v_estado from public.matches where id = v_curso;
  insert into r122 values ('N01 un partido en curso no pasa a abierto al salirse',
    (v_res->>'ok') = 'true' and v_estado = 'en_curso', v_estado || ' / ' || v_res::text);

  -- ── N03 ───────────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_otro, 'role', 'authenticated')::text, true);

  v_gps := public.confirm_attendance_gps(v_jugado, -33.45, -70.66);
  insert into r122 values ('N03 la primera confirmacion por GPS entra',
    (v_gps->>'ok') = 'true' and (v_gps->>'already') is null, v_gps::text);

  v_gps := public.confirm_attendance_gps(v_jugado, -33.45, -70.66);
  insert into r122 values ('N03 la segunda dice que ya estaba confirmado',
    (v_gps->>'already') = 'true', v_gps::text);

  select trust_score, asistencias_confirmadas into v_t, v_asis from public.profiles where id = v_otro;
  insert into r122 values ('N03 un punto y una asistencia, no dos',
    v_t = 81 and v_asis = 1, 'puntaje ' || v_t || ', asistencias ' || v_asis);

  select count(*) into v_n from public.trust_score_history
   where user_id = v_otro and match_id = v_jugado and reason = 'Asistencia confirmada por GPS';
  insert into r122 values ('N03 un solo movimiento en el historial', v_n = 1, v_n::text);

  -- ── N04 ───────────────────────────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  update public.matches set hora = now() - interval '3 hours' where id = v_jugado;

  perform public.save_match_attendance(v_jugado, jsonb_build_object(v_otro::text, 'presente'));
  perform public.save_match_attendance(v_jugado, jsonb_build_object(v_otro::text, 'presente'));
  select trust_score, asistencias_confirmadas into v_t, v_asis from public.profiles where id = v_otro;
  insert into r122 values ('N04 dos guardados dejan 83 y una asistencia, no 85 y dos',
    v_t = 83 and v_asis = 1, 'puntaje ' || v_t || ', asistencias ' || v_asis);

  select xmax::text::bigint <> 0 into v_bloqueada from public.matches where id = v_jugado;
  insert into r122 values ('N04 la asistencia tambien bloquea el partido', v_bloqueada,
    coalesce(v_bloqueada::text, 'null'));

  reset role;
end $$;

reset role;

-- Que el resumen no se pueda leer en diagonal: si algo falló, esto revienta.
do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r122 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r122 where not ok;
    raise exception 'FALLARON % casos de la 122: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r122 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r122;

rollback;
