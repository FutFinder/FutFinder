-- =============================================================
-- FutFinder — pruebas de la migración 94 (armar la reserva dividida).
--
-- CADA RECHAZO COMPRUEBA EL MENSAJE EXACTO. Ya pasó dos veces en este
-- proyecto que una excepción de OTRA regla se disfrazó de rechazo
-- esperado y dejó el arnés en verde sin probar nada.
--
-- QUÉ SE PRUEBA:
--   P1.  `crear_reserva` dividida con Balance deja al organizador dentro.
--   P2.  `crear_reserva` dividida con tarjeta se rechaza (Balance manda).
--   P3.  Un ajeno no puede leer la nómina.
--   P4.  Invitar más allá del cupo se corta al invitar, no al confirmar.
--   P5.  Autorizar un monto que no es la cuota se rechaza.
--   P6.  Con el grupo a medio autorizar la reserva sigue 'armando'.
--   P7.  LA CANCHA NO SE RETIENE: dos grupos arman la misma hora a la vez.
--   P8.  Un no-organizador no confirma.
--   P9.  Recordatorio: avisa a los que faltan, y no dos veces en una hora.
--   P10. AUTOCONFIRMACIÓN: el último autoriza y la reserva se cierra sola.
--   P11. Se cobró a los tres, cada uno su cuota, y a nadie más (fuera de RLS).
--   P12a-P12b. El grupo que perdió la hora recibe 'ocupado' — y NO se le cobró
--        a nadie: no hay ninguna devolución que hacer.
--   P13. Sin saldo la autoconfirmación falla, PERO la autorización que la
--        persona acaba de dar sobrevive (el savepoint).
--   P14. Sacar a alguien invalida su autorización vigente.
--   P15. `mis_reservas` trae el avance del grupo.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- Requiere las migraciones 54 a 94 aplicadas, y un complejo publicado con
-- una cancha activa con horario.
-- =============================================================

begin;

create temp table r90 (caso text, ok boolean, detalle text);
-- Los ids salen del bloque para que las cuentas de PLATA se hagan al
-- final, ya sin RLS. Contarlas desde adentro de la sesión de un jugador
-- devuelve 1 de 3 —`balance_movimientos` solo deja ver lo propio, que es
-- justo su gracia— y parece un cobro perdido. Ese fue el falso rojo de la
-- primera corrida: el tercer verde falso de este proyecto, y otra vez por
-- medir desde el lugar equivocado en vez de por un error del código.
create temp table ids90 (k text, v uuid);
grant all on r90, ids90 to authenticated, anon;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_cancha uuid; v_fecha date; v_h time; v_res json; v_det json;
  v_r uuid; v_r2 uuid; v_precio int; v_cuota int; v_n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r90-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b, v_c, v_x, v_d]) u;
  update public.profiles set username = 'r90-' || left(id::text, 4)
   where id in (v_a, v_b, v_c, v_x, v_d);

  select k.id into v_cancha
    from public.canchas_reservables k
    join public.complejos c on c.id = k.complejo_id
   where c.publicado and k.activa
     and exists (select 1 from public.cancha_horario_reglas hr where hr.cancha_id = k.id)
   limit 1;
  v_fecha := (now() at time zone 'America/Santiago')::date + 6;
  select (s->>'hora_inicio')::time into v_h
    from json_array_elements(public.get_disponibilidad_cancha(v_cancha, v_fecha)->'slots') s
   where (s->>'disponible')::boolean limit 1;

  -- El saldo se carga ACÁ, antes de bajar a `authenticated`:
  -- `balance_movimientos` no tiene policy de insert a propósito (migración
  -- 56), así que como jugador esto no se puede ni debe poder. v_d queda
  -- sin saldo a propósito: es el caso P13.
  insert into public.balance_movimientos (user_id, tipo, monto, metodo_carga)
  select u, 'carga', 500000, 'transferencia' from unnest(array[v_a, v_b, v_c, v_x]) u;

  set local role authenticated;

  -- ── P1-P2: crear la reserva dividida ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_fecha,
      p_hora_inicio := v_h, p_modalidad := 'jugadores', p_medio_pago := 'balance',
      p_n_jugadores := 3,
      p_contacto_nombre := 'Prueba R90', p_contacto_telefono := '912345678');
  v_r := (v_res->>'reserva_id')::uuid;
  select cuota into v_cuota from public.reservas where id = v_r;
  insert into r90 values ('P1',
    (v_res->>'ok')::boolean and v_r is not null
      and exists (select 1 from public.reserva_participantes
                   where reserva_id = v_r and user_id = v_a
                     and rol = 'organizador' and estado = 'aceptado'),
    'cuota ' || v_cuota);

  v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_fecha,
      p_hora_inicio := v_h, p_modalidad := 'jugadores', p_medio_pago := 'tarjeta',
      p_n_jugadores := 3,
      p_contacto_nombre := 'Prueba R90', p_contacto_telefono := '912345678');
  insert into r90 values ('P2',
    not (v_res->>'ok')::boolean
      and v_res->>'reason' = 'Esta modalidad requiere Balance FutFinder',
    v_res->>'reason');

  -- ── P3: la nómina no es de cualquiera ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_x, 'role', 'authenticated')::text);
  v_res := public.detalle_reserva(v_r);
  insert into r90 values ('P3',
    not (v_res->>'ok')::boolean and v_res->>'reason' = 'Esta reserva no es tuya',
    v_res->>'reason');

  -- ── P4: el cupo se corta al invitar ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  perform public.invitar_participante_reserva(v_r, v_b, 'jugador');
  perform public.invitar_participante_reserva(v_r, v_c, 'jugador');
  v_res := public.invitar_participante_reserva(v_r, v_d, 'jugador');
  insert into r90 values ('P4',
    not (v_res->>'ok')::boolean and v_res->>'reason' = 'cupos_llenos',
    v_res->>'reason');

  -- ── P5: la cuota es la cuota ──
  v_res := public.autorizar_cobro_reserva(v_r, v_cuota + 500);
  insert into r90 values ('P5',
    not (v_res->>'ok')::boolean
      and v_res->>'reason' = 'El monto no coincide con la cuota vigente'
      and (v_res->>'monto_esperado')::int = v_cuota,
    v_res->>'reason');

  -- ── P6: a medio autorizar no pasa nada ──
  v_res := public.autorizar_cobro_reserva(v_r, v_cuota);
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_b, 'role', 'authenticated')::text);
  v_res := public.autorizar_cobro_reserva(v_r, v_cuota);
  v_det := public.detalle_reserva(v_r);
  insert into r90 values ('P6',
    not (v_res->>'confirmada')::boolean
      and (v_det->>'listos')::int = 2 and (v_det->>'faltan_autorizar')::int = 1
      and v_det->'reserva'->>'estado' = 'armando',
    'listos ' || (v_det->>'listos') || ' estado ' || (v_det->'reserva'->>'estado'));

  -- ── P7: LA CANCHA NO SE RETIENE ──
  -- Otro grupo arma la MISMA hora al mismo tiempo. Tiene que poder.
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_x, 'role', 'authenticated')::text);
  v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_fecha,
      p_hora_inicio := v_h, p_modalidad := 'completa', p_medio_pago := 'balance',
      p_contacto_nombre := 'Prueba R90', p_contacto_telefono := '912345678');
  v_r2 := (v_res->>'reserva_id')::uuid;
  insert into r90 values ('P7', (v_res->>'ok')::boolean and v_r2 is not null,
    coalesce(v_res->>'reason', 'segundo grupo armando la misma hora'));

  -- ── P8: confirmar es del organizador ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_b, 'role', 'authenticated')::text);
  v_res := public.confirmar_reserva(v_r);
  insert into r90 values ('P8',
    not (v_res->>'ok')::boolean
      and v_res->>'reason' = 'Solo el organizador confirma la reserva',
    v_res->>'reason');

  -- ── P9: el recordatorio, y su tope ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_res := public.recordar_pago_reserva(v_r);
  insert into r90 values ('P9a',
    (v_res->>'ok')::boolean and (v_res->>'avisados')::int = 1,
    coalesce(v_res->>'avisados', v_res->>'reason'));
  v_res := public.recordar_pago_reserva(v_r);
  insert into r90 values ('P9b',
    not (v_res->>'ok')::boolean
      and v_res->>'reason' = 'Ya mandaste un recordatorio hace poco. Espera un rato.',
    v_res->>'reason');

  -- ── P10-P11: el último autoriza y se cierra sola ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_c, 'role', 'authenticated')::text);
  v_res := public.autorizar_cobro_reserva(v_r, v_cuota);
  insert into r90 values ('P10',
    (v_res->>'ok')::boolean and (v_res->>'confirmada')::boolean
      and (select estado from public.reservas where id = v_r) = 'confirmada',
    coalesce(v_res->'confirmacion'->>'reason', 'confirmada sola'));

  insert into ids90 values ('r', v_r), ('a', v_a), ('b', v_b), ('c', v_c);

  -- ── P12: el grupo que perdió la hora ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_x, 'role', 'authenticated')::text);
  select precio_total into v_precio from public.reservas where id = v_r2;
  v_res := public.autorizar_cobro_reserva(v_r2, v_precio);
  v_res := public.confirmar_reserva(v_r2);
  insert into r90 values ('P12a',
    not (v_res->>'ok')::boolean and v_res->>'reason' = 'ocupado',
    v_res->>'reason');
  insert into ids90 values ('r2', v_r2);

  -- ── P13: sin saldo, la autorización sobrevive ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_res := public.crear_reserva(p_cancha_id := v_cancha, p_fecha := v_fecha + 1,
      p_hora_inicio := v_h, p_modalidad := 'jugadores', p_medio_pago := 'balance',
      p_n_jugadores := 2,
      p_contacto_nombre := 'Prueba R90', p_contacto_telefono := '912345678');
  v_r2 := (v_res->>'reserva_id')::uuid;
  perform public.invitar_participante_reserva(v_r2, v_d, 'jugador');
  select cuota into v_cuota from public.reservas where id = v_r2;
  perform public.autorizar_cobro_reserva(v_r2, v_cuota);
  -- v_d nunca cargó saldo.
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_d, 'role', 'authenticated')::text);
  v_res := public.autorizar_cobro_reserva(v_r2, v_cuota);
  insert into r90 values ('P13',
    (v_res->>'ok')::boolean
      and not (v_res->>'confirmada')::boolean
      and v_res->'confirmacion'->>'reason' = 'saldo_insuficiente'
      and exists (select 1 from public.autorizaciones_cobro
                   where reserva_id = v_r2 and user_id = v_d and vigente)
      and (select estado from public.reservas where id = v_r2) = 'armando',
    coalesce(v_res->'confirmacion'->>'reason', 'sin confirmacion'));

  -- ── P14: sacar invalida la autorización ──
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_res := public.quitar_participante_reserva(v_r2, v_d);
  insert into r90 values ('P14',
    (v_res->>'ok')::boolean
      and not exists (select 1 from public.reserva_participantes
                       where reserva_id = v_r2 and user_id = v_d)
      and not exists (select 1 from public.autorizaciones_cobro
                       where reserva_id = v_r2 and user_id = v_d and vigente),
    coalesce(v_res->>'reason', 'quitado'));

  -- ── P15: mis_reservas trae el avance ──
  select count(*) into v_n from public.mis_reservas(60) m
   where m.id = v_r and m.cupos = 3 and m.listos = 3 and m.mi_estado = 'aceptado';
  insert into r90 values ('P15', v_n = 1, v_n || ' fila con avance');
end $$;

reset role;
set local request.jwt.claims to '{}';

-- ── P11-P12b: las cuentas de plata, ya sin RLS ──
insert into r90
select 'P11',
  (select count(*) from public.balance_movimientos m
    where m.reserva_id = (select v from ids90 where k='r') and m.tipo = 'cobro_reserva') = 3
  and (select count(distinct m.user_id) from public.balance_movimientos m
        where m.reserva_id = (select v from ids90 where k='r') and m.tipo = 'cobro_reserva') = 3
  and not exists (select 1 from public.balance_movimientos m
                   where m.reserva_id = (select v from ids90 where k='r')
                     and m.tipo = 'cobro_reserva'
                     and m.user_id not in (select v from ids90 where k in ('a','b','c'))),
  (select string_agg(m.monto::text, ' / ') from public.balance_movimientos m
    where m.reserva_id = (select v from ids90 where k='r') and m.tipo='cobro_reserva');

insert into r90
select 'P12b',
  not exists (select 1 from public.balance_movimientos m
               where m.reserva_id = (select v from ids90 where k='r2')
                 and m.tipo = 'cobro_reserva'),
  'al grupo que perdió la hora no se le cobró nada';

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r90 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r90;

rollback;
