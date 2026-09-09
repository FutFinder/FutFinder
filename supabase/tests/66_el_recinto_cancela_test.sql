-- =============================================================
-- FutFinder — pruebas de la migración 66 (el recinto cancela, ve sus
-- próximas y corrige un bloqueo).
--
-- QUÉ SE PRUEBA:
--   La hora de Chile
--   1.  `inicio_de_reserva` NO interpreta la hora como UTC: un partido a
--       las 20:00 en Chile cae 3 o 4 horas más tarde en UTC según la
--       época del año. Es el defecto que arrastra `cancelar_reserva`.
--
--   El recinto cancela
--   2.  Un ajeno no puede cancelar.
--   3.  Sin motivo, o con un motivo de dos palabras, se rechaza.
--   4.  El dueño cancela una confirmada y queda 'cancelada'.
--   5.  La devolución vuelve a CADA persona que puso plata, no al
--       organizador.
--   6.  Le llega aviso al organizador Y a cada participante aceptado.
--   7.  La comisión NO se borra, pero deja de sumar en el resumen.
--   8.  Una reserva ya empezada no se puede cancelar.
--   9.  Una ya cancelada tampoco.
--   10. Una 'armando' SÍ se puede, y devuelve lo que ya se había cobrado.
--
--   Las próximas del recinto
--   11. Solo confirmadas y solo futuras.
--   12. `total` cuenta TODAS aunque el límite recorte la lista.
--   13. No trae reservas de otro complejo.
--   14. Trae el desglose de comisión.
--
--   Corregir un bloqueo
--   15. El dueño lo mueve.
--   16. Moverlo encima de una reserva confirmada se rechaza.
--
--   Privilegios
--   17. `anon` no ejecuta ninguna de las tres.
--
-- Requiere las migraciones 54 a 66 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_org      uuid := gen_random_uuid();
  v_amigo    uuid := gen_random_uuid();
  v_ajeno    uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_otro_cpl uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_otra_ch  uuid := gen_random_uuid();
  v_futura   uuid := gen_random_uuid();
  v_pasada   uuid := gen_random_uuid();
  v_armando  uuid := gen_random_uuid();
  v_ajena    uuid := gen_random_uuid();
  v_bloqueo  uuid;
  v_manana   date := (now() at time zone 'America/Santiago')::date + 30;
  v_ayer     date := (now() at time zone 'America/Santiago')::date - 5;
  v_desfase  interval;
  v_j        json;
  v_n        integer;
  v_rechazado boolean;
begin
  -- ── Caso 1: la conversión de hora ──────────────────────────────
  -- Se comprueba el DESFASE, no un valor fijo: Chile cambia de hora y
  -- fijar 3 horas haría fallar la prueba media parte del año.
  v_desfase := public.inicio_de_reserva(date '2027-03-08', time '20:00')
               - (date '2027-03-08' + time '20:00') at time zone 'UTC';
  if v_desfase < interval '3 hours' or v_desfase > interval '4 hours' then
    raise exception 'FALLÓ (caso 1): el desfase con UTC debería ser de 3 o 4 horas, es %', v_desfase;
  end if;
  raise notice 'OK (caso 1): la hora se interpreta en Chile, desfase %', v_desfase;

  -- ── Montaje ────────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r66-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_org, v_amigo, v_ajeno]) as u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado) values
    (v_complejo, 'Cancela 66', 'Maipú', -33.53, -70.76, true),
    (v_otro_cpl, 'Ajeno 66', 'Ñuñoa', -33.45, -70.60, true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa) values
    (v_cancha,  v_complejo, 'Cancha 1', 'futbol_7', 28000, 60, true),
    (v_otra_ch, v_otro_cpl, 'Cancha X', 'futbol_7', 28000, 60, true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select c, d, time '11:00', time '22:00'
    from unnest(array[v_cancha, v_otra_ch]) as c, generate_series(0, 6) as d;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, v_dueno, 'dueño');

  -- Confirmada futura, pago dividido entre dos que ya pagaron.
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_futura, v_cancha, v_org, v_manana, time '20:00', time '21:00',
          28000, 'jugadores', 'balance', 2, 14000, 'confirmada');
  insert into public.reserva_comisiones (reserva_id, base, tasa, piso, techo, iva_tasa, monto)
  values (v_futura, 28000, 0.05, 1000, 2500, 0.19, 1400);
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado) values
    (v_futura, v_org,   'organizador', 'aceptado'),
    (v_futura, v_amigo, 'jugador',     'aceptado');
  insert into public.balance_movimientos (user_id, tipo, monto, reserva_id) values
    (v_org,   'cobro_reserva', -14000, v_futura),
    (v_amigo, 'cobro_reserva', -14000, v_futura);

  -- ── Casos 2-3: quién y con qué motivo ──────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    perform public.admin_cancelar_reserva(v_futura, 'Se cortó la luz del sector completo');
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 2): un ajeno no debería poder cancelar';
  end if;
  raise notice 'OK (caso 2)';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  begin
    perform public.admin_cancelar_reserva(v_futura, null);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 3): sin motivo no debería cancelarse';
  end if;
  begin
    perform public.admin_cancelar_reserva(v_futura, 'lluvia');
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 3): un motivo de una palabra no sirve, el jugador solo lee eso';
  end if;
  raise notice 'OK (caso 3)';

  -- ── Casos 4-7: la cancelación de verdad ────────────────────────
  v_j := public.admin_cancelar_reserva(v_futura, 'Se cortó la luz del sector y la cancha no tiene iluminación');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 4): %', v_j::text;
  end if;
  if (v_j->>'devuelto')::int <> 28000 then
    raise exception 'FALLÓ (caso 5): debería devolver los 28.000 completos, devolvió %', v_j->>'devuelto';
  end if;

  if (select estado from public.reservas where id = v_futura) <> 'cancelada' then
    raise exception 'FALLÓ (caso 4): la reserva no quedó cancelada';
  end if;
  raise notice 'OK (caso 4)';

  -- Caso 5: cada uno recibe lo SUYO, no el organizador todo
  select count(*) into v_n from public.balance_movimientos
   where reserva_id = v_futura and tipo = 'devolucion_cancelacion';
  if v_n <> 2 then
    raise exception 'FALLÓ (caso 5): esperaba 2 devoluciones (una por persona), hay %', v_n;
  end if;
  if not exists (select 1 from public.balance_movimientos
                  where reserva_id = v_futura and tipo = 'devolucion_cancelacion'
                    and user_id = v_amigo and monto = 14000) then
    raise exception 'FALLÓ (caso 5): al amigo no le volvieron sus 14.000';
  end if;
  raise notice 'OK (caso 5): la devolución vuelve a cada persona que puso plata';

  -- Caso 6: aviso al organizador y al participante aceptado
  select count(*) into v_n from public.notifications
   where type = 'reserva_cancelada'
     and (data->>'reservaId') = v_futura::text
     and user_id in (v_org, v_amigo);
  if v_n <> 2 then
    raise exception 'FALLÓ (caso 6): esperaba avisar a los 2, avisó a %', v_n;
  end if;
  if not exists (select 1 from public.notifications
                  where (data->>'reservaId') = v_futura::text
                    and body like '%no tiene iluminación%') then
    raise exception 'FALLÓ (caso 6): el motivo del recinto no llegó en el aviso';
  end if;
  raise notice 'OK (caso 6): avisa a todos los que perdieron la hora, con el motivo';

  -- Caso 7: la comisión sigue ahí pero no suma
  if not exists (select 1 from public.reserva_comisiones where reserva_id = v_futura and monto = 1400) then
    raise exception 'FALLÓ (caso 7): la comisión congelada no debería borrarse';
  end if;
  v_j := public.admin_agenda_complejo(v_complejo, v_manana);
  if (v_j->'resumen'->>'comision_confirmada')::int <> 0 then
    raise exception 'FALLÓ (caso 7): una cancelada no debe sumar comisión, el resumen dice %',
      v_j->'resumen'->>'comision_confirmada';
  end if;
  raise notice 'OK (caso 7): la comisión queda congelada y deja de sumar';

  -- ── Caso 9: no se cancela dos veces ────────────────────────────
  begin
    perform public.admin_cancelar_reserva(v_futura, 'Otro motivo cualquiera bien largo');
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 9): una reserva ya cancelada no debería cancelarse de nuevo';
  end if;
  raise notice 'OK (caso 9)';

  -- ── Caso 8: un partido ya jugado no se cancela ─────────────────
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_pasada, v_cancha, v_org, v_ayer, time '20:00', time '21:00',
          28000, 'completa', 'tarjeta', 'confirmada');
  begin
    perform public.admin_cancelar_reserva(v_pasada, 'Motivo suficientemente largo para pasar');
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 8): un partido que ya empezó no se puede cancelar';
  end if;
  raise notice 'OK (caso 8)';

  -- ── Caso 10: una 'armando' sí, y devuelve lo cobrado ───────────
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, n_jugadores, cuota, estado)
  values (v_armando, v_cancha, v_org, v_manana, time '18:00', time '19:00',
          28000, 'jugadores', 'balance', 4, 7000, 'armando');
  insert into public.balance_movimientos (user_id, tipo, monto, reserva_id)
  values (v_org, 'cobro_reserva', -7000, v_armando);

  v_j := public.admin_cancelar_reserva(v_armando, 'Vamos a resembrar el pasto esa semana completa');
  if (v_j->>'devuelto')::int <> 7000 then
    raise exception 'FALLÓ (caso 10): un grupo a medio armar YA puso plata; devolvió %', v_j->>'devuelto';
  end if;
  raise notice 'OK (caso 10): se cancela una sin confirmar y se devuelve lo ya cobrado';

  -- ── Casos 11-14: las próximas del recinto ──────────────────────
  -- Tres confirmadas futuras más una pasada y una de otro complejo.
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  select v_cancha, v_org, v_manana + g, time '19:00', time '20:00',
         28000, 'completa', 'tarjeta', 'confirmada'
    from generate_series(1, 3) as g;
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_ajena, v_otra_ch, v_org, v_manana, time '19:00', time '20:00',
          28000, 'completa', 'tarjeta', 'confirmada');

  v_j := public.admin_reservas_proximas(v_complejo, 2);
  if (v_j->>'total')::int <> 3 then
    raise exception 'FALLÓ (casos 11-12): esperaba 3 por jugar, dice %', v_j->>'total';
  end if;
  if json_array_length(v_j->'reservas') <> 2 then
    raise exception 'FALLÓ (caso 12): el límite debería recortar la lista a 2, trae %',
      json_array_length(v_j->'reservas');
  end if;
  raise notice 'OK (casos 11-12): total cuenta todas, la lista respeta el límite';

  select count(*) into v_n from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_ajena::text;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 13): apareció una reserva de otro complejo';
  end if;
  select count(*) into v_n from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_pasada::text;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 11): una reserva pasada no está "por jugar"';
  end if;
  raise notice 'OK (casos 11 y 13)';

  select count(*) into v_n from json_array_elements(v_j->'reservas') r
   where (r->>'neto') is not null and (r->>'comision') is not null;
  if v_n <> 2 then
    raise exception 'FALLÓ (caso 14): faltan el desglose de comisión en las filas';
  end if;
  raise notice 'OK (caso 14)';

  -- ── Casos 15-16: corregir un bloqueo ───────────────────────────
  v_bloqueo := public.admin_crear_bloqueo(v_cancha, v_manana, time '12:00', time '13:00', 'Mantención');
  perform public.admin_actualizar_bloqueo(v_bloqueo, null, time '13:00', time '15:00', 'Riego del pasto');
  if not exists (select 1 from public.cancha_bloqueos
                  where id = v_bloqueo and hora_inicio = time '13:00'
                    and hora_fin = time '15:00' and motivo = 'Riego del pasto') then
    raise exception 'FALLÓ (caso 15): el bloqueo no quedó movido';
  end if;
  raise notice 'OK (caso 15)';

  -- 19:00-20:00 del día siguiente tiene una confirmada de las de arriba.
  begin
    perform public.admin_actualizar_bloqueo(v_bloqueo, v_manana + 1, time '19:00', time '20:00', null);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 16): no debería poder moverse encima de una reserva confirmada';
  end if;
  raise notice 'OK (caso 16)';

  -- ── Caso 17: anon ──────────────────────────────────────────────
  execute format('set local role anon');
  begin
    perform public.admin_cancelar_reserva(v_futura, 'Motivo largo cualquiera para la prueba');
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then raise exception 'FALLÓ (caso 17a)'; end if;
  begin
    perform public.admin_reservas_proximas(v_complejo);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then raise exception 'FALLÓ (caso 17b)'; end if;
  begin
    perform public.admin_actualizar_bloqueo(v_bloqueo, null, null, null, 'x');
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then raise exception 'FALLÓ (caso 17c)'; end if;
  execute 'reset role';
  raise notice 'OK (caso 17)';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 66 PASARON ===';
end $$;

rollback;
