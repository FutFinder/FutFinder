-- =============================================================
-- FutFinder — pruebas de la migración 107.
--
-- EL CASO QUE IMPORTA: el organizador se equivoca al registrar la asistencia
-- y corrige. Antes eso le costaba puntos al JUGADOR: marcar ausente (−15) y
-- corregir a presente (+2) lo dejaba 13 abajo, y cada corrección siguiente
-- restaba más. Medido en producción: 80 → 65 → 67 → 52.
--
--   P1. Marcar ausente resta 15.
--   P2. Corregir a presente deja el +2 que corresponde, no el −13.
--   P3. Volver a ausente da EXACTAMENTE lo mismo que la primera vez.
--   P4. Repetir la misma marca no vuelve a mover nada.
--   P5. El contador de asistencias también vuelve atrás.
--   P6. Marcar presente de una vez suma 2.
--   P7. Un partido cancelado no registra asistencia…
--   P8. …y por lo tanto no le quita puntos a nadie.
--   P9. El historial guarda de qué partido viene cada movimiento.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r107 (caso text, ok boolean, detalle text);
grant all on r107 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_jug uuid := gen_random_uuid();
  v_otro uuid := gen_random_uuid();
  v_p uuid; v_pc uuid; v_res jsonb; v_t int; v_asis int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r107-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_jug, v_otro]) u;
  update public.profiles set trust_score = 80, asistencias_confirmadas = 0 where id in (v_jug, v_otro);

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r107 jugado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 day', 5, 5, 'abierto', 90, 'inmediata') returning id into v_p;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r107 cancelado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '2 days', 5, 5, 'abierto', 90, 'inmediata') returning id into v_pc;

  insert into public.attendees (id_partido, id_jugador, estado) values (v_p, v_jug, 'inscrito');
  insert into public.attendees (id_partido, id_jugador, estado) values (v_p, v_otro, 'inscrito');
  insert into public.attendees (id_partido, id_jugador, estado) values (v_pc, v_jug, 'inscrito');

  -- Los dos ya se jugaron. Se mueve la hora DESPUÉS de crearlos porque el
  -- trigger `trg_match_future_only` no deja crear un partido en el pasado.
  update public.matches set hora = now() - interval '2 hours' where id in (v_p, v_pc);
  update public.matches set estado = 'cancelado' where id = v_pc;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_org, 'role', 'authenticated')::text, true);

  perform public.save_match_attendance(v_p, jsonb_build_object(v_jug::text, 'ausente'));
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r107 values ('P1 marcar ausente resta 15', v_t = 65, '80 → ' || v_t);

  perform public.save_match_attendance(v_p, jsonb_build_object(v_jug::text, 'presente'));
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r107 values ('P2 corregir a presente deja el +2, no el −13', v_t = 82, '→ ' || v_t);

  perform public.save_match_attendance(v_p, jsonb_build_object(v_jug::text, 'ausente'));
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r107 values ('P3 volver a ausente da lo MISMO que la primera vez', v_t = 65, '→ ' || v_t);

  perform public.save_match_attendance(v_p, jsonb_build_object(v_jug::text, 'presente'));
  perform public.save_match_attendance(v_p, jsonb_build_object(v_jug::text, 'presente'));
  select trust_score, asistencias_confirmadas into v_t, v_asis from public.profiles where id = v_jug;
  insert into r107 values ('P4 repetir la misma marca no suma de nuevo', v_t = 82 and v_asis = 1,
    'puntaje ' || v_t || ', asistencias ' || v_asis);

  perform public.save_match_attendance(v_p, jsonb_build_object(v_jug::text, 'ausente'));
  select asistencias_confirmadas into v_asis from public.profiles where id = v_jug;
  insert into r107 values ('P5 el contador de asistencias también vuelve', v_asis = 0, v_asis::text);

  perform public.save_match_attendance(v_p, jsonb_build_object(v_otro::text, 'presente'));
  select trust_score into v_t from public.profiles where id = v_otro;
  insert into r107 values ('P6 marcar presente de una suma 2', v_t = 82, '80 → ' || v_t);

  v_res := public.save_match_attendance(v_pc, jsonb_build_object(v_jug::text, 'ausente'));
  insert into r107 values ('P7 un partido cancelado no registra asistencia',
    (v_res->>'ok') = 'false', v_res->>'reason');
  select trust_score into v_t from public.profiles where id = v_jug;
  insert into r107 values ('P8 y no le quita puntos a nadie', v_t = 65, v_t::text);

  reset role;
  insert into r107 values ('P9 el historial guarda de qué partido viene',
    (select count(*) from public.trust_score_history where user_id = v_jug and match_id = v_p) > 0,
    (select string_agg(change_amount::text, ' ' order by created_at)
       from public.trust_score_history where user_id = v_jug and match_id = v_p));
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r107 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r107;

rollback;
