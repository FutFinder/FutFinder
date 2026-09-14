-- =============================================================
-- FutFinder — pruebas de la migración 87 (devolver un pago).
--
-- QUÉ SE PRUEBA:
--   D1. Un pago en `reversar` se marca como devuelto.
--   D2. Y queda la fecha, la nota y quién lo hizo.
--   D3. Marcarlo dos veces no es un error…
--   D4. …y NO pisa la nota ni la fecha de la primera vez.
--   D5. Un pago BIEN COBRADO no se puede marcar como devuelto. Dejarlo
--       pasar descuadraría la caja con una sola consulta.
--   D6. Uno que no existe devuelve un motivo, no revienta.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- Requiere las migraciones 54 a 87 aplicadas.
-- =============================================================

begin;

create temp table r87 (caso text, ok boolean, detalle text);

do $$
declare
  v_yo uuid := gen_random_uuid(); v_cpl uuid; v_cancha uuid;
  v_reserva uuid; v_pago uuid; v_res json; v_n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_yo, 'authenticated', 'authenticated',
         'r87-' || v_yo || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  select c.id into v_cpl from public.complejos c limit 1;
  select k.id into v_cancha from public.canchas_reservables k where k.complejo_id = v_cpl limit 1;

  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, estado)
  values (v_cancha, v_yo, current_date + 4, '10:00', '11:00', 20000, 20000,
          'completa', 'tarjeta', 'rechazada')
  returning id into v_reserva;

  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio, estado, pagado_at)
  values (v_yo, v_reserva, 20000, 'flow', 'QA-87', 'reversar', now())
  returning id into v_pago;

  v_res := public.marcar_pago_reversado(v_pago, 'Devuelto por transferencia el 14/09', v_yo);
  insert into r87 values ('D1', (v_res->>'ok')::boolean, v_res::text);

  select count(*) into v_n from public.pagos
   where id = v_pago and estado = 'reversado'
     and reversado_at is not null and reversa_nota is not null and reversado_por = v_yo;
  insert into r87 values ('D2', v_n = 1, v_n::text);

  v_res := public.marcar_pago_reversado(v_pago, 'otra nota');
  insert into r87 values ('D3', (v_res->>'ok')::boolean and (v_res->>'ya_estaba')::boolean, v_res::text);

  select count(*) into v_n from public.pagos where id = v_pago and reversa_nota = 'otra nota';
  insert into r87 values ('D4', v_n = 0, v_n || ' filas con la nota nueva');

  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio, estado, pagado_at)
  values (v_yo, null, 5000, 'flow', 'QA-87-b', 'pagado', now())
  returning id into v_pago;
  v_res := public.marcar_pago_reversado(v_pago, null);
  insert into r87 values ('D5', not (v_res->>'ok')::boolean, v_res->>'reason');

  v_res := public.marcar_pago_reversado(gen_random_uuid(), null);
  insert into r87 values ('D6', not (v_res->>'ok')::boolean, v_res->>'reason');
end $$;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r87 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r87 where not ok order by caso loop
    raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle;
  end loop;
  select count(*) into v_malos from r87 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 87 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 87 PASARON ===';
end $$;

rollback;
