-- =============================================================
-- FutFinder — pruebas de la migración 68 (cobros adicionales).
--
-- QUÉ SE PRUEBA:
--   1.  El tope de 8 ACTIVOS, al crear y al encender uno apagado.
--   2.  Un ajeno no puede crear cobros.
--   3.  El jugador ve solo los activos de un recinto publicado.
--   4.  El administrador ve también los apagados.
--   5.  Una reserva con dos adicionales: total = cancha + adicionales, y
--       `precio_cancha` guarda la cancha sola.
--   6.  LA COMISIÓN VA SOBRE EL TOTAL, no sobre la cancha. Es lo que
--       impide poner la cancha a $1.000 y un «balón» a $27.000.
--   7.  Congelados: cambiar el precio o el nombre del cobro NO toca las
--       reservas ya hechas.
--   8.  Apagar un cobro no lo borra del historial de una reserva.
--   9.  Un cobro de OTRO complejo se rechaza.
--   10. Un cobro apagado se rechaza.
--   11. La agenda y el detalle traen la lista y el desglose.
--   12. `anon` no crea cobros.
--   13. En pago dividido la cuota sale del total CON adicionales.
--
-- Requiere las migraciones 54 a 68 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_dueno uuid := gen_random_uuid(); v_org uuid := gen_random_uuid(); v_ajeno uuid := gen_random_uuid();
  v_cpl uuid := gen_random_uuid(); v_otro uuid := gen_random_uuid();
  v_cancha uuid := gen_random_uuid(); v_otra_ch uuid := gen_random_uuid();
  v_balon uuid; v_arbitro uuid; v_apagado uuid; v_ajeno_cobro uuid;
  v_res uuid; v_manana date := (now() at time zone 'America/Santiago')::date + 10;
  v_j json; v_n integer; v_rech boolean; i integer;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u,'authenticated','authenticated',
    'r68-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
    from unnest(array[v_dueno, v_org, v_ajeno]) u;
  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado) values
    (v_cpl,'Cobros 68','Maipú',-33.53,-70.76,true), (v_otro,'Otro 68','Ñuñoa',-33.45,-70.60,true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa) values
    (v_cancha, v_cpl,'Cancha 1','futbol_7',28000,60,true),
    (v_otra_ch, v_otro,'Cancha X','futbol_7',28000,60,true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select c, d, time '11:00', time '22:00' from unnest(array[v_cancha, v_otra_ch]) c, generate_series(0,6) d;
  insert into public.complejo_admins (complejo_id, user_id, rol) values
    (v_cpl, v_dueno,'dueño'), (v_otro, v_dueno,'dueño');

  -- Caso 2
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ajeno,'role','authenticated')::text);
  begin perform public.admin_crear_cobro(v_cpl,'Balón',3000); v_rech := false;
  exception when others then v_rech := true; end;
  if not v_rech then raise exception 'FALLÓ (caso 2): un ajeno creó un cobro'; end if;

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno,'role','authenticated')::text);
  v_balon   := public.admin_crear_cobro(v_cpl,'Arriendo de balón',3000);
  v_arbitro := public.admin_crear_cobro(v_cpl,'Árbitro',12000);
  v_apagado := public.admin_crear_cobro(v_cpl,'Estacionamiento',1000);
  perform public.admin_actualizar_cobro(v_apagado, null, null, false);
  v_ajeno_cobro := public.admin_crear_cobro(v_otro,'Balón ajeno',3000);

  -- Caso 1: ya hay 2 activos, se agregan 6 más y el noveno falla.
  for i in 1..6 loop perform public.admin_crear_cobro(v_cpl,'Extra '||i, 1000); end loop;
  begin perform public.admin_crear_cobro(v_cpl,'Uno de más',1000); v_rech := false;
  exception when others then v_rech := true; end;
  if not v_rech then raise exception 'FALLÓ (caso 1): el tope de 8 activos no se respetó'; end if;
  begin perform public.admin_actualizar_cobro(v_apagado, null, null, true); v_rech := false;
  exception when others then v_rech := true; end;
  if not v_rech then raise exception 'FALLÓ (caso 1): encender uno tampoco debería pasar el tope'; end if;
  raise notice 'OK (casos 1-2)';

  -- Casos 3-4
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org,'role','authenticated')::text);
  select count(*) into v_n from public.complejo_cobros where complejo_id = v_cpl;
  if v_n <> 8 then raise exception 'FALLÓ (caso 3): el jugador ve %, deberían ser los 8 activos', v_n; end if;
  select count(*) into v_n from public.complejo_cobros where id = v_apagado;
  if v_n <> 0 then raise exception 'FALLÓ (caso 3): el jugador vio un cobro apagado'; end if;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno,'role','authenticated')::text);
  select count(*) into v_n from public.complejo_cobros where complejo_id = v_cpl;
  if v_n <> 9 then raise exception 'FALLÓ (caso 4): el admin debería ver los 9, ve %', v_n; end if;
  execute 'reset role';
  raise notice 'OK (casos 3-4)';

  -- Casos 5-6: 28.000 + 3.000 + 12.000 = 43.000, comisión 5% = 2.150
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org,'role','authenticated')::text);
  v_j := public.crear_reserva(v_cancha, v_manana, time '20:00','completa','tarjeta',
           null,false,null,null,'Matías Correa','987654321', array[v_balon, v_arbitro]);
  if (v_j->>'ok')::boolean is not true then raise exception 'FALLÓ (caso 5): %', v_j::text; end if;
  v_res := (v_j->>'reserva_id')::uuid;
  if (select precio_total from public.reservas where id = v_res) <> 43000 then
    raise exception 'FALLÓ (caso 5): total = %', (select precio_total from public.reservas where id = v_res); end if;
  if (select precio_cancha from public.reservas where id = v_res) <> 28000 then
    raise exception 'FALLÓ (caso 5): precio_cancha mal'; end if;
  if (select count(*) from public.reserva_cobros where reserva_id = v_res) <> 2 then
    raise exception 'FALLÓ (caso 5): faltan los cobros congelados'; end if;
  if not exists (select 1 from public.reserva_comisiones where reserva_id = v_res
      and base = 43000 and monto = 2150) then
    raise exception 'FALLÓ (caso 6): la comisión debe ir sobre el TOTAL: %',
      (select row_to_json(x)::text from public.reserva_comisiones x where x.reserva_id = v_res); end if;
  raise notice 'OK (casos 5-6): la comisión sale del total, no de la cancha';

  -- Casos 7-8: congelado
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno,'role','authenticated')::text);
  perform public.admin_actualizar_cobro(v_balon,'Balón nuevo', 9000, null);
  if (select precio from public.reserva_cobros where reserva_id = v_res and cobro_id = v_balon) <> 3000 then
    raise exception 'FALLÓ (caso 7): el precio congelado cambió'; end if;
  if (select nombre from public.reserva_cobros where reserva_id = v_res and cobro_id = v_balon) <> 'Arriendo de balón' then
    raise exception 'FALLÓ (caso 7): el nombre congelado cambió'; end if;
  perform public.admin_actualizar_cobro(v_arbitro, null, null, false);
  if (select count(*) from public.reserva_cobros where reserva_id = v_res) <> 2 then
    raise exception 'FALLÓ (caso 8): apagar borró el cobro del historial'; end if;
  raise notice 'OK (casos 7-8)';

  -- Casos 9-10
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org,'role','authenticated')::text);
  v_j := public.crear_reserva(v_cancha, v_manana, time '19:00','completa','tarjeta',
           null,false,null,null,'Matías Correa','987654321', array[v_ajeno_cobro]);
  if (v_j->>'ok')::boolean is not false then raise exception 'FALLÓ (caso 9): aceptó un cobro de otro recinto'; end if;
  v_j := public.crear_reserva(v_cancha, v_manana, time '19:00','completa','tarjeta',
           null,false,null,null,'Matías Correa','987654321', array[v_arbitro]);
  if (v_j->>'ok')::boolean is not false then raise exception 'FALLÓ (caso 10): aceptó un cobro apagado'; end if;
  raise notice 'OK (casos 9-10)';

  -- Caso 11
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno,'role','authenticated')::text);
  v_j := public.admin_reserva_detalle(v_res);
  if json_array_length(v_j->'cobros') <> 2 then raise exception 'FALLÓ (caso 11): detalle'; end if;
  if (v_j->>'total_cobros')::int <> 15000 or (v_j->>'precio_cancha')::int <> 28000 then
    raise exception 'FALLÓ (caso 11): desglose mal: %', v_j::text; end if;
  v_j := public.admin_agenda_complejo(v_cpl, v_manana);
  select json_array_length(r->'cobros') into v_n from json_array_elements(v_j->'reservas') r
   where r->>'id' = v_res::text;
  if v_n <> 2 then raise exception 'FALLÓ (caso 11): la agenda trae % cobros', v_n; end if;
  raise notice 'OK (caso 11)';

  -- Caso 13: 28.000 + 9.000 = 37.000 / 4 = 9.250
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org,'role','authenticated')::text);
  v_j := public.crear_reserva(v_cancha, v_manana, time '18:00','jugadores','balance',
           4,false,null,null,'Matías Correa','987654321', array[v_balon]);
  if (v_j->>'ok')::boolean is not true then raise exception 'FALLÓ (caso 13): %', v_j::text; end if;
  if (select cuota from public.reservas where id = (v_j->>'reserva_id')::uuid) <> 9250 then
    raise exception 'FALLÓ (caso 13): la cuota debe salir del total con adicionales, es %',
      (select cuota from public.reservas where id = (v_j->>'reserva_id')::uuid); end if;
  raise notice 'OK (caso 13)';

  -- Caso 12
  execute format('set local role anon');
  begin perform public.admin_crear_cobro(v_cpl,'x',1); v_rech := false;
  exception when insufficient_privilege then v_rech := true; end;
  if not v_rech then raise exception 'FALLÓ (caso 12): anon'; end if;
  execute 'reset role';
  raise notice 'OK (caso 12)';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 68 PASARON ===';
end $$;

rollback;
