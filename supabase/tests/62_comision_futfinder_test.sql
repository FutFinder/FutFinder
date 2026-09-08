-- =============================================================
-- FutFinder — pruebas de la migración 62 (la comisión de FutFinder).
--
-- QUÉ SE PRUEBA:
--   La tabla de tramos, tramo por tramo
--   1.  $12.000 → $1.000 (piso: el 5% son $600)
--   2.  $18.000 → $1.000 (piso: el 5% son $900)
--   3.  $20.000 → $1.000 (justo donde el 5% iguala el piso)
--   4.  $28.000 → $1.400 (5% puro)
--   5.  $43.000 → $2.150 (5% puro — el ejemplo del diseño)
--   6.  $50.000 → $2.500 (justo donde el 5% iguala el techo)
--   7.  $60.000 → $2.500 (techo: el 5% serían $3.000)
--   8.  $0 → $0 (una cancha gratis no deja al recinto debiendo)
--   9.  $500 → $500 (la comisión nunca supera la base)
--
--   Congelada al reservar
--   10. `crear_reserva` escribe la fila con base, tasa, piso, techo e IVA.
--   11. El monto guardado coincide con `calcular_comision`.
--
--   La regla que más importa: el jugador NO ve la comisión
--   12. El ORGANIZADOR de la reserva no puede leer `reserva_comisiones`.
--   13. Un administrador del complejo sí.
--   14. Un ajeno no.
--
--   El recinto ve el desglose
--   15. `admin_reserva_detalle` trae bruto, comisión y neto.
--   16. `admin_agenda_complejo` los trae por reserva y en el resumen.
--   17. Una reserva CANCELADA no suma a la comisión del resumen.
--
--   Bordes
--   18. La tabla rechaza un monto mayor que la base.
--   19. `anon` no ejecuta las funciones de comisión ni el helper.
--
-- Requiere las migraciones 54 a 62 aplicadas.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_dueno    uuid := gen_random_uuid();
  v_jugador  uuid := gen_random_uuid();
  v_ajeno    uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_cancha43 uuid := gen_random_uuid();
  v_fecha    date := date '2027-03-01';
  v_res      uuid;
  v_res_canc uuid := gen_random_uuid();
  v_res_sin  uuid := gen_random_uuid();
  v_j        json;
  v_n        integer;
  v_rechazado boolean;
begin
  -- ── Casos 1-9: la tabla de tramos ──────────────────────────────
  if public.calcular_comision(12000) <> 1000 then
    raise exception 'FALLÓ (caso 1): $12.000 debería dar el piso $1.000, dio %', public.calcular_comision(12000);
  end if;
  if public.calcular_comision(18000) <> 1000 then
    raise exception 'FALLÓ (caso 2): $18.000 → %', public.calcular_comision(18000);
  end if;
  if public.calcular_comision(20000) <> 1000 then
    raise exception 'FALLÓ (caso 3): $20.000 → %', public.calcular_comision(20000);
  end if;
  if public.calcular_comision(28000) <> 1400 then
    raise exception 'FALLÓ (caso 4): $28.000 → %', public.calcular_comision(28000);
  end if;
  if public.calcular_comision(43000) <> 2150 then
    raise exception 'FALLÓ (caso 5): $43.000 → %', public.calcular_comision(43000);
  end if;
  if public.calcular_comision(50000) <> 2500 then
    raise exception 'FALLÓ (caso 6): $50.000 → %', public.calcular_comision(50000);
  end if;
  if public.calcular_comision(60000) <> 2500 then
    raise exception 'FALLÓ (caso 7): $60.000 debería topar en $2.500, dio %', public.calcular_comision(60000);
  end if;
  if public.calcular_comision(0) <> 0 then
    raise exception 'FALLÓ (caso 8): una cancha gratis no cobra comisión, dio %', public.calcular_comision(0);
  end if;
  if public.calcular_comision(500) <> 500 then
    raise exception 'FALLÓ (caso 9): la comisión no puede superar la base, dio %', public.calcular_comision(500);
  end if;
  raise notice 'OK (casos 1-9): los nueve tramos';

  -- ── Montaje ────────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  )
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r62-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_dueno, v_jugador, v_ajeno]) as u;

  insert into public.complejos (id, nombre, comuna, latitud, longitud)
  values (v_complejo, 'Complejo 62', 'Ñuñoa', -33.45, -70.60);

  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa) values
    (v_cancha,   v_complejo, 'Cancha 28k', 'futbol_7',  28000, 60, true),
    (v_cancha43, v_complejo, 'Cancha 43k', 'futbol_11', 43000, 60, true);

  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select c, d, time '09:00', time '23:00'
    from unnest(array[v_cancha, v_cancha43]) as c, generate_series(0, 6) as d;

  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_complejo, v_dueno, 'dueño');

  -- ── Casos 10-11: crear_reserva congela la comisión ─────────────
  -- Se usa la RPC real y no un insert a mano: lo que se prueba es que el
  -- camino de verdad escriba la comisión.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador, 'role', 'authenticated')::text);
  v_j := public.crear_reserva(v_cancha43, v_fecha, time '10:00', 'completa', 'tarjeta');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 10): no se pudo crear la reserva: %', v_j::text;
  end if;
  v_res := (v_j->>'reserva_id')::uuid;

  select count(*) into v_n from public.reserva_comisiones where reserva_id = v_res;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 10): esperaba 1 fila de comisión, hay %', v_n;
  end if;

  if not exists (
    select 1 from public.reserva_comisiones
     where reserva_id = v_res
       and base = 43000 and monto = 2150
       and tasa = 0.05 and piso = 1000 and techo = 2500 and iva_tasa = 0.19
  ) then
    raise exception 'FALLÓ (casos 10-11): la fila congelada quedó mal: %',
      (select row_to_json(rc)::text from public.reserva_comisiones rc where rc.reserva_id = v_res);
  end if;
  raise notice 'OK (casos 10-11): comisión congelada con sus parámetros';

  -- ── Caso 12: EL JUGADOR NO VE SU COMISIÓN ──────────────────────
  -- El organizador puede leer su propia reserva (policy de la 55), y
  -- justamente por eso la comisión vive en otra tabla.
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jugador, 'role', 'authenticated')::text);

  select count(*) into v_n from public.reservas where id = v_res;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 12): el organizador debería seguir viendo su reserva';
  end if;
  select count(*) into v_n from public.reserva_comisiones where reserva_id = v_res;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 12): EL JUGADOR NO DEBE VER LA COMISIÓN, vio % filas', v_n;
  end if;
  raise notice 'OK (caso 12): el organizador ve su reserva pero NO la comisión';

  -- ── Caso 14: un ajeno tampoco ──────────────────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text);
  select count(*) into v_n from public.reserva_comisiones where reserva_id = v_res;
  if v_n <> 0 then
    raise exception 'FALLÓ (caso 14): un ajeno vio la comisión';
  end if;
  raise notice 'OK (caso 14)';

  -- ── Caso 13: el administrador del complejo sí ──────────────────
  -- ESTE CASO CAZÓ UN BUG REAL antes de aplicar la migración. La primera
  -- versión de la policy hacía `exists (select 1 from public.reservas
  -- ...)`, y ese select corre con los permisos de quien llama: le aplica
  -- la RLS de `reservas`, que solo deja ver al organizador y a los
  -- participantes. El administrador no es ninguno de los dos, el
  -- `exists` no encontraba nada y el recinto no podía leer NI UNA
  -- comisión. Se arregló con `es_admin_de_reserva()`, `security
  -- definer`. Si alguien vuelve a poner un `select` directo en la
  -- policy, este caso se cae.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  select count(*) into v_n from public.reserva_comisiones where reserva_id = v_res;
  if v_n <> 1 then
    raise exception 'FALLÓ (caso 13): el administrador debería ver la comisión de su recinto';
  end if;
  raise notice 'OK (caso 13)';
  execute 'reset role';

  -- ── Caso 15: el detalle trae el desglose ───────────────────────
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_j := public.admin_reserva_detalle(v_res);
  if (v_j->>'comision_base')::int <> 43000
     or (v_j->>'comision')::int <> 2150
     or (v_j->>'neto')::int <> 40850 then
    raise exception 'FALLÓ (caso 15): desglose mal: base %, comisión %, neto %',
      v_j->>'comision_base', v_j->>'comision', v_j->>'neto';
  end if;
  if (v_j->>'comision_iva_tasa')::numeric <> 0.19 then
    raise exception 'FALLÓ (caso 15): falta la tasa de IVA en el detalle';
  end if;
  raise notice 'OK (caso 15): 43.000 − 2.150 = 40.850';

  -- ── Casos 16-17: la agenda y el resumen ────────────────────────
  -- Se confirma la reserva para que sume al resumen, y se agrega una
  -- cancelada que NO debe sumar.
  update public.reservas set estado = 'confirmada', confirmada_at = now() where id = v_res;

  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_res_canc, v_cancha, v_jugador, v_fecha, time '12:00', time '13:00',
          28000, 'completa', 'tarjeta', 'cancelada');
  insert into public.reserva_comisiones (reserva_id, base, tasa, piso, techo, iva_tasa, monto)
  values (v_res_canc, 28000, 0.05, 1000, 2500, 0.19, public.calcular_comision(28000));

  v_j := public.admin_agenda_complejo(v_complejo, v_fecha);

  select (r->>'comision')::int into v_n
    from json_array_elements(v_j->'reservas') r where r->>'id' = v_res::text;
  if v_n <> 2150 then
    raise exception 'FALLÓ (caso 16): la agenda debería traer la comisión, trajo %', v_n;
  end if;
  select (r->>'neto')::int into v_n
    from json_array_elements(v_j->'reservas') r where r->>'id' = v_res::text;
  if v_n <> 40850 then
    raise exception 'FALLÓ (caso 16): neto por reserva = %', v_n;
  end if;

  -- Caso 17: solo la confirmada suma. La cancelada tiene su propia fila
  -- de comisión congelada ($1.400 sobre $28.000) y NO debe contarse:
  -- por eso no hace falta borrarla al cancelar.
  if (v_j->'resumen'->>'comision_confirmada')::int <> 2150 then
    raise exception 'FALLÓ (caso 17): la cancelada no debe sumar comisión; resumen dice %',
      v_j->'resumen'->>'comision_confirmada';
  end if;
  if (v_j->'resumen'->>'neto_confirmado')::int <> 40850 then
    raise exception 'FALLÓ (caso 17): neto confirmado = %', v_j->'resumen'->>'neto_confirmado';
  end if;
  raise notice 'OK (casos 16-17): desglose en la agenda, y la cancelada no cobra';

  -- ── Caso 18: la tabla rechaza monto > base ─────────────────────
  -- Se usa una reserva que EXISTE y todavía no tiene comisión, para que
  -- el rechazo venga del CHECK y no de la llave foránea.
  execute 'reset role';
  insert into public.reservas (id, cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
                               precio_total, modalidad, medio_pago, estado)
  values (v_res_sin, v_cancha, v_jugador, v_fecha, time '14:00', time '15:00',
          28000, 'completa', 'tarjeta', 'procesando');
  begin
    insert into public.reserva_comisiones (reserva_id, base, tasa, piso, techo, iva_tasa, monto)
    values (v_res_sin, 1000, 0.05, 1000, 2500, 0.19, 5000);
    v_rechazado := false;
  exception when check_violation then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 18): una comisión mayor que la base no debería entrar';
  end if;
  raise notice 'OK (caso 18)';

  -- ── Caso 19: anon no ejecuta las funciones de comisión ─────────
  execute format('set local role anon');
  begin
    perform public.calcular_comision(28000);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 19a): anon no debería ejecutar calcular_comision';
  end if;
  begin
    perform public.comision_params();
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 19b): anon no debería ejecutar comision_params';
  end if;
  begin
    perform public.es_admin_de_reserva(v_res);
    v_rechazado := false;
  exception when insufficient_privilege then v_rechazado := true; end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 19c): anon no debería sondear es_admin_de_reserva';
  end if;
  execute 'reset role';
  raise notice 'OK (caso 19)';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 62 PASARON ===';
end $$;

rollback;
