-- =============================================================
-- FutFinder — pruebas de la migración 84 (no se reserva el pasado).
--
-- QUÉ SE PRUEBA:
--   C1. La disponibilidad de HOY ya no ofrece bloques que empezaron.
--   C2. Reservar una hora de hoy que ya pasó se rechaza, con mensaje.
--   C3. Reservar ayer se rechaza.
--   C4. Una reserva FUTURA sigue funcionando — lo que importa tanto como
--       lo anterior: un arreglo que además rompa lo que servía no sirve.
--   C5. Y se puede pagar.
--   C6. No nace un pago para un bloque que ya empezó, ni saltándose la RPC.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- Requiere las migraciones 54 a 84 aplicadas, y un complejo publicado con
-- una cancha activa con horario.
-- =============================================================

begin;

create temp table r84 (caso text, ok boolean, detalle text);
grant all on r84 to authenticated, anon;

do $$
declare
  v_yo uuid := gen_random_uuid(); v_cpl uuid; v_cancha uuid; v_res json;
  v_hoy date; v_ahora time; v_libres int; v_pasadas int; v_h time; v_err text; v_r uuid;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_yo, 'authenticated', 'authenticated',
         'r84-' || v_yo || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');

  select c.id into v_cpl from public.complejos c where c.publicado limit 1;
  select k.id into v_cancha from public.canchas_reservables k
   where k.complejo_id = v_cpl and k.activa
     and exists (select 1 from public.cancha_horario_reglas hr where hr.cancha_id = k.id) limit 1;

  -- La hora de CHILE, no la del servidor: es la diferencia que arregló la 70.
  v_hoy := (now() at time zone 'America/Santiago')::date;
  v_ahora := (now() at time zone 'America/Santiago')::time;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);

  select count(*) filter (where (s->>'disponible')::boolean),
         count(*) filter (where (s->>'disponible')::boolean and (s->>'hora_inicio')::time < v_ahora)
    into v_libres, v_pasadas
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_hoy)->'slots') s;
  insert into r84 values ('C1', v_pasadas = 0,
                          v_pasadas || ' pasadas de ' || v_libres || ' libres hoy');

  select (s->>'hora_inicio')::time into v_h
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_hoy)->'slots') s
   where (s->>'hora_inicio')::time < v_ahora limit 1;
  if v_h is not null then
    v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_hoy, p_hora_inicio := v_h,
      p_modalidad := 'completa', p_medio_pago := 'tarjeta', p_n_jugadores := 10,
      p_contacto_nombre := 'QA', p_contacto_telefono := '+56911111111', p_cobros := null);
    insert into r84 values ('C2', not (v_res->>'ok')::boolean,
                            v_h || ' -> ' || coalesce(v_res->>'reason', v_res::text));
  end if;

  v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_hoy - 1, p_hora_inicio := '20:00',
    p_modalidad := 'completa', p_medio_pago := 'tarjeta', p_n_jugadores := 10,
    p_contacto_nombre := 'QA', p_contacto_telefono := '+56911111111', p_cobros := null);
  insert into r84 values ('C3', not (v_res->>'ok')::boolean, coalesce(v_res->>'reason', v_res::text));

  select (s->>'hora_inicio')::time into v_h
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_hoy + 2)->'slots') s
   where (s->>'disponible')::boolean limit 1;
  v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_hoy + 2, p_hora_inicio := v_h,
    p_modalidad := 'completa', p_medio_pago := 'tarjeta', p_n_jugadores := 10,
    p_contacto_nombre := 'QA', p_contacto_telefono := '+56911111111', p_cobros := null);
  v_r := (v_res->>'reserva_id')::uuid;
  insert into r84 values ('C4', (v_res->>'ok')::boolean, v_res::text);

  if v_r is not null then
    v_res := public.iniciar_pago_reserva(v_r);
    insert into r84 values ('C5', (v_res->>'ok')::boolean, v_res::text);
  end if;

  reset role;
  set local request.jwt.claims to '{}';
  -- Se fuerza una reserva vieja por debajo de la RPC, para probar que lo que
  -- corta el pago es el disparador y no la validación de `crear_reserva`.
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, estado)
  values (v_cancha, v_yo, v_hoy - 1, '20:00', '21:00', 10000, 10000, 'completa', 'tarjeta', 'armando')
  returning id into v_r;
  begin
    insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio)
    values (v_yo, v_r, 10000, 'flow', 'QA-84');
    v_err := 'NO lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r84 values ('C6', v_err <> 'NO lo rechazó', v_err);
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r84 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r84 where not ok order by caso loop
    raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle;
  end loop;
  select count(*) into v_malos from r84 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 84 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 84 PASARON ===';
end $$;

rollback;
