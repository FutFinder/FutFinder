-- =============================================================
-- FutFinder — pruebas de la migración 178 (los cobros que no se pierden).
--
--   A  pago_cobrado_sin_reserva: deja el pago para devolver con su motivo y
--      avisa; es idempotente; no toca un pago ya pagado; no es del cliente.
--   B  limite_aviso_de_pago: corta en 120 por minuto y por IP.
--   C  confirmar_reserva_interna sigue confirmando y cobrando (control), y
--      lleva el candado por pagador.
--   D  admin_cancelar_reserva devuelve una vez y la segunda cancelación se
--      rechaza; lleva `for update`.
--
-- Lo que este arnés NO puede ver: dos transacciones a la vez (corre en una
-- sola). Los candados se comprueban por presencia; la carrera real se prueba
-- con `scripts/carrera-dos-sesiones.sh` contra la base local.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r178 (caso text, ok boolean, detalle text);
grant all on r178 to authenticated;

create or replace function pg_temp.como(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
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
  v_comp uuid; v_cancha uuid; v_res uuid; v_res2 uuid; v_pago uuid;
  v_j json; r text; v_n int; v_saldo int; i int; v_ultimo boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r178-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u1, u_admin]) u;
  insert into public.profiles (id, username) select u, 'r178' || substr(replace(u::text, '-', ''), 1, 10) from unnest(array[u1, u_admin]) u on conflict (id) do nothing;

  insert into public.complejos (nombre, comuna, latitud, longitud) values ('r178 recinto', 'Ñuñoa', -33.45, -70.6) returning id into v_comp;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_comp, u_admin, 'dueño');
  insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora) values (v_comp, 'r178 cancha', 'futbol_7', 20000) returning id into v_cancha;

  -- ── A ──
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 200, '05:13', '06:13', 20000, 'completa', 'tarjeta', 20000, 'armando') returning id into v_res;
  insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio, estado)
  values (u1, v_res, 20000, 'flow', 'R178-A', 'expirado') returning id into v_pago;

  v_j := public.pago_cobrado_sin_reserva('R178-A', 'TOKENR178000000000', '{"amount": 20000}', 'Cobrado cuando el pago ya no estaba pendiente');
  insert into r178 select 'A1 el cobro queda para devolver, con motivo',
    (v_j->>'ok')::boolean and p.estado = 'reversar' and p.reversa_nota like 'Cobrado cuando%' and p.pagado_at is not null
      and p.referencia_externa = 'TOKENR178000000000',
    v_j::text || ' ' || p.estado
    from public.pagos p where p.id = v_pago;
  insert into r178 select 'A2 y la persona recibe el aviso',
    exists (select 1 from public.notifications where user_id = u1 and title = 'Te devolveremos un pago' and data->>'pagoId' = v_pago::text), '';
  v_j := public.pago_cobrado_sin_reserva('R178-A', 'TOKENR178000000000', null, 'otra vez');
  select count(*) into v_n from public.notifications where user_id = u1 and title = 'Te devolveremos un pago';
  insert into r178 values ('A3 el aviso repetido de Flow no duplica nada', (v_j->>'ya_estaba')::boolean and v_n = 1, v_j::text || ' avisos=' || v_n);

  update public.pagos set estado = 'pagado' where id = v_pago;
  v_j := public.pago_cobrado_sin_reserva('R178-A', null, null, 'x');
  insert into r178 select 'A4 un pago ya pagado no se toca', (v_j->>'ya_estaba')::boolean and p.estado = 'pagado', v_j::text
    from public.pagos p where p.id = v_pago;
  v_j := public.pago_cobrado_sin_reserva('NO-EXISTE', null, null, 'x');
  insert into r178 values ('A5 una orden desconocida no rompe', not (v_j->>'ok')::boolean, v_j::text);
  r := pg_temp.como(u1, $q$select public.pago_cobrado_sin_reserva('R178-A', null, null, 'x')::text$q$);
  insert into r178 values ('A6 el cliente no la ejecuta', r like 'err:42501%', r);

  -- ── B ──
  for i in 1 .. 120 loop
    v_ultimo := public.limite_aviso_de_pago('203.0.113.7');
  end loop;
  insert into r178 values ('B1 hasta 120 avisos por minuto pasan', v_ultimo, v_ultimo::text);
  v_ultimo := public.limite_aviso_de_pago('203.0.113.7');
  insert into r178 values ('B2 el 121 se corta', v_ultimo = false, v_ultimo::text);
  insert into r178 values ('B3 otra IP no se ve afectada', public.limite_aviso_de_pago('198.51.100.9'), '');
  r := pg_temp.como(u1, $q$select public.limite_aviso_de_pago('1.1.1.1')::text$q$);
  insert into r178 values ('B4 el cliente no la ejecuta', r like 'err:42501%', r);

  -- ── C ──
  insert into public.balance_movimientos (user_id, tipo, monto, metodo_carga) values (u1, 'carga', 50000, 'transferencia');
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin, precio_total, modalidad, medio_pago, precio_cancha, estado)
  values (v_cancha, u1, current_date + 201, '05:13', '06:13', 20000, 'completa', 'balance', 20000, 'armando') returning id into v_res2;
  insert into public.autorizaciones_cobro (reserva_id, user_id, monto, vigente) values (v_res2, u1, 20000, true);
  v_j := public.confirmar_reserva_interna(v_res2);
  select coalesce(sum(monto), 0) into v_saldo from public.balance_movimientos where user_id = u1;
  insert into r178 values ('C1 control: confirmar con saldo sigue cobrando y confirmando',
    (v_j->>'ok')::boolean and v_saldo = 30000 and (select estado from public.reservas where id = v_res2) = 'confirmada',
    v_j::text || ' saldo=' || v_saldo);
  insert into r178 select 'C2 lleva el candado por pagador',
    pg_get_functiondef('public.confirmar_reserva_interna(uuid)'::regprocedure) like '%saldo_del_pagador%', '';

  -- ── D ──
  r := pg_temp.como(u_admin, format($q$select public.admin_cancelar_reserva(%L, 'Cierre por mantención de la cancha')::text$q$, v_res2));
  select coalesce(sum(monto), 0) into v_saldo from public.balance_movimientos where user_id = u1;
  insert into r178 values ('D1 control: el recinto cancela y devuelve una vez', r like 'ok:%' and v_saldo = 50000, r || ' saldo=' || v_saldo);
  r := pg_temp.como(u_admin, format($q$select public.admin_cancelar_reserva(%L, 'Cierre por mantención de la cancha')::text$q$, v_res2));
  select coalesce(sum(monto), 0) into v_saldo from public.balance_movimientos where user_id = u1;
  insert into r178 values ('D2 una segunda cancelación no devuelve otra vez', r like 'err:%no está activa%' and v_saldo = 50000, r || ' saldo=' || v_saldo);
  insert into r178 select 'D3 lee la reserva con for update',
    pg_get_functiondef('public.admin_cancelar_reserva(uuid,text)'::regprocedure) like '%where id = p_reserva_id for update;%', '';
end $$;

select caso, ok, detalle from r178 order by caso;

rollback;
