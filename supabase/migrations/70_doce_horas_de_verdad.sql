-- =============================================================
-- FutFinder migration 70: doce horas de verdad
-- =============================================================
-- LA BASE CORRE EN UTC Y DOS FUNCIONES DE LA MIGRACIÓN 55 LO IGNORAN.
-- `fecha + hora_inicio` da un `timestamp` SIN zona. Al compararlo con
-- `now()`, Postgres lo lee como si fuera UTC — pero las 20:00 de una
-- reserva son las 20:00 EN CHILE. La diferencia son 3 horas en verano y
-- 4 en invierno, y cae siempre en contra del usuario:
--
--   1. `cancelar_reserva` cierra su ventana de 12 horas antes de tiempo.
--      Un partido el sábado a las 20:00 debería poder cancelarse hasta
--      las 08:00 del sábado; hoy se cierra a las 05:00. O sea que la
--      app promete 12 horas y cobra 15.
--
--   2. `vencer_reservas_pasadas` mata una reserva a medio armar TRES
--      HORAS ANTES de que empiece su propio partido: un grupo juntándose
--      a las 17:00 para jugar a las 20:00 se muere solo. No está
--      haciendo daño todavía porque esa función no está agendada en
--      ningún cron (ver docs/memoria/operacion/pendientes.md), así que
--      esto es preventivo — pero el día que se agende habría sido un
--      bug carísimo de diagnosticar.
--
-- LA CORRECCIÓN NO CAMBIA NINGUNA REGLA, solo hace que se cumpla la que
-- ya estaba escrita. El jugador recupera las 3 o 4 horas que la app le
-- había prometido, y el recinto ve una cancha liberarse 12 horas antes
-- del partido en vez de 15.
--
-- Se usa `inicio_de_reserva()` (migración 66), que ya es el único lugar
-- del esquema donde se convierte fecha+hora local a un instante. Usa
-- `America/Santiago` y no un desplazamiento fijo: Chile cambia de hora
-- y restar 3 o 4 a mano acierta la mitad del año.
--
-- Ambas se recrean COMPLETAS y con el cuerpo idéntico al de la
-- migración 55 salvo esa línea. No cambian de firma, así que
-- `create or replace` basta y no hay sobrecargas que limpiar.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La ventana de 12 horas del jugador ────────────────────────
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

    v_inicio := public.inicio_de_reserva(v_reserva.fecha, v_reserva.hora_inicio);
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

-- Los grants no se pierden con `create or replace`, pero se repiten para
-- que esta migración se pueda leer sola (la 58 ya había sacado a `anon`).
revoke all on function public.cancelar_reserva(uuid, text) from public, anon;
grant execute on function public.cancelar_reserva(uuid, text) to authenticated;

-- ── 2. El vencimiento de las reservas a medio armar ──────────────
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
       and public.inicio_de_reserva(fecha, hora_inicio) < now();
    get diagnostics v_vencidas = row_count;

    return json_build_object('ok', true, 'vencidas', v_vencidas);
end;
$$;

-- Solo para el cron/service_role: no tiene sentido que un usuario
-- autenticado la ejecute a mano. El revoke de PUBLIC no alcanza porque
-- Supabase concede EXECUTE a `authenticated` y `anon` por privilegio por
-- defecto en cada función nueva (lección de la migración 58).
revoke all on function public.vencer_reservas_pasadas() from public, anon, authenticated;
