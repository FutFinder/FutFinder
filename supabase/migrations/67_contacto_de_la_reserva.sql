-- =============================================================
-- FutFinder migration 67: nombre y teléfono de contacto de la reserva
-- =============================================================
-- EL PROBLEMA: en FutFinder una persona es su `username` y su foto, y
-- nada más — `profiles` no tiene nombre real, ni correo, ni teléfono. Así
-- que el recinto veía `@matico7` y no tenía NINGUNA forma de contactar a
-- nadie: ni para avisar que se cortó la luz, ni para preguntar por qué no
-- llegaron, ni para mover una hora. Es el problema operativo más concreto
-- que dejó abierto todo el vertical.
--
-- LA SOLUCIÓN, y por qué NO se toca `profiles`: al reservar se piden un
-- nombre y un teléfono de contacto, obligatorios, y se guardan **en la
-- reserva**. No en el perfil. Son un dato de ESA reserva, entregado para
-- ESE partido, no una agenda de contactos que FutFinder acumula. Quien
-- reserva dos veces puede dejar dos teléfonos distintos y está bien.
--
-- POR QUÉ UNA TABLA APARTE Y NO COLUMNAS EN `reservas`: la misma razón
-- que la comisión en la migración 62, y acá es más grave. `reservas_select`
-- deja leer la fila completa al organizador **y a todos los
-- participantes**; con columnas, los otros nueve de un partido dividido
-- verían el teléfono del organizador. El diseño lo prometió al revés en
-- la pantalla del jugador: «lo ve solo el recinto, no aparece en tu perfil
-- ni lo ven otros recintos ni los demás jugadores». En tabla propia con su
-- RLS, esa promesa es estructural.
--
-- LA VENTANA DE 12 HORAS: el contacto se ve desde que la reserva existe y
-- hasta 12 h después de que TERMINA el partido, y desaparece de inmediato
-- si se cancela. Después queda solo el `@usuario`. El criterio es del
-- diseño y es bueno: los problemas que necesitan un llamado pasan antes o
-- durante el partido, y el reclamo tardío llega esa misma noche. Más allá
-- de eso, guardar el número deja de ser operación y pasa a ser base de
-- datos.
--
-- La ventana se aplica en DOS lugares a propósito: en la policy —para que
-- una consulta directa tampoco lo devuelva— y en cada RPC que lo expone,
-- porque las RPC son `security definer` y se saltan la RLS. Cualquiera de
-- los dos solo sería una media protección.
--
-- `crear_reserva` CAMBIA DE FIRMA y por eso se elimina la versión de nueve
-- argumentos: con `create or replace` quedarían las dos como sobrecargas y
-- PostgREST no sabría cuál llamar. Ningún cliente la usa todavía
-- (`src/services/reservas.js` sigue en datos de ejemplo), así que el
-- cambio no rompe nada en vuelo.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Cuándo TERMINA un partido, en hora de Chile ───────────────
-- Compañera de `inicio_de_reserva` (migración 66). El `case` cubre el
-- bloque que cruza la medianoche: Postgres devuelve `time '23:00' +
-- interval '1 hour'` como '00:00', no '24:00', así que un partido que
-- termina a medianoche tiene `hora_fin` MENOR que `hora_inicio` y hay que
-- sumarle el día. Sin esto, ese partido se daría por terminado 23 horas
-- antes de empezar y el teléfono desaparecería antes del pitazo inicial.
create or replace function public.fin_de_reserva(
    p_fecha date,
    p_hora_inicio time,
    p_hora_fin time
)
returns timestamptz
language sql
immutable
as $$
    select case
        when p_hora_fin <= p_hora_inicio
            then ((p_fecha + 1) + p_hora_fin) at time zone 'America/Santiago'
        else (p_fecha + p_hora_fin) at time zone 'America/Santiago'
    end;
$$;

revoke all on function public.fin_de_reserva(date, time, time) from public;
grant execute on function public.fin_de_reserva(date, time, time) to authenticated, anon;

-- ── 2. Normalización y validación del teléfono chileno ───────────
-- Se guarda siempre igual, `+569XXXXXXXX`, para que dos personas que
-- escriben «9 8765 4321» y «+56987654321» queden idénticas. Devuelve NULL
-- si no es un móvil chileno válido, y quien llama decide qué hacer con
-- eso.
--
-- Solo móviles (empiezan con 9): el contacto existe para llamar o
-- escribir por WhatsApp el día del partido, y a un fijo no se le escribe.
create or replace function public.normaliza_telefono_cl(p_telefono text)
returns text
language sql
immutable
as $$
    with digitos as (
        select regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g') as d
    ),
    -- Se saca el prefijo de país si viene, con o sin el 0 de salida.
    sin_prefijo as (
        select case
            when length(d) = 11 and left(d, 2) = '56' then right(d, 9)
            when length(d) = 12 and left(d, 3) = '056' then right(d, 9)
            else d
        end as d
        from digitos
    )
    select case
        when length(d) = 9 and left(d, 1) = '9' then '+56' || d
        else null
    end
    from sin_prefijo;
$$;

revoke all on function public.normaliza_telefono_cl(text) from public;
grant execute on function public.normaliza_telefono_cl(text) to authenticated, anon;

-- ── 3. TABLA: reserva_contacto ───────────────────────────────────
create table if not exists public.reserva_contacto (
    reserva_id uuid primary key references public.reservas(id) on delete cascade,
    nombre text not null check (length(trim(nombre)) between 2 and 80),
    telefono text not null check (telefono ~ '^\+569\d{8}$'),
    created_at timestamptz not null default now()
);

alter table public.reserva_contacto enable row level security;

-- ── 4. ¿Se puede ver todavía el contacto de esta reserva? ────────
-- `security definer` porque consulta `reservas`, que tiene su propia RLS:
-- si la policy de abajo hiciera el `select` directo, le aplicaría la RLS
-- de `reservas` y un administrador de complejo —que no es organizador ni
-- participante— no vería nada. Es exactamente el error que la migración
-- 62 cometió y que el dry-run cazó; acá va resuelto desde el principio.
create or replace function public.contacto_visible(p_reserva_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.reservas r
         where r.id = p_reserva_id
           and r.estado <> 'cancelada'
           and now() < public.fin_de_reserva(r.fecha, r.hora_inicio, r.hora_fin)
                       + interval '12 hours'
    );
$$;

revoke all on function public.contacto_visible(uuid) from public, anon;
grant execute on function public.contacto_visible(uuid) to authenticated;

-- Dos ramas, y son distintas a propósito:
--   · Quien organizó ve SU dato siempre — lo escribió él, y tiene que
--     poder revisarlo o corregirlo aunque el partido haya pasado.
--   · El administrador del recinto lo ve solo mientras dure la ventana.
--
-- Los demás participantes NO aparecen acá: pueden leer la reserva pero no
-- el contacto de quien la organizó. Esa es la promesa que la pantalla del
-- jugador le hace y la razón de que esto sea una tabla aparte.
drop policy if exists "reserva_contacto_select" on public.reserva_contacto;
create policy "reserva_contacto_select"
    on public.reserva_contacto for select
    to authenticated
    using (
        public.es_organizador_de_reserva(reserva_id, auth.uid())
        or (public.es_admin_de_reserva(reserva_id) and public.contacto_visible(reserva_id))
    );
-- Sin policies de escritura: lo escribe `crear_reserva`.

-- ── 5. Corregir el contacto ──────────────────────────────────────
-- Solo quien organizó. Un teléfono mal tipeado es el error más probable
-- de todo el flujo y no tener cómo arreglarlo dejaría al recinto llamando
-- a un desconocido.
create or replace function public.actualizar_contacto_reserva(
    p_reserva_id uuid,
    p_nombre text,
    p_telefono text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_tel text;
begin
    if auth.uid() is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if not public.es_organizador_de_reserva(p_reserva_id, auth.uid()) then
        return json_build_object('ok', false, 'reason', 'Solo quien reservó puede cambiar el contacto');
    end if;
    if p_nombre is null or length(trim(p_nombre)) < 2 then
        return json_build_object('ok', false, 'reason', 'Escribe un nombre de contacto');
    end if;

    v_tel := public.normaliza_telefono_cl(p_telefono);
    if v_tel is null then
        return json_build_object('ok', false, 'reason', 'Revisa el teléfono: son 9 dígitos y parte con 9');
    end if;

    insert into public.reserva_contacto (reserva_id, nombre, telefono)
    values (p_reserva_id, trim(p_nombre), v_tel)
    on conflict (reserva_id) do update
       set nombre = excluded.nombre, telefono = excluded.telefono;

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.actualizar_contacto_reserva(uuid, text, text) from public, anon;
grant execute on function public.actualizar_contacto_reserva(uuid, text, text) to authenticated;

-- ── 6. `crear_reserva` exige el contacto ─────────────────────────
-- Se ELIMINA la versión de nueve argumentos antes de crear la nueva: con
-- `create or replace` quedarían las dos como sobrecargas y PostgREST no
-- sabría cuál llamar. Ningún cliente la usa todavía, así que el cambio de
-- firma no rompe nada en vuelo.
drop function if exists public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid);

create or replace function public.crear_reserva(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_modalidad text,
    p_medio_pago text default 'balance',
    p_n_jugadores integer default null,
    p_es_desafio_club boolean default false,
    p_club_organizador_id uuid default null,
    p_club_rival_id uuid default null,
    -- Obligatorios pese al `default null`: el default existe para que la
    -- firma sea legible, y la validación de más abajo los exige. Van al
    -- final para no mover la posición de los que ya estaban.
    p_contacto_nombre text default null,
    p_contacto_telefono text default null
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

    -- Contacto obligatorio (migración 67). Se valida ANTES de tocar nada
    -- para no crear una reserva a la que después le falte el contacto.
    if p_contacto_nombre is null or length(trim(p_contacto_nombre)) < 2 then
        return json_build_object('ok', false, 'reason', 'Escribe un nombre de contacto');
    end if;
    v_contacto_tel := public.normaliza_telefono_cl(p_contacto_telefono);
    if v_contacto_tel is null then
        return json_build_object('ok', false, 'reason', 'Revisa el teléfono: son 9 dígitos y parte con 9');
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

    insert into public.reserva_contacto (reserva_id, nombre, telefono)
    values (v_reserva_id, trim(p_contacto_nombre), v_contacto_tel);

    -- El organizador cuenta como participante (y pagador) en capitanes y
    -- jugadores; en 'completa' no aplica reserva_participantes (spec).
    if p_modalidad in ('capitanes', 'jugadores') then
        insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
        values (v_reserva_id, v_me, 'organizador', 'aceptado');
    end if;

    return json_build_object('ok', true, 'reserva_id', v_reserva_id);
end;
$$;

revoke all on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid, text, text) from public, anon;
grant execute on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid, text, text) to authenticated;

-- ── 7. El recinto ve el contacto, dentro de la ventana ───────────
-- Las tres funciones que el recinto usa para operar el día. En las tres
-- el contacto viene en NULL cuando la ventana se cerró o la reserva se
-- canceló, y la pantalla muestra solo el `@usuario`.

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
                 -- `fecha` en cada reserva y no solo en la raíz de la
                 -- respuesta: sin ella el cliente no puede saber si el
                 -- partido ya terminó. Ver el encabezado.
                 to_char(r.fecha, 'YYYY-MM-DD')    as fecha,
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
                 -- Contacto del organizador, solo dentro de la ventana
                 -- (migración 67). Se filtra acá ADEMÁS de en la policy
                 -- porque esta función es `security definer` y se salta la
                 -- RLS: sin este `case`, el recinto vería el teléfono para
                 -- siempre.
                 case when public.contacto_visible(r.id) then ct.nombre end   as contacto_nombre,
                 case when public.contacto_visible(r.id) then ct.telefono end as contacto_telefono,
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
            left join public.reserva_contacto ct  on ct.reserva_id = r.id
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
               -- Ver la nota de la agenda: el filtro va acá además de
               -- en la policy, porque esto es `security definer`.
               'contacto_nombre', case when public.contacto_visible(r.id) then ct.nombre end,
               'contacto_telefono', case when public.contacto_visible(r.id) then ct.telefono end,
               'contacto_visible', public.contacto_visible(r.id),
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
      left join public.reserva_contacto ct  on ct.reserva_id = r.id
     where r.id = p_reserva_id;

    return v_out;
end;
$$;

revoke all on function public.admin_reserva_detalle(uuid) from public, anon;
grant execute on function public.admin_reserva_detalle(uuid) to authenticated;

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
                     'organizador_foto_url', res.foto_url,
                     'contacto_nombre', res.contacto_nombre,
                     'contacto_telefono', res.contacto_telefono
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
                       p.username, p.foto_url,
                       case when public.contacto_visible(r.id) then ct.nombre end   as contacto_nombre,
                       case when public.contacto_visible(r.id) then ct.telefono end as contacto_telefono
                  from public.reservas r
                  join public.profiles p on p.id = r.organizador_id
                  left join public.reserva_contacto ct on ct.reserva_id = r.id
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
