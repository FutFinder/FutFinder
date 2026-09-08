-- =============================================================
-- FutFinder — pruebas de la migración 61 (el recinto lee sus reservas).
--
-- QUÉ SE PRUEBA:
--   Autorización
--   1.  Un ajeno no puede pedir la agenda de un complejo.
--   2.  El dueño sí puede.
--   3.  Un `admin` (no dueño) también.
--   4.  La agenda NO trae reservas de otro complejo.
--   5.  `admin_reserva_detalle` de una reserva ajena se rechaza.
--
--   Privacidad (el recorte deliberado de la migración)
--   6.  La agenda trae el `username` del organizador.
--   7.  La agenda NO trae la lista de participantes: solo los agregados.
--
--   Contenido
--   8.  El resumen cuenta confirmadas, en curso, canceladas y bloqueos.
--   9.  `monto_confirmado` suma solo lo confirmado.
--   10. La agenda excluye 'vencida' y 'rechazada'.
--
--   Calendario, y la regla central del vertical
--   11. Un bloque con reserva confirmada sale 'reservada'.
--   12. Un bloque bloqueado sale 'bloqueada'.
--   13. Un bloque con un grupo 'armando' sale 'libre' con
--       grupos_en_curso = 1 — la reserva no confirmada NO ocupa la hora.
--   14. El bloqueo gana sobre la reserva cuando se solapan.
--   15. Una reserva de 90 min ocupa los dos bloques de 60 que pisa.
--
--   Privilegios
--   16. `anon` no puede ejecutar ninguna de las tres funciones.
--
-- Requiere las migraciones 54 a 61 aplicadas.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_ajeno    uuid := gen_random_uuid();
  v_jugador  uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_otro_cpl uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_otra_ch  uuid := gen_random_uuid();
  v_res_conf uuid := gen_random_uuid();
  v_res_arm  uuid := gen_random_uuid();
  v_res_venc uuid := gen_random_uuid();
  v_res_larga uuid := gen_random_uuid();
  v_res_otro uuid := gen_random_uuid();
  v_fecha    date := date '2027-03-01';
  v_rechazado boolean;
  v_j        json;
  v_txt      text;
  v_n        integer;
begin
  -- ── Montaje ────────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r61-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_admin, v_ajeno, v_jugador]) as u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud) values
    (v_complejo, 'Complejo 61', 'Ñuñoa', -33.45, -70.60),
    (v_otro_cpl, 'Complejo Ajeno 61', 'Maipú', -33.51, -70.76);

  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa) values
    (v_cancha,  v_complejo, 'Cancha 1', 'futbol_7', 20000, 60, true),
    (v_otra_ch, v_otro_cpl, 'Cancha Ajena', 'futbol_7', 20000, 60, true);

  -- Una cancha inactiva más, para el contador de activas/total.
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora, activa)
  values (v_complejo, 'Cancha Apagada', 'futbol_5', 15000, false);

  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '09:00', time '23:00' from generate_series(0, 6) as d;
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_otra_ch, d, time '09:00', time '23:00' from generate_series(0, 6) as d;

  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, v_dueno, 'dueño');
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, v_admin, 'admin');

  -- Reserva CONFIRMADA a las 10:00
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_res_conf, v_cancha, v_jugador, v_fecha, time '10:00', time '11:00',
          20000, 'completa', 'tarjeta', 'confirmada');

  -- Reserva ARMANDO a las 12:00, dividida entre 10, con 8 aceptados.
  -- Esta NO ocupa el horario: es la regla central del vertical.
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_res_arm, v_cancha, v_jugador, v_fecha, time '12:00', time '13:00',
          20000, 'jugadores', 'balance', 10, 2000, 'armando');
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
  values (v_res_arm, v_jugador, 'organizador', 'aceptado');
  -- 7 aceptados más (8 en total) y 2 pendientes, sin crear 9 usuarios:
  -- se usan los otros perfiles que ya existen y perfiles nuevos mínimos.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         'r61-p' || g || '-' || gen_random_uuid() || '@futfinder.test', 'x', now(), now(), now(),
         '{}', '{}', '', '', '', ''
    from generate_series(1, 9) as g;

  insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
  select v_res_arm, u.id, 'jugador',
         case when row_number() over (order by u.email) <= 7 then 'aceptado' else 'pendiente' end
    from auth.users u
   where u.email like 'r61-p%@futfinder.test';

  -- Reserva VENCIDA a las 14:00 — no debe salir en la agenda
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_res_venc, v_cancha, v_jugador, v_fecha, time '14:00', time '15:00',
          20000, 'completa', 'tarjeta', 'vencida');

  -- Reserva de 90 min a las 16:00 en una cancha de bloques de 60:
  -- tiene que ocupar 16:00 y 17:00.
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_res_larga, v_cancha, v_jugador, v_fecha, time '16:00', time '17:30',
          30000, 'completa', 'tarjeta', 'confirmada');

  -- Reserva del OTRO complejo — nunca debe aparecer
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_res_otro, v_otra_ch, v_jugador, v_fecha, time '10:00', time '11:00',
          20000, 'completa', 'tarjeta', 'confirmada');

  -- Bloqueo de 20:00 a 21:00
  insert into public.cancha_bloqueos (cancha_id, fecha, hora_inicio, hora_fin, motivo, creado_por)
  values (v_cancha, v_fecha, time '20:00', time '21:00', 'Mantención', v_dueno);

  -- ── Caso 1: un ajeno no pide la agenda ─────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    perform public.admin_agenda_complejo(v_complejo, v_fecha);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 1): un ajeno no debería poder pedir la agenda';
  end if;
  raise notice 'OK (caso 1)';

  -- ── Casos 2, 6-10: el dueño pide la agenda ─────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_j := public.admin_agenda_complejo(v_complejo, v_fecha);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 2): el dueño debería poder pedir la agenda';
  end if;
  raise notice 'OK (caso 2)';

  -- Caso 6: username del organizador presente
  select r->>'organizador_username' into v_txt
    from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_res_conf::text;
  if v_txt is null or length(v_txt) = 0 then
    raise exception 'FALLÓ (caso 6): falta el username del organizador';
  end if;
  raise notice 'OK (caso 6): username presente (%)', v_txt;

  -- Caso 7: agregados sí, lista de participantes no
  select r::text into v_txt
    from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_res_arm::text;
  if v_txt is null then
    raise exception 'FALLÓ (caso 7): no vino la reserva en curso';
  end if;
  if v_txt like '%participantes"%' or v_txt like '%"jugadores":[%' then
    raise exception 'FALLÓ (caso 7): la agenda no debe traer la lista de participantes';
  end if;
  select (r->>'participantes_aceptados')::int into v_n
    from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_res_arm::text;
  if v_n <> 8 then
    raise exception 'FALLÓ (caso 7): esperaba 8 aceptados, vinieron %', v_n;
  end if;
  select (r->>'participantes_total')::int into v_n
    from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_res_arm::text;
  if v_n <> 10 then
    raise exception 'FALLÓ (caso 7): esperaba 10 participantes, vinieron %', v_n;
  end if;
  raise notice 'OK (caso 7): 8 de 10, sin identidades';

  -- Caso 8: contadores del resumen
  if (v_j->'resumen'->>'reservas_confirmadas')::int <> 2 then
    raise exception 'FALLÓ (caso 8): esperaba 2 confirmadas, dice %', v_j->'resumen'->>'reservas_confirmadas';
  end if;
  if (v_j->'resumen'->>'reservas_en_curso')::int <> 1 then
    raise exception 'FALLÓ (caso 8): esperaba 1 en curso, dice %', v_j->'resumen'->>'reservas_en_curso';
  end if;
  if (v_j->'resumen'->>'bloqueos')::int <> 1 then
    raise exception 'FALLÓ (caso 8): esperaba 1 bloqueo, dice %', v_j->'resumen'->>'bloqueos';
  end if;
  if (v_j->'resumen'->>'canchas_activas')::int <> 1 or (v_j->'resumen'->>'canchas_total')::int <> 2 then
    raise exception 'FALLÓ (caso 8): canchas activas/total mal: % de %',
      v_j->'resumen'->>'canchas_activas', v_j->'resumen'->>'canchas_total';
  end if;
  raise notice 'OK (caso 8)';

  -- Caso 9: monto_confirmado suma solo confirmadas (20.000 + 30.000)
  if (v_j->'resumen'->>'monto_confirmado')::int <> 50000 then
    raise exception 'FALLÓ (caso 9): esperaba 50000, dice %', v_j->'resumen'->>'monto_confirmado';
  end if;
  raise notice 'OK (caso 9)';

  -- Caso 10: la vencida no aparece
  select count(*) into v_n from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_res_venc::text;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 10): una reserva vencida no debería salir en la agenda';
  end if;
  raise notice 'OK (caso 10)';

  -- Caso 4: nada del otro complejo
  select count(*) into v_n from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_res_otro::text;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 4): apareció una reserva de otro complejo';
  end if;
  raise notice 'OK (caso 4)';

  -- ── Caso 3: un admin (no dueño) también ────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin, 'role', 'authenticated')::text);
  v_j := public.admin_agenda_complejo(v_complejo, v_fecha);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 3): un admin debería poder pedir la agenda';
  end if;
  raise notice 'OK (caso 3)';

  -- ── Casos 11-15: el calendario de la cancha ────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_j := public.admin_calendario_cancha(v_cancha, v_fecha);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 11): el calendario debería responder ok';
  end if;

  -- Caso 11: 10:00 reservada
  select s->>'estado' into v_txt from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '10:00';
  if v_txt <> 'reservada' then
    raise exception 'FALLÓ (caso 11): 10:00 debería estar reservada, dice %', v_txt;
  end if;
  select s->'reserva'->>'organizador_username' into v_txt
    from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '10:00';
  if v_txt is null then
    raise exception 'FALLÓ (caso 11): el bloque reservado debería traer el username';
  end if;
  raise notice 'OK (caso 11)';

  -- Caso 12: 20:00 bloqueada, con motivo
  select s->>'estado' into v_txt from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '20:00';
  if v_txt <> 'bloqueada' then
    raise exception 'FALLÓ (caso 12): 20:00 debería estar bloqueada, dice %', v_txt;
  end if;
  select s->'bloqueo'->>'motivo' into v_txt
    from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '20:00';
  if v_txt <> 'Mantención' then
    raise exception 'FALLÓ (caso 12): esperaba el motivo, vino %', v_txt;
  end if;
  raise notice 'OK (caso 12)';

  -- Caso 13: LA REGLA CENTRAL. 12:00 tiene un grupo armando y sigue LIBRE.
  select s->>'estado' into v_txt from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '12:00';
  if v_txt <> 'libre' then
    raise exception 'FALLÓ (caso 13): una reserva sin confirmar NO ocupa el bloque; 12:00 dice %', v_txt;
  end if;
  select (s->>'grupos_en_curso')::int into v_n
    from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '12:00';
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 13): esperaba grupos_en_curso = 1, dice %', v_n;
  end if;
  raise notice 'OK (caso 13): el bloque con un grupo armando sigue libre';

  -- Caso 15: la reserva de 90 min ocupa 16:00 y 17:00
  select s->>'estado' into v_txt from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '16:00';
  if v_txt <> 'reservada' then
    raise exception 'FALLÓ (caso 15): 16:00 debería estar reservada, dice %', v_txt;
  end if;
  select s->>'estado' into v_txt from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '17:00';
  if v_txt <> 'reservada' then
    raise exception 'FALLÓ (caso 15): 17:00 también lo pisa una reserva de 90 min, dice %', v_txt;
  end if;
  raise notice 'OK (caso 15): una reserva de 90 min ocupa los dos bloques de 60';

  -- Caso 14: el bloqueo gana sobre la reserva cuando se solapan
  insert into public.cancha_bloqueos (cancha_id, fecha, hora_inicio, hora_fin, motivo, creado_por)
  values (v_cancha, v_fecha, time '10:00', time '11:00', 'Encima de la reserva', v_dueno);
  v_j := public.admin_calendario_cancha(v_cancha, v_fecha);
  select s->>'estado' into v_txt from json_array_elements(v_j->'slots') s where s->>'hora_inicio' = '10:00';
  if v_txt <> 'bloqueada' then
    raise exception 'FALLÓ (caso 14): el bloqueo debería ganar sobre la reserva, dice %', v_txt;
  end if;
  raise notice 'OK (caso 14)';

  -- ── Caso 5: detalle de una reserva ─────────────────────────────
  v_j := public.admin_reserva_detalle(v_res_arm);
  if (v_j->>'ok')::boolean is not true or (v_j->>'participantes_aceptados')::int <> 8 then
    raise exception 'FALLÓ (caso 5): el detalle debería traer 8 aceptados, trajo %', v_j::text;
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    perform public.admin_reserva_detalle(v_res_conf);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 5): un ajeno no debería ver el detalle';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  begin
    perform public.admin_reserva_detalle(v_res_otro);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 5): no debería ver el detalle de una reserva de otro complejo';
  end if;
  raise notice 'OK (caso 5)';

  -- ── Caso 16: anon no ejecuta nada ──────────────────────────────
  execute format('set local role anon');
  begin
    perform public.admin_agenda_complejo(v_complejo, v_fecha);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 16a): anon no debería ejecutar admin_agenda_complejo';
  end if;
  begin
    perform public.admin_calendario_cancha(v_cancha, v_fecha);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 16b): anon no debería ejecutar admin_calendario_cancha';
  end if;
  begin
    perform public.admin_reserva_detalle(v_res_conf);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 16c): anon no debería ejecutar admin_reserva_detalle';
  end if;
  execute 'reset role';
  raise notice 'OK (caso 16)';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 61 PASARON ===';
end $$;

rollback;
