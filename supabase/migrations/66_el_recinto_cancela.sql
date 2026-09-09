-- =============================================================
-- FutFinder migration 66: el recinto cancela, ve sus próximas y
-- corrige un bloqueo
-- =============================================================
-- TRES HUECOS QUE EL DISEÑO DEJÓ A LA VISTA. Los tres son pantallas ya
-- diseñadas que apuntaban a funciones que no existían:
--
--   1. `admin_cancelar_reserva`. La migración 60 le dice al recinto
--      «Ese horario tiene una reserva confirmada: cancélala antes de
--      bloquearlo», y no había NINGUNA forma de que el recinto cancelara
--      nada: `cancelar_reserva` (55) es del jugador y de los clubes de un
--      desafío. Era una instrucción imposible de seguir.
--   2. `admin_reservas_proximas`. La hoja de despublicar (migración 65)
--      necesita mostrar qué reservas quedan por jugar en TODO el recinto
--      antes de apagarlo, y `admin_agenda_complejo` es de un solo día.
--   3. `admin_actualizar_bloqueo`. Solo se podía crear y borrar, así que
--      corregir un horario mal marcado obligaba a borrarlo y volver a
--      hacerlo, perdiendo el registro sin ganar nada.
--
-- LA HORA DE CHILE, Y UN BUG QUE ESTA MIGRACIÓN NO ARREGLA:
-- la base corre en UTC. `fecha + hora_inicio` da un `timestamp` SIN zona
-- que, al compararse con `now()`, se interpreta como UTC — y un partido a
-- las 20:00 en Chile son las 23:00 UTC. La diferencia son 3 horas en
-- verano y 4 en invierno.
--
-- Eso ya afecta a `cancelar_reserva` (55), que hace exactamente eso en su
-- ventana de 12 horas: el jugador pierde la posibilidad de cancelar unas
-- 15 horas antes del partido, no 12. **Es un bug preexistente y sigue
-- ahí**: no se toca acá porque es una regla que el jugador ve y su
-- corrección es una decisión de producto, no un arreglo silencioso.
--
-- Las funciones nuevas sí lo hacen bien, y para que nadie lo vuelva a
-- escribir mal la conversión vive en una sola función:
-- `inicio_de_reserva()`.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. El instante real en que empieza un bloque ─────────────────
-- Único lugar del esquema donde se convierte fecha+hora local a un
-- instante. `America/Santiago` y no un desplazamiento fijo: Chile cambia
-- de hora, y restar 3 o 4 a mano acierta la mitad del año.
create or replace function public.inicio_de_reserva(p_fecha date, p_hora time)
returns timestamptz
language sql
immutable
as $$
    select (p_fecha + p_hora) at time zone 'America/Santiago';
$$;

revoke all on function public.inicio_de_reserva(date, time) from public;
grant execute on function public.inicio_de_reserva(date, time) to authenticated, anon;

-- ── 2. El recinto cancela una reserva ────────────────────────────
-- Es la salida al mensaje de la migración 60, y es una acción cara para
-- el recinto: el jugador pierde la cancha por una decisión que no tomó.
-- De ahí las tres reglas duras:
--
--   · MOTIVO OBLIGATORIO. El jugador lo lee tal cual, y es lo único que
--     va a saber. Sin motivo no hay cancelación.
--   · DEVOLUCIÓN TOTAL. Todo lo que se cobró vuelve, y vuelve a CADA
--     persona que puso plata: en un pago dividido entre diez, los ocho
--     que ya pagaron reciben lo suyo. Se agrupa por persona, igual que
--     `cancelar_reserva`.
--   · SIN COMISIÓN. No hace falta borrar la fila de `reserva_comisiones`:
--     queda congelada y los resúmenes filtran por `estado = 'confirmada'`,
--     así que una cancelada simplemente no suma.
--
-- SE PUEDE CANCELAR TAMBIÉN UNA RESERVA SIN CONFIRMAR ('armando' /
-- 'procesando') y es a propósito: en el pago dividido cada parte se cobra
-- del Balance al aceptar unirse, así que un grupo a medio armar YA tiene
-- plata puesta. Si el recinto cierra esa hora, esa gente tiene que
-- recuperarla. Por eso la devolución no se condiciona al estado.
--
-- NO SE PUEDE CANCELAR UN PARTIDO YA EMPEZADO. Después de la hora de
-- inicio no hay nada que liberar, y devolver sería regalar una cancha que
-- se usó.
--
-- LÍMITE CONOCIDO: los pagos con `medio_pago = 'tarjeta'` no pasan por
-- `balance_movimientos`, así que este bucle no los devuelve. Hoy no
-- existe ninguno —no hay pasarela conectada— pero cuando exista, la
-- devolución de tarjeta hay que resolverla ahí y no acá.
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

    return json_build_object('ok', true, 'devuelto', v_devuelto);
end;
$$;

revoke all on function public.admin_cancelar_reserva(uuid, text) from public, anon;
grant execute on function public.admin_cancelar_reserva(uuid, text) to authenticated;

-- ── 3. Las reservas que quedan por jugar ─────────────────────────
-- Para la hoja de despublicar: antes de apagar el recinto, el dueño
-- necesita ver QUÉ le queda vendido, no solo cuántas. El dato que decide
-- es la hora, la cancha, quién y cuánto.
--
-- Solo 'confirmada': una reserva a medio armar no está vendida, y
-- despublicar no la cancela — simplemente ese grupo ya no va a poder
-- confirmar.
--
-- El corte usa `inicio_de_reserva`, así que "por jugar" significa que no
-- ha empezado en hora de Chile.
create or replace function public.admin_reservas_proximas(
    p_complejo_id uuid,
    p_limite integer default 20
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_total integer;
    v_monto integer;
    v_reservas json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;

    select count(*), coalesce(sum(r.precio_total), 0)
      into v_total, v_monto
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
     where k.complejo_id = p_complejo_id
       and r.estado = 'confirmada'
       and public.inicio_de_reserva(r.fecha, r.hora_inicio) > now();

    select coalesce(json_agg(x order by x.fecha, x.hora_inicio, x.cancha_nombre), '[]'::json)
      into v_reservas
      from (
          select r.id,
                 to_char(r.fecha, 'YYYY-MM-DD')     as fecha,
                 to_char(r.hora_inicio, 'HH24:MI')  as hora_inicio,
                 to_char(r.hora_fin, 'HH24:MI')     as hora_fin,
                 r.cancha_id,
                 k.nombre                           as cancha_nombre,
                 r.precio_total,
                 coalesce(c.base, r.precio_total)                        as comision_base,
                 coalesce(c.monto, 0)                                    as comision,
                 coalesce(c.base, r.precio_total) - coalesce(c.monto, 0) as neto,
                 p.username                         as organizador_username,
                 p.foto_url                         as organizador_foto_url
            from public.reservas r
            join public.canchas_reservables k on k.id = r.cancha_id
            join public.profiles p            on p.id = r.organizador_id
            left join public.reserva_comisiones c on c.reserva_id = r.id
           where k.complejo_id = p_complejo_id
             and r.estado = 'confirmada'
             and public.inicio_de_reserva(r.fecha, r.hora_inicio) > now()
           order by r.fecha, r.hora_inicio, k.nombre
           limit greatest(1, coalesce(p_limite, 20))
      ) x;

    return json_build_object(
        'ok', true,
        -- `total` es de TODAS las que quedan, no de las que caben en la
        -- lista: la hoja dice "tienes 12 por jugar" y muestra las
        -- primeras. Si devolviera el largo del arreglo, mentiría.
        'total', v_total,
        'monto_total', v_monto,
        'reservas', v_reservas
    );
end;
$$;

revoke all on function public.admin_reservas_proximas(uuid, integer) from public, anon;
grant execute on function public.admin_reservas_proximas(uuid, integer) to authenticated;

-- ── 4. Corregir un bloqueo ───────────────────────────────────────
-- Mismos chequeos que crearlo, incluido el rechazo si el nuevo rango
-- pisa una reserva confirmada. Mover un bloqueo encima de una reserva es
-- el mismo estado ambiguo que crearlo ahí.
create or replace function public.admin_actualizar_bloqueo(
    p_bloqueo_id uuid,
    p_fecha date default null,
    p_hora_inicio time default null,
    p_hora_fin time default null,
    p_motivo text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_b public.cancha_bloqueos;
    v_fecha date;
    v_desde time;
    v_hasta time;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select * into v_b from public.cancha_bloqueos where id = p_bloqueo_id;
    if v_b is null or not public.es_admin_cancha(v_b.cancha_id) then
        raise exception 'No administras este bloqueo';
    end if;

    v_fecha := coalesce(p_fecha, v_b.fecha);
    v_desde := coalesce(p_hora_inicio, v_b.hora_inicio);
    v_hasta := coalesce(p_hora_fin, v_b.hora_fin);

    if v_hasta <= v_desde then
        raise exception 'La hora de término tiene que ser posterior a la de inicio';
    end if;

    if exists (
        select 1 from public.reservas r
         where r.cancha_id = v_b.cancha_id
           and r.fecha = v_fecha
           and r.estado = 'confirmada'
           and v_desde < r.hora_fin
           and v_hasta > r.hora_inicio
    ) then
        raise exception 'Ese horario tiene una reserva confirmada: cancélala antes de bloquearlo';
    end if;

    update public.cancha_bloqueos set
        fecha       = v_fecha,
        hora_inicio = v_desde,
        hora_fin    = v_hasta,
        -- El motivo sí se puede vaciar: es opcional, a diferencia del
        -- resto, así que un texto en blanco significa "quítalo".
        motivo      = case when p_motivo is null then motivo
                           else nullif(trim(p_motivo), '') end
     where id = p_bloqueo_id;
end;
$$;

revoke all on function public.admin_actualizar_bloqueo(uuid, date, time, time, text) from public, anon;
grant execute on function public.admin_actualizar_bloqueo(uuid, date, time, time, text) to authenticated;
