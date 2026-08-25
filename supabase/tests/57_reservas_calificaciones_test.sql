-- =============================================================
-- FutFinder — pruebas de calificación de complejos (migración 57).
--
-- QUÉ SE PRUEBA:
--   1. El organizador de una reserva CONFIRMADA puede calificar el
--      complejo de esa reserva.
--   2. Un participante (no organizador) de esa misma reserva también.
--   3. Un ajeno sin ninguna reserva en el complejo no puede calificar.
--   4. Una reserva que NO está 'confirmada' (p.ej. 'armando') no
--      habilita a calificar.
--   5. Una reserva de OTRO complejo no habilita a calificar este.
--   6. Una segunda calificación de la MISMA reserva por el MISMO
--      usuario se rechaza (una calificación por reserva).
--   7. Cualquiera puede LEER las calificaciones (descubrimiento público).
--   8. El autor no puede editar su calificación después de enviada: no
--      hay policy de update, es inmutable desde el cliente.
--   9. El trigger recalcula rating_avg/rating_count del complejo.
--   10. Las estrellas fuera de 1-5 las rechaza el CHECK.
--
-- Requiere las migraciones 54 a 57 aplicadas, o corridas dentro de la
-- misma transacción que este arnés, en orden.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK. Si un
-- caso falla, la ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_org       uuid := gen_random_uuid(); -- organizador de la reserva confirmada
  v_part      uuid := gen_random_uuid(); -- participante de esa misma reserva
  v_ajeno     uuid := gen_random_uuid(); -- sin ninguna reserva
  v_org_armando uuid := gen_random_uuid();
  v_org_otro  uuid := gen_random_uuid(); -- reserva confirmada en OTRO complejo

  v_complejo1 uuid := gen_random_uuid();
  v_complejo2 uuid := gen_random_uuid();
  v_cancha1   uuid := gen_random_uuid();
  v_cancha2   uuid := gen_random_uuid();

  v_res_ok      uuid := gen_random_uuid(); -- confirmada, complejo1
  v_res_armando uuid := gen_random_uuid(); -- sin confirmar, complejo1
  v_res_otro    uuid := gen_random_uuid(); -- confirmada, complejo2

  v_rechazado boolean;
  v_filas     int;
  v_avg       numeric;
  v_count     int;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r57-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_part, v_ajeno, v_org_armando, v_org_otro]) u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud)
  values (v_complejo1, 'Complejo Rating 1', 'Ñuñoa', -33.45, -70.60),
         (v_complejo2, 'Complejo Rating 2', 'Providencia', -33.42, -70.61);

  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha1, v_complejo1, 'Cancha 1', 'futbol_7', 20000, 60, true),
         (v_cancha2, v_complejo2, 'Cancha 1', 'futbol_7', 20000, 60, true);

  insert into public.reservas (
    id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, modalidad, medio_pago, estado
  ) values
    (v_res_ok,      v_cancha1, v_org,         current_date + 3, time '10:00', time '11:00', 20000, 'completa',  'balance', 'confirmada'),
    (v_res_armando, v_cancha1, v_org_armando, current_date + 4, time '10:00', time '11:00', 20000, 'completa',  'balance', 'armando'),
    (v_res_otro,    v_cancha2, v_org_otro,    current_date + 3, time '10:00', time '11:00', 20000, 'completa',  'balance', 'confirmada');

  insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
  values (v_res_ok, v_part, 'jugador', 'aceptado');

  execute format('set local role authenticated');

  -- ── Caso 1: el organizador de una reserva confirmada puede calificar ──
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  insert into public.complejo_calificaciones (complejo_id, reserva_id, user_id, estrellas, comentario)
  values (v_complejo1, v_res_ok, v_org, 5, 'Excelente cancha');
  select count(*) into v_filas from public.complejo_calificaciones where reserva_id = v_res_ok and user_id = v_org;
  if v_filas <> 1 then
    raise exception 'FALLÓ (caso 1): el organizador de una reserva confirmada debería poder calificar';
  end if;
  raise notice 'OK (caso 1): el organizador de una reserva confirmada puede calificar el complejo';

  -- ── Caso 2: un participante (no organizador) también puede ────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_part, 'role', 'authenticated')::text);
  insert into public.complejo_calificaciones (complejo_id, reserva_id, user_id, estrellas)
  values (v_complejo1, v_res_ok, v_part, 3);
  select count(*) into v_filas from public.complejo_calificaciones where reserva_id = v_res_ok and user_id = v_part;
  if v_filas <> 1 then
    raise exception 'FALLÓ (caso 2): un participante de la reserva debería poder calificar';
  end if;
  raise notice 'OK (caso 2): un participante (no organizador) también puede calificar';

  -- ── Caso 3: un ajeno sin ninguna reserva no puede calificar ────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  begin
    insert into public.complejo_calificaciones (complejo_id, reserva_id, user_id, estrellas)
    values (v_complejo1, v_res_ok, v_ajeno, 5);
    v_rechazado := false;
  exception when insufficient_privilege or others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 3): un ajeno sin reserva en el complejo no debería poder calificar';
  end if;
  raise notice 'OK (caso 3): un ajeno sin ninguna reserva en el complejo no puede calificar';

  -- ── Caso 4: una reserva no confirmada no habilita a calificar ─────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org_armando, 'role', 'authenticated')::text);
  begin
    insert into public.complejo_calificaciones (complejo_id, reserva_id, user_id, estrellas)
    values (v_complejo1, v_res_armando, v_org_armando, 4);
    v_rechazado := false;
  exception when insufficient_privilege or others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 4): una reserva "armando" (no confirmada) no debería habilitar a calificar';
  end if;
  raise notice 'OK (caso 4): solo una reserva CONFIRMADA habilita a calificar';

  -- ── Caso 5: una reserva de otro complejo no califica este ─────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org_otro, 'role', 'authenticated')::text);
  begin
    insert into public.complejo_calificaciones (complejo_id, reserva_id, user_id, estrellas)
    values (v_complejo1, v_res_otro, v_org_otro, 4); -- v_res_otro es de v_complejo2
    v_rechazado := false;
  exception when insufficient_privilege or others then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 5): una reserva de otro complejo no debería habilitar a calificar este';
  end if;
  raise notice 'OK (caso 5): la reserva citada tiene que pertenecer al complejo que se califica';

  -- ── Caso 6: una segunda calificación de la misma reserva se rechaza ──
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  begin
    insert into public.complejo_calificaciones (complejo_id, reserva_id, user_id, estrellas)
    values (v_complejo1, v_res_ok, v_org, 1);
    v_rechazado := false;
  exception when unique_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 6): una segunda calificación de la misma reserva por el mismo usuario debería rechazarse';
  end if;
  raise notice 'OK (caso 6): una reserva se califica una sola vez';

  -- ── Caso 7: cualquiera puede leer las calificaciones ───────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  select count(*) into v_count from public.complejo_calificaciones where complejo_id = v_complejo1;
  if v_count <> 2 then
    raise exception 'FALLÓ (caso 7): cualquiera debería poder leer las calificaciones del complejo, vio %', v_count;
  end if;
  raise notice 'OK (caso 7): las calificaciones se leen públicamente';

  -- ── Caso 8: el autor no puede editar su propia calificación ────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  update public.complejo_calificaciones set estrellas = 1 where reserva_id = v_res_ok and user_id = v_org;
  get diagnostics v_filas = row_count;
  if v_filas <> 0 then
    raise exception 'FALLÓ (caso 8): no debería existir ninguna policy de update — la calificación es inmutable';
  end if;
  raise notice 'OK (caso 8): una calificación enviada es inmutable, ni su propio autor la edita';

  -- ── Caso 9: el trigger recalcula rating_avg/rating_count ───────────
  select rating_avg, rating_count into v_avg, v_count from public.complejos where id = v_complejo1;
  if v_count <> 2 or v_avg <> 4.00 then
    raise exception 'FALLÓ (caso 9): con estrellas 5 y 3, rating_avg debería ser 4.00 y rating_count 2, quedó avg=%, count=%', v_avg, v_count;
  end if;
  raise notice 'OK (caso 9): el trigger recalcula rating_avg/rating_count del complejo';

  -- ── Caso 10: estrellas fuera de 1-5 las rechaza el CHECK ───────────
  -- Tiene que ser una fila que la RLS SÍ dejaría pasar (complejo, reserva
  -- y usuario calzando) para aislar el CHECK: con `v_ajeno`/`v_res_otro`/
  -- `v_complejo1` (caso 3) la propia RLS ya la rechaza primero con
  -- insufficient_privilege, y esta prueba nunca llega a ejercitar el CHECK.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org_otro, 'role', 'authenticated')::text);
  begin
    insert into public.complejo_calificaciones (complejo_id, reserva_id, user_id, estrellas)
    values (v_complejo2, v_res_otro, v_org_otro, 0);
    v_rechazado := false;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 10): 0 estrellas debería violar el CHECK';
  end if;
  raise notice 'OK (caso 10): el CHECK de estrellas rechaza valores fuera de 1-5';

  raise notice 'TODAS LAS PRUEBAS DE CALIFICACIÓN DE COMPLEJOS PASARON';
end $$;

rollback;
