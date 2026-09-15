-- =============================================================
-- FutFinder migration 100: si se cae el partido, se suelta la cancha
-- =============================================================
-- EL AGUJERO QUE DEJÓ LA 99. Dos clubes reservan la cancha de su
-- desafío, los dos capitanes ponen su mitad —se cobra de verdad— y
-- después alguien cancela el partido. La reserva se quedaba viva: la
-- cancha arrendada y pagada para un encuentro que ya no existe, y nadie
-- se enteraba hasta el día del partido.
--
-- Ninguna función ni trigger de `matches` miraba `reserva_id`: el vínculo
-- se creó en la 99 y se dejó sin cerrar por el otro lado.
--
-- ── POR QUÉ UN TRIGGER Y NO UN PASO EN CADA RPC ──
-- Un partido se cancela desde varios lados —el organizador, un admin de
-- club, la resolución de un desafío— y mañana desde alguno más. Con el
-- trigger, cualquier camino que deje `estado = 'cancelado'` suelta la
-- cancha sin que nadie tenga que acordarse. Es la misma decisión que la
-- migración 83 tomó con los permisos.
--
-- `after update of estado` A PROPÓSITO: sin la lista de columnas, el
-- trigger se despertaría con cualquier escritura sobre el partido —un
-- recordatorio enviado, un contador de cupos— y tendría que descartarlas
-- a mano. Con ella, Postgres ni lo llama.
--
-- ── SE CANCELA, NO SE PREGUNTA ──
-- `cancelar_reserva` tiene una rama especial para desafíos: en vez de
-- cancelar, le PIDE al otro club que acepte (`cancelacion_estado =
-- 'solicitada'`), porque cancelarle la cancha al rival por tu cuenta no
-- corresponde. Acá esa negociación no aplica: el partido ya no existe, no
-- hay nada que negociar y dejar la reserva esperando una respuesta sería
-- justo el agujero que se está tapando.
--
-- Por eso la cola de `cancelar_reserva` —devolver la plata, marcar
-- cancelada, avisar a todos— se muda a `cancelar_reserva_interna`, y las
-- dos vías la comparten. NO se copia: una segunda versión de la
-- devolución es la forma segura de que un día devuelvan distinto.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La cola de cancelar, sin preguntar quién llama ────────────
create or replace function public.cancelar_reserva_interna(
    p_reserva_id uuid,
    p_motivo text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reserva public.reservas;
    v_pago record;
begin
    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    -- Ya muerta: no es un error. La llama un trigger, y reventar ahí
    -- impediría cancelar el partido por algo que ya estaba resuelto.
    if v_reserva.estado not in ('armando', 'procesando', 'confirmada') then
        return json_build_object('ok', true, 'already', true, 'estado', v_reserva.estado);
    end if;

    -- Solo una confirmada movió plata. Se devuelve por persona, agrupando
    -- lo que cada una puso: en el pago dividido son varios cobros.
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

revoke all on function public.cancelar_reserva_interna(uuid, text) from public, anon, authenticated;

-- ── 2. El partido cancelado suelta su cancha ─────────────────────
create or replace function public.tg_partido_cancelado_suelta_la_cancha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.cancelar_reserva_interna(
        new.reserva_id,
        'Se canceló el partido de clubes, así que la cancha quedó liberada. '
        || 'Si ya habías puesto tu parte, te la devolvimos a tu saldo.'
    );
    return new;
end;
$$;

drop trigger if exists tg_partido_cancelado_suelta_la_cancha on public.matches;
create trigger tg_partido_cancelado_suelta_la_cancha
    after update of estado on public.matches
    for each row
    when (new.estado = 'cancelado'
          and old.estado is distinct from 'cancelado'
          and new.reserva_id is not null)
    execute function public.tg_partido_cancelado_suelta_la_cancha();

-- ── 3. La de siempre, ahora delegando la cola ────────────────────
-- Conserva TODO lo suyo: quién puede cancelar, la ventana de 12 horas y
-- la negociación entre clubes. Lo único que cambia es que el final —la
-- devolución, el cambio de estado y los avisos— ya no vive acá.
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

    -- En un desafío no se cancela de frentón: se le PIDE al otro club.
    -- Cancelarle la cancha al rival por tu cuenta no corresponde.
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

    return public.cancelar_reserva_interna(p_reserva_id, p_motivo);
end;
$$;

revoke all on function public.cancelar_reserva(uuid, text) from public, anon;
grant execute on function public.cancelar_reserva(uuid, text) to authenticated;
