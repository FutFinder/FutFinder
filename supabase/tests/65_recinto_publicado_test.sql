-- =============================================================
-- FutFinder — pruebas de la migración 65 (un recinto se publica cuando
-- está listo).
--
-- QUÉ SE PRUEBA:
--   1.  Un complejo nuevo arranca NO publicado.
--   2.  No publicado: un jugador no lo ve en `complejos`.
--   3.  No publicado: tampoco ve sus canchas.
--   4.  No publicado: `get_disponibilidad_cancha` se niega, incluso para
--       `anon` y aunque la función sea `security definer` (que se salta
--       la RLS — este es el chequeo que hace falta de verdad).
--   5.  No se puede publicar sin una cancha ACTIVA con horario.
--   6.  Con cancha activa y horario, se publica.
--   7.  Publicado: el jugador lo ve, ve las canchas y obtiene horarios.
--   8.  Su administrador lo ve en `admin_mis_complejos` AUNQUE no esté
--       publicado, con el campo `publicado`.
--   9.  Despublicar NO borra ni cancela las reservas confirmadas.
--   10. Un ajeno no puede publicar; `anon` tampoco.
--
-- Requiere las migraciones 54 a 65 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_jugador  uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_fecha    date := date '2027-03-08';
  v_res      uuid := gen_random_uuid();
  v_j        json;
  v_n        integer;
  v_pub      boolean;
  v_rechazado boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r65-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_jugador]) as u;

  -- Sin pasar `publicado`: tiene que quedar en false por el default.
  insert into public.complejos (id, nombre, comuna, latitud, longitud)
  values (v_complejo, 'Publicado 65', 'Maipú', -33.53, -70.76);
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, v_dueno, 'dueño');

  -- ── Caso 1 ─────────────────────────────────────────────────────
  select publicado into v_pub from public.complejos where id = v_complejo;
  if v_pub is not false then
    raise exception 'FALLÓ (caso 1): un complejo nuevo debería arrancar sin publicar';
  end if;
  raise notice 'OK (caso 1)';

  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_complejo, 'Cancha 1', 'futbol_7', 20000, 60, true);

  -- ── Caso 5: publicar sin horario se rechaza ────────────────────
  -- La cancha ya existe y está activa, pero todavía no tiene horario:
  -- publicar acá dejaría el recinto en el buscador sin nada reservable.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  begin
    perform public.admin_publicar_complejo(v_complejo, true);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 5): no debería publicarse sin una cancha activa CON horario';
  end if;
  raise notice 'OK (caso 5)';

  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '11:00', time '22:00' from generate_series(0, 6) as d;

  -- ── Casos 2-4: invisible mientras no se publica ────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador, 'role', 'authenticated')::text);

  select count(*) into v_n from public.complejos where id = v_complejo;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 2): un jugador no debería ver un recinto sin publicar';
  end if;
  select count(*) into v_n from public.canchas_reservables where id = v_cancha;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 3): tampoco debería ver sus canchas';
  end if;
  raise notice 'OK (casos 2-3)';

  execute 'reset role';
  execute format('set local role anon');
  v_j := public.get_disponibilidad_cancha(v_cancha, v_fecha);
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 4): la disponibilidad de un recinto sin publicar no debería darse: %', v_j::text;
  end if;
  execute 'reset role';
  raise notice 'OK (caso 4): la función security definer también lo respeta';

  -- ── Caso 8: su administrador sí lo ve, sin publicar ────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  select count(*) into v_n from public.admin_mis_complejos() where id = v_complejo;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 8): el administrador debe ver su recinto aunque no esté publicado';
  end if;
  select publicado into v_pub from public.admin_mis_complejos() where id = v_complejo;
  if v_pub is not false then
    raise exception 'FALLÓ (caso 8): admin_mis_complejos debe devolver `publicado`';
  end if;
  raise notice 'OK (caso 8)';

  -- ── Casos 6-7: se publica y se vuelve visible ──────────────────
  perform public.admin_publicar_complejo(v_complejo, true);
  select publicado into v_pub from public.complejos where id = v_complejo;
  if v_pub is not true then
    raise exception 'FALLÓ (caso 6): debería quedar publicado';
  end if;

  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador, 'role', 'authenticated')::text);
  select count(*) into v_n from public.complejos where id = v_complejo;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 7): publicado, el jugador debería verlo';
  end if;
  select count(*) into v_n from public.canchas_reservables where id = v_cancha;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 7): y también sus canchas';
  end if;
  execute 'reset role';
  execute format('set local role anon');
  v_j := public.get_disponibilidad_cancha(v_cancha, v_fecha);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 7): publicado, la disponibilidad debería darse: %', v_j::text;
  end if;
  execute 'reset role';
  raise notice 'OK (casos 6-7)';

  -- ── Caso 9: despublicar no toca las reservas confirmadas ───────
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_res, v_cancha, v_jugador, v_fecha, time '12:00', time '13:00',
          20000, 'completa', 'tarjeta', 'confirmada');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  perform public.admin_publicar_complejo(v_complejo, false);

  select count(*) into v_n from public.reservas where id = v_res and estado = 'confirmada';
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 9): despublicar no debe cancelar una reserva confirmada';
  end if;
  -- Y el recinto la sigue viendo en su agenda.
  v_j := public.admin_agenda_complejo(v_complejo, v_fecha);
  if (v_j->'resumen'->>'reservas_confirmadas')::int <> 1 then
    raise exception 'FALLÓ (caso 9): la reserva debería seguir en la agenda del recinto';
  end if;
  raise notice 'OK (caso 9): despublicar es dejar de recibir, no cancelar';

  -- ── Caso 10: privilegios ───────────────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador, 'role', 'authenticated')::text);
  begin
    perform public.admin_publicar_complejo(v_complejo, true);
    v_rechazado := false;
  exception when others then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 10): un ajeno no debería poder publicar';
  end if;

  execute format('set local role anon');
  begin
    perform public.admin_publicar_complejo(v_complejo, true);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 10): anon no debería ejecutar admin_publicar_complejo';
  end if;
  execute 'reset role';
  raise notice 'OK (caso 10)';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 65 PASARON ===';
end $$;

rollback;
