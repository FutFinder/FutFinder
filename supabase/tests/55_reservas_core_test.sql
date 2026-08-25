-- =============================================================
-- FutFinder — pruebas del ciclo de vida de una reserva: creación,
-- convocatoria, autorización de cobro, confirmación, cancelación y
-- devolución (migración 55).
--
-- QUÉ SE PRUEBA (resumen; el detalle va en cada caso):
--   · crear_reserva: 'completa' nace 'procesando' sin participantes;
--     'capitanes'/'jugadores' nacen 'armando' con el organizador ya
--     'aceptado'; la cuota se calcula por CEIL; tarjeta no sirve para
--     capitanes/jugadores; una cancha inactiva o un slot ya
--     'confirmada' se rechazan; DOS reservas 'armando' del MISMO slot
--     coexisten (regla central: mientras se arma, el slot sigue libre).
--   · invitar_participante_reserva: solo el organizador invita, solo
--     mientras 'armando', nadie se invita a sí mismo, el rol tiene que
--     calzar con la modalidad, no hay dos capitanes ACTIVOS a la vez,
--     pero SÍ se puede reemplazar a uno que ya rechazó.
--   · rechazar_invitacion_reserva: solo con invitación pendiente.
--   · autorizar_cobro_reserva: el monto tiene que calzar EXACTO con la
--     cuota vigente de esa modalidad; en 'completa' paga solo el
--     organizador.
--   · confirmar_reserva, el paso crítico: solo el organizador confirma;
--     el grupo tiene que estar COMPLETO (falta_capitan/faltan_jugadores);
--     autorización vigente de cada pagador (autorizacion_pendiente);
--     saldo suficiente de cada pagador, SIN cobrar a nadie si falta
--     (atomicidad); camino feliz cobra el monto exacto y confirma; es
--     idempotente; y una segunda reserva del mismo slot ya no puede
--     confirmar una vez que la primera ganó el horario.
--   · recalcular_cuota_reserva: invalida autorizaciones vigentes y
--     resetea a los no-organizadores a 'pendiente'.
--   · cancelar_reserva: solo el organizador (o el club, si es desafío);
--     ventana de 12h sobre una 'confirmada'; devuelve el monto EXACTO
--     cobrado a cada pagador; una 'armando' se cancela sin devolución
--     porque nunca se cobró nada; un desafío de club no cancela solo,
--     queda 'solicitada'.
--   · responder_cancelacion_desafio: solo el club que NO pidió puede
--     responder; aceptar cancela y devuelve; rechazar deja la reserva
--     como estaba.
--   · RLS: un ajeno no ve una reserva de la que no participa, ni las
--     autorizaciones de cobro de otro (privacidad de montos).
--   · vencer_reservas_pasadas: solo pasa a 'vencida' lo 'armando'/
--     'procesando' con la hora ya pasada — una 'confirmada' no se toca
--     — y solo puede llamarla el cron/service_role, no un autenticado.
--
-- Requiere las migraciones 54 a 57 aplicadas (usa `balance_movimientos`
-- de la 56 para financiar a los pagadores), o las cuatro corridas
-- dentro de la misma transacción que este arnés, en orden.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK. Si un
-- caso falla, la ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_org     uuid := gen_random_uuid(); -- organizador en casi todo
  v_cap2    uuid := gen_random_uuid(); -- segundo capitán, rechaza
  v_cap2b   uuid := gen_random_uuid(); -- segundo capitán, reemplazo
  v_j2      uuid := gen_random_uuid();
  v_j3      uuid := gen_random_uuid();
  v_j4      uuid := gen_random_uuid();
  v_pobre   uuid := gen_random_uuid(); -- organizador sin saldo
  v_ajeno   uuid := gen_random_uuid();

  v_admin1  uuid := gen_random_uuid(); -- admin club organizador del desafío
  v_admin2  uuid := gen_random_uuid(); -- admin club rival del desafío
  v_club1   uuid := gen_random_uuid();
  v_club2   uuid := gen_random_uuid();

  v_complejo uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_cancha_off uuid := gen_random_uuid();
  v_fecha    date := date '2027-03-01';

  v_j        json;
  v_res      uuid;
  v_res2     uuid;
  v_res14    uuid;
  v_sin_plata uuid;
  v_sin_cobro uuid;
  v_estado   text;
  v_n        int;
  v_saldo    int;
  v_count    int;
  v_rechazado boolean;
begin
  -- ── Setup: gente ──────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r55-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[
      v_org, v_cap2, v_cap2b, v_j2, v_j3, v_j4, v_pobre, v_ajeno, v_admin1, v_admin2
    ]) u;

  -- ── Setup: complejo, cancha, cancha inactiva ─────────────────────
  insert into public.complejos (id, nombre, comuna, latitud, longitud)
  values (v_complejo, 'Complejo Prueba 55', 'Ñuñoa', -33.45, -70.60);

  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values
    (v_cancha,     v_complejo, 'Cancha 1', 'futbol_7', 30000, 60, true),
    (v_cancha_off, v_complejo, 'Cancha 2', 'futbol_7', 30000, 60, false);

  -- ── Setup: dos clubes para el desafío ─────────────────────────────
  insert into public.clubs (id, nombre, slug, created_by)
  values (v_club1, 'Club Reserva 1', 'club-reserva-1-' || left(v_club1::text, 8), v_admin1),
         (v_club2, 'Club Reserva 2', 'club-reserva-2-' || left(v_club2::text, 8), v_admin2);
  insert into public.club_members (club_id, user_id, rol)
  values (v_club1, v_admin1, 'admin'), (v_club2, v_admin2, 'admin');

  -- ── Setup: financiar balances (ledger de la migración 56) ─────────
  insert into public.balance_movimientos (user_id, tipo, monto, metodo_carga)
  select u, 'carga', 200000, 'transferencia'
    from unnest(array[v_org, v_cap2b, v_j2, v_j3, v_j4, v_admin1, v_ajeno]) u;
  -- v_pobre y v_cap2 quedan deliberadamente sin saldo.

  -- ══════════════════════════════════════════════════════════════
  -- CREAR_RESERVA
  -- ══════════════════════════════════════════════════════════════
  -- OJO: `auth.uid()` solo lee `request.jwt.claims` — el rol de sesión no
  -- le importa. Por eso este arnés NUNCA hace `set local role
  -- authenticated` salvo en los casos 37-39, que prueban RLS/permisos de
  -- verdad: en cualquier otro lado, quedarse en el rol por defecto deja
  -- que las verificaciones lean CUALQUIER fila (organizador, capitán,
  -- admin del club rival...) sin que la RLS de esa tabla —pensada para
  -- esconderle datos a otro usuario, no al arnés— tape lo que este
  -- arnés necesita comprobar.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);

  -- Caso 1: 'completa' nace 'procesando', sin fila en reserva_participantes.
  v_j := public.crear_reserva(v_cancha, v_fecha, time '10:00', 'completa', 'balance');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 1): crear_reserva completa debería aceptar, respondió %', v_j;
  end if;
  v_res := (v_j->>'reserva_id')::uuid;
  select estado into v_estado from public.reservas where id = v_res;
  if v_estado <> 'procesando' then
    raise exception 'FALLÓ (caso 1): una reserva completa debería nacer procesando, quedó %', v_estado;
  end if;
  select count(*) into v_count from public.reserva_participantes where reserva_id = v_res;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 1): completa no debería crear filas en reserva_participantes, creó %', v_count;
  end if;
  raise notice 'OK (caso 1): completa nace procesando, sin participantes';

  -- Caso 2: 'capitanes' nace 'armando', organizador ya 'aceptado'.
  v_j := public.crear_reserva(v_cancha, v_fecha, time '11:00', 'capitanes', 'balance');
  v_res := (v_j->>'reserva_id')::uuid;
  select estado into v_estado from public.reservas where id = v_res;
  if v_estado <> 'armando' then
    raise exception 'FALLÓ (caso 2): capitanes debería nacer armando, quedó %', v_estado;
  end if;
  if not exists (
    select 1 from public.reserva_participantes
     where reserva_id = v_res and user_id = v_org and rol = 'organizador' and estado = 'aceptado'
  ) then
    raise exception 'FALLÓ (caso 2): el organizador debería quedar aceptado en reserva_participantes';
  end if;
  raise notice 'OK (caso 2): capitanes nace armando con el organizador ya aceptado';

  -- Caso 3: 'jugadores' calcula la cuota por CEIL(total/n).
  v_j := public.crear_reserva(v_cancha, v_fecha, time '12:00', 'jugadores', 'balance', 3);
  v_res := (v_j->>'reserva_id')::uuid;
  if not exists (select 1 from public.reservas where id = v_res and cuota = ceil(30000::numeric / 3)) then
    raise exception 'FALLÓ (caso 3): la cuota de jugadores debería ser CEIL(30000/3)=10000';
  end if;
  raise notice 'OK (caso 3): la cuota de jugadores se calcula por CEIL(total/n)';

  -- Caso 4: capitanes/jugadores con tarjeta se rechaza.
  v_j := public.crear_reserva(v_cancha, v_fecha, time '11:00', 'capitanes', 'tarjeta');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 4): capitanes con tarjeta debería rechazarse, respondió %', v_j;
  end if;
  raise notice 'OK (caso 4): capitanes/jugadores exige Balance, no tarjeta';

  -- Caso 5: jugadores sin n_jugadores válido se rechaza.
  v_j := public.crear_reserva(v_cancha, v_fecha, time '12:00', 'jugadores', 'balance', 1);
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 5): jugadores con n_jugadores=1 debería rechazarse, respondió %', v_j;
  end if;
  raise notice 'OK (caso 5): jugadores exige al menos 2 jugadores';

  -- Caso 6: cancha inactiva se rechaza.
  v_j := public.crear_reserva(v_cancha_off, v_fecha, time '10:00', 'completa', 'balance');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 6): una cancha inactiva debería rechazar la reserva';
  end if;
  raise notice 'OK (caso 6): una cancha inactiva no admite reservas nuevas';

  -- ── Setup: slot 13:00 con una reserva YA confirmada ───────────────
  insert into public.reservas (
    id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, modalidad, medio_pago, estado
  ) values (
    gen_random_uuid(), v_cancha, v_ajeno, v_fecha, time '13:00', time '14:00',
    30000, 'completa', 'balance', 'confirmada'
  );

  -- Caso 7: un slot ya 'confirmada' se rechaza al crear (informativo).
  v_j := public.crear_reserva(v_cancha, v_fecha, time '13:00', 'completa', 'balance');
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') <> 'ocupado' then
    raise exception 'FALLÓ (caso 7): un slot confirmado debería rechazar con reason=ocupado, respondió %', v_j;
  end if;
  raise notice 'OK (caso 7): crear_reserva rechaza un slot ya confirmado';

  -- Caso 8: DOS reservas 'armando'/'procesando' del MISMO slot coexisten.
  v_j := public.crear_reserva(v_cancha, v_fecha, time '14:00', 'capitanes', 'balance');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 8): la primera reserva armando del slot 14:00 debería crearse, respondió %', v_j;
  end if;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  v_j := public.crear_reserva(v_cancha, v_fecha, time '14:00', 'completa', 'balance');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 8): una segunda reserva "armando/procesando" del mismo slot debería coexistir, respondió %', v_j;
  end if;
  v_res2 := (v_j->>'reserva_id')::uuid; -- la del ajeno, para el caso 27
  raise notice 'OK (caso 8): dos reservas sin confirmar del mismo slot coexisten (el slot sigue libre)';

  -- ══════════════════════════════════════════════════════════════
  -- INVITAR / RECHAZAR INVITACIÓN
  -- ══════════════════════════════════════════════════════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.crear_reserva(v_cancha, v_fecha, time '15:00', 'capitanes', 'balance');
  v_res := (v_j->>'reserva_id')::uuid;

  -- Caso 9: un no-organizador no puede invitar.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_cap2, 'role', 'authenticated')::text);
  v_j := public.invitar_participante_reserva(v_res, v_j2, 'capitan');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 9): solo el organizador debería poder invitar';
  end if;
  raise notice 'OK (caso 9): un no-organizador no puede invitar participantes';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);

  -- Caso 10: nadie se invita a sí mismo.
  v_j := public.invitar_participante_reserva(v_res, v_org, 'capitan');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 10): el organizador no debería poder invitarse a sí mismo';
  end if;
  raise notice 'OK (caso 10): nadie se invita a sí mismo';

  -- Caso 11: el rol tiene que calzar con la modalidad.
  v_j := public.invitar_participante_reserva(v_res, v_j2, 'jugador');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 11): invitar un "jugador" en una reserva de capitanes debería rechazarse';
  end if;
  raise notice 'OK (caso 11): el rol de la invitación tiene que calzar con la modalidad';

  -- Caso 12: primera invitación de capitán, ok.
  v_j := public.invitar_participante_reserva(v_res, v_cap2, 'capitan');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 12): la primera invitación de capitán debería aceptarse, respondió %', v_j;
  end if;

  -- Caso 12b: mientras ese capitán sigue pendiente, no se puede invitar a otro.
  v_j := public.invitar_participante_reserva(v_res, v_cap2b, 'capitan');
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 12b): no debería poder haber dos capitanes activos a la vez';
  end if;
  raise notice 'OK (caso 12): no hay dos capitanes ACTIVOS invitados a la vez';

  -- Caso 13: el capitán invitado rechaza, y AHÍ SÍ se puede invitar a otro.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_cap2, 'role', 'authenticated')::text);
  v_j := public.rechazar_invitacion_reserva(v_res);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 13): rechazar una invitación pendiente debería aceptarse, respondió %', v_j;
  end if;

  -- Caso 14: sin invitación pendiente, rechazar_invitacion_reserva no hace nada.
  v_j := public.rechazar_invitacion_reserva(v_res);
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 14): rechazar sin invitación pendiente debería fallar';
  end if;
  raise notice 'OK (caso 13-14): rechazar invitación funciona una vez y no de nuevo sin invitación pendiente';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.invitar_participante_reserva(v_res, v_cap2b, 'capitan');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 15): tras el rechazo debería poder invitarse a un capitán de reemplazo, respondió %', v_j;
  end if;
  raise notice 'OK (caso 15): un capitán que rechazó no ocupa el cupo — se puede invitar a otro';

  -- ══════════════════════════════════════════════════════════════
  -- AUTORIZAR COBRO
  -- ══════════════════════════════════════════════════════════════

  -- Caso 16: en 'completa' paga solo el organizador — otro que intente falla.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin1, 'role', 'authenticated')::text);
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.crear_reserva(v_cancha, v_fecha, time '10:00', 'completa', 'balance'); -- 2ª reserva, otro slot
  declare v_completa uuid := (v_j->>'reserva_id')::uuid;
  begin
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
    v_j := public.autorizar_cobro_reserva(v_completa, 30000);
    if (v_j->>'ok')::boolean is not false then
      raise exception 'FALLÓ (caso 16): solo el organizador debería poder autorizar en modalidad completa';
    end if;
  end;
  raise notice 'OK (caso 16): en completa, solo el organizador autoriza el cobro';

  -- Caso 17: el monto tiene que calzar EXACTO con la cuota vigente.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_cap2b, 'role', 'authenticated')::text);
  v_j := public.autorizar_cobro_reserva(v_res, 12345);
  if (v_j->>'ok')::boolean is not false or (v_j->>'monto_esperado')::int <> ceil(30000::numeric / 2)::int then
    raise exception 'FALLÓ (caso 17): un monto que no calza debería rechazarse e informar el esperado, respondió %', v_j;
  end if;
  raise notice 'OK (caso 17): autorizar con un monto que no calza se rechaza e informa la cuota esperada';

  -- Caso 18: monto correcto, el capitán queda 'aceptado'.
  v_j := public.autorizar_cobro_reserva(v_res, ceil(30000::numeric / 2)::int);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 18): autorizar con el monto correcto debería aceptarse, respondió %', v_j;
  end if;
  if not exists (
    select 1 from public.reserva_participantes
     where reserva_id = v_res and user_id = v_cap2b and estado = 'aceptado'
  ) then
    raise exception 'FALLÓ (caso 18): el capitán debería quedar aceptado tras autorizar';
  end if;
  raise notice 'OK (caso 18): autorizar el monto correcto acepta al participante';

  -- ══════════════════════════════════════════════════════════════
  -- CONFIRMAR_RESERVA
  -- ══════════════════════════════════════════════════════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  -- Caso 19: un no-organizador no puede confirmar.
  v_j := public.confirmar_reserva(v_res);
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 19): solo el organizador debería poder confirmar';
  end if;
  raise notice 'OK (caso 19): un no-organizador no puede confirmar';

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);

  -- Caso 20: falta el segundo capitán ACEPTAR — organizador aún no autorizó.
  v_j := public.confirmar_reserva(v_res);
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') <> 'autorizacion_pendiente' then
    raise exception 'FALLÓ (caso 20): con el organizador sin autorizar debería pedir autorizacion_pendiente, respondió %', v_j;
  end if;
  raise notice 'OK (caso 20): confirmar exige la autorización de CADA pagador, incluido el organizador';

  v_j := public.autorizar_cobro_reserva(v_res, ceil(30000::numeric / 2)::int);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (setup caso 21): el organizador debería poder autorizar su mitad';
  end if;

  -- Caso 21: camino feliz — confirma, cobra el monto exacto a cada uno.
  v_j := public.confirmar_reserva(v_res);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 21): con todo autorizado y saldo, debería confirmar, respondió %', v_j;
  end if;
  select estado into v_estado from public.reservas where id = v_res;
  if v_estado <> 'confirmada' then
    raise exception 'FALLÓ (caso 21): la reserva debería quedar confirmada, quedó %', v_estado;
  end if;
  if not exists (
    select 1 from public.balance_movimientos
     where reserva_id = v_res and user_id = v_org and tipo = 'cobro_reserva' and monto = -ceil(30000::numeric / 2)::int
  ) then
    raise exception 'FALLÓ (caso 21): al organizador debería habérsele cobrado exactamente su mitad';
  end if;
  if not exists (
    select 1 from public.balance_movimientos
     where reserva_id = v_res and user_id = v_cap2b and tipo = 'cobro_reserva' and monto = -ceil(30000::numeric / 2)::int
  ) then
    raise exception 'FALLÓ (caso 21): al capitán debería habérsele cobrado exactamente su mitad';
  end if;
  raise notice 'OK (caso 21): confirmar_reserva cobra el monto exacto a cada pagador y confirma';

  -- Caso 22: confirmar de nuevo es idempotente.
  v_j := public.confirmar_reserva(v_res);
  if (v_j->>'ok')::boolean is not true or (v_j->>'already')::boolean is not true then
    raise exception 'FALLÓ (caso 22): confirmar una reserva ya confirmada debería ser idempotente, respondió %', v_j;
  end if;
  raise notice 'OK (caso 22): confirmar una reserva ya confirmada es idempotente';

  -- Caso 23: el ganador del slot 14:00 confirma, y el otro (v_ajeno) ya no puede.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  begin
    select id into v_res14 from public.reservas
     where cancha_id = v_cancha and fecha = v_fecha and hora_inicio = time '14:00' and organizador_id = v_org;
    v_j := public.autorizar_cobro_reserva(v_res14, ceil(30000::numeric / 2)::int);
    -- Falta el segundo capitán: nunca se invitó a nadie en esta reserva de
    -- prueba, así que confirmar_reserva rechaza por falta_capitan — es
    -- justo lo que hace falta para el siguiente caso: el slot 14:00 tiene
    -- que ganarlo la reserva 'completa' de v_ajeno (v_res2), no esta.
  end;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  v_j := public.autorizar_cobro_reserva(v_res2, 30000);
  v_j := public.confirmar_reserva(v_res2);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 23 setup): la reserva completa de v_ajeno debería poder confirmar el slot 14:00, respondió %', v_j;
  end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  declare v_j2b json;
  begin
    select id into v_res14 from public.reservas
     where cancha_id = v_cancha and fecha = v_fecha and hora_inicio = time '14:00' and organizador_id = v_org;
    v_j2b := public.invitar_participante_reserva(v_res14, v_j2, 'capitan');
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_j2, 'role', 'authenticated')::text);
    v_j2b := public.autorizar_cobro_reserva(v_res14, ceil(30000::numeric / 2)::int);
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
    v_j := public.confirmar_reserva(v_res14);
  end;
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') <> 'ocupado' then
    raise exception 'FALLÓ (caso 23): confirmar el slot que otra reserva ya ganó debería responder ocupado, respondió %', v_j;
  end if;
  raise notice 'OK (caso 23): una vez que otra reserva confirmó el slot, esta ya no puede';

  -- ══════════════════════════════════════════════════════════════
  -- FALTA_CAPITAN / FALTAN_JUGADORES
  -- ══════════════════════════════════════════════════════════════
  v_j := public.crear_reserva(v_cancha, v_fecha, time '16:00', 'capitanes', 'balance');
  declare v_solo_org uuid := (v_j->>'reserva_id')::uuid;
  begin
    v_j := public.autorizar_cobro_reserva(v_solo_org, ceil(30000::numeric / 2)::int);
    v_j := public.confirmar_reserva(v_solo_org);
  end;
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') <> 'falta_capitan' then
    raise exception 'FALLÓ (caso 24): confirmar capitanes sin el segundo capitán debería responder falta_capitan, respondió %', v_j;
  end if;
  raise notice 'OK (caso 24): confirmar sin el segundo capitán responde falta_capitan';

  v_j := public.crear_reserva(v_cancha, v_fecha, time '17:00', 'jugadores', 'balance', 3);
  declare v_pocos uuid := (v_j->>'reserva_id')::uuid;
  begin
    v_j := public.invitar_participante_reserva(v_pocos, v_j2, 'jugador');
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_j2, 'role', 'authenticated')::text);
    v_j := public.autorizar_cobro_reserva(v_pocos, ceil(30000::numeric / 3)::int);
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
    v_j := public.autorizar_cobro_reserva(v_pocos, ceil(30000::numeric / 3)::int);
    v_j := public.confirmar_reserva(v_pocos);
  end;
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') <> 'faltan_jugadores' then
    raise exception 'FALLÓ (caso 25): confirmar jugadores con menos de n_jugadores aceptados debería responder faltan_jugadores, respondió %', v_j;
  end if;
  raise notice 'OK (caso 25): confirmar sin completar n_jugadores responde faltan_jugadores';

  -- ══════════════════════════════════════════════════════════════
  -- AUTORIZACION_PENDIENTE tras un recálculo de cuota
  -- ══════════════════════════════════════════════════════════════
  v_j := public.crear_reserva(v_cancha, v_fecha, time '18:00', 'jugadores', 'balance', 2);
  declare v_recalc uuid := (v_j->>'reserva_id')::uuid;
  begin
    v_j := public.invitar_participante_reserva(v_recalc, v_j3, 'jugador');
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_j3, 'role', 'authenticated')::text);
    v_j := public.autorizar_cobro_reserva(v_recalc, ceil(30000::numeric / 2)::int);
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
    v_j := public.autorizar_cobro_reserva(v_recalc, ceil(30000::numeric / 2)::int);
    -- Grupo completo y ambos autorizados. Recalcular invalida las
    -- autorizaciones vigentes; el organizador SIGUE 'aceptado' (no lo
    -- resetea) pero pierde su autorización — a diferencia de v_j3, que
    -- vuelve a 'pendiente' y ya no cuenta como pagador.
    v_j := public.recalcular_cuota_reserva(v_recalc, 2);
    if (v_j->>'ok')::boolean is not true then
      raise exception 'FALLÓ (setup caso 26): recalcular_cuota_reserva debería aceptar, respondió %', v_j;
    end if;
    if not exists (
      select 1 from public.reserva_participantes
       where reserva_id = v_recalc and user_id = v_org and rol = 'organizador' and estado = 'aceptado'
    ) then
      raise exception 'FALLÓ (caso 26): recalcular no debería resetear al organizador a pendiente';
    end if;
    if not exists (
      select 1 from public.reserva_participantes
       where reserva_id = v_recalc and user_id = v_j3 and estado = 'pendiente'
    ) then
      raise exception 'FALLÓ (caso 26): recalcular debería resetear a los no-organizadores a pendiente';
    end if;

    -- v_j3 vuelve a autorizar con la cuota recalculada (igual en este caso:
    -- mismo precio, mismo n). El organizador NO vuelve a autorizar.
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_j3, 'role', 'authenticated')::text);
    v_j := public.autorizar_cobro_reserva(v_recalc, ceil(30000::numeric / 2)::int);
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
    v_j := public.confirmar_reserva(v_recalc);
  end;
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') <> 'autorizacion_pendiente' then
    raise exception 'FALLÓ (caso 26): el organizador con autorización invalidada por el recálculo debería bloquear la confirmación, respondió %', v_j;
  end if;
  if not ((v_j->'usuarios_afectados')::jsonb @> to_jsonb(v_org)::jsonb) then
    raise exception 'FALLÓ (caso 26): usuarios_afectados debería incluir al organizador, respondió %', v_j;
  end if;
  raise notice 'OK (caso 26): recalcular la cuota invalida también la autorización del organizador, no solo la del resto';

  -- ══════════════════════════════════════════════════════════════
  -- SALDO INSUFICIENTE — atomicidad: no se cobra a nadie si falta uno
  -- ══════════════════════════════════════════════════════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_pobre, 'role', 'authenticated')::text);
  v_j := public.crear_reserva(v_cancha, v_fecha, time '19:00', 'completa', 'balance');
  v_sin_plata := (v_j->>'reserva_id')::uuid;
  begin
    v_j := public.autorizar_cobro_reserva(v_sin_plata, 30000);
    v_j := public.confirmar_reserva(v_sin_plata);
  end;
  if (v_j->>'ok')::boolean is not false or (v_j->>'reason') <> 'saldo_insuficiente' then
    raise exception 'FALLÓ (caso 27): confirmar sin saldo debería responder saldo_insuficiente, respondió %', v_j;
  end if;
  select estado into v_estado from public.reservas where id = v_sin_plata;
  if v_estado = 'confirmada' then
    raise exception 'FALLÓ (caso 27): la reserva no debería quedar confirmada sin saldo';
  end if;
  if exists (select 1 from public.balance_movimientos where reserva_id = v_sin_plata and tipo = 'cobro_reserva') then
    raise exception 'FALLÓ (caso 27): no debería haberse cobrado nada — la operación es todo-o-nada';
  end if;
  if not exists (select 1 from public.notifications where user_id = v_pobre and type = 'reserva_saldo_insuficiente') then
    raise exception 'FALLÓ (caso 27): debería notificarse al usuario sin saldo';
  end if;
  raise notice 'OK (caso 27): sin saldo no se confirma ni se cobra a nadie (atomicidad), y se notifica';

  -- ══════════════════════════════════════════════════════════════
  -- CANCELAR_RESERVA / DEVOLUCIÓN
  -- ══════════════════════════════════════════════════════════════

  -- Caso 28: un ajeno no puede cancelar una reserva normal.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  v_j := public.cancelar_reserva(v_res); -- v_res es del caso 21, confirmada, organizador v_org
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 28): un ajeno no debería poder cancelar una reserva de otro';
  end if;
  raise notice 'OK (caso 28): un ajeno no puede cancelar una reserva ajena';

  -- Caso 29: dentro de la ventana de 12h, no se puede cancelar.
  update public.reservas set fecha = current_date, hora_inicio = (now() + interval '2 hours')::time where id = v_res;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
  v_j := public.cancelar_reserva(v_res);
  if (v_j->>'ok')::boolean is not false then
    raise exception 'FALLÓ (caso 29): cancelar a menos de 12h del inicio debería rechazarse, respondió %', v_j;
  end if;
  raise notice 'OK (caso 29): la ventana de 12h antes del inicio bloquea la cancelación';

  -- Caso 30: fuera de la ventana, cancela y devuelve el monto EXACTO cobrado.
  update public.reservas set fecha = current_date + 5, hora_inicio = time '10:00' where id = v_res;
  v_j := public.cancelar_reserva(v_res, 'motivo de prueba');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 30): cancelar fuera de la ventana de 12h debería aceptarse, respondió %', v_j;
  end if;
  select estado into v_estado from public.reservas where id = v_res;
  if v_estado <> 'cancelada' then
    raise exception 'FALLÓ (caso 30): la reserva debería quedar cancelada, quedó %', v_estado;
  end if;
  if not exists (
    select 1 from public.balance_movimientos
     where reserva_id = v_res and user_id = v_org and tipo = 'devolucion_cancelacion'
       and monto = ceil(30000::numeric / 2)::int
  ) then
    raise exception 'FALLÓ (caso 30): al organizador debería devolvérsele exactamente lo que pagó';
  end if;
  if not exists (
    select 1 from public.balance_movimientos
     where reserva_id = v_res and user_id = v_cap2b and tipo = 'devolucion_cancelacion'
       and monto = ceil(30000::numeric / 2)::int
  ) then
    raise exception 'FALLÓ (caso 30): al capitán debería devolvérsele exactamente lo que pagó';
  end if;
  raise notice 'OK (caso 30): cancelar una reserva confirmada devuelve el monto exacto a cada pagador';

  -- Caso 31: cancelar una reserva 'armando' (nunca cobrada) no genera devolución.
  v_j := public.crear_reserva(v_cancha, v_fecha, time '09:00', 'capitanes', 'balance');
  v_sin_cobro := (v_j->>'reserva_id')::uuid;
  begin
    v_j := public.cancelar_reserva(v_sin_cobro);
  end;
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 31): cancelar una reserva armando debería aceptarse siempre, respondió %', v_j;
  end if;
  if exists (select 1 from public.balance_movimientos where reserva_id = v_sin_cobro) then
    raise exception 'FALLÓ (caso 31): una reserva que nunca se cobró no debería generar ningún movimiento al cancelarse';
  end if;
  raise notice 'OK (caso 31): cancelar una reserva "armando" no genera devolución porque nunca se cobró nada';

  -- ══════════════════════════════════════════════════════════════
  -- RECALCULAR_CUOTA_RESERVA (efecto directo, además del caso 26)
  -- ══════════════════════════════════════════════════════════════
  v_j := public.crear_reserva(v_cancha, v_fecha, time '08:00', 'jugadores', 'balance', 2);
  declare v_recalc2 uuid := (v_j->>'reserva_id')::uuid;
  begin
    v_j := public.recalcular_cuota_reserva(v_recalc2, 4);
  end;
  if (v_j->>'ok')::boolean is not true or (v_j->>'cuota')::int <> ceil(30000::numeric / 4)::int then
    raise exception 'FALLÓ (caso 32): recalcular a 4 jugadores debería dejar la cuota en CEIL(30000/4), respondió %', v_j;
  end if;
  raise notice 'OK (caso 32): recalcular_cuota_reserva recalcula la cuota y actualiza n_jugadores';

  -- ══════════════════════════════════════════════════════════════
  -- DESAFÍO DE CLUB: cancelación en dos pasos
  -- ══════════════════════════════════════════════════════════════
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin1, 'role', 'authenticated')::text);
  v_j := public.crear_reserva(
    v_cancha, v_fecha, time '07:00', 'completa', 'balance',
    null, true, v_club1, v_club2
  );
  declare v_desafio uuid := (v_j->>'reserva_id')::uuid;
  begin
    v_j := public.autorizar_cobro_reserva(v_desafio, 30000);
    v_j := public.confirmar_reserva(v_desafio);
    if (v_j->>'ok')::boolean is not true then
      raise exception 'FALLÓ (setup caso 33): la reserva de desafío debería confirmar, respondió %', v_j;
    end if;

    -- Caso 33: cancelar un desafío NO cancela directo, queda 'solicitada'.
    v_j := public.cancelar_reserva(v_desafio);
    if (v_j->>'ok')::boolean is not true or (v_j->>'cancelacion_estado') <> 'solicitada' then
      raise exception 'FALLÓ (caso 33): cancelar un desafío debería dejarlo en cancelacion_estado=solicitada, respondió %', v_j;
    end if;
    select estado into v_estado from public.reservas where id = v_desafio;
    if v_estado <> 'confirmada' then
      raise exception 'FALLÓ (caso 33): la reserva del desafío no debería cancelarse sola, sigue %', v_estado;
    end if;
    if not exists (select 1 from public.notifications where user_id = v_admin2 and type = 'reserva_cancelacion_solicitada') then
      raise exception 'FALLÓ (caso 33): el club rival debería ser notificado de la solicitud de cancelación';
    end if;
    raise notice 'OK (caso 33): cancelar un desafío de club queda pendiente de respuesta del rival, no cancela solo';

    -- Caso 34: quien PIDIÓ la cancelación no puede responderla.
    v_j := public.responder_cancelacion_desafio(v_desafio, true);
    if (v_j->>'ok')::boolean is not false then
      raise exception 'FALLÓ (caso 34): el club que pidió la cancelación no debería poder responderla';
    end if;
    raise notice 'OK (caso 34): solo el club que NO pidió la cancelación puede responder';

    -- Caso 35: el rival RECHAZA la cancelación — la reserva sigue viva.
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin2, 'role', 'authenticated')::text);
    v_j := public.responder_cancelacion_desafio(v_desafio, false);
    if (v_j->>'ok')::boolean is not true or (v_j->>'cancelacion_estado') <> 'rechazada' then
      raise exception 'FALLÓ (caso 35): rechazar debería dejar cancelacion_estado=rechazada, respondió %', v_j;
    end if;
    select estado into v_estado from public.reservas where id = v_desafio;
    if v_estado <> 'confirmada' then
      raise exception 'FALLÓ (caso 35): rechazar la cancelación no debería tocar el estado de la reserva, quedó %', v_estado;
    end if;
    raise notice 'OK (caso 35): el rival puede rechazar la cancelación y la reserva sigue confirmada';

    -- Caso 36: se vuelve a solicitar, y esta vez el rival ACEPTA — cancela y devuelve.
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin1, 'role', 'authenticated')::text);
    v_j := public.cancelar_reserva(v_desafio);
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_admin2, 'role', 'authenticated')::text);
    v_j := public.responder_cancelacion_desafio(v_desafio, true);
    if (v_j->>'ok')::boolean is not true then
      raise exception 'FALLÓ (caso 36): aceptar la cancelación debería aceptarse, respondió %', v_j;
    end if;
    select estado into v_estado from public.reservas where id = v_desafio;
    if v_estado <> 'cancelada' then
      raise exception 'FALLÓ (caso 36): al aceptar debería quedar cancelada, quedó %', v_estado;
    end if;
    if not exists (
      select 1 from public.balance_movimientos
       where reserva_id = v_desafio and user_id = v_admin1 and tipo = 'devolucion_cancelacion' and monto = 30000
    ) then
      raise exception 'FALLÓ (caso 36): debería devolvérsele lo cobrado al organizador del desafío';
    end if;
    raise notice 'OK (caso 36): el rival acepta la cancelación del desafío, cancela y devuelve lo cobrado';
  end;

  -- ══════════════════════════════════════════════════════════════
  -- RLS: privacidad
  -- ══════════════════════════════════════════════════════════════
  -- Acá SÍ hace falta el rol 'authenticated' de verdad: los casos 37-38
  -- prueban que la RLS esconde filas, no la lógica interna de una RPC.
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);

  -- Caso 37: un ajeno no ve una reserva de la que no participa.
  select count(*) into v_count from public.reservas where id = v_res;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 37): un ajeno no debería poder leer una reserva de otro';
  end if;
  raise notice 'OK (caso 37): RLS de reservas oculta lo que no es propio ni convocado';

  -- Caso 38: un ajeno no ve las autorizaciones de cobro de otro (privacidad de montos).
  select count(*) into v_count from public.autorizaciones_cobro where user_id = v_org;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 38): un ajeno no debería poder leer autorizaciones de cobro de otro usuario';
  end if;
  raise notice 'OK (caso 38): RLS de autorizaciones_cobro es estrictamente por dueño';

  -- ══════════════════════════════════════════════════════════════
  -- VENCER_RESERVAS_PASADAS
  -- ══════════════════════════════════════════════════════════════
  reset role;

  declare
    v_vencida    uuid := gen_random_uuid();
    v_confirmada_pasada uuid := gen_random_uuid();
  begin
    insert into public.reservas (
      id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
      precio_total, modalidad, medio_pago, estado
    ) values
      (v_vencida, v_cancha, v_org, current_date - 1, time '10:00', time '11:00',
       30000, 'completa', 'balance', 'armando'),
      (v_confirmada_pasada, v_cancha, v_org, current_date - 1, time '12:00', time '13:00',
       30000, 'completa', 'balance', 'confirmada');

    -- Caso 39: un autenticado NO puede llamarla directo (solo cron/service_role).
    execute format('set local role authenticated');
    execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role', 'authenticated')::text);
    begin
      perform public.vencer_reservas_pasadas();
      v_rechazado := false;
    exception when insufficient_privilege then
      v_rechazado := true;
    end;
    if not v_rechazado then
      raise exception 'FALLÓ (caso 39): un autenticado no debería poder ejecutar vencer_reservas_pasadas directo';
    end if;
    raise notice 'OK (caso 39): vencer_reservas_pasadas no es ejecutable por un usuario autenticado';

    -- Caso 40: como el cron (sin rol acotado), vence lo pasado sin cobrar/confirmar.
    reset role;
    v_j := public.vencer_reservas_pasadas();
    if (v_j->>'ok')::boolean is not true then
      raise exception 'FALLÓ (caso 40): vencer_reservas_pasadas debería responder ok:true, respondió %', v_j;
    end if;
    select estado into v_estado from public.reservas where id = v_vencida;
    if v_estado <> 'vencida' then
      raise exception 'FALLÓ (caso 40): una reserva armando con la hora pasada debería vencer, quedó %', v_estado;
    end if;
    select estado into v_estado from public.reservas where id = v_confirmada_pasada;
    if v_estado <> 'confirmada' then
      raise exception 'FALLÓ (caso 40): una reserva CONFIRMADA con la hora pasada NO debería vencer, quedó %', v_estado;
    end if;
    raise notice 'OK (caso 40): vencer_reservas_pasadas solo toca armando/procesando pasadas, nunca una confirmada';
  end;

  raise notice 'TODAS LAS PRUEBAS DEL CICLO DE VIDA DE RESERVAS PASARON';
end $$;

rollback;
