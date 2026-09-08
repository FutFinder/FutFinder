-- =============================================================
-- FutFinder migration 62: la comisión de FutFinder
-- =============================================================
-- EL MODELO DE NEGOCIO, escrito una sola vez:
-- inscribir un recinto es gratis y no hay mensualidad. FutFinder cobra
-- una comisión solo cuando se concreta un arriendo, y la paga el
-- RECINTO, no el jugador.
--
--   · 5% del total de la reserva, con piso $1.000 y techo $2.500.
--   · Una sola comisión por reserva, siempre — también en un desafío
--     entre dos clubes: es una cancha y una hora.
--   · Si la reserva se cancela, no se cobra. Sin importar quién canceló
--     ni cuándo.
--   · Los montos son FINALES, con IVA incluido, y la comisión también
--     lo lleva dentro: de $2.150 de comisión, ~$1.807 es ingreso de
--     FutFinder y ~$343 es IVA. Por eso se guarda `iva_tasa` en cada
--     fila: el día que cambie, las filas viejas siguen explicándose
--     solas.
--
-- ANTES DE ESTA MIGRACIÓN el número vivía en el cliente y en ningún
-- lado más: `reservasRules.js` tenía `SERVICE_FEE_CLP = 1500` sumado
-- ARRIBA del precio, o sea un recargo al JUGADOR, que es el modelo
-- contrario al que se decidió. La base de datos no sabía nada de esto:
-- `crear_reserva` guardaba `precio_total = precio_hora` y punto. El
-- propio `reservasRules.js` advertía que había que verificar que esos
-- números siguieran coincidiendo cuando existiera backend real. Existía
-- desde la migración 55 y la verificación nunca se hizo; esta migración
-- la hace, y el recargo visible al jugador se elimina del cliente en el
-- mismo commit.
--
-- POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN `reservas`: porque el
-- jugador NUNCA debe ver la comisión, y `reservas_select` le deja leer
-- su propia fila completa. Con columnas en `reservas`, cualquier
-- `select *` del organizador se la mostraría, y la única defensa sería
-- revocar privilegios por columna — que además rompe todo `select *`
-- con un error de permisos en vez de omitir el dato. En una tabla
-- propia, con RLS que solo deja leer a los administradores del
-- complejo, la garantía es estructural y no depende de que nadie
-- escriba una consulta descuidada. Mismo criterio que `cancha_bloqueos`
-- en la migración 60: la comisión es un registro del negocio de
-- FutFinder y del recinto, no parte de la reserva del jugador.
--
-- CONGELADA AL RESERVAR, y esto es lo que no se puede perder: el monto,
-- la tasa, el piso, el techo y la tasa de IVA se guardan tal como
-- estaban el día que se reservó. El día que la comisión pase de 5% a 6%,
-- las reservas viejas tienen que seguir diciendo lo que de verdad se
-- cobró. Recalcularlas leyendo la constante de hoy corrompería la
-- contabilidad hacia atrás — y con boletas emitidas, eso no se arregla.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Los parámetros, en un solo lugar ──────────────────────────
-- Acá y en ningún otro lado viven los números. Cambiarlos es un
-- `create or replace` en una migración nueva; las filas ya escritas no
-- se tocan porque cada una guarda los suyos.
create or replace function public.comision_params()
returns json
language sql
immutable
as $$
    select json_build_object(
        'tasa', 0.05,
        'piso', 1000,
        'techo', 2500,
        'iva_tasa', 0.19
    );
$$;

-- Único cálculo de la comisión. El cliente NO debe replicar esta
-- fórmula: el valor que vale es el que quedó guardado en la fila.
--
-- El `least(..., p_base)` del final es un borde real: `precio_hora`
-- admite 0 (una cancha en promoción), y sin ese tope el piso de $1.000
-- dejaría al recinto debiéndole plata a FutFinder por una hora que
-- regaló. La comisión nunca puede ser mayor que la base.
create or replace function public.calcular_comision(p_base integer)
returns integer
language sql
immutable
as $$
    select case
        when p_base is null or p_base <= 0 then 0
        else least(
            greatest(
                (public.comision_params()->>'piso')::integer,
                least(
                    (public.comision_params()->>'techo')::integer,
                    round(p_base * (public.comision_params()->>'tasa')::numeric)::integer
                )
            ),
            p_base
        )
    end;
$$;

revoke all on function public.comision_params() from public, anon;
revoke all on function public.calcular_comision(integer) from public, anon;
-- `authenticated` conserva EXECUTE: la app del recinto puede querer
-- mostrar la regla ("cobramos 5%, mínimo $1.000") antes de que exista
-- una reserva. No hay nada sensible en devolver la fórmula — lo
-- sensible es el monto de una reserva concreta, y eso está en la tabla.
grant execute on function public.comision_params() to authenticated;
grant execute on function public.calcular_comision(integer) to authenticated;

-- ── 2. La comisión de cada reserva ───────────────────────────────
-- Una fila por reserva, escrita por `crear_reserva` y nunca más
-- modificada. `base` es el monto sobre el que se aplicó el porcentaje:
-- hoy es el precio de la cancha, y cuando existan los cobros
-- adicionales será cancha + adicionales. Se guarda explícito justamente
-- para que ese cambio no obligue a reinterpretar las filas viejas.
create table if not exists public.reserva_comisiones (
    reserva_id uuid primary key references public.reservas(id) on delete cascade,
    base integer not null check (base >= 0),
    tasa numeric(5, 4) not null check (tasa >= 0 and tasa <= 1),
    piso integer not null check (piso >= 0),
    techo integer not null check (techo >= 0),
    iva_tasa numeric(5, 4) not null check (iva_tasa >= 0 and iva_tasa <= 1),
    monto integer not null check (monto >= 0),
    created_at timestamptz not null default now(),

    -- La comisión nunca puede superar la base: si eso pasa, el neto del
    -- recinto es negativo y hay un error de cálculo, no un caso raro.
    constraint reserva_comisiones_no_supera_base check (monto <= base)
);

alter table public.reserva_comisiones enable row level security;

-- Helper `security definer` para la policy de abajo, y hace falta de
-- verdad: la primera versión de la policy hacía
--
--     exists (select 1 from public.reservas r
--              where r.id = reserva_comisiones.reserva_id
--                and es_admin_cancha(r.cancha_id))
--
-- y NO funcionaba — el dry-run la cazó antes de aplicarla. El `select`
-- de adentro corre con los permisos de quien llama, así que le aplica la
-- RLS de `reservas`, que solo deja ver al organizador y a los
-- participantes (migración 55). Un administrador de complejo no es
-- ninguno de los dos: el `exists` no encontraba la reserva y la policy
-- negaba todo. El recinto no habría podido leer ni una comisión.
--
-- Mismo remedio y mismo motivo que `es_participante_de_reserva()` y
-- `es_organizador_de_reserva()` en la migración 55: la vuelta por una
-- función `security definer`, que consulta las tablas como su dueño y no
-- reentra en la RLS de nadie.
create or replace function public.es_admin_de_reserva(p_reserva_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.reservas r
          join public.canchas_reservables k on k.id = r.cancha_id
          join public.complejo_admins ca    on ca.complejo_id = k.complejo_id
         where r.id = p_reserva_id
           and ca.user_id = auth.uid()
    );
$$;

revoke all on function public.es_admin_de_reserva(uuid) from public, anon;
grant execute on function public.es_admin_de_reserva(uuid) to authenticated;

-- Solo los administradores del complejo de esa cancha. `to
-- authenticated` y no `using (...)` a secas, por lo mismo que en la
-- migración 60: si la policy aplicara a `anon`, una consulta suya
-- evaluaría el helper y chocaría con un error de privilegio en vez de
-- devolver cero filas.
drop policy if exists "reserva_comisiones_select" on public.reserva_comisiones;
create policy "reserva_comisiones_select"
    on public.reserva_comisiones for select
    to authenticated
    using (public.es_admin_de_reserva(reserva_id));
-- Sin policies de escritura: la escribe `crear_reserva`, que es
-- `security definer`. Nadie más, nunca — ni el recinto ni el jugador.

-- ── 3. `crear_reserva` calcula y guarda la comisión ──────────────
-- Es la versión de la migración 60 (la vigente, con el cableado de los
-- bloqueos) con UN agregado: el insert en `reserva_comisiones` justo
-- después de crear la reserva. El resto del cuerpo es idéntico; se copia
-- completo porque Postgres no deja parchear el cuerpo de una función por
-- partes.

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

-- ── 4. El recinto ve el desglose ─────────────────────────────────
-- Las dos funciones de la migración 61, extendidas con la comisión. Era
-- un requisito del negocio y no un adorno: un recinto que no ve lo que
-- se le descuenta desconfía en la primera semana, así que la comisión se
-- muestra siempre y con el mismo peso visual que el resto.

create or replace function public.admin_agenda_complejo(
    p_complejo_id uuid,
    p_fecha date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reservas json;
    v_bloqueos json;
    v_resumen json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;

    select coalesce(json_agg(x order by x.hora_inicio, x.cancha_nombre), '[]'::json)
      into v_reservas
      from (
          select r.id,
                 r.cancha_id,
                 k.nombre                      as cancha_nombre,
                 k.tipo                        as cancha_tipo,
                 to_char(r.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(r.hora_fin, 'HH24:MI')    as hora_fin,
                 r.estado,
                 r.modalidad,
                 r.medio_pago,
                 r.precio_total,
                 -- Desglose de la comisión (migración 62). `left join`
                 -- porque una reserva anterior a esa migración no tiene
                 -- fila: en producción no existe ninguna, pero no se
                 -- asume que no exista.
                 coalesce(c.base, r.precio_total)                        as comision_base,
                 coalesce(c.monto, 0)                                    as comision,
                 coalesce(c.base, r.precio_total) - coalesce(c.monto, 0) as neto,
                 r.es_desafio_club,
                 r.n_jugadores,
                 p.username                    as organizador_username,
                 p.foto_url                    as organizador_foto_url,
                 -- Agregado, nunca la lista: el recinto necesita saber
                 -- si esto se va a completar, no quiénes son.
                 (select count(*) from public.reserva_participantes rp
                   where rp.reserva_id = r.id)                          as participantes_total,
                 (select count(*) from public.reserva_participantes rp
                   where rp.reserva_id = r.id and rp.estado = 'aceptado') as participantes_aceptados,
                 r.cancelada_at
            from public.reservas r
            join public.canchas_reservables k on k.id = r.cancha_id
            join public.profiles p            on p.id = r.organizador_id
            left join public.reserva_comisiones c on c.reserva_id = r.id
           where k.complejo_id = p_complejo_id
             and r.fecha = p_fecha
             and r.estado in ('confirmada', 'armando', 'procesando', 'cancelada')
      ) x;

    select coalesce(json_agg(y order by y.hora_inicio, y.cancha_nombre), '[]'::json)
      into v_bloqueos
      from (
          select b.id,
                 b.cancha_id,
                 k.nombre                      as cancha_nombre,
                 to_char(b.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(b.hora_fin, 'HH24:MI')    as hora_fin,
                 b.motivo
            from public.cancha_bloqueos b
            join public.canchas_reservables k on k.id = b.cancha_id
           where k.complejo_id = p_complejo_id
             and b.fecha = p_fecha
      ) y;

    select json_build_object(
               'reservas_confirmadas', count(*) filter (where r.estado = 'confirmada'),
               'reservas_en_curso',    count(*) filter (where r.estado in ('armando', 'procesando')),
               'reservas_canceladas',  count(*) filter (where r.estado = 'cancelada'),
               -- Solo lo confirmado suma plata: lo que está armando
               -- todavía no es un peso de nadie.
               'monto_confirmado',     coalesce(sum(r.precio_total) filter (where r.estado = 'confirmada'), 0),
               -- Solo las confirmadas pagan comisión: una cancelada no
               -- cobra nada, sin importar quién canceló ni cuándo. Por
               -- eso no hace falta borrar el monto al cancelar — queda
               -- congelado y simplemente no se suma.
               'comision_confirmada',  coalesce(sum(cc.monto) filter (where r.estado = 'confirmada'), 0),
               'neto_confirmado',      coalesce(sum(coalesce(cc.base, r.precio_total) - coalesce(cc.monto, 0))
                                                filter (where r.estado = 'confirmada'), 0),
               'bloqueos', (select count(*) from public.cancha_bloqueos b
                             join public.canchas_reservables k2 on k2.id = b.cancha_id
                            where k2.complejo_id = p_complejo_id and b.fecha = p_fecha),
               'canchas_activas', (select count(*) from public.canchas_reservables
                                    where complejo_id = p_complejo_id and activa),
               'canchas_total', (select count(*) from public.canchas_reservables
                                  where complejo_id = p_complejo_id)
           )
      into v_resumen
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      left join public.reserva_comisiones cc on cc.reserva_id = r.id
     where k.complejo_id = p_complejo_id
       and r.fecha = p_fecha;

    return json_build_object(
        'ok', true,
        'fecha', to_char(p_fecha, 'YYYY-MM-DD'),
        'resumen', v_resumen,
        'reservas', v_reservas,
        'bloqueos', v_bloqueos
    );
end;
$$;

revoke all on function public.admin_agenda_complejo(uuid, date) from public, anon;
grant execute on function public.admin_agenda_complejo(uuid, date) to authenticated;

create or replace function public.admin_reserva_detalle(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha_id uuid;
    v_out json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select cancha_id into v_cancha_id from public.reservas where id = p_reserva_id;

    if v_cancha_id is null or not public.es_admin_cancha(v_cancha_id) then
        raise exception 'Esa reserva no es de un recinto que administres';
    end if;

    select json_build_object(
               'ok', true,
               'id', r.id,
               'cancha_id', r.cancha_id,
               'cancha_nombre', k.nombre,
               'cancha_tipo', k.tipo,
               'complejo_id', k.complejo_id,
               'fecha', to_char(r.fecha, 'YYYY-MM-DD'),
               'hora_inicio', to_char(r.hora_inicio, 'HH24:MI'),
               'hora_fin', to_char(r.hora_fin, 'HH24:MI'),
               'estado', r.estado,
               'modalidad', r.modalidad,
               'medio_pago', r.medio_pago,
               'precio_total', r.precio_total,
               -- El desglose que el recinto ve al abrir la reserva:
               -- bruto, comisión y neto. Los tres con IVA incluido;
               -- `comision_iva_tasa` va para que el recinto pueda
               -- separarlo en su contabilidad.
               'comision_base', coalesce(c.base, r.precio_total),
               'comision', coalesce(c.monto, 0),
               'comision_tasa', c.tasa,
               'comision_iva_tasa', c.iva_tasa,
               'neto', coalesce(c.base, r.precio_total) - coalesce(c.monto, 0),
               'n_jugadores', r.n_jugadores,
               'cuota', r.cuota,
               'es_desafio_club', r.es_desafio_club,
               'organizador_username', p.username,
               'organizador_foto_url', p.foto_url,
               'created_at', r.created_at,
               'confirmada_at', r.confirmada_at,
               'cancelada_at', r.cancelada_at,
               'cancelacion_estado', r.cancelacion_estado,
               'participantes_total', (select count(*) from public.reserva_participantes rp
                                        where rp.reserva_id = r.id),
               'participantes_aceptados', (select count(*) from public.reserva_participantes rp
                                            where rp.reserva_id = r.id and rp.estado = 'aceptado'),
               'participantes_pendientes', (select count(*) from public.reserva_participantes rp
                                             where rp.reserva_id = r.id and rp.estado = 'pendiente')
           )
      into v_out
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      join public.profiles p            on p.id = r.organizador_id
      left join public.reserva_comisiones c on c.reserva_id = r.id
     where r.id = p_reserva_id;

    return v_out;
end;
$$;

revoke all on function public.admin_reserva_detalle(uuid) from public, anon;
grant execute on function public.admin_reserva_detalle(uuid) to authenticated;
