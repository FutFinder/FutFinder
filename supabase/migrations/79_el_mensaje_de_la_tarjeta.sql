-- =============================================================
-- FutFinder migration 79: el mensaje de la tarjeta ya no es cierto
-- =============================================================
-- `confirmar_reserva` respondía «El pago con tarjeta todavía no está
-- disponible». Desde la migración 78 eso es falso: la tarjeta existe.
--
-- Lo que sigue siendo cierto es que una reserva con tarjeta NO se
-- confirma por esa función — la confirma `confirmar_pago` cuando el
-- proveedor avisa que se pagó. Así que el rechazo se queda, pero el
-- texto tiene que explicar eso en vez de mandar a alguien a esperar algo
-- que ya está.
--
-- Va aparte de la 78 a propósito: la 78 es la puerta por la que va a
-- pasar plata y conviene poder revisarla sin un cambio de texto en el
-- medio.
--
-- Se recrea completa e idéntica a la de la migración 55 salvo ese texto
-- y su comentario — se generó desde el archivo de la 55 y se comprobó
-- que el cuerpo aplicado en producción era ese mismo (md5
-- a613596716a73dae6ad228d512f04842). Misma firma, así que
-- `create or replace` basta.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- y su comentario. Misma firma, así que `create or replace` basta.
create or replace function public.confirmar_reserva(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_lock_key bigint;
    v_ya_confirmada boolean;
    v_pagadores uuid[];
    v_montos integer[];
    v_faltan_autorizar uuid[] := array[]::uuid[];
    v_faltan_saldo uuid[] := array[]::uuid[];
    v_uid uuid;
    v_monto integer;
    v_saldo integer;
    v_ok_autorizacion boolean;
    i integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.organizador_id <> v_me then
        return json_build_object('ok', false, 'reason', 'Solo el organizador confirma la reserva');
    end if;
    if v_reserva.estado = 'confirmada' then
        return json_build_object('ok', true, 'already', true);
    end if;
    if v_reserva.estado not in ('armando', 'procesando') then
        return json_build_object('ok', false, 'reason', 'La reserva no está disponible para confirmar');
    end if;
    -- Una reserva con tarjeta NO se confirma por acá: la confirma
    -- `confirmar_pago` cuando el proveedor avisa (migración 78). Cobrarla
    -- del Balance falsearía el medio de pago.
    if v_reserva.medio_pago <> 'balance' then
        return json_build_object('ok', false, 'reason',
            'Esta reserva se paga con tarjeta: se confirma sola al completar el pago');
    end if;

    -- Serializa a cualquiera que intente confirmar ESTE slot al mismo
    -- tiempo. Un `for update` normal no alcanza acá: puede que todavía
    -- no exista ninguna fila 'confirmada' que lockear (varias reservas
    -- 'armando'/'procesando' del mismo slot coexisten a propósito).
    v_lock_key := hashtextextended(
        v_reserva.cancha_id::text || '|' || v_reserva.fecha::text || '|' || v_reserva.hora_inicio::text, 0
    );
    perform pg_advisory_xact_lock(v_lock_key);

    select exists (
        select 1 from public.reservas
         where cancha_id = v_reserva.cancha_id
           and fecha = v_reserva.fecha
           and hora_inicio = v_reserva.hora_inicio
           and estado = 'confirmada'
           and id <> v_reserva.id
    ) into v_ya_confirmada;
    if v_ya_confirmada then
        return json_build_object('ok', false, 'reason', 'ocupado');
    end if;

    -- ── Pagadores y monto exacto de cada uno ──
    -- `estado = 'aceptado'` es imprescindible acá: sin filtrar, una fila
    -- 'rechazada' (que nadie borra ni limpia — es historial, igual que
    -- las autorizaciones) sigue contando como pagador para siempre. Esa
    -- fila nunca va a tener autorización vigente (rechazó), así que sin
    -- este filtro la reserva quedaba bloqueada sin ninguna vía de
    -- recuperación en cuanto alguien rechazaba una invitación.
    if v_reserva.modalidad = 'completa' then
        v_pagadores := array[v_reserva.organizador_id];
        v_montos := array[v_reserva.precio_total];
    else
        select array_agg(user_id order by user_id), array_agg(
                   case when v_reserva.modalidad = 'capitanes'
                        then ceil(v_reserva.precio_total::numeric / 2)::integer
                        else v_reserva.cuota
                   end order by user_id)
          into v_pagadores, v_montos
          from public.reserva_participantes
         where reserva_id = p_reserva_id and estado = 'aceptado';
    end if;

    if v_pagadores is null or array_length(v_pagadores, 1) is null then
        return json_build_object('ok', false, 'reason', 'No hay participantes para cobrar');
    end if;

    -- ── El grupo tiene que estar COMPLETO, no solo "lo que ya se
    -- autorizó" ──
    -- Sin este chequeo, confirmar con el grupo a medio armar cobra menos
    -- del 100% del valor de la cancha: en 'capitanes', si nunca se invitó
    -- o nunca aceptó el segundo capitán, v_pagadores tiene 1 solo
    -- elemento y se cobraría la mitad del total como si fuera el total
    -- completo; en 'jugadores', confirmar antes de que se sumen los
    -- `n_jugadores` convocados recauda menos de lo que cuesta la cancha.
    -- Deliberadamente por CONTEO de participantes, no por
    -- sum(v_montos) = precio_total: el redondeo hacia arriba de las
    -- cuotas (ver RPC 10 y el comentario de la migración 55 sobre
    -- `ajuste_redondeo`) casi nunca calza exacto con el total, así que
    -- comparar sumas daría falsos rechazos.
    if v_reserva.modalidad = 'capitanes' and array_length(v_pagadores, 1) <> 2 then
        return json_build_object('ok', false, 'reason', 'falta_capitan');
    end if;
    if v_reserva.modalidad = 'jugadores' and array_length(v_pagadores, 1) <> v_reserva.n_jugadores then
        return json_build_object('ok', false, 'reason', 'faltan_jugadores');
    end if;

    -- ── Aceptación + autorización vigente de CADA pagador ──
    for i in 1 .. array_length(v_pagadores, 1) loop
        v_uid := v_pagadores[i];
        v_monto := v_montos[i];

        if v_reserva.modalidad <> 'completa' and not exists (
            select 1 from public.reserva_participantes
             where reserva_id = p_reserva_id and user_id = v_uid and estado = 'aceptado'
        ) then
            v_faltan_autorizar := array_append(v_faltan_autorizar, v_uid);
            continue;
        end if;

        select exists (
            select 1 from public.autorizaciones_cobro
             where reserva_id = p_reserva_id and user_id = v_uid
               and vigente = true and monto = v_monto
        ) into v_ok_autorizacion;
        if not v_ok_autorizacion then
            v_faltan_autorizar := array_append(v_faltan_autorizar, v_uid);
        end if;
    end loop;

    if array_length(v_faltan_autorizar, 1) > 0 then
        return json_build_object(
            'ok', false, 'reason', 'autorizacion_pendiente',
            'usuarios_afectados', to_json(v_faltan_autorizar)
        );
    end if;

    -- ── Doble validación de saldo: acá, dentro de la transacción de
    -- confirmar, es la que de verdad cuenta (la otra es solo informativa
    -- en la UI al armar la reserva). Nunca se expone el número: solo
    -- quién de los ya-conocidos participantes no alcanza. ──
    for i in 1 .. array_length(v_pagadores, 1) loop
        v_uid := v_pagadores[i];
        v_monto := v_montos[i];
        select coalesce(sum(monto), 0) into v_saldo
          from public.balance_movimientos where user_id = v_uid;
        if v_saldo < v_monto then
            v_faltan_saldo := array_append(v_faltan_saldo, v_uid);
        end if;
    end loop;

    if array_length(v_faltan_saldo, 1) > 0 then
        -- El alias del unnest NO puede llamarse v_uid: esa variable ya
        -- existe en el DECLARE de esta función, y Postgres no distingue
        -- cuál de las dos quiere el SELECT ("column reference is
        -- ambiguous", 42702) — revienta apenas alguien confirma sin saldo.
        insert into public.notifications (user_id, type, title, body, data)
        select v_afectado_id, 'reserva_saldo_insuficiente', 'Necesitas cargar saldo',
               'Tu Balance no alcanza para confirmar esta reserva.',
               jsonb_build_object('reservaId', p_reserva_id)
          from unnest(v_faltan_saldo) as v_afectado_id;

        return json_build_object(
            'ok', false, 'reason', 'saldo_insuficiente',
            'usuarios_afectados', to_json(v_faltan_saldo)
        );
    end if;

    -- ── Todo validado: cobrar a todos y confirmar, mismo statement ──
    for i in 1 .. array_length(v_pagadores, 1) loop
        insert into public.balance_movimientos (user_id, tipo, monto, reserva_id)
        values (v_pagadores[i], 'cobro_reserva', -v_montos[i], p_reserva_id);
    end loop;

    -- TODO: sum(v_montos) puede quedar unos pesos por encima de
    -- v_reserva.precio_total por el redondeo hacia arriba de las cuotas
    -- (ceil()): en 'jugadores' con precio impar entre varios, o en
    -- 'capitanes' con precio_total impar (ceil(total/2) dos veces suma
    -- total + 1). Ese excedente hoy no queda registrado en ningún lado
    -- aparte — no es grave y no bloquea el cobro.
    --
    -- NO lo resolví insertando un `balance_movimientos` adicional que le
    -- cobre el excedente al organizador (como una primera lectura del
    -- pedido sugería): cada `cobro_reserva` de arriba ya es exactamente
    -- el monto que esa persona autorizó explícitamente en
    -- `autorizaciones_cobro` — cobrarle al organizador unos pesos más
    -- ACÁ, sin que él haya autorizado ESE monto adicional, es la regla
    -- de negocio #4 ("nunca cobrar sin autorización explícita") rota
    -- para arreglar un problema de un par de pesos. Si se quiere trazar
    -- el excedente, la vía correcta es una fila puramente informativa
    -- (o un reporte, no un movimiento que reste saldo real) — a decidir
    -- antes de tocar el ledger por esto.
    if (select coalesce(sum(m), 0) from unnest(v_montos) as m) > v_reserva.precio_total then
        raise notice 'confirmar_reserva %: excedente de redondeo de % pesos sin registrar',
            p_reserva_id, (select sum(m) from unnest(v_montos) as m) - v_reserva.precio_total;
    end if;

    update public.reservas
       set estado = 'confirmada', confirmada_at = now()
     where id = p_reserva_id;

    insert into public.notifications (user_id, type, title, body, data)
    select v_pagadores[gs], 'reserva_confirmada', '¡Cancha reservada!',
           'Tu reserva quedó confirmada.',
           jsonb_build_object('reservaId', p_reserva_id)
      from generate_subscripts(v_pagadores, 1) as gs;

    return json_build_object('ok', true, 'reserva_id', p_reserva_id);
end;
$$;
revoke all on function public.confirmar_reserva(uuid) from public, anon;
grant execute on function public.confirmar_reserva(uuid) to authenticated;
