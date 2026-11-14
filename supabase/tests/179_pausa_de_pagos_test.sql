-- =============================================================
-- FutFinder — pruebas de la migración 179 (un interruptor para dejar de
-- cobrar).
--
--   A  Con la bandera apagada todo sigue igual (control).
--   B  Con la bandera encendida no nace ningún pago, y el rechazo trae su
--      código (55000), no «algo falló». Reusar un pendiente no inserta, así
--      que sigue contestando.
--   C  Lo que ya existe se puede confirmar con la bandera encendida.
--   D  `pagos_en_pausa()` es sólo de service_role.
--   E  Al apagarla vuelve a cobrar.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK. Si un caso
-- falla, el arnés falla (no basta con que llegue al final).
-- =============================================================

begin;

create temp table r179 (caso text, ok boolean, detalle text);
grant all on r179 to authenticated, anon, service_role;

create or replace function pg_temp.como(p_uid uuid, p_sql text, p_rol text default 'authenticated')
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', p_rol, 'aal', 'aal1')::text, true);
  execute format('set local role %I', p_rol);
  begin
    execute p_sql into v; execute 'reset role'; v := 'ok:' || coalesce(v, '');
  exception when others then execute 'reset role'; v := 'err:' || sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

do $$
declare
  u1 uuid := gen_random_uuid(); u_admin uuid := gen_random_uuid();
  v_comp uuid; v_cancha uuid; v_res uuid; v_res2 uuid; v_res3 uuid;
  v_j json; r text; v_n int; v_orden text; v_estado text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r179-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u_admin]) u;
  insert into public.profiles (id, username) select u, 'r179' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u_admin]) u on conflict (id) do nothing;


  insert into public.complejos (nombre, comuna, latitud, longitud) values ('r179 recinto', 'Ñuñoa', -33.45, -70.6) returning id into v_comp;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_comp, u_admin, 'dueño');
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora) values (v_comp, 'r179 cancha', 'futbol_7', 20000) returning id into v_cancha;

  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 200, '05:13', '06:13', 20000, 'completa', 'tarjeta', 20000, 'armando') returning id into v_res;
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 201, '05:13', '06:13', 20000, 'completa', 'tarjeta', 20000, 'armando') returning id into v_res2;
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 202, '05:13', '06:13', 20000, 'completa', 'tarjeta', 20000, 'armando') returning id into v_res3;

  -- ── A: apagada ──
  update public.feature_flags set activo = false where nombre = 'pagos_en_pausa';
  insert into r179 select 'A1 la bandera existe y nace apagada',
    exists (select 1 from public.feature_flags where nombre = 'pagos_en_pausa') and not public.pagos_en_pausa(), '';
  r := pg_temp.como(u1, format($q$select public.iniciar_pago_reserva(%L)::text$q$, v_res));
  select count(*) into v_n from public.pagos where reserva_id = v_res and estado = 'pendiente';
  insert into r179 values ('A2 control: apagada, el pago nace', r like 'ok:%"ok" : true%' and v_n = 1, r || ' n=' || v_n);

  -- ── B: encendida ──
  update public.feature_flags set activo = true, activado_at = coalesce(activado_at, now()) where nombre = 'pagos_en_pausa';
  insert into r179 select 'B1 encendida, pagos_en_pausa() lo dice', public.pagos_en_pausa(), '';
  r := pg_temp.como(u1, format($q$select public.iniciar_pago_reserva(%L)::text$q$, v_res2));
  select count(*) into v_n from public.pagos where reserva_id = v_res2;
  insert into r179 values ('B2 encendida, no nace un pago nuevo (55000)', r like 'err:55000 %en pausa%', r);
  insert into r179 values ('B3 y no quedó ninguna fila', v_n = 0, 'n=' || v_n);
  r := pg_temp.como(u1, format($q$select public.iniciar_pago_reserva(%L)::text$q$, v_res));
  select count(*) into v_n from public.pagos where reserva_id = v_res;
  insert into r179 values ('B4 reusar el pendiente no inserta: sigue contestando', r like 'ok:%"reusado" : true%' and v_n = 1, r || ' n=' || v_n);

  -- ── C: lo que ya existe se confirma igual ──
  select orden_comercio into v_orden from public.pagos where reserva_id = v_res;
  v_j := public.confirmar_pago(v_orden, 'TOKENR179000000000', '{"amount": 20000}'::jsonb);
  select estado into v_estado from public.pagos where reserva_id = v_res;
  insert into r179 values ('C1 encendida, un pago pendiente se confirma',
    (v_j->>'ok')::boolean and v_estado = 'pagado'
      and (select estado from public.reservas where id = v_res) = 'confirmada',
    v_j::text || ' pago=' || v_estado);

  -- ── D: quién puede preguntar ──
  r := pg_temp.como(u1, 'select public.pagos_en_pausa()::text');
  insert into r179 values ('D1 authenticated no ejecuta pagos_en_pausa (42501)', r like 'err:42501%', r);
  r := pg_temp.como(null, 'select public.pagos_en_pausa()::text', 'anon');
  insert into r179 values ('D2 anon tampoco (42501)', r like 'err:42501%', r);
  r := pg_temp.como(null, 'select public.pagos_en_pausa()::text', 'service_role');
  insert into r179 values ('D3 service_role sí', r = 'ok:true', r);
  r := pg_temp.como(u1, $q$update public.feature_flags set activo = false where nombre = 'pagos_en_pausa' returning 'cambiada'$q$);
  insert into r179 values ('D4 un usuario no puede apagar la bandera', public.pagos_en_pausa() and r not like 'ok:cambiada%', r);

  -- ── E: al apagarla vuelve ──
  update public.feature_flags set activo = false where nombre = 'pagos_en_pausa';
  r := pg_temp.como(u1, format($q$select public.iniciar_pago_reserva(%L)::text$q$, v_res3));
  select count(*) into v_n from public.pagos where reserva_id = v_res3 and estado = 'pendiente';
  insert into r179 values ('E1 apagada otra vez, el pago nace', r like 'ok:%"ok" : true%' and v_n = 1, r || ' n=' || v_n);
end $$;

select caso, ok, detalle from r179 order by caso;

do $$
declare v text;
begin
  select string_agg(caso || ' → ' || detalle, E'\n') into v from r179 where ok is not true;
  if v is not null then raise exception E'179: casos fallidos:\n%', v; end if;
end $$;

rollback;
