-- =============================================================
-- FutFinder — pruebas de la migración 202 (del desafío a la cancha).
--
--   D1. Quien creó la propuesta anota una cancha de FutFinder; otro no puede,
--       y una cancha de un recinto sin aprobar no se acepta.
--   D2. `cancha_del_desafio` le dice al local que puede reservar y le muestra
--       la cancha elegida en la propuesta.
--   D3. Reservar escribe «cancha_reservada» en el chat del desafío.
--   D3b. Recién reservada, el local todavía no figura como pagado.
--   D4. El local paga su mitad: «mitad_pagada» y el aviso al capitán rival.
--   D5. El rival ve que le toca pagar, con el plazo a 15 min del pago local.
--   D6. Antes del plazo, el cron no suelta nada.
--   D7. Vencido el plazo, la cancha se suelta, el chat dice por qué y no se
--       cobró un peso.
--   D8. Se reserva de nuevo y pagan los dos: «reserva_confirmada», y el cron
--       no toca una confirmada.
--   D9. Alguien que no es de ningún club no ve nada.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r202 (caso text, ok boolean, detalle text);
grant all on r202 to authenticated;

do $$
declare
  v_jefe uuid := gen_random_uuid();
  v_rival uuid := gen_random_uuid();
  v_ajeno uuid := gen_random_uuid();
  v_local uuid; v_visita uuid; v_cancha uuid; v_cancha_mala uuid; v_cpl uuid := gen_random_uuid();
  v_cpl_malo uuid := gen_random_uuid();
  v_match uuid; v_ch uuid; v_prop uuid;
  v_res json; v_info json; v_rid uuid; v_rid2 uuid; v_fecha date; v_hora time; v_mitad int;
  mk text := left(replace(gen_random_uuid()::text, '-', ''), 8);
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r202-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_jefe, v_rival, v_ajeno]) u;

  insert into public.balance_movimientos (user_id, tipo, monto, metodo_carga)
  select u, 'carga', 500000, 'transferencia' from unnest(array[v_jefe, v_rival]) u;

  insert into public.clubs (nombre, slug, created_by)
  values ('Local 202 ' || mk, 'local-202-' || mk, v_jefe) returning id into v_local;
  insert into public.clubs (nombre, slug, created_by)
  values ('Visita 202 ' || mk, 'visita-202-' || mk, v_rival) returning id into v_visita;
  insert into public.club_members (club_id, user_id, rol) values (v_local, v_jefe, 'capitan')
  on conflict (club_id, user_id) do update set rol = 'capitan';
  insert into public.club_members (club_id, user_id, rol) values (v_visita, v_rival, 'capitan')
  on conflict (club_id, user_id) do update set rol = 'capitan';

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado, aprobado_futfinder)
  values (v_cpl, 'Recinto arnés 202', 'Ñuñoa', -33.45, -70.60, true, true);
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cpl, 'Cancha arnés 202', 'futbol_7', 20000, 60, true) returning id into v_cancha;
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '00:00', time '23:00' from generate_series(0, 6) as d;

  -- Un recinto publicado pero SIN aprobar: su cancha no sirve para anotar.
  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado, aprobado_futfinder)
  values (v_cpl_malo, 'Recinto sin aprobar 202', 'Ñuñoa', -33.45, -70.60, true, false);
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cpl_malo, 'Cancha sin aprobar', 'futbol_7', 20000, 60, true) returning id into v_cancha_mala;

  v_fecha := (now() at time zone 'America/Santiago')::date + 6;
  select (s->>'hora_inicio')::time into v_hora
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_fecha)->'slots') s
   where (s->>'disponible')::boolean limit 1;

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado, modalidad)
  values (v_local, v_visita, v_jefe, 'negociacion', 'futbol7') returning id into v_ch;

  insert into public.club_challenge_proposals (
      challenge_id, club_proponente_id, creada_por, fecha, duracion_min, direccion,
      cancha_nombre, comuna, region, latitud, longitud, modalidad, cupos_por_club,
      metodo_inscripcion, cuota_por_persona, estado)
  values (v_ch, v_local, v_jefe, (v_fecha + v_hora)::timestamptz, 60, 'Av. Arnés 202',
      'Cancha arnés 202', 'Ñuñoa', 'Región Metropolitana', -33.45, -70.60, 'futbol7', 7,
      'orden_llegada', 0, 'pendiente') returning id into v_prop;

  -- ── D1 ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_rival, 'role', 'authenticated')::text);
  v_res := public.anotar_cancha_de_la_propuesta(v_prop, v_cancha);
  insert into r202 values ('D1a otro no anota la cancha', not (v_res->>'ok')::boolean, v_res->>'reason');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  v_res := public.anotar_cancha_de_la_propuesta(v_prop, v_cancha_mala);
  insert into r202 values ('D1b recinto sin aprobar no se acepta', not (v_res->>'ok')::boolean, v_res->>'reason');
  v_res := public.anotar_cancha_de_la_propuesta(v_prop, v_cancha);
  insert into r202 values ('D1c quien la creó la anota', (v_res->>'ok')::boolean, v_res::text);
  reset role;

  -- El rival aprueba: se publica el partido (montado a mano, como la 100).
  update public.club_challenge_proposals set estado = 'aprobada' where id = v_prop;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, precio_cuota, estado, duracion_min, aprobacion,
      min_trust_score, club_local_id, club_visitante_id, challenge_id, challenge_proposal_id)
  values (v_jefe, 'prueba 202', 'Ñuñoa', 'Cancha', -33.45, -70.66,
      (v_fecha + v_hora)::timestamptz, 14, 14, 0, 'abierto', 60, 'inmediata', 0, v_local, v_visita, v_ch, v_prop)
  returning id into v_match;
  update public.club_challenges set estado = 'publicado', match_id = v_match where id = v_ch;

  -- ── D2 ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  v_info := public.cancha_del_desafio(v_ch);
  insert into r202 values ('D2 el local puede reservar y ve la cancha elegida',
    (v_info->>'soy_local')::boolean and (v_info->>'puedo_reservar')::boolean
      and (v_info->'cancha_elegida'->>'cancha_id')::uuid = v_cancha,
    v_info::text);

  -- ── D3 ──
  v_res := public.reservar_cancha_del_partido(v_match, v_cancha, v_fecha, v_hora, 'Prueba', '912345678');
  v_rid := (v_res->>'reserva_id')::uuid;
  select ceil(precio_total::numeric / 2)::int into v_mitad from public.reservas where id = v_rid;
  reset role;
  insert into r202 values ('D3 el chat dice que se reservó la cancha',
    exists (select 1 from public.club_challenge_events where challenge_id = v_ch and tipo = 'cancha_reservada'
              and payload->>'reserva_id' = v_rid::text), v_res::text);

  -- ── D3b: recién reservada, el local TODAVÍA no pagó ──
  -- El organizador nace 'aceptado' (creó la reserva): mirar el estado lo
  -- daba por pagado antes de poner un peso.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  v_info := public.cancha_del_desafio(v_ch);
  insert into r202 values ('D3b recién reservada, el local no figura como pagado',
    not (v_info->'reserva'->>'pago_local')::boolean, (v_info->'reserva')::text);

  -- ── D4 ──
  perform public.autorizar_cobro_reserva(v_rid, v_mitad);
  reset role;
  insert into r202 values ('D4a el chat dice que el local pagó su mitad',
    exists (select 1 from public.club_challenge_events where challenge_id = v_ch and tipo = 'mitad_pagada'
              and club_id = v_local), 'mitad_pagada');
  insert into r202 values ('D4b el capitán rival recibe el aviso de los 15 min',
    exists (select 1 from public.notifications where user_id = v_rival and type = 'reserva_recordatorio_pago'
              and data->>'reservaId' = v_rid::text and body like '%15 minutos%'), 'aviso');

  -- ── D5 ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_rival, 'role', 'authenticated')::text);
  v_info := public.cancha_del_desafio(v_ch);
  reset role;
  insert into r202 values ('D5 el rival ve que le toca pagar, con plazo de 15 min',
    (v_info->>'soy_capitan_rival')::boolean
      and (v_info->'reserva'->>'pago_local')::boolean
      and not (v_info->'reserva'->>'pago_rival')::boolean
      and abs(extract(epoch from ((v_info->'reserva'->>'plazo_at')::timestamptz - now())) - 900) < 60,
    v_info->'reserva'::text);

  -- ── D6 ──
  perform public.soltar_reservas_de_desafio_vencidas();
  insert into r202 values ('D6 antes del plazo no se suelta',
    (select estado from public.reservas where id = v_rid) = 'armando',
    (select estado from public.reservas where id = v_rid));

  -- ── D7 ──
  update public.reserva_participantes set autorizado_at = now() - interval '16 minutes'
   where reserva_id = v_rid and rol = 'organizador';
  perform public.soltar_reservas_de_desafio_vencidas();
  insert into r202 values ('D7a vencido el plazo se suelta',
    (select estado from public.reservas where id = v_rid) = 'cancelada',
    (select estado from public.reservas where id = v_rid));
  insert into r202 values ('D7b el chat dice que fue por el plazo',
    exists (select 1 from public.club_challenge_events where challenge_id = v_ch and tipo = 'cancha_soltada'
              and payload->>'motivo' = 'plazo'), 'cancha_soltada/plazo');
  insert into r202 values ('D7c no se cobró nada',
    not exists (select 1 from public.balance_movimientos where reserva_id = v_rid), 'sin movimientos');

  -- ── D8 ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jefe, 'role', 'authenticated')::text);
  v_info := public.cancha_del_desafio(v_ch);
  v_res := public.reservar_cancha_del_partido(v_match, v_cancha, v_fecha, v_hora, 'Prueba', '912345678');
  v_rid2 := (v_res->>'reserva_id')::uuid;
  perform public.autorizar_cobro_reserva(v_rid2, v_mitad);
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_rival, 'role', 'authenticated')::text);
  perform public.autorizar_cobro_reserva(v_rid2, v_mitad);
  reset role;
  perform public.soltar_reservas_de_desafio_vencidas();
  insert into r202 values ('D8a tras soltarse, se puede reservar de nuevo',
    (v_info->>'puedo_reservar')::boolean and v_rid2 is not null, v_res::text);
  insert into r202 values ('D8b pagan los dos: confirmada y el chat lo dice',
    (select estado from public.reservas where id = v_rid2) = 'confirmada'
      and exists (select 1 from public.club_challenge_events where challenge_id = v_ch and tipo = 'reserva_confirmada'),
    (select estado from public.reservas where id = v_rid2));

  -- ── D9 ──
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  v_info := public.cancha_del_desafio(v_ch);
  reset role;
  insert into r202 values ('D9 alguien ajeno no ve nada', not (v_info->>'ok')::boolean, v_info::text);
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, left(detalle, 160) as detalle from r202 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r202;

rollback;
