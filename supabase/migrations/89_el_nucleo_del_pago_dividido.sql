-- =============================================================
-- FutFinder migration 89: el núcleo del pago dividido
-- =============================================================
-- LA MITAD DEL PAGO DIVIDIDO QUE NO DEPENDE DE LA PASARELA. La 78 dejó
-- el cobro con tarjeta andando para `modalidad = 'completa'` y rechazaba
-- el resto explícito. Esto abre el camino para que CADA PARTICIPANTE
-- pague su parte con su propia tarjeta.
--
-- POR QUÉ ESTO NO ES «LA 78 PERO CON VARIOS PAGOS». Con Balance —que es
-- como se diseñó el pago dividido en la 55— nadie pone plata hasta el
-- final: cada uno AUTORIZA y el cobro ocurre entero, de una vez, cuando
-- están todos. Si falta uno, no hay nada que devolver. Con tarjeta la
-- plata se mueve en cada pago, así que una reserva que no se completa
-- deja dinero de VARIAS personas en la mano. Todo lo delicado de esta
-- migración sale de ahí.
--
-- LA REGLA PARA CONFIRMAR ES LA PLATA, NO LA GENTE: se confirma cuando la
-- suma de lo pagado alcanza el precio total. Contar personas obligaría a
-- decidir qué pasa si alguien se va o si el grupo cambia de tamaño; el
-- dinero no tiene ese problema — o está o no está.
--
-- SI EL BLOQUE SE PIERDE, SE DEVUELVE TODO, NO SOLO EL ÚLTIMO PAGO. Es el
-- caso que no existe en la 78: allá había un solo pagador. Acá pueden ser
-- cinco, y cuatro ya pusieron la plata. Los cinco quedan en 'reversar' y
-- los cinco reciben aviso.
--
-- Y SI SE VENCE SIN COMPLETARSE, TAMBIÉN. Una reserva a medio pagar que
-- llega a su hora la vence el cron; sin esto, la plata de los que sí
-- pagaron se quedaría acá sin que nadie se entere. `vencer_reservas_pasadas`
-- pasa a marcar esos pagos y a avisarles.
--
-- LO QUE ESTA MIGRACIÓN NO HACE, a propósito: `crear_reserva` sigue
-- rechazando el pago dividido con tarjeta. Sin las pantallas del flujo
-- —invitar, ver quién pagó, recordar al que falta— abrir esa puerta sería
-- dejar crear reservas que nadie puede terminar de pagar. Esto es el motor;
-- la llave se gira cuando exista la pantalla y la pasarela.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Un pago vivo POR PERSONA, no por reserva ──────────────────
-- El índice de la 78 permitía un solo pago vivo por reserva, que es justo
-- lo contrario de lo que el pago dividido necesita.
drop index if exists public.pagos_reserva_vivo_uidx;

create unique index if not exists pagos_reserva_usuario_vivo_uidx
    on public.pagos(reserva_id, user_id)
    where reserva_id is not null and estado in ('pendiente', 'pagado');

-- ── 2. Cuánto le toca a cada uno ─────────────────────────────────
-- Devuelve `null` si esa persona no tiene nada que pagar en esa reserva:
-- así quien llama distingue «no te toca» de «te toca cero».
create or replace function public.cuota_de_reserva(p_reserva_id uuid, p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_reserva public.reservas;
    v_participa boolean;
begin
    select * into v_reserva from public.reservas where id = p_reserva_id;
    if v_reserva.id is null then
        return null;
    end if;

    -- La reserva completa la paga quien organiza, entera.
    if v_reserva.modalidad = 'completa' then
        return case when v_reserva.organizador_id = p_user_id
                    then v_reserva.precio_total else null end;
    end if;

    select exists (
        select 1 from public.reserva_participantes rp
         where rp.reserva_id = p_reserva_id
           and rp.user_id = p_user_id
           and rp.estado = 'aceptado'
    ) into v_participa;

    if not v_participa and v_reserva.organizador_id <> p_user_id then
        return null;
    end if;

    -- Entre dos capitanes, mitad y mitad. Se redondea HACIA ARRIBA, igual
    -- que la cuota de `crear_reserva`: con un total impar, el sobrante de
    -- un peso lo pone el sistema y no queda plata sin cobrar.
    if v_reserva.modalidad = 'capitanes' then
        return ceil(v_reserva.precio_total::numeric / 2);
    end if;

    -- Entre todos: la cuota ya está congelada en la reserva.
    return coalesce(
        v_reserva.cuota,
        ceil(v_reserva.precio_total::numeric / greatest(coalesce(v_reserva.n_jugadores, 1), 1))
    );
end;
$$;

revoke all on function public.cuota_de_reserva(uuid, uuid) from public, anon;
grant execute on function public.cuota_de_reserva(uuid, uuid) to authenticated;

-- ── 3. Empezar a pagar MI parte ──────────────────────────────────
create or replace function public.iniciar_pago_reserva(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_pago public.pagos;
    v_orden text;
    v_monto integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.estado = 'confirmada' then
        return json_build_object('ok', false, 'reason', 'Esta reserva ya está pagada');
    end if;
    if v_reserva.estado not in ('armando', 'procesando') then
        return json_build_object('ok', false, 'reason', 'Esta reserva ya no se puede pagar');
    end if;
    if v_reserva.medio_pago <> 'tarjeta' then
        return json_build_object('ok', false, 'reason', 'Esta reserva no es de pago con tarjeta');
    end if;

    -- Cuánto le toca a QUIEN LLAMA. `null` es «esta reserva no es tuya»:
    -- en la completa, cualquiera que no organiza; en las divididas, quien
    -- no aceptó la invitación.
    v_monto := public.cuota_de_reserva(p_reserva_id, v_me);
    if v_monto is null then
        return json_build_object('ok', false, 'reason',
            case when v_reserva.modalidad = 'completa'
                 then 'Solo quien organiza paga esta reserva'
                 else 'No estás en esta reserva' end);
    end if;

    -- Si ya pagó su parte, no se le cobra dos veces.
    if exists (
        select 1 from public.pagos p
         where p.reserva_id = p_reserva_id and p.user_id = v_me and p.estado = 'pagado'
    ) then
        return json_build_object('ok', false, 'reason', 'Ya pagaste tu parte');
    end if;

    -- Si el bloque ya se lo llevó otro, mejor enterarse ANTES de mandar a
    -- nadie a pagar. No alcanza —entre esto y el pago sigue habiendo una
    -- ventana, y por eso `confirmar_pago` lo vuelve a mirar— pero evita la
    -- mayoría de los casos.
    if exists (
        select 1 from public.reservas r
         where r.cancha_id = v_reserva.cancha_id
           and r.fecha = v_reserva.fecha
           and r.hora_inicio = v_reserva.hora_inicio
           and r.estado = 'confirmada'
           and r.id <> v_reserva.id
    ) then
        return json_build_object('ok', false, 'reason', 'Otro grupo tomó ese horario');
    end if;

    -- Reusar el pendiente propio en vez de crear otro: volver atrás en el
    -- navegador y darle pagar de nuevo no puede generar dos cobros.
    select * into v_pago from public.pagos
     where reserva_id = p_reserva_id and user_id = v_me and estado = 'pendiente'
     limit 1;

    if v_pago.id is not null then
        if v_pago.monto <> v_monto then
            update public.pagos
               set monto = v_monto, actualizado_at = now()
             where id = v_pago.id
             returning * into v_pago;
        end if;
        return json_build_object('ok', true, 'pago_id', v_pago.id,
                                 'orden_comercio', v_pago.orden_comercio,
                                 'monto', v_pago.monto, 'reusado', true);
    end if;

    v_orden := 'FF-' || replace(p_reserva_id::text, '-', '') || '-'
               || upper(substr(md5(gen_random_uuid()::text), 1, 6));

    insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio)
    values (v_me, p_reserva_id, v_monto, 'flow', v_orden)
    returning * into v_pago;

    return json_build_object('ok', true, 'pago_id', v_pago.id,
                             'orden_comercio', v_pago.orden_comercio,
                             'monto', v_pago.monto, 'reusado', false);
end;
$$;

revoke all on function public.iniciar_pago_reserva(uuid) from public, anon;
grant execute on function public.iniciar_pago_reserva(uuid) to authenticated;

-- ── 4. Devolverle a TODOS los que pusieron plata ─────────────────
-- Se usa en los dos caminos que dejan dinero sin cancha: el bloque que se
-- lo lleva otro, y la reserva que se vence a medio pagar. Estaba en línea
-- dentro de `confirmar_pago` cuando había un solo pagador; con varios,
-- repetirlo en dos lugares es garantizar que un día uno de los dos se
-- olvide de avisarle a alguien.
create or replace function public.reversar_pagos_de_reserva(
    p_reserva_id uuid,
    p_titulo text,
    p_cuerpo text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pago record;
    v_n integer := 0;
begin
    for v_pago in
        select id, user_id from public.pagos
         where reserva_id = p_reserva_id and estado = 'pagado'
         for update
    loop
        update public.pagos
           set estado = 'reversar', actualizado_at = now()
         where id = v_pago.id;

        insert into public.notifications (user_id, type, title, body, data)
        values (v_pago.user_id, 'reserva_cancelada', p_titulo, p_cuerpo,
                jsonb_build_object('reservaId', p_reserva_id, 'pagoId', v_pago.id));

        v_n := v_n + 1;
    end loop;
    return v_n;
end;
$$;

revoke all on function public.reversar_pagos_de_reserva(uuid, text, text)
    from public, anon, authenticated;

-- ── 5. Confirmar: parcial hasta que esté toda la plata ───────────
create or replace function public.confirmar_pago(
    p_orden_comercio text,
    p_referencia text default null,
    p_datos jsonb default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pago public.pagos;
    v_reserva public.reservas;
    v_lock_key bigint;
    v_ocupado boolean;
    v_pagado integer;
    v_falta integer;
    v_otros integer;
begin
    select * into v_pago from public.pagos
     where orden_comercio = p_orden_comercio
     for update;

    if v_pago.id is null then
        return json_build_object('ok', false, 'reason', 'Orden desconocida');
    end if;

    -- Idempotencia: el aviso llegó dos veces.
    if v_pago.estado = 'pagado' then
        return json_build_object('ok', true, 'ya_estaba', true, 'pago_id', v_pago.id);
    end if;
    if v_pago.estado in ('reversar', 'reversado') then
        return json_build_object('ok', true, 'ya_estaba', true, 'pago_id', v_pago.id,
                                 'estado', v_pago.estado);
    end if;
    if v_pago.estado <> 'pendiente' then
        return json_build_object('ok', false, 'reason',
                                 'El pago está en estado ' || v_pago.estado);
    end if;

    -- Una carga de saldo no tiene reserva. Todavía no existe ese camino,
    -- pero cuando exista entra por acá y no por otra función.
    if v_pago.reserva_id is null then
        update public.pagos
           set estado = 'pagado', pagado_at = now(), actualizado_at = now(),
               referencia_externa = coalesce(p_referencia, referencia_externa),
               datos = coalesce(p_datos, datos)
         where id = v_pago.id;
        return json_build_object('ok', true, 'pago_id', v_pago.id, 'tipo', 'carga');
    end if;

    select * into v_reserva from public.reservas where id = v_pago.reserva_id for update;

    -- Mismo candado que `confirmar_reserva`: sin esto, dos pagos del
    -- mismo bloque podrían confirmarse los dos.
    v_lock_key := hashtextextended(
        v_reserva.cancha_id::text || '|' || v_reserva.fecha::text || '|' || v_reserva.hora_inicio::text, 0
    );
    perform pg_advisory_xact_lock(v_lock_key);

    select exists (
        select 1 from public.reservas r
         where r.cancha_id = v_reserva.cancha_id
           and r.fecha = v_reserva.fecha
           and r.hora_inicio = v_reserva.hora_inicio
           and r.estado = 'confirmada'
           and r.id <> v_reserva.id
    ) into v_ocupado;

    if v_ocupado or v_reserva.estado not in ('armando', 'procesando') then
        -- Pagó y no hay cancha. Este pago queda para devolver…
        update public.pagos
           set estado = 'reversar', pagado_at = now(), actualizado_at = now(),
               referencia_externa = coalesce(p_referencia, referencia_externa),
               datos = coalesce(p_datos, datos)
         where id = v_pago.id;

        update public.reservas
           set estado = 'rechazada'
         where id = v_reserva.id and estado in ('armando', 'procesando');

        insert into public.notifications (user_id, type, title, body, data)
        values (v_pago.user_id, 'reserva_cancelada', 'No pudimos tomar esa hora',
                'Otro grupo confirmó ese horario justo antes. Te devolvemos el total del pago.',
                jsonb_build_object('reservaId', v_reserva.id, 'pagoId', v_pago.id));

        -- …y los de todos los demás que ya habían puesto su parte. Es el
        -- caso que no existía con un solo pagador.
        v_otros := public.reversar_pagos_de_reserva(
            v_reserva.id,
            'No pudimos tomar esa hora',
            'Otro grupo confirmó ese horario justo antes. Te devolvemos tu parte del pago.');

        return json_build_object('ok', true, 'pago_id', v_pago.id, 'resultado', 'reversar',
                                 'otros_reversados', v_otros,
                                 'reason', 'Otro grupo tomó ese horario');
    end if;

    update public.pagos
       set estado = 'pagado', pagado_at = now(), actualizado_at = now(),
           referencia_externa = coalesce(p_referencia, referencia_externa),
           datos = coalesce(p_datos, datos)
     where id = v_pago.id;

    -- ¿Ya está toda la plata? La regla es el dinero y no la gente: contar
    -- personas obligaría a decidir qué pasa si el grupo cambia de tamaño.
    select coalesce(sum(monto), 0) into v_pagado
      from public.pagos
     where reserva_id = v_reserva.id and estado = 'pagado';

    v_falta := v_reserva.precio_total - v_pagado;

    if v_falta > 0 then
        return json_build_object('ok', true, 'pago_id', v_pago.id, 'resultado', 'parcial',
                                 'pagado', v_pagado, 'falta', v_falta,
                                 'reserva_id', v_reserva.id);
    end if;

    update public.reservas
       set estado = 'confirmada', confirmada_at = now()
     where id = v_reserva.id;

    return json_build_object('ok', true, 'pago_id', v_pago.id, 'resultado', 'confirmada',
                             'reserva_id', v_reserva.id);
end;
$$;

revoke all on function public.confirmar_pago(text, text, jsonb) from public, anon, authenticated;

-- ── 6. Vencer una reserva a medio pagar devuelve la plata ────────
create or replace function public.vencer_reservas_pasadas()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_vencidas integer;
    v_reserva record;
    v_devueltos integer := 0;
begin
    -- Primero se anota la plata: si se vencieran antes, la consulta de
    -- abajo ya no encontraría cuáles acaban de vencerse.
    for v_reserva in
        select r.id from public.reservas r
         where r.estado in ('armando', 'procesando')
           and public.inicio_de_reserva(r.fecha, r.hora_inicio) < now()
           and exists (select 1 from public.pagos p
                        where p.reserva_id = r.id and p.estado = 'pagado')
    loop
        v_devueltos := v_devueltos + public.reversar_pagos_de_reserva(
            v_reserva.id,
            'Tu reserva no se completó',
            'No se juntó el pago de todos a tiempo y la hora se liberó. Te devolvemos tu parte.');
    end loop;

    update public.reservas
       set estado = 'vencida'
     where estado in ('armando', 'procesando')
       and public.inicio_de_reserva(fecha, hora_inicio) < now();
    get diagnostics v_vencidas = row_count;

    return json_build_object('ok', true, 'vencidas', v_vencidas, 'pagos_por_devolver', v_devueltos);
end;
$$;

revoke all on function public.vencer_reservas_pasadas() from public, anon, authenticated;
