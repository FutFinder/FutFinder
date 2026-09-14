-- =============================================================
-- FutFinder migration 84: no se reserva el pasado
-- =============================================================
-- SE PODÍAN RESERVAR —Y PAGAR— HORAS QUE YA HABÍAN PASADO. Encontrado
-- recorriendo el vertical como jugador el 2026-09-14, a las 14:23 de
-- Chile:
--
--   · `get_disponibilidad_cancha` ofrecía 7 de 16 bloques de HOY que ya
--     habían empezado (08:00 a 13:00) marcados como disponibles, y la
--     grilla del jugador los muestra tal cual: se pueden tocar;
--   · `crear_reserva` aceptaba las 08:00 de hoy a las 14:23, y aceptaba
--     AYER;
--   · `iniciar_pago_reserva` aceptaba cobrar esa reserva de ayer.
--
-- Ninguna de las tres miraba la hora. Hoy no hay daño porque no hay
-- jugadores reales, pero con la pasarela conectada esto es cobrarle a
-- alguien por una cancha que ya pasó.
--
-- LA REGLA ES UNA SOLA: un bloque que YA EMPEZÓ no se ofrece, no se
-- reserva y no se cobra. Se usa `inicio_de_reserva()`, que es la que
-- convierte fecha + hora a un instante real en `America/Santiago` — la
-- misma que arregló la 70. Comparar `p_fecha` con `current_date` habría
-- vuelto a meter el error de huso que esa migración vino a sacar.
--
-- NO SE PIDE MARGEN. Reservar el bloque de las 15:00 a las 14:59 se
-- permite: es apretado pero es una reserva legítima, y elegir un margen
-- —diez minutos, media hora— es una decisión de producto que nadie tomó.
-- Lo único que se rechaza es lo que ya empezó.
--
-- EL PAGO SE CIERRA CON UN DISPARADOR y no reescribiendo la función. La
-- fila de `pagos` no puede nacer para un bloque que ya empezó, venga de
-- la RPC de hoy o de la que se agregue mañana. Va solo en INSERT: un pago
-- que YA existe tiene que poder confirmarse aunque el bloque haya
-- empezado mientras la persona pagaba — para eso está el estado
-- 'reversar' de la 78, y bloquear ese UPDATE dejaría plata cobrada sin
-- forma de anotarla.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La disponibilidad no ofrece lo que ya empezó ──────────────
-- Cuerpo de la 65 con una condición más en `disponible`.
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
    -- Recinto no publicado: no se puede reservar (migración 65). Va acá
    -- y no solo en la policy porque esta función es `security definer` y
    -- por lo tanto se salta la RLS: sin este chequeo, cualquiera con un
    -- `cancha_id` obtendría los horarios de un recinto que todavía no
    -- salió a la venta.
    if not exists (
        select 1 from public.complejos c
         where c.id = v_cancha.complejo_id and c.publicado
    ) then
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
               -- Un bloque que YA EMPEZÓ no se ofrece (migración 84). Se
               -- compara con `inicio_de_reserva`, que resuelve el huso de
               -- Chile; con `current_date` volvería el error de la 70.
               'disponible', public.inicio_de_reserva(p_fecha, s.hora_inicio) > now()
               and not exists (
                   select 1 from public.reservas r
                    where r.cancha_id = p_cancha_id
                      and r.fecha = p_fecha
                      and r.hora_inicio = s.hora_inicio
                      and r.estado = 'confirmada'
               )
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
grant execute on function public.get_disponibilidad_cancha(uuid, date) to anon, authenticated;

-- ── 2. Crear una reserva del pasado se rechaza ───────────────────
-- Cuerpo de la 68 con una comprobación más, apenas se conoce la cancha.
create or replace function public.crear_reserva(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_modalidad text,
    -- El `default 'balance'` se conserva tal cual estaba: quitarlo haría
    -- que Postgres se niegue a reemplazar la función, y cambiarlo movería
    -- el medio de pago por omisión de quien la llame sin nombrarlo.
    p_medio_pago text default 'balance',
    p_n_jugadores integer default null,
    p_es_desafio_club boolean default false,
    p_club_organizador_id uuid default null,
    p_club_rival_id uuid default null,
    p_contacto_nombre text default null,
    p_contacto_telefono text default null,
    p_cobros uuid[] default null
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
    v_contacto_tel text;
    v_precio_cancha integer;
    v_total_cobros integer := 0;
    v_n_cobros integer := 0;
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
    if p_modalidad in ('capitanes', 'jugadores') and p_medio_pago <> 'balance' then
        return json_build_object('ok', false, 'reason', 'Esta modalidad requiere Balance FutFinder');
    end if;
    if p_modalidad = 'jugadores' and (p_n_jugadores is null or p_n_jugadores < 2) then
        return json_build_object('ok', false, 'reason', 'Indica cuántos jugadores participan (mínimo 2)');
    end if;
    if p_es_desafio_club and (p_club_organizador_id is null or p_club_rival_id is null) then
        return json_build_object('ok', false, 'reason', 'Falta indicar los clubes del desafío');
    end if;

    -- Contacto obligatorio (migración 67).
    if p_contacto_nombre is null or length(trim(p_contacto_nombre)) < 2 then
        return json_build_object('ok', false, 'reason', 'Escribe un nombre de contacto');
    end if;
    v_contacto_tel := public.normaliza_telefono_cl(p_contacto_telefono);
    if v_contacto_tel is null then
        return json_build_object('ok', false, 'reason', 'Revisa el teléfono: son 9 dígitos y parte con 9');
    end if;

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

    -- Una hora que ya empezó no se reserva (migración 84). Va ANTES de
    -- calcular precios y comisiones: si ya pasó, no hay nada que cobrar.
    if public.inicio_de_reserva(p_fecha, p_hora_inicio) <= now() then
        return json_build_object('ok', false, 'reason', 'Esa hora ya pasó. Elige otra.');
    end if;

    v_hora_fin := p_hora_inicio + (v_cancha.duracion_slot_min || ' minutes')::interval;
    v_precio_cancha := public.precio_de_bloque(p_cancha_id, p_fecha, p_hora_inicio);

    -- Cobros adicionales (migración 68). Se validan contra el complejo de
    -- ESTA cancha y solo los activos: un id de otro recinto, o uno
    -- apagado, no entra. Se cuenta cuántos coinciden para detectar un id
    -- inválido en vez de ignorarlo en silencio y cobrar de menos.
    if p_cobros is not null and array_length(p_cobros, 1) > 0 then
        select count(*), coalesce(sum(cc.precio), 0)
          into v_n_cobros, v_total_cobros
          from public.complejo_cobros cc
         where cc.id = any(p_cobros)
           and cc.activo
           and cc.complejo_id = v_cancha.complejo_id;

        if v_n_cobros <> array_length(array(select distinct unnest(p_cobros)), 1) then
            return json_build_object('ok', false, 'reason', 'Alguno de los adicionales ya no está disponible');
        end if;
    end if;

    -- El total es lo que el jugador paga: cancha + adicionales. Sobre este
    -- número se calcula la comisión.
    v_precio_total := v_precio_cancha + v_total_cobros;

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

    if public.slot_bloqueado(p_cancha_id, p_fecha, p_hora_inicio, v_hora_fin) then
        return json_build_object('ok', false, 'reason', 'bloqueado');
    end if;

    if p_modalidad = 'jugadores' then
        v_cuota := ceil(v_precio_total::numeric / p_n_jugadores);
    end if;

    v_estado := case when p_modalidad = 'completa' then 'procesando' else 'armando' end;

    insert into public.reservas (
        cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
        precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado,
        es_desafio_club, club_organizador_id, club_rival_id
    ) values (
        p_cancha_id, v_me, p_fecha, p_hora_inicio, v_hora_fin,
        v_precio_total, v_precio_cancha, p_modalidad, p_medio_pago, p_n_jugadores, v_cuota, v_estado,
        p_es_desafio_club, p_club_organizador_id, p_club_rival_id
    )
    returning id into v_reserva_id;

    -- Se copian NOMBRE y PRECIO, no solo el id: cambiar el precio del
    -- cobro mañana no puede reescribir lo que se cobró hoy.
    if p_cobros is not null and array_length(p_cobros, 1) > 0 then
        insert into public.reserva_cobros (reserva_id, cobro_id, nombre, precio)
        select distinct v_reserva_id, cc.id, cc.nombre, cc.precio
          from public.complejo_cobros cc
         where cc.id = any(p_cobros) and cc.activo and cc.complejo_id = v_cancha.complejo_id;
    end if;

    -- Comisión de FutFinder, CONGELADA acá y para siempre (migración 62).
    -- La base es el TOTAL: cancha + adicionales.
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

    insert into public.reserva_contacto (reserva_id, nombre, telefono)
    values (v_reserva_id, trim(p_contacto_nombre), v_contacto_tel);

    if p_modalidad in ('capitanes', 'jugadores') then
        insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
        values (v_reserva_id, v_me, 'organizador', 'aceptado');
    end if;

    return json_build_object('ok', true, 'reserva_id', v_reserva_id);
end;
$$;

revoke all on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid, text, text, uuid[])
    from public, anon;
grant execute on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid, text, text, uuid[])
    to authenticated;

-- ── 3. Tampoco nace un pago para un bloque que ya empezó ─────────
-- Disparador y no un cambio en `iniciar_pago_reserva`: así queda cubierta
-- cualquier RPC de pago que se agregue después. SOLO en INSERT — ver el
-- encabezado.
create or replace function public.tg_pago_no_del_pasado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reserva public.reservas;
begin
    if NEW.reserva_id is null then
        -- Carga de saldo, que todavía no existe: no cuelga de ningún bloque.
        return NEW;
    end if;

    select * into v_reserva from public.reservas where id = NEW.reserva_id;
    if v_reserva.id is not null
       and public.inicio_de_reserva(v_reserva.fecha, v_reserva.hora_inicio) <= now() then
        raise exception 'Esa hora ya pasó: no se puede cobrar';
    end if;
    return NEW;
end;
$$;

drop trigger if exists tg_pago_no_del_pasado on public.pagos;
create trigger tg_pago_no_del_pasado
    before insert on public.pagos
    for each row execute function public.tg_pago_no_del_pasado();
