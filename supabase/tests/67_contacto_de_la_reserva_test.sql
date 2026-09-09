-- =============================================================
-- FutFinder — pruebas de la migración 67 (nombre y teléfono de contacto).
--
-- QUÉ SE PRUEBA:
--   El teléfono chileno
--   1.  Los cuatro formatos que la gente escribe quedan idénticos.
--   2.  Un fijo, un número corto y basura devuelven null.
--
--   El fin del partido
--   3.  Un bloque que cruza la medianoche termina al día SIGUIENTE.
--
--   El contacto es obligatorio al reservar
--   4.  Sin nombre se rechaza; con teléfono inválido también.
--   5.  Con contacto válido se crea la reserva y el teléfono queda
--       normalizado.
--
--   LA PRIVACIDAD, que es lo que importa
--   6.  El recinto ve el contacto de una reserva vigente.
--   7.  **Otro participante del partido NO lo ve**, aunque sí puede leer
--       la reserva. Es la promesa que la pantalla del jugador le hace.
--   8.  Un ajeno no ve nada.
--   9.  Quien organizó ve SU contacto siempre, incluso pasada la ventana.
--
--   La ventana de 12 horas
--   10. Pasadas 12 h del término, el recinto ya NO lo ve.
--   11. Si la reserva se cancela, desaparece de inmediato.
--
--   Corregir el contacto
--   12. Quien organizó lo corrige; un ajeno no.
--
--   13. `anon` no ejecuta nada de esto.
--
-- Requiere las migraciones 54 a 67 aplicadas.
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
  v_cancha   uuid := gen_random_uuid();
  v_futura   uuid;
  v_vieja    uuid := gen_random_uuid();
  v_cancelada uuid := gen_random_uuid();
  v_manana   date := (now() at time zone 'America/Santiago')::date + 10;
  v_hace3    date := (now() at time zone 'America/Santiago')::date - 3;
  v_j        json;
  v_n        integer;
  v_txt      text;
  v_rechazado boolean;
begin
  -- ── Casos 1-2: el teléfono ─────────────────────────────────────
  if public.normaliza_telefono_cl('9 8765 4321')     <> '+56987654321'
     or public.normaliza_telefono_cl('+56 9 8765 4321') <> '+56987654321'
     or public.normaliza_telefono_cl('56987654321')     <> '+56987654321'
     or public.normaliza_telefono_cl('987654321')       <> '+56987654321' then
    raise exception 'FALLÓ (caso 1): los cuatro formatos deberían quedar idénticos';
  end if;
  raise notice 'OK (caso 1): «9 8765 4321» y «+56 9 8765 4321» quedan iguales';

  if public.normaliza_telefono_cl('221234567') is not null then
    raise exception 'FALLÓ (caso 2): un fijo no sirve, al fijo no se le escribe por WhatsApp';
  end if;
  if public.normaliza_telefono_cl('9876') is not null
     or public.normaliza_telefono_cl('hola') is not null
     or public.normaliza_telefono_cl(null) is not null then
    raise exception 'FALLÓ (caso 2): un número inválido debería dar null';
  end if;
  raise notice 'OK (caso 2)';

  -- ── Caso 3: el partido que cruza la medianoche ─────────────────
  if public.fin_de_reserva(date '2027-03-08', time '23:00', time '00:00')
     <> public.inicio_de_reserva(date '2027-03-09', time '00:00') then
    raise exception 'FALLÓ (caso 3): un bloque 23:00-00:00 termina al día siguiente';
  end if;
  raise notice 'OK (caso 3)';

  -- ── Montaje ────────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r67-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_org, v_amigo, v_ajeno]) as u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
  values (v_complejo, 'Contacto 67', 'Maipú', -33.53, -70.76, true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_complejo, 'Cancha 1', 'futbol_7', 28000, 60, true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '11:00', time '22:00' from generate_series(0, 6) as d;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, v_dueno, 'dueño');

  -- ── Casos 4-5: el contacto es obligatorio ──────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);

  v_j := public.crear_reserva(v_cancha, v_manana, time '20:00', 'completa', 'tarjeta',
                              null, false, null, null, null, '9 8765 4321');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 4): sin nombre no debería crearse';
  end if;
  v_j := public.crear_reserva(v_cancha, v_manana, time '20:00', 'completa', 'tarjeta',
                              null, false, null, null, 'Matías Correa', '221234567');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 4): con un fijo no debería crearse';
  end if;
  raise notice 'OK (caso 4)';

  v_j := public.crear_reserva(v_cancha, v_manana, time '20:00', 'completa', 'tarjeta',
                              null, false, null, null, '  Matías Correa  ', '+56 9 8765 4321');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 5): %', v_j::text;
  end if;
  v_futura := (v_j->>'reserva_id')::uuid;

  if not exists (select 1 from public.reserva_contacto
                  where reserva_id = v_futura
                    and nombre = 'Matías Correa' and telefono = '+56987654321') then
    raise exception 'FALLÓ (caso 5): el contacto no quedó guardado y normalizado: %',
      (select row_to_json(rc)::text from public.reserva_contacto rc where rc.reserva_id = v_futura);
  end if;
  raise notice 'OK (caso 5): guardado como +56987654321, sin espacios en el nombre';

  -- El amigo participa del partido: puede leer la reserva.
  update public.reservas set estado = 'confirmada' where id = v_futura;
  insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
  values (v_futura, v_org, 'organizador', 'aceptado'),
         (v_futura, v_amigo, 'jugador', 'aceptado');

  -- ── Caso 6: el recinto lo ve ───────────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_j := public.admin_reserva_detalle(v_futura);
  if v_j->>'contacto_telefono' <> '+56987654321' or v_j->>'contacto_nombre' <> 'Matías Correa' then
    raise exception 'FALLÓ (caso 6): el recinto debería ver el contacto, ve %', v_j::text;
  end if;
  v_j := public.admin_agenda_complejo(v_complejo, v_manana);
  select r->>'contacto_telefono' into v_txt
    from json_array_elements(v_j->'reservas') r where r->>'id' = v_futura::text;
  if v_txt <> '+56987654321' then
    raise exception 'FALLÓ (caso 6): la agenda debería traer el teléfono, trae %', v_txt;
  end if;
  raise notice 'OK (caso 6)';

  -- ── Casos 7-9: quién NO lo ve ──────────────────────────────────
  execute format('set local role authenticated');

  -- Caso 7: el amigo lee la reserva pero NO el contacto
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_amigo, 'role', 'authenticated')::text);
  select count(*) into v_n from public.reservas where id = v_futura;
  if v_n <> 1 then
    raise exception 'MONTAJE MAL (caso 7): el participante debería poder leer la reserva';
  end if;
  select count(*) into v_n from public.reserva_contacto where reserva_id = v_futura;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 7): OTRO JUGADOR VIO EL TELÉFONO DEL ORGANIZADOR';
  end if;
  raise notice 'OK (caso 7): el participante lee la reserva pero no el contacto';

  -- Caso 8: un ajeno, nada
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  select count(*) into v_n from public.reserva_contacto where reserva_id = v_futura;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 8): un ajeno vio el contacto';
  end if;
  raise notice 'OK (caso 8)';

  -- Caso 9: quien organizó, siempre
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  select count(*) into v_n from public.reserva_contacto where reserva_id = v_futura;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 9): quien reservó debería ver su propio contacto';
  end if;
  execute 'reset role';
  raise notice 'OK (caso 9)';

  -- ── Casos 10-11: la ventana se cierra ──────────────────────────
  -- Una reserva de hace tres días: la ventana de 12 h ya pasó.
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_vieja, v_cancha, v_org, v_hace3, time '20:00', time '21:00',
          28000, 'completa', 'tarjeta', 'confirmada');
  insert into public.reserva_contacto (reserva_id, nombre, telefono)
  values (v_vieja, 'Camila Rojas', '+56911112222');

  if public.contacto_visible(v_vieja) then
    raise exception 'FALLÓ (caso 10): pasadas 12 h del partido el contacto no debería verse';
  end if;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_j := public.admin_reserva_detalle(v_vieja);
  if v_j->>'contacto_telefono' is not null then
    raise exception 'FALLÓ (caso 10): la RPC devolvió el teléfono fuera de la ventana';
  end if;
  if (v_j->>'contacto_visible')::boolean is not false then
    raise exception 'FALLÓ (caso 10): contacto_visible debería venir en false';
  end if;
  -- Y el organizador SÍ lo sigue viendo: es su dato.
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  select count(*) into v_n from public.reserva_contacto where reserva_id = v_vieja;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 9): quien reservó lo ve aunque haya pasado la ventana';
  end if;
  execute 'reset role';
  raise notice 'OK (casos 9-10): se cierra para el recinto, no para quien lo escribió';

  -- Caso 11: cancelada, desaparece de inmediato
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_cancelada, v_cancha, v_org, v_manana, time '18:00', time '19:00',
          28000, 'completa', 'tarjeta', 'cancelada');
  insert into public.reserva_contacto (reserva_id, nombre, telefono)
  values (v_cancelada, 'Javiera Soto', '+56933334444');
  if public.contacto_visible(v_cancelada) then
    raise exception 'FALLÓ (caso 11): una reserva cancelada no debería mostrar contacto';
  end if;
  raise notice 'OK (caso 11)';

  -- ── Caso 12: corregir el contacto ──────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  v_j := public.actualizar_contacto_reserva(v_futura, 'Impostor', '+56999998888');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 12): un ajeno no debería poder cambiar el contacto';
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.actualizar_contacto_reserva(v_futura, 'Matías C.', '9 1111 2222');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 12): %', v_j::text;
  end if;
  if not exists (select 1 from public.reserva_contacto
                  where reserva_id = v_futura and telefono = '+56911112222') then
    raise exception 'FALLÓ (caso 12): el teléfono no quedó corregido';
  end if;
  raise notice 'OK (caso 12)';

  -- ── Caso 13: anon ──────────────────────────────────────────────
  execute format('set local role anon');
  begin
    perform public.contacto_visible(v_futura);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then raise exception 'FALLÓ (caso 13a)'; end if;
  begin
    perform public.actualizar_contacto_reserva(v_futura, 'x', '987654321');
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then raise exception 'FALLÓ (caso 13b)'; end if;
  execute 'reset role';
  raise notice 'OK (caso 13)';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 67 PASARON ===';
end $$;

rollback;
