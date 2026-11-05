-- =============================================================
-- 168. LA TARJETA TAMBIÉN SE DEVUELVE
--
-- EL FALLO. Cancelar una reserva devolvía sólo lo que `balance_movimientos`
-- registraba como `cobro_reserva`:
--   · `cancelar_reserva_interna` (migración 100), por donde pasan la
--     cancelación del organizador (`cancelar_reserva`), la del desafío
--     aceptada por el otro club (`responder_cancelacion_desafio`, 101) y la
--     del partido de clubes que se cae (disparador de la 100);
--   · `admin_cancelar_reserva` (66), cuando cancela el recinto.
-- Un pago con tarjeta (`confirmar_pago`, 78 y 89) NO deja movimiento de
-- saldo: queda en `pagos` como `pagado`. Así que una reserva pagada con
-- tarjeta y cancelada se quedaba sin devolución y SIN MARCA: nada decía
-- que había plata que devolver, y el aviso del partido de clubes además
-- prometía «te la devolvimos a tu saldo». La 66 lo había anotado como
-- «límite conocido»; hoy no pasa sólo porque no hay pagos con tarjeta.
--
-- EL ARREGLO. Las dos funciones llaman a `reversar_pagos_de_reserva`
-- (migración 89), la misma que ya usan `confirmar_pago` cuando otro grupo
-- tomó la hora y `vencer_reservas_pasadas`: cada pago `pagado` de la
-- reserva pasa a `reversar` y su dueño recibe un aviso que nombra el pago.
-- Desde ahí sigue el flujo de siempre: alguien devuelve en Flow y lo anota
-- con `marcar_pago_reversado` (87, sólo `service_role`).
--
-- SE MIRA EN CUALQUIER ESTADO ACTIVO, NO SÓLO EN `confirmada`. En el pago
-- dividido una reserva `armando` ya puede tener pagos con tarjeta de los
-- que alcanzaron a pagar; la devolución al saldo sólo miraba las
-- confirmadas porque el saldo sólo se cobra al confirmar.
--
-- Lo demás de cada función queda IGUAL (copiado de la 100 y de la 66): la
-- devolución al saldo, el cambio de estado, los avisos y los permisos.
-- Las dos devuelven además `tarjeta_por_devolver` (cuántos pagos quedaron
-- marcados); quien ya leía la respuesta no cambia.
--
-- COMPATIBLE CON LA 166: los límites de uso miran INSERT en `pagos`, y
-- esto sólo actualiza filas que ya existen. `notifications` no tiene tope.
--
-- Idempotente: `create or replace`. Cancelar dos veces no vuelve a marcar
-- ni a avisar: la segunda vez la reserva ya no está activa y la función
-- sale antes, y `reversar_pagos_de_reserva` sólo toma pagos `pagado`.
-- Pruebas: supabase/tests/168_la_tarjeta_tambien_se_devuelve_test.sql
-- =============================================================

-- ── 1. La cancelación por dentro ─────────────────────────────────
create or replace function public.cancelar_reserva_interna(
    p_reserva_id uuid,
    p_motivo text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reserva public.reservas;
    v_pago record;
    v_tarjeta integer := 0;
begin
    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    -- Ya muerta: no es un error. La llama un trigger, y reventar ahí
    -- impediría cancelar el partido por algo que ya estaba resuelto.
    if v_reserva.estado not in ('armando', 'procesando', 'confirmada') then
        return json_build_object('ok', true, 'already', true, 'estado', v_reserva.estado);
    end if;

    -- Solo una confirmada movió plata. Se devuelve por persona, agrupando
    -- lo que cada una puso: en el pago dividido son varios cobros.
    if v_reserva.estado = 'confirmada' then
        for v_pago in
            select user_id, -sum(monto) as monto
              from public.balance_movimientos
             where reserva_id = p_reserva_id and tipo = 'cobro_reserva'
             group by user_id
        loop
            insert into public.balance_movimientos (user_id, tipo, monto, reserva_id)
            values (v_pago.user_id, 'devolucion_cancelacion', v_pago.monto, p_reserva_id);
        end loop;
    end if;

    -- 168: lo pagado con tarjeta no está en el saldo. Queda para devolver
    -- a la tarjeta, en cualquier estado activo (ver la cabecera).
    v_tarjeta := public.reversar_pagos_de_reserva(
        p_reserva_id,
        'Te devolveremos tu pago con tarjeta',
        'La reserva se canceló y tu pago con tarjeta quedó registrado para devolución. '
        || 'La devolución se hace a la misma tarjeta con la que pagaste.');

    update public.reservas
       set estado = 'cancelada', cancelada_at = now(), cancelacion_estado = 'aceptada'
     where id = p_reserva_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct uid, 'reserva_cancelada', 'Reserva cancelada',
           coalesce(p_motivo, 'La reserva fue cancelada.'),
           jsonb_build_object('reservaId', p_reserva_id)
      from (
          select v_reserva.organizador_id as uid
          union
          select user_id from public.reserva_participantes where reserva_id = p_reserva_id
      ) u;

    return json_build_object('ok', true, 'reserva_id', p_reserva_id,
                             'tarjeta_por_devolver', v_tarjeta);
end;
$$;

revoke all on function public.cancelar_reserva_interna(uuid, text) from public, anon, authenticated;

-- ── 2. El aviso del partido de clubes ya no promete «a tu saldo» ──
-- Mismo disparador de la 100; sólo cambia el texto, que mentía cuando la
-- parte se había pagado con tarjeta.
create or replace function public.tg_partido_cancelado_suelta_la_cancha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.cancelar_reserva_interna(
        new.reserva_id,
        'Se canceló el partido de clubes, así que la cancha quedó liberada. '
        || 'Si ya habías puesto tu parte, te la devolvemos: al saldo si pagaste con saldo, '
        || 'o a tu tarjeta si pagaste con ella.'
    );
    return new;
end;
$$;

revoke all on function public.tg_partido_cancelado_suelta_la_cancha() from public, anon, authenticated;

-- ── 3. Cuando cancela el recinto ─────────────────────────────────
create or replace function public.admin_cancelar_reserva(
    p_reserva_id uuid,
    p_motivo text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reserva public.reservas;
    v_complejo_nombre text;
    v_devuelto integer := 0;
    v_tarjeta integer := 0;
    v_pago record;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id;
    if v_reserva is null or not public.es_admin_cancha(v_reserva.cancha_id) then
        raise exception 'Esa reserva no es de un recinto que administres';
    end if;

    if v_reserva.estado not in ('confirmada', 'armando', 'procesando') then
        raise exception 'Esta reserva ya no está activa';
    end if;

    if now() >= public.inicio_de_reserva(v_reserva.fecha, v_reserva.hora_inicio) then
        raise exception 'El partido ya empezó: no se puede cancelar una reserva en curso';
    end if;

    if p_motivo is null or length(trim(p_motivo)) < 10 then
        raise exception 'Escribe el motivo: es lo único que el jugador va a saber';
    end if;

    -- Devolución a cada persona que puso plata.
    for v_pago in
        select user_id, -sum(monto) as monto
          from public.balance_movimientos
         where reserva_id = p_reserva_id and tipo = 'cobro_reserva'
         group by user_id
        having -sum(monto) > 0
    loop
        insert into public.balance_movimientos (user_id, tipo, monto, reserva_id)
        values (v_pago.user_id, 'devolucion_cancelacion', v_pago.monto, p_reserva_id);
        v_devuelto := v_devuelto + v_pago.monto;
    end loop;

    -- 168: y lo pagado con tarjeta queda para devolver a la tarjeta.
    v_tarjeta := public.reversar_pagos_de_reserva(
        p_reserva_id,
        'Te devolveremos tu pago con tarjeta',
        'El recinto canceló la reserva y tu pago con tarjeta quedó registrado para devolución. '
        || 'La devolución se hace a la misma tarjeta con la que pagaste.');

    update public.reservas
       set estado = 'cancelada',
           cancelada_at = now(),
           cancelacion_estado = 'aceptada'
     where id = p_reserva_id;

    select c.nombre into v_complejo_nombre
      from public.complejos c
      join public.canchas_reservables k on k.complejo_id = c.id
     where k.id = v_reserva.cancha_id;

    -- Al organizador y a cada participante que había aceptado: todos
    -- perdieron la hora, no solo quien reservó.
    insert into public.notifications (user_id, type, title, body, data)
    select u, 'reserva_cancelada',
           'El recinto canceló tu reserva',
           coalesce(v_complejo_nombre, 'El recinto') || ' canceló la reserva del '
             || to_char(v_reserva.fecha, 'DD/MM') || ' a las '
             || to_char(v_reserva.hora_inicio, 'HH24:MI') || '. Motivo: ' || trim(p_motivo),
           jsonb_build_object('reservaId', p_reserva_id, 'motivo', trim(p_motivo),
                              'canceladaPorRecinto', true)
      from (
          select v_reserva.organizador_id as u
          union
          select rp.user_id from public.reserva_participantes rp
           where rp.reserva_id = p_reserva_id and rp.estado = 'aceptado'
      ) destinatarios;

    return json_build_object('ok', true, 'devuelto', v_devuelto,
                             'tarjeta_por_devolver', v_tarjeta);
end;
$$;

revoke all on function public.admin_cancelar_reserva(uuid, text) from public, anon;
grant execute on function public.admin_cancelar_reserva(uuid, text) to authenticated;
