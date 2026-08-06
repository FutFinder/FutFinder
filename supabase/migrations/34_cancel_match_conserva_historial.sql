-- =============================================================
-- FutFinder migration 34 · OPCIONAL
--
-- `cancel_match` conserva el partido en el historial en vez de borrarlo.
--
-- POR QUÉ ESTÁ SEPARADA DE LA 33
-- La migración 33 no toca las RPC que ya existían en la base, a propósito, para
-- no pisar lógica en producción que no estaba versionada. Al probar el flujo se
-- verificó que la `cancel_match` que está corriendo **elimina la fila** de
-- `matches` (y en cascada sus `attendees` y `messages`).
--
-- El brief del rediseño pide lo contrario: «No borres el registro si debe
-- mantenerse en el historial; cambia su estado». Esta migración implementa eso.
--
-- QUÉ CAMBIA SI LA APLICAS
--   · El partido cancelado queda con `estado = 'cancelado'` y sigue existiendo.
--   · Se conserva `motivo_cancelacion` y los jugadores pueden verlo.
--   · El chat del partido NO se borra: queda accesible en solo lectura.
--   · Los `attendees` se conservan, así que el partido sigue apareciendo en el
--     historial de los jugadores.
--   · La pantalla de gestión muestra el estado «cancelado» en vez del cierre
--     «el partido no quedó en tu historial».
--
-- QUÉ REVISAR ANTES DE APLICARLA
--   · Si alguna pantalla o consulta asume que un partido cancelado desaparece,
--     ahora tiene que filtrar por `estado <> 'cancelado'`. En el módulo Partidos
--     ya se filtra (`listOpenMatches` pide `estado = 'abierto'`).
--   · Los partidos cancelados ANTES de aplicar esto ya no se pueden recuperar.
--
-- Es idempotente: se puede volver a correr sin efectos secundarios.
-- =============================================================

create or replace function public.cancel_match(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := auth.uid();
    v_match   record;
    v_reglas  jsonb := public.partido_reglas();
    v_penalty integer;
    v_row     record;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.id_organizador <> v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede cancelar el partido');
    end if;
    if v_match.estado = 'cancelado' then
        return jsonb_build_object('ok', true, 'penalty', 0, 'already', true);
    end if;

    v_penalty := case
        when v_match.hora - now() > make_interval(
                hours => (v_reglas->>'ventana_sin_penalizacion_horas')::int)
        then (v_reglas->>'penalizacion_cancelar_temprano')::int
        else (v_reglas->>'penalizacion_cancelar_tarde')::int
    end;

    -- La diferencia con la versión anterior: cambia el estado, no borra la fila.
    update public.matches
       set estado = 'cancelado'
     where id = p_match_id;

    update public.profiles
       set trust_score = greatest(0, trust_score - v_penalty)
     where id = v_uid;

    -- Avisamos a confirmados y a solicitudes pendientes.
    for v_row in
        select id_jugador from public.attendees
        where id_partido = p_match_id
          and estado in ('pendiente', 'inscrito', 'confirmado_gps')
          and id_jugador <> v_uid
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_cancelled', 'Se canceló el partido',
                case
                    when coalesce(v_match.motivo_cancelacion, '') = ''
                    then format('«%s» fue cancelado por el organizador.', v_match.titulo)
                    else format('«%s» fue cancelado. Motivo: %s',
                                v_match.titulo, v_match.motivo_cancelacion)
                end,
                jsonb_build_object('matchId', p_match_id));
    end loop;

    -- Y a la lista de espera, que además se cierra.
    for v_row in
        select id_jugador from public.match_waitlist where id_partido = p_match_id
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_cancelled', 'Se canceló el partido',
                format('«%s» fue cancelado, así que la lista de espera se cerró.', v_match.titulo),
                jsonb_build_object('matchId', p_match_id));
    end loop;

    delete from public.match_waitlist where id_partido = p_match_id;

    return jsonb_build_object('ok', true, 'penalty', v_penalty);
end;
$$;

grant execute on function public.cancel_match(uuid) to authenticated;

comment on function public.cancel_match(uuid) is
    'Cancela un partido cambiando su estado a cancelado (migración 34). '
    'No borra el registro: se conserva en el historial junto con su chat, '
    'sus attendees y el motivo de cancelación.';
