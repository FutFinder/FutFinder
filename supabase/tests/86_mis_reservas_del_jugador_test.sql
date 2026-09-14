-- =============================================================
-- FutFinder — pruebas de la migración 86 (mis reservas del jugador).
--
-- QUÉ SE PRUEBA:
--   M1. Veo mi reserva.
--   M2. Trae el nombre del recinto y de la cancha, que es lo que la RLS de
--       esas tablas no deja ver por sí sola.
--   M3. Sin pagar se puede cancelar.
--   M6. Aparece el estado del pago, para poder ofrecer «continuar al pago».
--   M7. Confirmada y a pocas horas: NO se puede cancelar.
--   M8. EL RECINTO DESPUBLICADO NO ME BORRA LA RESERVA. Es la razón de que
--       esto sea una RPC `security definer` y no una consulta directa.
--   M9. Otro usuario no ve ninguna.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- Requiere las migraciones 54 a 86 aplicadas, y un complejo publicado con
-- una cancha activa con horario.
-- =============================================================

begin;

create temp table r86 (caso text, ok boolean, detalle text);
grant all on r86 to authenticated, anon;

do $$
declare
  v_yo uuid := gen_random_uuid(); v_otro uuid := gen_random_uuid();
  v_cpl uuid; v_cancha uuid; v_res json; v_n int; v_fila record; v_r uuid;
  v_hoy date; v_h time;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r86-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_yo, v_otro]) u;

  select c.id into v_cpl from public.complejos c where c.publicado limit 1;
  select k.id into v_cancha from public.canchas_reservables k
   where k.complejo_id = v_cpl and k.activa
     and exists (select 1 from public.cancha_horario_reglas hr where hr.cancha_id = k.id) limit 1;
  v_hoy := (now() at time zone 'America/Santiago')::date;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);

  select (s->>'hora_inicio')::time into v_h
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_hoy + 3)->'slots') s
   where (s->>'disponible')::boolean limit 1;
  v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_hoy + 3, p_hora_inicio := v_h,
    p_modalidad := 'completa', p_medio_pago := 'tarjeta', p_n_jugadores := 10,
    p_contacto_nombre := 'QA', p_contacto_telefono := '+56911111111', p_cobros := null);
  v_r := (v_res->>'reserva_id')::uuid;

  select count(*) into v_n from public.mis_reservas();
  insert into r86 values ('M1', v_n = 1, v_n || ' filas');

  select * into v_fila from public.mis_reservas() limit 1;
  insert into r86 values ('M2',
    v_fila.complejo_nombre is not null and v_fila.cancha_nombre is not null,
    v_fila.complejo_nombre || ' / ' || v_fila.cancha_nombre);
  insert into r86 values ('M3', v_fila.puede_cancelar, v_fila.estado);

  perform public.iniciar_pago_reserva(v_r);
  select * into v_fila from public.mis_reservas() limit 1;
  insert into r86 values ('M6', v_fila.pago_estado = 'pendiente',
                          coalesce(v_fila.pago_estado, 'null'));

  -- Confirmada y a pocas horas: se cierra la ventana.
  reset role;
  set local request.jwt.claims to '{}';
  update public.reservas
     set estado = 'confirmada', fecha = v_hoy, hora_inicio = '23:30', hora_fin = '23:59'
   where id = v_r;
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);
  select * into v_fila from public.mis_reservas() limit 1;
  insert into r86 values ('M7', not v_fila.puede_cancelar,
                          'hasta ' || coalesce(v_fila.cancelacion_hasta::text, 'null'));

  -- Y el recinto despublicado no me la hace desaparecer.
  reset role;
  set local request.jwt.claims to '{}';
  update public.complejos set publicado = false where id = v_cpl;
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_yo, 'role', 'authenticated')::text);
  select count(*) into v_n from public.mis_reservas();
  insert into r86 values ('M8', v_n = 1, v_n || ' filas con el recinto despublicado');

  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_otro, 'role', 'authenticated')::text);
  select count(*) into v_n from public.mis_reservas();
  insert into r86 values ('M9', v_n = 0, v_n || ' filas para otro usuario');
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r86 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r86 where not ok order by caso loop
    raise warning 'FALLÓ (caso %): %', v_f.caso, v_f.detalle;
  end loop;
  select count(*) into v_malos from r86 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 86 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 86 PASARON ===';
end $$;

rollback;
