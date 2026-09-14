-- =============================================================
-- FutFinder — pruebas de la migración 85 (eliminar un cobro adicional).
--
-- QUÉ SE PRUEBA:
--   E1. Un cobro que nunca se usó se BORRA de verdad.
--   E2. Uno que ya se cobró se APAGA, y la función lo dice —con cuántas
--       veces— para que la pantalla no prometa un borrado que no pasó.
--   E3. Tocar el botón dos veces no es un error.
--   E4. Un administrador sin `puede_cobros` no puede, ni borrar ni apagar:
--       lo corta el disparador de la 83, no un chequeo repetido acá.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- Requiere las migraciones 54 a 85 aplicadas.
-- =============================================================

begin;

create temp table r85 (caso text, ok boolean, detalle text);
grant all on r85 to authenticated, anon;

do $$
declare
  v_dueno uuid; v_cpl uuid; v_cobro uuid; v_res json; v_n int;
  v_mano uuid := gen_random_uuid(); v_err text; v_cancha uuid; v_reserva uuid;
begin
  select a.complejo_id, a.user_id into v_cpl, v_dueno
    from public.complejo_admins a where a.rol = 'dueño' limit 1;
  select k.id into v_cancha from public.canchas_reservables k where k.complejo_id = v_cpl limit 1;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_mano, 'authenticated', 'authenticated',
         'r85-' || v_mano || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_cpl, v_mano, 'admin');

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_dueno, 'role', 'authenticated')::text);

  v_cobro := public.admin_crear_cobro(v_cpl, 'Prueba 85 sin uso', 1000);
  v_res := public.admin_eliminar_cobro(v_cobro);
  select count(*) into v_n from public.complejo_cobros where id = v_cobro;
  insert into r85 values ('E1', v_res->>'resultado' = 'eliminado' and v_n = 0,
                          v_res::text || ' | quedan ' || v_n);

  v_cobro := public.admin_crear_cobro(v_cpl, 'Prueba 85 usado', 2000);
  reset role;
  set local request.jwt.claims to '{}';
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, estado)
  values (v_cancha, v_dueno, current_date + 5, '10:00', '11:00', 12000, 10000,
          'completa', 'tarjeta', 'armando')
  returning id into v_reserva;
  insert into public.reserva_cobros (reserva_id, cobro_id, nombre, precio)
  values (v_reserva, v_cobro, 'Prueba 85 usado', 2000);

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_dueno, 'role', 'authenticated')::text);
  v_res := public.admin_eliminar_cobro(v_cobro);
  select count(*) filter (where activo) into v_n from public.complejo_cobros where id = v_cobro;
  insert into r85 values ('E2',
    v_res->>'resultado' = 'apagado' and (v_res->>'usos')::int = 1 and v_n = 0, v_res::text);

  v_res := public.admin_eliminar_cobro(gen_random_uuid());
  insert into r85 values ('E3', (v_res->>'ok')::boolean, v_res::text);

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_mano, 'role', 'authenticated')::text);
  select id into v_cobro from public.complejo_cobros where complejo_id = v_cpl limit 1;
  begin
    perform public.admin_eliminar_cobro(v_cobro);
    v_err := 'NO lo rechazó';
  exception when others then v_err := sqlerrm; end;
  insert into r85 values ('E4', v_err like '%No tienes permiso%', v_err);
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r85 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r85 where not ok order by caso loop
    raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle;
  end loop;
  select count(*) into v_malos from r85 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 85 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 85 PASARON ===';
end $$;

rollback;
