-- =============================================================
-- FutFinder migration 78: pagos con tarjeta, cobro directo por reserva
-- =============================================================
-- PRIMERA MITAD DE LA PASARELA: el jugador paga la reserva con tarjeta y
-- la plata pasa por el proveedor a FutFinder. NO hay saldo guardado. El
-- Balance queda para después y en su propio paso.
--
-- Esta migración es TODO lo que no depende del proveedor. Lo que Flow (o
-- quien sea) aporta es dos cosas: crear la transacción y avisar cuando se
-- pagó. Nada de eso vive acá — vive en una Edge Function, que es la única
-- que tiene las credenciales y la única que llama a `confirmar_pago`.
--
-- EL PROBLEMA DE VERDAD NO ES COBRAR, ES QUÉ PASA SI EL HORARIO SE LO
-- LLEVA OTRO MIENTRAS EL JUGADOR PAGA. La regla central del vertical es
-- que una reserva sin confirmar NO ocupa el bloque: sigue disponible y el
-- primero que confirma se lo lleva. Con tarjeta eso significa que entre
-- que alguien entra a pagar y el proveedor nos avisa pueden pasar
-- minutos, y en el medio otro grupo puede confirmar el mismo bloque.
--
-- Cuando eso pasa la plata YA SE MOVIÓ. No se puede simplemente decir que
-- no: hay que dejar la reserva rechazada y el pago marcado para reversa,
-- y que eso quede escrito en la misma transacción que descubre el choque.
-- Un pago 'reversar' es plata de una persona que no recibió nada; es el
-- estado más importante de esta tabla y el que hay que mirar todos los
-- días hasta que la reversa sea automática.
--
-- POR AHORA SOLO MODALIDAD 'completa' (un pagador). El pago dividido
-- necesita diez cobros que se confirman por separado, y mezclarlo acá
-- haría esta migración imposible de revisar. Se rechaza explícito en vez
-- de dejarlo pasar a medias.
--
-- IDEMPOTENCIA EN TRES CAPAS, porque un webhook llega dos veces:
--   · `orden_comercio` es única — nuestra referencia;
--   · (proveedor, referencia_externa) es única — la de ellos;
--   · `confirmar_pago` sobre un pago ya pagado devuelve ok sin repetir
--     nada. Cobrar dos veces por un aviso duplicado sería el peor error
--     posible de este archivo.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La tabla ──────────────────────────────────────────────────
create table if not exists public.pagos (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id),
    -- Nulo = carga de saldo, que todavía no existe. Se deja el campo
    -- porque el día que exista el Balance es la misma tabla y el mismo
    -- ciclo de estados: no tiene sentido una tabla `cargas` paralela.
    reserva_id uuid references public.reservas(id),
    monto integer not null check (monto > 0),
    proveedor text not null check (proveedor in ('flow')),

    -- La referencia que MANDAMOS nosotros y por la que el proveedor nos
    -- responde. Es la llave de la idempotencia del webhook.
    orden_comercio text not null unique,
    -- La que devuelve el proveedor (token, payment id). Llega después de
    -- crear la fila, por eso es nullable.
    referencia_externa text,

    estado text not null default 'pendiente' check (estado in (
        'pendiente',   -- creado, el jugador todavía no paga
        'pagado',      -- confirmado por el proveedor y aplicado
        'fallido',     -- el proveedor dijo que no
        'expirado',    -- nadie lo pagó nunca
        'reversar',    -- SE PAGÓ pero no se pudo entregar: hay que devolver
        'reversado'    -- ya se devolvió
    )),

    -- La respuesta cruda del proveedor, tal cual. Cuando haya que
    -- discutir un cobro con alguien, esto es lo único que va a servir.
    datos jsonb,

    created_at timestamptz not null default now(),
    actualizado_at timestamptz not null default now(),
    pagado_at timestamptz
);

create index if not exists idx_pagos_user on public.pagos(user_id);
create index if not exists idx_pagos_reserva on public.pagos(reserva_id);
-- Para el reporte diario de lo que hay que devolver a mano.
create index if not exists idx_pagos_reversar on public.pagos(estado) where estado = 'reversar';

-- La referencia del proveedor no se puede repetir: es la segunda barrera
-- contra un webhook duplicado. Varios NULL conviven sin problema.
create unique index if not exists pagos_referencia_externa_uidx
    on public.pagos(proveedor, referencia_externa)
    where referencia_externa is not null;

-- Una reserva no puede tener dos pagos vivos a la vez. Si el jugador
-- vuelve a entrar a pagar, se reusa el pendiente que ya tenía.
create unique index if not exists pagos_reserva_vivo_uidx
    on public.pagos(reserva_id)
    where reserva_id is not null and estado in ('pendiente', 'pagado');

alter table public.pagos enable row level security;

-- Cada quien ve sus pagos y nada más. Sin políticas de escritura: solo
-- las funciones de abajo (y el `service_role`) escriben acá.
drop policy if exists "pagos_select" on public.pagos;
create policy "pagos_select"
    on public.pagos for select
    to authenticated
    using (user_id = auth.uid());

-- ── 2. Empezar a pagar ───────────────────────────────────────────
-- Crea (o reusa) el pago pendiente y devuelve lo que la Edge Function
-- necesita para armar la transacción con el proveedor. NO habla con
-- nadie de afuera: esta función es solo la parte que la base puede
-- garantizar.
--
-- El monto sale de la reserva y no del cliente, por razones obvias.
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
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.organizador_id <> v_me then
        return json_build_object('ok', false, 'reason', 'Solo quien organiza paga esta reserva');
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
    -- El pago dividido necesita un cobro por persona y todavía no está.
    -- Se dice, en vez de cobrarle todo al organizador por descuido.
    if v_reserva.modalidad <> 'completa' then
        return json_build_object('ok', false, 'reason',
            'Por ahora solo se puede pagar con tarjeta la reserva completa, no el pago dividido');
    end if;

    -- Si el bloque ya se lo llevó otro, mejor enterarse ANTES de mandar a
    -- nadie a pagar. No alcanza —entre esto y el pago sigue habiendo una
    -- ventana, y por eso `confirmar_pago` lo vuelve a mirar— pero evita
    -- la mayoría de los casos.
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

    -- Reusar el pendiente en vez de crear otro: volver atrás en el
    -- navegador y darle pagar de nuevo no puede generar dos cobros.
    select * into v_pago from public.pagos
     where reserva_id = p_reserva_id and estado = 'pendiente'
     limit 1;

    if v_pago.id is not null then
        -- Si el precio cambió entremedio, el pendiente viejo ya no sirve.
        if v_pago.monto <> v_reserva.precio_total then
            update public.pagos
               set monto = v_reserva.precio_total, actualizado_at = now()
             where id = v_pago.id
             returning * into v_pago;
        end if;
        return json_build_object('ok', true, 'pago_id', v_pago.id,
                                 'orden_comercio', v_pago.orden_comercio,
                                 'monto', v_pago.monto, 'reusado', true);
    end if;

    -- La orden lleva un sufijo aleatorio: si una reserva se paga, se
    -- cancela y se vuelve a intentar, la orden nueva no puede chocar con
    -- la vieja en el proveedor.
    v_orden := 'FF-' || replace(p_reserva_id::text, '-', '') || '-'
               || upper(substr(md5(gen_random_uuid()::text), 1, 6));

    insert into public.pagos (user_id, reserva_id, monto, proveedor, orden_comercio)
    values (v_me, p_reserva_id, v_reserva.precio_total, 'flow', v_orden)
    returning * into v_pago;

    return json_build_object('ok', true, 'pago_id', v_pago.id,
                             'orden_comercio', v_pago.orden_comercio,
                             'monto', v_pago.monto, 'reusado', false);
end;
$$;

revoke all on function public.iniciar_pago_reserva(uuid) from public, anon;
grant execute on function public.iniciar_pago_reserva(uuid) to authenticated;

-- ── 3. Guardar la referencia del proveedor ───────────────────────
-- La llama la Edge Function apenas el proveedor devuelve su token, para
-- poder cruzar su aviso con nuestra fila. Solo `service_role`.
create or replace function public.anotar_referencia_pago(
    p_orden_comercio text,
    p_referencia text,
    p_datos jsonb default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.pagos
       set referencia_externa = p_referencia,
           datos = coalesce(p_datos, datos),
           actualizado_at = now()
     where orden_comercio = p_orden_comercio
       and estado = 'pendiente';
    if not found then
        return json_build_object('ok', false, 'reason', 'No hay un pago pendiente con esa orden');
    end if;
    return json_build_object('ok', true);
end;
$$;

revoke all on function public.anotar_referencia_pago(text, text, jsonb) from public, anon, authenticated;

-- ── 4. El proveedor dice que se pagó ─────────────────────────────
-- LA FUNCIÓN MÁS DELICADA DEL ARCHIVO. La llama SOLO la Edge Function,
-- después de haberle preguntado al proveedor —no de creerle al POST que
-- llegó, que cualquiera puede falsificar.
--
-- Hace tres cosas, en una sola transacción:
--   1. Marca el pago como pagado. Si ya lo estaba, no hace nada más y
--      devuelve ok: un webhook repetido no puede cobrar ni confirmar dos
--      veces.
--   2. Toma el candado del bloque y comprueba que nadie más lo haya
--      confirmado. Es el MISMO candado que usa `confirmar_reserva`, así
--      que los dos caminos se serializan entre sí.
--   3. Si el bloque está libre, confirma la reserva. Si no, deja el pago
--      en 'reversar' y la reserva 'rechazada' — la plata se movió y hay
--      que devolverla.
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
        -- Pagó y no hay cancha. Queda escrito para devolver.
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

        return json_build_object('ok', true, 'pago_id', v_pago.id, 'resultado', 'reversar',
                                 'reason', 'Otro grupo tomó ese horario');
    end if;

    update public.pagos
       set estado = 'pagado', pagado_at = now(), actualizado_at = now(),
           referencia_externa = coalesce(p_referencia, referencia_externa),
           datos = coalesce(p_datos, datos)
     where id = v_pago.id;

    update public.reservas
       set estado = 'confirmada', confirmada_at = now()
     where id = v_reserva.id;

    return json_build_object('ok', true, 'pago_id', v_pago.id, 'resultado', 'confirmada',
                             'reserva_id', v_reserva.id);
end;
$$;

revoke all on function public.confirmar_pago(text, text, jsonb) from public, anon, authenticated;

-- ── 5. El proveedor dice que no ──────────────────────────────────
create or replace function public.rechazar_pago(
    p_orden_comercio text,
    p_estado text default 'fallido',
    p_datos jsonb default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pago public.pagos;
begin
    if p_estado not in ('fallido', 'expirado') then
        raise exception 'Estado inválido para un pago rechazado: %', p_estado;
    end if;

    select * into v_pago from public.pagos
     where orden_comercio = p_orden_comercio for update;
    if v_pago.id is null then
        return json_build_object('ok', false, 'reason', 'Orden desconocida');
    end if;
    -- Un pago ya cobrado NO se marca como fallido por un aviso tardío.
    if v_pago.estado <> 'pendiente' then
        return json_build_object('ok', true, 'ya_estaba', true, 'estado', v_pago.estado);
    end if;

    update public.pagos
       set estado = p_estado, actualizado_at = now(),
           datos = coalesce(p_datos, datos)
     where id = v_pago.id;

    return json_build_object('ok', true, 'estado', p_estado);
end;
$$;

revoke all on function public.rechazar_pago(text, text, jsonb) from public, anon, authenticated;
