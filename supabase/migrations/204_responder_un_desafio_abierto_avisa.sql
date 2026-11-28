-- =============================================================
-- FutFinder — migración 204: responder un desafío abierto avisa.
--
-- EL FALLO (lo encontró Vicente el 2026-11-28): publicó un desafío abierto
-- con un club y lo respondió con otro. El acceso «Desafíos» marcaba 1, pero
-- la campana no traía nada. No era un aviso perdido: NUNCA existió. La 112
-- armó el tablero abierto reusando `aceptar_desafio()` para lo que pasa
-- DESPUÉS de elegir una respuesta, y ése sí avisa; pero que alguien
-- responda la publicación no avisaba a nadie. El club que publicó sólo se
-- enteraba si entraba a mirar.
--
-- QUÉ HACE:
--   1. Suma el tipo `club_open_challenge_response` a
--      `notifications_type_check` (la lista es la de la 194, más éste).
--   2. Un disparador sobre `club_open_challenge_responses`: cuando una
--      respuesta queda `pendiente` —al nacer, o al volver a responder
--      después de retirarla, que mueve la MISMA fila (112)— avisa a quienes
--      pueden elegirla: los integrantes del club que publicó con el permiso
--      `answerChallenge` (`tiene_permiso_de_club`, 119), el mismo que exige
--      `aceptar_respuesta_desafio_abierto()`.
--
-- QUIÉN NO RECIBE: el resto del club que publicó (no puede hacer nada con
-- el aviso) ni el club que respondió. Como en `notify_club_challenge_created`
-- (28), no se excluye a quien respondió: si administra los dos clubes, el
-- aviso le llega igual, y es justo el caso que destapó el fallo.
--
-- `security definer` como el resto de los disparadores que escriben avisos:
-- quien responde no puede insertar en `notifications` de otro. La función
-- `returns trigger` no se puede llamar por la API, y además se le quita el
-- execute a public, anon y authenticated (la 98 y 165).
--
-- Pruebas: supabase/tests/204_responder_un_desafio_abierto_avisa_test.sql
-- =============================================================

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'match_join', 'friend_request', 'moderacion', 'friend_accept', 'message_new', 'match_reminder',
    'match_rate', 'join_request', 'join_approved', 'join_rejected', 'match_cancelled',
    'match_updated', 'match_slot_free', 'waitlist_turn', 'match_left', 'match_attendance',
    'club_request', 'club_request_accepted', 'club_request_rejected', 'club_member_joined',
    'club_member_left', 'club_invite_accepted', 'club_challenge', 'club_challenge_accepted',
    'club_challenge_rejected', 'chat_mention_all', 'club_challenge_extension',
    'club_challenge_closed', 'club_challenge_proposal', 'club_challenge_proposal_rejected',
    'club_match_published', 'club_match_reserva_omitida', 'club_match_change',
    'club_match_change_responded', 'club_match_cancelled', 'club_sancionado',
    'club_revision_resuelta', 'club_resultado_propuesto', 'club_resultado_confirmado',
    'club_resultado_disputado', 'reserva_confirmada', 'reserva_cancelada',
    'reserva_invitacion_capitan', 'reserva_invitacion_jugador', 'reserva_invitacion_rechazada',
    'reserva_cuota_recalculada', 'reserva_saldo_insuficiente', 'reserva_cancelacion_solicitada',
    'balance_cargado', 'complejo_admin_agregado', 'reserva_recordatorio_pago',
    'reserva_participante_quitado', 'reserva_cancelacion_rechazada', 'waitlist_turno_vencido',
    'club_invite', 'club_open_challenge_response']::text[]));

create or replace function public.notify_open_challenge_response()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_open        public.club_open_challenges%rowtype;
    v_publica     text;
    v_responde    text;
    v_destino     record;
begin
    if new.estado <> 'pendiente' then
        return new;
    end if;
    if tg_op = 'UPDATE' and old.estado = 'pendiente' then
        return new;
    end if;

    select * into v_open from public.club_open_challenges where id = new.open_challenge_id;
    if not found or v_open.estado <> 'abierto' then
        return new;
    end if;

    select nombre into v_publica from public.clubs where id = v_open.club_id;
    select nombre into v_responde from public.clubs where id = new.club_id;

    for v_destino in
        select m.user_id
          from public.club_members m
         where m.club_id = v_open.club_id
           and public.tiene_permiso_de_club(v_open.club_id, m.user_id, 'answerChallenge')
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_destino.user_id,
            'club_open_challenge_response',
            '⚔️ ' || coalesce(v_responde, 'Un club') || ' quiere jugar tu desafío',
            'Respondió el desafío abierto de ' || coalesce(v_publica, 'tu club')
                || '. Elige una respuesta para empezar a negociar.',
            jsonb_build_object(
                'clubId', v_open.club_id,
                'openChallengeId', v_open.id,
                'responseId', new.id,
                'clubRespondedorId', new.club_id
            )
        );
    end loop;

    return new;
end;
$$;

revoke execute on function public.notify_open_challenge_response() from public, anon, authenticated;

drop trigger if exists trg_notify_open_challenge_response on public.club_open_challenge_responses;
create trigger trg_notify_open_challenge_response
    after insert or update of estado on public.club_open_challenge_responses
    for each row execute function public.notify_open_challenge_response();
