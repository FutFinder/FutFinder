-- =============================================================
-- 178. LOS COBROS QUE NO SE PIERDEN
--
-- La parte de base de datos del arreglo de pagos con Flow (2026-11-13). Las
-- Edge Functions `pagar-reserva` y `flow-confirmacion` cambian en el mismo
-- commit; ver `_shared/flowPagos.ts` y `_shared/flowLogic.ts`.
--
--   1. `pago_cobrado_sin_reserva`: un cobro que Flow confirmó y que no puede
--      confirmar una reserva (monto distinto, o el pago ya no estaba
--      pendiente porque alguien pagó un enlace viejo) queda `reversar` con su
--      motivo y la persona recibe un aviso. Antes esos dos casos contestaban
--      200 y la base no guardaba nada: Flow cobraba y nadie se enteraba.
--   2. `limite_aviso_de_pago`: el tope por IP de `flow-confirmacion`, que es
--      una URL pública y cada POST era una llamada firmada a la API de Flow.
--   3. Saldo sin doble gasto: `confirmar_reserva_interna` toma un candado por
--      pagador antes de mirar su saldo. Dos reservas del mismo jugador
--      confirmadas a la vez veían el mismo saldo y lo gastaban dos veces.
--   4. Sin doble devolución: `admin_cancelar_reserva` leía la reserva sin
--      `for update`; dos cancelaciones a la vez (o una del recinto y otra del
--      jugador) devolvían la plata dos veces.
--
-- 3 y 4 están latentes (hoy no hay forma de cargar saldo, `cargar_balance`
-- revocada en la 73), pero son de las que no se notan hasta que pasan.
--
-- Las dos funciones de 3 y 4 se parchan sobre el cuerpo DESPLEGADO con anclas
-- que fallan si no existen (ver la lección de la 159).
--
-- Pruebas: supabase/tests/178_los_cobros_que_no_se_pierden_test.sql
-- =============================================================

-- ── 1. Un cobro que no confirma nada queda para devolver ──────────
create or replace function public.pago_cobrado_sin_reserva(
  p_orden_comercio text,
  p_referencia text,
  p_datos jsonb,
  p_motivo text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago public.pagos;
begin
  select * into v_pago from public.pagos where orden_comercio = p_orden_comercio for update;
  if v_pago.id is null then
    return json_build_object('ok', false, 'reason', 'Orden desconocida');
  end if;
  -- Idempotente: Flow reintenta el aviso.
  if v_pago.estado in ('pagado', 'reversar', 'reversado') then
    return json_build_object('ok', true, 'ya_estaba', true, 'estado', v_pago.estado);
  end if;

  update public.pagos
     set estado = 'reversar',
         pagado_at = coalesce(pagado_at, now()),
         actualizado_at = now(),
         referencia_externa = coalesce(p_referencia, referencia_externa),
         datos = coalesce(p_datos, datos),
         reversa_nota = left(coalesce(p_motivo, 'Cobro sin reserva que confirmar'), 500)
   where id = v_pago.id;

  if v_pago.user_id is not null then
    insert into public.notifications (user_id, type, title, body, data)
    values (v_pago.user_id, 'reserva_cancelada', 'Te devolveremos un pago',
            'Recibimos un pago con tarjeta que no pudimos asociar a tu reserva. '
            || 'Quedó registrado para devolución a la misma tarjeta con la que pagaste.',
            jsonb_build_object('reservaId', v_pago.reserva_id, 'pagoId', v_pago.id));
  end if;

  return json_build_object('ok', true, 'resultado', 'reversar', 'pago_id', v_pago.id);
end;
$$;

revoke all on function public.pago_cobrado_sin_reserva(text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.pago_cobrado_sin_reserva(text, text, jsonb, text) to service_role;

-- ── 2. Tope de avisos por IP ──────────────────────────────────────
-- 120 por minuto: Flow manda uno por pago (más reintentos); nadie legítimo
-- se acerca a eso a esta escala.
create or replace function public.limite_aviso_de_pago(p_ip text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public._limite_de_uso('ip:' || coalesce(nullif(p_ip, ''), 'sin-ip'), 'flow-confirmacion', 120, 60);
$$;

revoke all on function public.limite_aviso_de_pago(text) from public, anon, authenticated;
grant execute on function public.limite_aviso_de_pago(text) to service_role;

-- ── 3 y 4. Candados sobre los cuerpos desplegados ─────────────────
do $$
declare
  v_def text;
  v_nuevo text;
begin
  -- 3. Un candado por pagador, en orden (`v_pagadores` ya viene ordenado por
  -- user_id, y el `order by` lo asegura), antes de mirar su saldo.
  v_def := pg_get_functiondef('public.confirmar_reserva_interna(uuid)'::regprocedure);
  if v_def not like '%saldo_del_pagador%' then
    v_nuevo := replace(v_def,
      '    -- ── Doble validación de saldo:',
      '    -- 178: un candado por pagador (saldo_del_pagador) para que dos reservas
    -- del mismo jugador no gasten el mismo saldo a la vez.
    perform pg_advisory_xact_lock(hashtextextended(''saldo_del_pagador:'' || u::text, 0))
       from unnest(v_pagadores) as u order by u;

    -- ── Doble validación de saldo:');
    if v_nuevo = v_def then
      raise exception '178: confirmar_reserva_interna cambió; no encontré dónde poner el candado de saldo';
    end if;
    execute v_nuevo;
  end if;

  -- 4. La reserva se lee con candado: la segunda cancelación espera a la
  -- primera y después la encuentra cancelada.
  v_def := pg_get_functiondef('public.admin_cancelar_reserva(uuid,text)'::regprocedure);
  if v_def not like '%where id = p_reserva_id for update;%' then
    v_nuevo := replace(v_def,
      '    select * into v_reserva from public.reservas where id = p_reserva_id;',
      '    select * into v_reserva from public.reservas where id = p_reserva_id for update;');
    if v_nuevo = v_def then
      raise exception '178: admin_cancelar_reserva cambió; no encontré la lectura de la reserva';
    end if;
    execute v_nuevo;
  end if;
end $$;
