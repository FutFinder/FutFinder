-- =============================================================
-- FutFinder — pruebas de complejos, canchas reservables y
-- disponibilidad (migración 54).
--
-- QUÉ SE PRUEBA:
--   1-3. Lectura pública de `complejos`, `canchas_reservables` y
--        `cancha_horario_reglas` — cualquier autenticado las lee.
--   4. Un día sin reglas de horario devuelve `slots: []`, no un error.
--   5. Un día con reglas devuelve los slots esperados, todos
--      disponibles cuando no hay ninguna reserva 'confirmada'.
--   6. Una reserva 'confirmada' bloquea SOLO su slot puntual.
--   7. Una reserva 'armando' (o 'procesando') NO bloquea el slot — la
--      regla de negocio central del vertical: mientras el grupo se
--      arma, la cancha sigue disponible para otros.
--   8. Cancha inactiva → `ok:false`.
--   9. Cancha inexistente → `ok:false`.
--   10. El CHECK de `notifications.type` acepta los tipos nuevos del
--       vertical (si no, ninguna de las RPC de las migraciones 55-57
--       podría notificar nada).
--
-- Requiere las migraciones 54 a 57 aplicadas (esta función referencia
-- `public.reservas`, que crea la 55), o las cuatro corridas dentro de
-- la misma transacción que este arnés, en orden.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK: no queda
-- nada guardado. Si un caso falla, la ejecución se corta con
-- RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_user       uuid := gen_random_uuid();

  v_complejo   uuid := gen_random_uuid();
  v_cancha     uuid := gen_random_uuid();
  v_cancha_off uuid := gen_random_uuid(); -- inactiva

  -- Fecha fija de prueba: se ancla el día de la semana de las reglas de
  -- horario a esta fecha, así el arnés no depende del día en que se corre.
  v_fecha      date := date '2027-03-01'; -- lunes
  v_dow        int  := extract(dow from date '2027-03-01')::int;

  v_json       json;
  v_slots      json;
  v_n          int;
  v_disp       boolean;
  v_count      int;
  v_reserva_bloqueante uuid := gen_random_uuid();
  v_reserva_armando    uuid := gen_random_uuid();
begin
  -- ── Setup: un usuario, un complejo, una cancha activa y una inactiva ──
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'canchas-user-' || v_user || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
  );

  insert into public.complejos (id, nombre, comuna, latitud, longitud)
  values (v_complejo, 'Complejo Prueba 54', 'Ñuñoa', -33.45, -70.60);

  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values
    (v_cancha,     v_complejo, 'Cancha 1', 'futbol_7', 20000, 60, true),
    (v_cancha_off, v_complejo, 'Cancha 2', 'futbol_7', 20000, 60, false);

  -- Lunes 18:00-22:00 → 4 slots de 60 min.
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  values (v_cancha, v_dow, time '18:00', time '22:00');

  -- ── Actuar como un usuario autenticado cualquiera ────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);

  -- ── Caso 1-3: lectura pública ─────────────────────────────────────
  select count(*) into v_count from public.complejos where id = v_complejo;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 1): cualquier autenticado debería poder leer complejos';
  end if;
  raise notice 'OK (caso 1): complejos se lee públicamente';

  select count(*) into v_count from public.canchas_reservables where complejo_id = v_complejo;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 2): cualquier autenticado debería poder leer canchas_reservables, vio %', v_count;
  end if;
  raise notice 'OK (caso 2): canchas_reservables se lee públicamente';

  select count(*) into v_count from public.cancha_horario_reglas where cancha_id = v_cancha;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 3): cualquier autenticado debería poder leer cancha_horario_reglas';
  end if;
  raise notice 'OK (caso 3): cancha_horario_reglas se lee públicamente';

  -- ── Caso 4: día sin reglas de horario → slots vacíos, no error ────
  v_json := public.get_disponibilidad_cancha(v_cancha, v_fecha + 1); -- martes, sin regla
  if (v_json->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 4): un día sin reglas debería responder ok:true, respondió %', v_json;
  end if;
  if json_array_length(v_json->'slots') <> 0 then
    raise exception 'FALLÓ (caso 4): un día sin reglas debería devolver slots vacíos, devolvió %', v_json;
  end if;
  raise notice 'OK (caso 4): un día sin reglas de horario devuelve slots: []';

  -- ── Caso 5: día con reglas → 4 slots, todos disponibles ───────────
  v_json := public.get_disponibilidad_cancha(v_cancha, v_fecha);
  if (v_json->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 5): respuesta inesperada %', v_json;
  end if;
  v_slots := v_json->'slots';
  if json_array_length(v_slots) <> 4 then
    raise exception 'FALLÓ (caso 5): 18:00-22:00 en slots de 60 min debería dar 4 slots, dio %', json_array_length(v_slots);
  end if;
  for v_n in 0 .. 3 loop
    if ((v_slots->v_n)->>'disponible')::boolean is not true then
      raise exception 'FALLÓ (caso 5): el slot % debería estar disponible sin reservas, respuesta %', v_n, v_slots;
    end if;
  end loop;
  raise notice 'OK (caso 5): 4 slots de 60 min, todos disponibles sin reservas';

  -- ── Setup: una reserva 'confirmada' en el slot 19:00 ──────────────
  -- `reservas` no tiene policy de insert (todo pasa por las RPC de la
  -- migración 55): el fixture se escribe sin RLS y se retoma el rol
  -- autenticado después, para no romper el resto de las aserciones.
  reset role;
  insert into public.reservas (
    id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, modalidad, medio_pago, estado
  ) values (
    v_reserva_bloqueante, v_cancha, v_user, v_fecha, time '19:00', time '20:00',
    20000, 'completa', 'balance', 'confirmada'
  );
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);

  -- ── Caso 6: esa reserva confirmada bloquea SOLO su slot ───────────
  v_json := public.get_disponibilidad_cancha(v_cancha, v_fecha);
  v_slots := v_json->'slots';
  for v_n in 0 .. 3 loop
    v_disp := ((v_slots->v_n)->>'disponible')::boolean;
    if (v_slots->v_n)->>'hora_inicio' = '19:00' then
      if v_disp is not false then
        raise exception 'FALLÓ (caso 6): el slot 19:00 con reserva confirmada debería estar ocupado, slots=%', v_slots;
      end if;
    else
      if v_disp is not true then
        raise exception 'FALLÓ (caso 6): un slot sin reserva no debería bloquearse por la de otro horario, slots=%', v_slots;
      end if;
    end if;
  end loop;
  raise notice 'OK (caso 6): una reserva confirmada bloquea únicamente su propio slot';

  -- ── Setup: una reserva 'armando' en el slot 20:00 ─────────────────
  reset role;
  insert into public.reservas (
    id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, modalidad, medio_pago, estado
  ) values (
    v_reserva_armando, v_cancha, v_user, v_fecha, time '20:00', time '21:00',
    20000, 'capitanes', 'balance', 'armando'
  );
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);

  -- ── Caso 7: una reserva 'armando' NO bloquea el slot ──────────────
  v_json := public.get_disponibilidad_cancha(v_cancha, v_fecha);
  v_slots := v_json->'slots';
  for v_n in 0 .. 3 loop
    if (v_slots->v_n)->>'hora_inicio' = '20:00' then
      if ((v_slots->v_n)->>'disponible')::boolean is not true then
        raise exception 'FALLÓ (caso 7): una reserva "armando" no debería bloquear el slot (regla central del vertical), slots=%', v_slots;
      end if;
    end if;
  end loop;
  raise notice 'OK (caso 7): una reserva "armando" no bloquea el slot mientras el grupo se arma';

  -- ── Caso 8: cancha inactiva ────────────────────────────────────────
  v_json := public.get_disponibilidad_cancha(v_cancha_off, v_fecha);
  if (v_json->>'ok')::boolean is not false or (v_json->>'reason') <> 'Cancha no disponible' then
    raise exception 'FALLÓ (caso 8): una cancha inactiva debería responder ok:false/Cancha no disponible, respondió %', v_json;
  end if;
  raise notice 'OK (caso 8): una cancha inactiva no da disponibilidad';

  -- ── Caso 9: cancha inexistente ─────────────────────────────────────
  v_json := public.get_disponibilidad_cancha(gen_random_uuid(), v_fecha);
  if (v_json->>'ok')::boolean is not false or (v_json->>'reason') <> 'Cancha no existe' then
    raise exception 'FALLÓ (caso 9): una cancha inexistente debería responder Cancha no existe, respondió %', v_json;
  end if;
  raise notice 'OK (caso 9): una cancha inexistente responde Cancha no existe';

  -- ── Caso 10: el CHECK de notifications acepta los tipos nuevos ────
  -- `notifications` tampoco tiene policy de insert (solo escriben las
  -- RPC, SECURITY DEFINER): sin RLS para este insert directo de prueba.
  reset role;
  insert into public.notifications (user_id, type, title, body, data)
  values (v_user, 'reserva_confirmada', 'x', 'x', '{}'::jsonb);
  select count(*) into v_count from public.notifications where user_id = v_user and type = 'reserva_confirmada';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 10): el CHECK de notifications debería aceptar reserva_confirmada';
  end if;
  raise notice 'OK (caso 10): notifications acepta los tipos nuevos del vertical de Reservas';

  raise notice 'TODAS LAS PRUEBAS DE COMPLEJOS/CANCHAS/DISPONIBILIDAD PASARON';
end $$;

rollback;
