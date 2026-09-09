-- =============================================================
-- FutFinder migration 64: precio por franja horaria
-- =============================================================
-- POR QUÉ AHORA: el primer recinto real que se intentó cargar no cabía
-- en el modelo. MaiClub (Maipú, 6 canchas) cobra $14.000 de 11:00 a
-- 17:00 y $28.000 desde ahí hasta el cierre, y `canchas_reservables`
-- tenía UN entero de precio por cancha. Las tres formas de cargarlo con
-- el modelo viejo estaban mal: precio bajo fijo (se regalan las horas de
-- la noche), precio alto fijo (nadie reserva de día), o duplicar las
-- canchas (rompe el calendario y las estadísticas). En Chile una cancha
-- de noche o de fin de semana no vale lo mismo que un martes a las
-- 15:00, así que esto no es un caso raro: va a ser la norma.
--
-- CÓMO SE RESUELVE UN PRECIO, en `precio_de_bloque()`:
--   1. La tarifa de ese DÍA de la semana que contiene la hora de inicio.
--   2. Si no hay, la tarifa de TODOS los días (`dia_semana is null`).
--   3. Si tampoco hay, `canchas_reservables.precio_hora`.
--
-- El paso 3 es lo que mantiene compatible todo lo anterior: una cancha
-- sin ninguna tarifa cargada sigue funcionando exactamente como antes.
-- Por eso `precio_hora` no se elimina ni se vuelve nullable — pasa a ser
-- el precio por defecto, y sigue siendo obligatorio para que una cancha
-- nunca quede sin precio.
--
-- EL RANGO ES SEMIABIERTO en la hora de inicio: una tarifa de 11:00 a
-- 17:00 cubre los bloques que EMPIEZAN a las 11, 12, 13, 14, 15 y 16. El
-- bloque de las 17:00 ya pertenece a la franja siguiente. Es la lectura
-- natural de "de 11 a 17" y evita que dos franjas contiguas se peleen la
-- hora del borde.
--
-- LA COMISIÓN SIGUE AL PRECIO DEL BLOQUE. `crear_reserva` guarda en
-- `precio_total` el precio de la franja elegida, y la comisión (migración
-- 62) se calcula sobre eso. Ojo con el efecto en las horas baratas: 5% de
-- $14.000 son $700, así que se aplica el piso de $1.000 y el recinto paga
-- 7,1% en esas horas, no 5%.
--
-- Y EL PRECIO SE MUESTRA POR BLOQUE. `get_disponibilidad_cancha` ahora
-- devuelve `precio` en cada slot: sin eso el jugador elegiría una hora
-- sin saber cuánto cuesta, que con precio único no importaba y con
-- franjas es inaceptable.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. TABLA: cancha_tarifas ─────────────────────────────────────
-- `dia_semana` NULL significa "todos los días", y es el caso habitual.
-- Una fila con día específico gana sobre la de todos los días, así que
-- "todos a $14.000 hasta las 17:00, pero el sábado todo el día a
-- $28.000" son dos filas y no siete.
create table if not exists public.cancha_tarifas (
    id uuid primary key default gen_random_uuid(),
    cancha_id uuid not null references public.canchas_reservables(id) on delete cascade,
    dia_semana integer check (dia_semana is null or dia_semana between 0 and 6), -- 0 = domingo
    hora_desde time not null,
    hora_hasta time not null,
    precio integer not null check (precio >= 0),
    created_at timestamptz not null default now(),

    constraint cancha_tarifas_rango check (hora_hasta > hora_desde)
);

create index if not exists idx_cancha_tarifas_cancha on public.cancha_tarifas(cancha_id);

alter table public.cancha_tarifas enable row level security;

-- Lectura pública, igual que `canchas_reservables` y sus horarios: el
-- precio es justamente lo que el jugador necesita ver antes de reservar,
-- y se muestra sin iniciar sesión.
drop policy if exists "cancha_tarifas_select" on public.cancha_tarifas;
create policy "cancha_tarifas_select"
    on public.cancha_tarifas for select
    using (true);
-- Sin policies de escritura: solo vía `admin_upsert_tarifa` /
-- `admin_eliminar_tarifa`.

-- ── 2. Resolución del precio de un bloque ────────────────────────
-- Único lugar donde se decide cuánto cuesta una hora. `crear_reserva`,
-- la disponibilidad del jugador y el calendario del recinto la llaman
-- todas: si cada una resolviera el precio por su cuenta, un día el
-- jugador vería $14.000 y se le cobrarían $28.000.
--
-- `order by dia_semana nulls last` es lo que hace ganar a la tarifa del
-- día específico sobre la general.
create or replace function public.precio_de_bloque(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time
)
returns integer
language sql
stable
as $$
    select coalesce(
        (select t.precio
           from public.cancha_tarifas t
          where t.cancha_id = p_cancha_id
            and (t.dia_semana is null or t.dia_semana = extract(dow from p_fecha)::integer)
            and p_hora_inicio >= t.hora_desde
            and p_hora_inicio <  t.hora_hasta
          order by t.dia_semana nulls last
          limit 1),
        (select k.precio_hora from public.canchas_reservables k where k.id = p_cancha_id)
    );
$$;

revoke all on function public.precio_de_bloque(uuid, date, time) from public;
-- `anon` incluido a propósito, igual que `get_disponibilidad_cancha`: el
-- precio es información pública que se muestra antes de iniciar sesión.
grant execute on function public.precio_de_bloque(uuid, date, time) to authenticated, anon;

-- ── 3. Administración de tarifas ─────────────────────────────────
-- Rechaza franjas que se cruzan DENTRO del mismo `dia_semana`: dos
-- tarifas que se pisan dejarían el precio de esa hora a merced del
-- `limit 1`, o sea indeterminado. Que una tarifa de sábado se cruce con
-- una de todos los días SÍ se permite: es exactamente cómo se sobrescribe
-- un día.
create or replace function public.admin_upsert_tarifa(
    p_cancha_id uuid,
    p_hora_desde time,
    p_hora_hasta time,
    p_precio integer,
    p_dia_semana integer default null,
    p_tarifa_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;
    if p_hora_hasta <= p_hora_desde then
        raise exception 'La hora de término tiene que ser posterior a la de inicio';
    end if;
    if p_precio is null or p_precio < 0 then
        raise exception 'El precio no puede ser negativo';
    end if;
    if p_dia_semana is not null and p_dia_semana not between 0 and 6 then
        raise exception 'Día de la semana inválido';
    end if;

    if exists (
        select 1 from public.cancha_tarifas t
         where t.cancha_id = p_cancha_id
           and t.dia_semana is not distinct from p_dia_semana
           and (p_tarifa_id is null or t.id <> p_tarifa_id)
           and p_hora_desde < t.hora_hasta
           and p_hora_hasta > t.hora_desde
    ) then
        raise exception 'Ya hay una tarifa que se cruza con ese horario';
    end if;

    if p_tarifa_id is not null then
        update public.cancha_tarifas set
            dia_semana = p_dia_semana,
            hora_desde = p_hora_desde,
            hora_hasta = p_hora_hasta,
            precio     = p_precio
         where id = p_tarifa_id
           and cancha_id = p_cancha_id
        returning id into v_id;

        if v_id is null then
            raise exception 'Esa tarifa no pertenece a esta cancha';
        end if;
    else
        insert into public.cancha_tarifas (cancha_id, dia_semana, hora_desde, hora_hasta, precio)
        values (p_cancha_id, p_dia_semana, p_hora_desde, p_hora_hasta, p_precio)
        returning id into v_id;
    end if;

    return v_id;
end;
$$;

revoke all on function public.admin_upsert_tarifa(uuid, time, time, integer, integer, uuid) from public, anon;
grant execute on function public.admin_upsert_tarifa(uuid, time, time, integer, integer, uuid) to authenticated;

create or replace function public.admin_eliminar_tarifa(p_tarifa_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha_id uuid;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select cancha_id into v_cancha_id from public.cancha_tarifas where id = p_tarifa_id;

    if v_cancha_id is null or not public.es_admin_cancha(v_cancha_id) then
        raise exception 'No administras esta tarifa';
    end if;

    -- Borrar la última tarifa no deja la cancha sin precio: cae en
    -- `precio_hora`, que es obligatorio.
    delete from public.cancha_tarifas where id = p_tarifa_id;
end;
$$;

revoke all on function public.admin_eliminar_tarifa(uuid) from public, anon;
grant execute on function public.admin_eliminar_tarifa(uuid) to authenticated;

-- ── 4. Las tres funciones que deciden o muestran un precio ───────
-- Las tres se reemplazan con `create or replace` desde su versión
-- vigente (`crear_reserva` de la 62, `get_disponibilidad_cancha` de la
-- 60, `admin_calendario_cancha` de la 61) con un solo cambio cada una:
-- pasan por `precio_de_bloque()`. El resto del cuerpo es idéntico.
--
-- Que las tres usen la MISMA función no es prolijidad: si la
-- disponibilidad resolviera el precio por su cuenta y `crear_reserva`
-- por la suya, un jugador vería $14.000 en la grilla y se le cobrarían
-- $28.000. Eso es un reclamo, no un bug de redondeo.

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
    -- El precio sale de la FRANJA del bloque elegido (migración 64), no
    -- de la columna de la cancha. `precio_de_bloque` cae en
    -- `precio_hora` cuando la cancha no tiene tarifas cargadas, así que
    -- una cancha de precio único se comporta igual que antes.
    v_precio_total := public.precio_de_bloque(p_cancha_id, p_fecha, p_hora_inicio);

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

    -- Cableado de los bloqueos de administración (migración 60). Va
    -- aparte de `v_ocupada` y con su propio `reason`: para quien reserva
    -- son lo mismo (no puede tomar ese horario), pero el recinto y el
    -- soporte necesitan poder distinguir "otro se te adelantó" de "el
    -- complejo cerró ese bloque".
    if public.slot_bloqueado(p_cancha_id, p_fecha, p_hora_inicio, v_hora_fin) then
        return json_build_object('ok', false, 'reason', 'bloqueado');
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

    -- Comisión de FutFinder, CONGELADA acá y para siempre (migración
    -- 62). Se guardan también la tasa, el piso, el techo y la tasa de
    -- IVA vigentes, para que esta fila se explique sola dentro de dos
    -- años aunque los números hayan cambiado. `base` es hoy el precio
    -- de la cancha; cuando existan los cobros adicionales pasa a ser
    -- cancha + adicionales, y por eso se guarda explícita.
    insert into public.reserva_comisiones
        (reserva_id, base, tasa, piso, techo, iva_tasa, monto)
    values (
        v_reserva_id,
        v_precio_total,
        (public.comision_params()->>'tasa')::numeric,
        (public.comision_params()->>'piso')::integer,
        (public.comision_params()->>'techo')::integer,
        (public.comision_params()->>'iva_tasa')::numeric,
        public.calcular_comision(v_precio_total)
    );

    -- El organizador cuenta como participante (y pagador) en capitanes y
    -- jugadores; en 'completa' no aplica reserva_participantes (spec).
    if p_modalidad in ('capitanes', 'jugadores') then
        insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
        values (v_reserva_id, v_me, 'organizador', 'aceptado');
    end if;

    return json_build_object('ok', true, 'reserva_id', v_reserva_id);
end;
$$;

revoke all on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid) from public, anon;
grant execute on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid) to authenticated;

create or replace function public.get_disponibilidad_cancha(
    p_cancha_id uuid,
    p_fecha date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha public.canchas_reservables;
    v_dow integer;
    v_slot_min integer;
    v_slots json;
begin
    select * into v_cancha from public.canchas_reservables where id = p_cancha_id;
    if v_cancha is null then
        return json_build_object('ok', false, 'reason', 'Cancha no existe');
    end if;
    if not v_cancha.activa then
        return json_build_object('ok', false, 'reason', 'Cancha no disponible');
    end if;

    v_dow := extract(dow from p_fecha)::integer;
    v_slot_min := v_cancha.duracion_slot_min;

    select coalesce(json_agg(json_build_object(
               'hora_inicio', to_char(s.hora_inicio, 'HH24:MI'),
               'hora_fin', to_char(s.hora_inicio + (v_slot_min || ' minutes')::interval, 'HH24:MI'),
               -- Precio del bloque (migración 64). Antes no hacía falta
               -- porque toda la cancha valía lo mismo; con franjas, el
               -- jugador elegiría una hora sin saber cuánto cuesta.
               'precio', public.precio_de_bloque(p_cancha_id, p_fecha, s.hora_inicio),
               -- Solo 'confirmada' bloquea el slot: 'procesando' es el
               -- estado inicial de toda reserva 'completa' apenas se
               -- crea, ANTES de que nadie pague un peso. Bloquearlo acá
               -- contradecía la regla de negocio — mientras se arma el
               -- grupo (o se procesa el pago, para 'completa'), el
               -- horario sigue disponible para otros hasta que alguien
               -- de verdad confirma. `crear_reserva` ya lo hacía bien;
               -- esta era la única función con el criterio equivocado.
               'disponible', not exists (
                   select 1 from public.reservas r
                    where r.cancha_id = p_cancha_id
                      and r.fecha = p_fecha
                      and r.hora_inicio = s.hora_inicio
                      and r.estado = 'confirmada'
               )
               -- Cableado de los bloqueos de administración (migración
               -- 60). Sin esta condición `cancha_bloqueos` sería
               -- decorativa: el bloque marcado por mantención seguiría
               -- pintándose libre. No se distingue "ocupado" de
               -- "bloqueado" a propósito: el criterio de esta función es
               -- no revelar POR QUÉ un slot no está, solo que no está.
               and not public.slot_bloqueado(
                   p_cancha_id, p_fecha, s.hora_inicio,
                   s.hora_inicio + (v_slot_min || ' minutes')::interval
               )
           ) order by s.hora_inicio), '[]'::json)
      into v_slots
      from (
          select generate_series(
                     (p_fecha + r.hora_apertura)::timestamp,
                     (p_fecha + r.hora_cierre)::timestamp - (v_slot_min || ' minutes')::interval,
                     (v_slot_min || ' minutes')::interval
                 )::time as hora_inicio
            from public.cancha_horario_reglas r
           where r.cancha_id = p_cancha_id
             and r.dia_semana = v_dow
      ) s;

    return json_build_object('ok', true, 'slots', v_slots);
end;
$$;

revoke all on function public.get_disponibilidad_cancha(uuid, date) from public;
grant execute on function public.get_disponibilidad_cancha(uuid, date) to authenticated, anon;

create or replace function public.admin_calendario_cancha(
    p_cancha_id uuid,
    p_fecha date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha public.canchas_reservables;
    v_dow integer;
    v_slot_min integer;
    v_slots json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;

    select * into v_cancha from public.canchas_reservables where id = p_cancha_id;
    if v_cancha is null then
        return json_build_object('ok', false, 'reason', 'Cancha no existe');
    end if;

    v_dow := extract(dow from p_fecha)::integer;
    v_slot_min := v_cancha.duracion_slot_min;

    select coalesce(json_agg(s order by s.hora_inicio), '[]'::json)
      into v_slots
      from (
          select to_char(g.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(g.hora_fin, 'HH24:MI')    as hora_fin,
                 -- Mismo precio que ve el jugador, resuelto por la misma
                 -- función: si el recinto viera otro número, el problema
                 -- sería del recinto y del soporte, no del jugador.
                 public.precio_de_bloque(p_cancha_id, p_fecha, g.hora_inicio) as precio,
                 case
                     when bl.id is not null then 'bloqueada'
                     when res.id is not null then 'reservada'
                     else 'libre'
                 end as estado,
                 case when bl.id is null then null else json_build_object(
                     'id', bl.id, 'motivo', bl.motivo,
                     'hora_inicio', to_char(bl.hora_inicio, 'HH24:MI'),
                     'hora_fin', to_char(bl.hora_fin, 'HH24:MI')
                 ) end as bloqueo,
                 case when res.id is null then null else json_build_object(
                     'id', res.id, 'estado', res.estado,
                     'modalidad', res.modalidad, 'medio_pago', res.medio_pago,
                     'precio_total', res.precio_total,
                     'organizador_username', res.username,
                     'organizador_foto_url', res.foto_url
                 ) end as reserva,
                 -- Grupos que están juntando la plata sobre este bloque.
                 -- NO lo ocupan: el bloque sigue 'libre'.
                 (select count(*)
                    from public.reservas r2
                   where r2.cancha_id = p_cancha_id
                     and r2.fecha = p_fecha
                     and r2.estado in ('armando', 'procesando')
                     and g.hora_inicio < r2.hora_fin
                     and g.hora_fin > r2.hora_inicio) as grupos_en_curso
            from (
                select h as hora_inicio,
                       (h + (v_slot_min || ' minutes')::interval)::time as hora_fin
                  from (
                      select generate_series(
                                 (p_fecha + hr.hora_apertura)::timestamp,
                                 (p_fecha + hr.hora_cierre)::timestamp - (v_slot_min || ' minutes')::interval,
                                 (v_slot_min || ' minutes')::interval
                             )::time as h
                        from public.cancha_horario_reglas hr
                       where hr.cancha_id = p_cancha_id
                         and hr.dia_semana = v_dow
                  ) gen
            ) g
            left join lateral (
                select b.id, b.motivo, b.hora_inicio, b.hora_fin
                  from public.cancha_bloqueos b
                 where b.cancha_id = p_cancha_id
                   and b.fecha = p_fecha
                   and g.hora_inicio < b.hora_fin
                   and (case when g.hora_fin <= g.hora_inicio then time '24:00' else g.hora_fin end) > b.hora_inicio
                 limit 1
            ) bl on true
            left join lateral (
                select r.id, r.estado, r.modalidad, r.medio_pago, r.precio_total,
                       p.username, p.foto_url
                  from public.reservas r
                  join public.profiles p on p.id = r.organizador_id
                 where r.cancha_id = p_cancha_id
                   and r.fecha = p_fecha
                   and r.estado = 'confirmada'
                   and g.hora_inicio < r.hora_fin
                   and (case when g.hora_fin <= g.hora_inicio then time '24:00' else g.hora_fin end) > r.hora_inicio
                 limit 1
            ) res on true
      ) s;

    return json_build_object(
        'ok', true,
        'cancha_id', p_cancha_id,
        'cancha_nombre', v_cancha.nombre,
        'duracion_slot_min', v_slot_min,
        'activa', v_cancha.activa,
        'fecha', to_char(p_fecha, 'YYYY-MM-DD'),
        'slots', v_slots
    );
end;
$$;

revoke all on function public.admin_calendario_cancha(uuid, date) from public, anon;
grant execute on function public.admin_calendario_cancha(uuid, date) to authenticated;
