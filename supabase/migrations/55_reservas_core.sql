-- =============================================================
-- FutFinder migration 55: vertical de Reservas — reservas,
-- participantes, autorizaciones de cobro, y las RPC del ciclo de vida
-- =============================================================
-- Reglas de negocio que condicionan todo este archivo:
--   - Nunca se retiene una cancha esperando pagos: mientras el grupo se
--     arma (estado 'armando'), el slot sigue disponible para otros. El
--     índice único de más abajo solo protege el estado 'confirmada'.
--   - El primero que CONFIRMA se queda con el horario.
--   - Cobro atómico y todo-o-nada: verificar disponibilidad →
--     aceptaciones → saldos → descontar → confirmar, dentro de una sola
--     función. Cualquier fallo real aborta con `raise exception` (no se
--     cobra a nadie); un rechazo de negocio esperado (saldo
--     insuficiente, falta autorización, horario ocupado) es un
--     `json_build_object('ok', false, ...)` limpio, sin tocar datos.
--   - Nunca se cobra sin autorización explícita con el monto exacto
--     (tabla `autorizaciones_cobro`, historial inmutable).
--   - Privacidad de saldos: ninguna función devuelve el saldo de otro
--     usuario. `confirmar_reserva` puede decir QUIÉN de los ya
--     conocidos participantes no tiene saldo (el organizador ya sabe
--     quiénes son), pero nunca CUÁNTO tiene cada uno.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. TABLA: reservas ───────────────────────────────────────────
create table if not exists public.reservas (
    id uuid primary key default gen_random_uuid(),
    cancha_id uuid not null references public.canchas_reservables(id),
    organizador_id uuid not null references public.profiles(id),
    fecha date not null,
    hora_inicio time not null,
    hora_fin time not null,
    precio_total integer not null check (precio_total >= 0),
    modalidad text not null check (modalidad in ('completa', 'capitanes', 'jugadores')),
    medio_pago text not null check (medio_pago in ('balance', 'tarjeta')),
    n_jugadores integer check (n_jugadores is null or n_jugadores >= 2),
    cuota integer check (cuota is null or cuota >= 0),
    estado text not null default 'armando'
        check (estado in ('armando', 'procesando', 'confirmada', 'cancelada', 'rechazada', 'vencida')),
    es_desafio_club boolean not null default false,
    club_organizador_id uuid references public.clubs(id),
    club_rival_id uuid references public.clubs(id),
    -- 'ninguna' por defecto y NOT NULL (más estricto que solo nullable):
    -- toda reserva tiene un estado de cancelación definido, nunca vacío.
    cancelacion_estado text not null default 'ninguna'
        check (cancelacion_estado in ('ninguna', 'solicitada', 'aceptada', 'rechazada')),
    cancelacion_solicitada_por_club_id uuid references public.clubs(id),
    created_at timestamptz not null default now(),
    confirmada_at timestamptz,
    cancelada_at timestamptz,

    constraint reservas_desafio_clubes check (
        (es_desafio_club and club_organizador_id is not null and club_rival_id is not null)
        or (not es_desafio_club and club_organizador_id is null and club_rival_id is null)
    ),
    constraint reservas_jugadores_datos check (
        (modalidad = 'jugadores' and n_jugadores is not null and cuota is not null)
        or (modalidad <> 'jugadores' and n_jugadores is null and cuota is null)
    )
);

-- Última línea de defensa contra doble reserva del mismo slot: la base
-- de datos, no solo el candado de la función. Solo sobre 'confirmada'
-- a propósito (regla de negocio: mientras se arma, el slot sigue libre
-- para otros grupos).
create unique index if not exists reservas_slot_confirmada_uidx
    on public.reservas (cancha_id, fecha, hora_inicio)
    where estado = 'confirmada';

create index if not exists idx_reservas_cancha on public.reservas(cancha_id);
create index if not exists idx_reservas_organizador on public.reservas(organizador_id);
create index if not exists idx_reservas_fecha_cancha on public.reservas(fecha, cancha_id);

-- ── 2. TABLA: reserva_participantes ──────────────────────────────
create table if not exists public.reserva_participantes (
    id uuid primary key default gen_random_uuid(),
    reserva_id uuid not null references public.reservas(id) on delete cascade,
    user_id uuid not null references public.profiles(id),
    rol text not null check (rol in ('organizador', 'capitan', 'jugador')),
    monto_autorizado integer check (monto_autorizado is null or monto_autorizado >= 0),
    estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptado', 'rechazado')),
    autorizado_at timestamptz,

    unique (reserva_id, user_id)
);

create index if not exists idx_reserva_participantes_reserva on public.reserva_participantes(reserva_id);

-- ── 3. TABLA: autorizaciones_cobro ───────────────────────────────
-- Historial inmutable: una fila por autorización, aunque después se
-- invalide por un recálculo de cuota. Nunca se sobrescribe ni se borra.
create table if not exists public.autorizaciones_cobro (
    id uuid primary key default gen_random_uuid(),
    reserva_id uuid not null references public.reservas(id) on delete cascade,
    user_id uuid not null references public.profiles(id),
    monto integer not null check (monto >= 0),
    vigente boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_autorizaciones_cobro_reserva on public.autorizaciones_cobro(reserva_id);

-- ── 4. RLS ────────────────────────────────────────────────────────
alter table public.reservas enable row level security;
alter table public.reserva_participantes enable row level security;
alter table public.autorizaciones_cobro enable row level security;

-- Las policies de abajo se referencian cruzado (reservas_select mira
-- reserva_participantes y viceversa): un `exists` directo sobre la OTRA
-- tabla protegida por RLS reevalúa esa policy, que vuelve a mirar la
-- primera, y Postgres corta con "infinite recursion detected in policy"
-- (42P17) apenas alguien hace un SELECT normal — bloqueando de raíz
-- cualquier lectura de una reserva o su nómina desde el cliente. Estas
-- dos funciones SECURITY DEFINER hacen ese chequeo cruzado POR FUERA de
-- la RLS del que llama (mismo patrón que `get_disponibilidad_cancha`
-- usa para leer `reservas` sin que su propia RLS se lo oculte), así la
-- policy nunca vuelve a disparar la RLS de la tabla ajena.
create or replace function public.es_participante_de_reserva(p_reserva_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1 from public.reserva_participantes
         where reserva_id = p_reserva_id and user_id = p_user_id
    );
$$;

revoke all on function public.es_participante_de_reserva(uuid, uuid) from public;
grant execute on function public.es_participante_de_reserva(uuid, uuid) to authenticated;

create or replace function public.es_organizador_de_reserva(p_reserva_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
    select exists (
        select 1 from public.reservas
         where id = p_reserva_id and organizador_id = p_user_id
    );
$$;

revoke all on function public.es_organizador_de_reserva(uuid, uuid) from public;
grant execute on function public.es_organizador_de_reserva(uuid, uuid) to authenticated;

-- reservas: solo el organizador o quien está convocado la ve. Nada de
-- insert/update/delete directo — todo pasa por las RPC de más abajo.
drop policy if exists "reservas_select" on public.reservas;
create policy "reservas_select"
    on public.reservas for select
    using (
        auth.uid() = organizador_id
        or public.es_participante_de_reserva(id, auth.uid())
    );

-- reserva_participantes: el propio participante o el organizador de esa
-- reserva. Sin insert/update/delete directo (RPC).
drop policy if exists "reserva_participantes_select" on public.reserva_participantes;
create policy "reserva_participantes_select"
    on public.reserva_participantes for select
    using (
        auth.uid() = user_id
        or public.es_organizador_de_reserva(reserva_id, auth.uid())
    );

-- autorizaciones_cobro: la tabla más sensible junto a balance_movimientos.
-- Solo lo propio, sin excepción, sin insert/update/delete directo.
drop policy if exists "autorizaciones_cobro_select" on public.autorizaciones_cobro;
create policy "autorizaciones_cobro_select"
    on public.autorizaciones_cobro for select
    using (auth.uid() = user_id);

-- ── 5. RPC: crear_reserva ────────────────────────────────────────
-- Crea la reserva en 'armando' (o 'procesando' si es 'completa': no hay
-- grupo que armar, se va derecho al cobro). Rechazo temprano si el slot
-- ya está 'confirmada' — informativo nomás: la exclusividad real la
-- garantiza `confirmar_reserva`.
--
-- "Pagar cancha completa" como salida de emergencia (pantallas 17/27/28
-- del handoff: saldo insuficiente, capitán rechazó, jugador rechazó) NO
-- tiene una función de "cambiar modalidad" propia, y no hace falta una:
-- el camino es (1) `cancelar_reserva()` sobre la reserva a medio armar
-- —siempre segura mientras no esté 'confirmada': no hay ventana de 12h
-- ni devolución que hacer, porque en 'armando'/'procesando' todavía no
-- se cobró nada— y (2) `crear_reserva(..., p_modalidad := 'completa')`
-- para el mismo horario. No hay carrera nueva que cuidar acá: el slot
-- de la reserva vieja NUNCA bloqueaba a otros mientras no era
-- 'confirmada' (esa es la regla de negocio de fondo), así que cancelarla
-- no cambia la disponibilidad — solo evita dejar un 'armando' fantasma
-- colgado hasta que `vencer_reservas_pasadas()` lo limpie solo.
create or replace function public.crear_reserva(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_modalidad text,
    p_medio_pago text default 'balance',
    p_n_jugadores integer default null,
    p_es_desafio_club boolean default false,
    p_club_organizador_id uuid default null,
    p_club_rival_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_cancha public.canchas_reservables;
    v_hora_fin time;
    v_precio_total integer;
    v_cuota integer;
    v_estado text;
    v_reserva_id uuid;
    v_ocupada boolean;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    if p_modalidad not in ('completa', 'capitanes', 'jugadores') then
        return json_build_object('ok', false, 'reason', 'Modalidad inválida');
    end if;
    if p_medio_pago not in ('balance', 'tarjeta') then
        return json_build_object('ok', false, 'reason', 'Medio de pago inválido');
    end if;
    -- Regla de negocio: capitanes/jugadores requieren Balance.
    if p_modalidad in ('capitanes', 'jugadores') and p_medio_pago <> 'balance' then
        return json_build_object('ok', false, 'reason', 'Esta modalidad requiere Balance FutFinder');
    end if;
    if p_modalidad = 'jugadores' and (p_n_jugadores is null or p_n_jugadores < 2) then
        return json_build_object('ok', false, 'reason', 'Indica cuántos jugadores participan (mínimo 2)');
    end if;
    if p_es_desafio_club and (p_club_organizador_id is null or p_club_rival_id is null) then
        return json_build_object('ok', false, 'reason', 'Falta indicar los clubes del desafío');
    end if;

    -- Normaliza parámetros que no aplican a la modalidad/tipo elegido,
    -- para que un caller que los manda de todos modos no choque contra
    -- el CHECK de la tabla (eso sería un error de sistema por un
    -- descuido del cliente, no un rechazo de negocio real).
    if p_modalidad <> 'jugadores' then
        p_n_jugadores := null;
    end if;
    if not p_es_desafio_club then
        p_club_organizador_id := null;
        p_club_rival_id := null;
    end if;

    select * into v_cancha from public.canchas_reservables where id = p_cancha_id;
    if v_cancha is null or not v_cancha.activa then
        return json_build_object('ok', false, 'reason', 'Cancha no disponible');
    end if;

    v_hora_fin := p_hora_inicio + (v_cancha.duracion_slot_min || ' minutes')::interval;
    v_precio_total := v_cancha.precio_hora;

    select exists (
        select 1 from public.reservas
         where cancha_id = p_cancha_id
           and fecha = p_fecha
           and hora_inicio = p_hora_inicio
           and estado = 'confirmada'
    ) into v_ocupada;
    if v_ocupada then
        return json_build_object('ok', false, 'reason', 'ocupado');
    end if;

    if p_modalidad = 'jugadores' then
        v_cuota := ceil(v_precio_total::numeric / p_n_jugadores);
    end if;

    v_estado := case when p_modalidad = 'completa' then 'procesando' else 'armando' end;

    insert into public.reservas (
        cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
        precio_total, modalidad, medio_pago, n_jugadores, cuota, estado,
        es_desafio_club, club_organizador_id, club_rival_id
    ) values (
        p_cancha_id, v_me, p_fecha, p_hora_inicio, v_hora_fin,
        v_precio_total, p_modalidad, p_medio_pago, p_n_jugadores, v_cuota, v_estado,
        p_es_desafio_club, p_club_organizador_id, p_club_rival_id
    )
    returning id into v_reserva_id;

    -- El organizador cuenta como participante (y pagador) en capitanes y
    -- jugadores; en 'completa' no aplica reserva_participantes (spec).
    if p_modalidad in ('capitanes', 'jugadores') then
        insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
        values (v_reserva_id, v_me, 'organizador', 'aceptado');
    end if;

    return json_build_object('ok', true, 'reserva_id', v_reserva_id);
end;
$$;

revoke all on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid) from public;
grant execute on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid) to authenticated;

-- ── 6. RPC: invitar_participante_reserva ─────────────────────────
-- No estaba en la lista de RPC del encargo, pero sin ella
-- `reserva_participantes` no tiene ninguna vía de escritura real para
-- sumar al segundo capitán o a cada jugador convocado (está sin
-- insert/update directo a propósito). La usan las pantallas "Elegir
-- capitán" y "Convocatoria".
create or replace function public.invitar_participante_reserva(
    p_reserva_id uuid,
    p_user_id uuid,
    p_rol text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_nombre text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if p_rol not in ('capitan', 'jugador') then
        return json_build_object('ok', false, 'reason', 'Rol inválido');
    end if;
    if p_user_id = v_me then
        return json_build_object('ok', false, 'reason', 'No puedes invitarte a ti mismo');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.organizador_id <> v_me then
        return json_build_object('ok', false, 'reason', 'Solo el organizador invita participantes');
    end if;
    if v_reserva.estado <> 'armando' then
        return json_build_object('ok', false, 'reason', 'La reserva ya no admite cambios');
    end if;
    if p_rol = 'capitan' and v_reserva.modalidad <> 'capitanes' then
        return json_build_object('ok', false, 'reason', 'Esta reserva no es de modalidad capitanes');
    end if;
    if p_rol = 'jugador' and v_reserva.modalidad <> 'jugadores' then
        return json_build_object('ok', false, 'reason', 'Esta reserva no es de modalidad jugadores');
    end if;
    -- `estado <> 'rechazado'` es imprescindible: si no se excluye, la
    -- fila del capitán que YA rechazó sigue "ocupando" el cupo y el
    -- organizador nunca puede invitar a un reemplazo (rompe el flujo de
    -- "Capitán rechazó → invitar a otro capitán").
    if p_rol = 'capitan' and exists (
        select 1 from public.reserva_participantes
         where reserva_id = p_reserva_id and rol = 'capitan' and estado <> 'rechazado'
    ) then
        return json_build_object('ok', false, 'reason', 'Ya hay un segundo capitán invitado');
    end if;

    insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
    values (p_reserva_id, p_user_id, p_rol, 'pendiente')
    on conflict (reserva_id, user_id) do nothing;

    select username into v_nombre from public.profiles where id = v_me;

    insert into public.notifications (user_id, type, title, body, data)
    values (
        p_user_id,
        case when p_rol = 'capitan' then 'reserva_invitacion_capitan' else 'reserva_invitacion_jugador' end,
        case when p_rol = 'capitan' then 'Te invitaron como capitán' else 'Te invitaron a jugar' end,
        coalesce(v_nombre, 'Un jugador') || ' te invitó a una reserva de cancha.',
        jsonb_build_object('reservaId', p_reserva_id)
    );

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.invitar_participante_reserva(uuid, uuid, text) from public;
grant execute on function public.invitar_participante_reserva(uuid, uuid, text) to authenticated;

-- ── 7. RPC: rechazar_invitacion_reserva ──────────────────────────
create or replace function public.rechazar_invitacion_reserva(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_rol text;
    v_organizador_id uuid;
    v_nombre text;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- `returning rol into v_rol` deja v_rol en NULL si no se actualizó
    -- ninguna fila (no hay UPDATE que calce) — `rol` es NOT NULL en la
    -- tabla, así que no hay ambigüedad con una fila real.
    update public.reserva_participantes
       set estado = 'rechazado'
     where reserva_id = p_reserva_id
       and user_id = v_me
       and estado = 'pendiente'
    returning rol into v_rol;

    if v_rol is null then
        return json_build_object('ok', false, 'reason', 'No tienes una invitación pendiente en esta reserva');
    end if;

    select organizador_id into v_organizador_id from public.reservas where id = p_reserva_id;
    select username into v_nombre from public.profiles where id = v_me;

    insert into public.notifications (user_id, type, title, body, data)
    values (
        v_organizador_id,
        'reserva_invitacion_rechazada',
        case when v_rol = 'capitan' then 'El capitán rechazó la invitación' else 'Un jugador rechazó la invitación' end,
        coalesce(v_nombre, 'Alguien') || ' rechazó tu invitación a la reserva.',
        jsonb_build_object('reservaId', p_reserva_id, 'rol', v_rol)
    );

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.rechazar_invitacion_reserva(uuid) from public;
grant execute on function public.rechazar_invitacion_reserva(uuid) to authenticated;

-- ── 8. RPC: autorizar_cobro_reserva ───────────────────────────────
-- El monto tiene que calzar EXACTO con la cuota vigente (organizador
-- paga completo en 'completa', mitad redondeada hacia arriba en
-- 'capitanes', `reservas.cuota` en 'jugadores'). Aceptar la invitación
-- y autorizar el cobro son el mismo paso, a propósito (así lo pide el
-- diseño): no hay un "aceptar" separado de "autorizar".
create or replace function public.autorizar_cobro_reserva(
    p_reserva_id uuid,
    p_monto integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_monto_esperado integer;
    v_participante public.reserva_participantes;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if p_monto is null or p_monto < 0 then
        return json_build_object('ok', false, 'reason', 'Monto inválido');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.estado not in ('armando', 'procesando') then
        return json_build_object('ok', false, 'reason', 'La reserva ya no admite autorizaciones');
    end if;

    if v_reserva.modalidad = 'completa' then
        if v_me <> v_reserva.organizador_id then
            return json_build_object('ok', false, 'reason', 'Solo el organizador paga en esta modalidad');
        end if;
        v_monto_esperado := v_reserva.precio_total;
    elsif v_reserva.modalidad = 'capitanes' then
        select * into v_participante
          from public.reserva_participantes
         where reserva_id = p_reserva_id and user_id = v_me and rol in ('organizador', 'capitan');
        if v_participante is null then
            return json_build_object('ok', false, 'reason', 'No eres capitán de esta reserva');
        end if;
        v_monto_esperado := ceil(v_reserva.precio_total::numeric / 2);
    else -- jugadores
        select * into v_participante
          from public.reserva_participantes
         where reserva_id = p_reserva_id and user_id = v_me;
        if v_participante is null then
            return json_build_object('ok', false, 'reason', 'No formas parte de esta reserva');
        end if;
        v_monto_esperado := v_reserva.cuota;
    end if;

    if p_monto <> v_monto_esperado then
        return json_build_object(
            'ok', false, 'reason', 'El monto no coincide con la cuota vigente',
            'monto_esperado', v_monto_esperado
        );
    end if;

    if v_reserva.modalidad <> 'completa' then
        update public.reserva_participantes
           set estado = 'aceptado', monto_autorizado = p_monto, autorizado_at = now()
         where reserva_id = p_reserva_id and user_id = v_me;
    end if;

    insert into public.autorizaciones_cobro (reserva_id, user_id, monto, vigente)
    values (p_reserva_id, v_me, p_monto, true);

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.autorizar_cobro_reserva(uuid, integer) from public;
grant execute on function public.autorizar_cobro_reserva(uuid, integer) to authenticated;

-- ── 9. RPC: confirmar_reserva ─────────────────────────────────────
-- El paso crítico: disponibilidad → GRUPO COMPLETO → aceptaciones →
-- saldos → descontar → confirmar, dentro de una sola transacción. La
-- verificación de grupo completo (capitán B presente en 'capitanes',
-- exactamente `n_jugadores` filas en 'jugadores') es imprescindible:
-- sin ella, confirmar con el grupo a medio armar cobra menos del 100%
-- del valor de la cancha y la reserva queda igual marcada 'confirmada'
-- (viola la regla de negocio: "la reserva existe solo cuando se cobra
-- el 100%"). Si algo real falla a mitad de camino, Postgres revierte
-- todo solo (no hace falta un bloque EXCEPTION que lo capture —
-- capturarlo aquí sería exactamente lo que la regla de negocio pide
-- evitar).
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
    -- La pasarela de tarjeta no está conectada todavía: cobrar por
    -- Balance cuando el usuario eligió tarjeta falsearía el medio de pago.
    if v_reserva.medio_pago <> 'balance' then
        return json_build_object('ok', false, 'reason', 'El pago con tarjeta todavía no está disponible');
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

revoke all on function public.confirmar_reserva(uuid) from public;
grant execute on function public.confirmar_reserva(uuid) to authenticated;

-- ── 10. RPC: recalcular_cuota_reserva ─────────────────────────────
-- Cambiar cuántos jugadores dividen la cuenta invalida TODAS las
-- autorizaciones vigentes (incluida la del organizador, que también
-- paga en esta modalidad): nadie queda cobrado con un monto que no
-- volvió a autorizar.
create or replace function public.recalcular_cuota_reserva(
    p_reserva_id uuid,
    p_n_jugadores integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_cuota integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if p_n_jugadores is null or p_n_jugadores < 2 then
        return json_build_object('ok', false, 'reason', 'Mínimo 2 jugadores');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.organizador_id <> v_me then
        return json_build_object('ok', false, 'reason', 'Solo el organizador cambia la convocatoria');
    end if;
    if v_reserva.modalidad <> 'jugadores' then
        return json_build_object('ok', false, 'reason', 'Esta reserva no se paga por cuota entre jugadores');
    end if;
    if v_reserva.estado <> 'armando' then
        return json_build_object('ok', false, 'reason', 'La reserva ya no admite cambios');
    end if;

    v_cuota := ceil(v_reserva.precio_total::numeric / p_n_jugadores);

    update public.reservas
       set n_jugadores = p_n_jugadores, cuota = v_cuota
     where id = p_reserva_id;

    update public.autorizaciones_cobro
       set vigente = false
     where reserva_id = p_reserva_id and vigente = true;

    -- El organizador no vuelve a "pendiente" (nunca tuvo una invitación
    -- que aceptar), pero sí pierde su autorización de monto, igual que
    -- todos: paga la misma cuota que el resto.
    update public.reserva_participantes
       set monto_autorizado = null,
           autorizado_at = null,
           estado = case when rol = 'organizador' then estado else 'pendiente' end
     where reserva_id = p_reserva_id;

    insert into public.notifications (user_id, type, title, body, data)
    select user_id, 'reserva_cuota_recalculada', 'La cuota de tu partido cambió',
           'Ahora es $' || v_cuota || ' por jugador. Autorízalo de nuevo para seguir participando.',
           jsonb_build_object('reservaId', p_reserva_id, 'cuota', v_cuota)
      from public.reserva_participantes
     where reserva_id = p_reserva_id and rol <> 'organizador';

    return json_build_object('ok', true, 'cuota', v_cuota);
end;
$$;

revoke all on function public.recalcular_cuota_reserva(uuid, integer) from public;
grant execute on function public.recalcular_cuota_reserva(uuid, integer) to authenticated;

-- ── 11. RPC: cancelar_reserva ──────────────────────────────────────
-- Ventana de 12h antes del inicio (solo aplica si ya estaba
-- 'confirmada': cancelar algo que nunca se cobró no tiene ventana).
-- Devuelve el saldo exacto a quien pagó, sin repartir de nuevo. Los
-- desafíos de club no se cancelan solos: quedan 'solicitada' hasta que
-- el otro club responde (ver RPC 12).
create or replace function public.cancelar_reserva(
    p_reserva_id uuid,
    p_motivo text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_inicio timestamptz;
    v_mi_club_id uuid;
    v_otro_club_id uuid;
    v_pago record;
    v_puede_desafio boolean;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.estado not in ('armando', 'procesando', 'confirmada') then
        return json_build_object('ok', false, 'reason', 'Esta reserva ya no se puede cancelar');
    end if;

    select exists (
        select 1 from public.club_members m
         where m.user_id = v_me and m.rol = 'admin'
           and m.club_id in (v_reserva.club_organizador_id, v_reserva.club_rival_id)
    ) into v_puede_desafio;

    if v_reserva.organizador_id <> v_me and not (v_reserva.es_desafio_club and v_puede_desafio) then
        return json_build_object('ok', false, 'reason', 'No puedes cancelar esta reserva');
    end if;

    v_inicio := v_reserva.fecha + v_reserva.hora_inicio;
    if v_reserva.estado = 'confirmada' and now() > v_inicio - interval '12 hours' then
        return json_build_object('ok', false, 'reason', 'Ya no se puede cancelar: quedan menos de 12 horas');
    end if;

    if v_reserva.es_desafio_club then
        select m.club_id into v_mi_club_id
          from public.club_members m
         where m.user_id = v_me and m.rol = 'admin'
           and m.club_id in (v_reserva.club_organizador_id, v_reserva.club_rival_id)
         limit 1;
        v_otro_club_id := case when v_mi_club_id = v_reserva.club_organizador_id
                                then v_reserva.club_rival_id else v_reserva.club_organizador_id end;

        update public.reservas
           set cancelacion_estado = 'solicitada',
               cancelacion_solicitada_por_club_id = v_mi_club_id
         where id = p_reserva_id;

        insert into public.notifications (user_id, type, title, body, data)
        select m.user_id, 'reserva_cancelacion_solicitada', 'Solicitud de cancelación',
               'El club rival pidió cancelar la reserva de cancha del desafío.',
               jsonb_build_object('reservaId', p_reserva_id)
          from public.club_members m
         where m.rol = 'admin' and m.club_id = v_otro_club_id;

        return json_build_object('ok', true, 'cancelacion_estado', 'solicitada');
    end if;

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

    return json_build_object('ok', true, 'reserva_id', p_reserva_id);
end;
$$;

revoke all on function public.cancelar_reserva(uuid, text) from public;
grant execute on function public.cancelar_reserva(uuid, text) to authenticated;

-- ── 12. RPC: responder_cancelacion_desafio ────────────────────────
-- Solo el club que NO pidió la cancelación puede aceptarla o rechazarla.
create or replace function public.responder_cancelacion_desafio(
    p_reserva_id uuid,
    p_acepta boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_mi_club_id uuid;
    v_pago record;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if not v_reserva.es_desafio_club or v_reserva.cancelacion_estado <> 'solicitada' then
        return json_build_object('ok', false, 'reason', 'No hay una solicitud de cancelación pendiente');
    end if;

    select m.club_id into v_mi_club_id
      from public.club_members m
     where m.user_id = v_me and m.rol = 'admin'
       and m.club_id in (v_reserva.club_organizador_id, v_reserva.club_rival_id)
       and m.club_id <> v_reserva.cancelacion_solicitada_por_club_id
     limit 1;

    if v_mi_club_id is null then
        return json_build_object('ok', false, 'reason', 'Solo el club que no pidió la cancelación puede responder');
    end if;

    if not p_acepta then
        update public.reservas set cancelacion_estado = 'rechazada' where id = p_reserva_id;
        return json_build_object('ok', true, 'cancelacion_estado', 'rechazada');
    end if;

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

    update public.reservas
       set estado = 'cancelada', cancelada_at = now(), cancelacion_estado = 'aceptada'
     where id = p_reserva_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct uid, 'reserva_cancelada', 'Reserva cancelada',
           'El otro club aceptó cancelar la reserva del desafío.',
           jsonb_build_object('reservaId', p_reserva_id)
      from (
          select v_reserva.organizador_id as uid
          union
          select user_id from public.reserva_participantes where reserva_id = p_reserva_id
      ) u;

    return json_build_object('ok', true, 'reserva_id', p_reserva_id);
end;
$$;

revoke all on function public.responder_cancelacion_desafio(uuid, boolean) from public;
grant execute on function public.responder_cancelacion_desafio(uuid, boolean) to authenticated;

-- ── 13. RPC: vencer_reservas_pasadas ──────────────────────────────
-- Limpieza, no negocio: una reserva 'armando'/'procesando' abandonada
-- (el usuario cierra la app a mitad del flujo) quedaba viva para
-- siempre — sin esto, ni `get_disponibilidad_cancha` ni el conteo de
-- `confirmar_reserva` tenían forma de distinguirla de una reserva
-- todavía activa. No cobra ni notifica a nadie: solo pasa el `estado`
-- a 'vencida' para que el resto del sistema deje de considerarla viva.
-- 'confirmada' nunca vence por esta vía (eso es cancelación, con su
-- propia ventana de 12h y su propia devolución).
--
-- No se dispara sola: hay que programarla con `pg_cron` (o el
-- scheduler que se use) para que corra cada 5-10 minutos, igual que
-- `send_match_reminders`/`send_rating_reminders` (ver
-- docs/memoria/operacion/pendientes.md — esas dos también son
-- cron jobs, aunque hoy no están versionadas). Esta migración solo la
-- deja creada; no se agenda ningún cron todavía.
create or replace function public.vencer_reservas_pasadas()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_vencidas integer;
begin
    update public.reservas
       set estado = 'vencida'
     where estado in ('armando', 'procesando')
       and (fecha + hora_inicio) < now();
    get diagnostics v_vencidas = row_count;

    return json_build_object('ok', true, 'vencidas', v_vencidas);
end;
$$;

-- Solo para el cron/service_role, no para el cliente: no tiene sentido
-- que un usuario autenticado la ejecute a mano. El revoke de PUBLIC no
-- alcanza: Supabase concede EXECUTE a `authenticated` por privilegio por
-- defecto en cada función nueva (mismo problema que documenta la
-- migración 43 sobre `procesar_vencimientos_desafios`), así que hay que
-- revocarlo explícitamente también de `authenticated` y `anon`.
revoke all on function public.vencer_reservas_pasadas() from public, anon, authenticated;
