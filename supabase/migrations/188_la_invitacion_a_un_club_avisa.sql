-- 188. La invitación a un club avisa al invitado.
--
-- Pedido de Vicente (2026-11-18): «cuando se invita a alguien a un club,
-- aparte de salirte en el apartado de clubes, tiene que haber una
-- notificación». Hasta acá `notify_club_request_created` sólo avisaba de las
-- SOLICITUDES (a los admins) y salía a propósito con las invitaciones: «las
-- ve el jugador en su pestaña». Quien no entraba a Clubes no se enteraba.
--
-- Esta migración:
--   1. Suma el tipo `club_invite` al CHECK de `notifications` (la lista es la
--      de producción al 2026-11-18, más el nuevo).
--   2. `notify_club_request_created` avisa al invitado con `club_invite`
--      y `data = {clubId, requestId, fromUserId}`: la tarjeta trae Aceptar y
--      Rechazar, que responden la misma invitación que la pestaña Clubes.
--      No avisa si entre quien invita y el invitado hay un bloqueo, en
--      cualquier sentido: un bloqueado no tiene que poder llegarte así.
--
-- El push sale por el disparador genérico de `notifications`, como el resto.
-- Idempotente.

-- ── 1. El tipo nuevo ─────────────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'match_join', 'friend_request', 'friend_accept', 'message_new', 'match_reminder', 'match_rate',
  'join_request', 'join_approved', 'join_rejected', 'match_cancelled', 'match_updated',
  'match_slot_free', 'waitlist_turn', 'match_left', 'match_attendance', 'club_request',
  'club_request_accepted', 'club_request_rejected', 'club_member_joined', 'club_member_left',
  'club_invite_accepted', 'club_challenge', 'club_challenge_accepted', 'club_challenge_rejected',
  'chat_mention_all', 'club_challenge_extension', 'club_challenge_closed', 'club_challenge_proposal',
  'club_challenge_proposal_rejected', 'club_match_published', 'club_match_reserva_omitida',
  'club_match_change', 'club_match_change_responded', 'club_match_cancelled', 'club_sancionado',
  'club_revision_resuelta', 'club_resultado_propuesto', 'club_resultado_confirmado',
  'club_resultado_disputado', 'reserva_confirmada', 'reserva_cancelada', 'reserva_invitacion_capitan',
  'reserva_invitacion_jugador', 'reserva_invitacion_rechazada', 'reserva_cuota_recalculada',
  'reserva_saldo_insuficiente', 'reserva_cancelacion_solicitada', 'balance_cargado',
  'complejo_admin_agregado', 'reserva_recordatorio_pago', 'reserva_participante_quitado',
  'reserva_cancelacion_rechazada', 'waitlist_turno_vencido',
  -- 188
  'club_invite'
]::text[]));

-- ── 2. Avisar la invitación ──────────────────────────────────────
create or replace function public.notify_club_request_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_club_nombre text;
    v_username text;
    v_admin record;
    v_quien uuid := auth.uid();
begin
    select nombre into v_club_nombre from public.clubs where id = new.club_id;

    -- 188: la invitación le llega al invitado.
    if new.tipo = 'invitacion' then
        if v_quien is not null and exists (
            select 1 from public.blocked_users b
             where (b.blocker_id = new.user_id and b.blocked_id = v_quien)
                or (b.blocker_id = v_quien and b.blocked_id = new.user_id)
        ) then
            return new;
        end if;

        select username into v_username from public.profiles where id = v_quien;

        insert into public.notifications (user_id, type, title, body, data)
        values (
            new.user_id,
            'club_invite',
            '🛡️ ' || coalesce('@' || v_username, 'Un administrador') || ' te invitó a ' || coalesce(v_club_nombre, 'su club'),
            'Acepta o rechaza la invitación aquí o en la pestaña Clubes.',
            jsonb_build_object(
                'clubId', new.club_id,
                'requestId', new.id,
                'fromUserId', v_quien
            )
        );
        return new;
    end if;

    if new.tipo <> 'solicitud' then
        return new;
    end if;

    select username into v_username from public.profiles where id = new.user_id;

    for v_admin in
        select user_id from public.club_members
        where club_id = new.club_id and rol = 'admin'
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_admin.user_id,
            'club_request',
            '⚽ ' || coalesce(v_username, 'Un jugador') || ' quiere unirse a ' || coalesce(v_club_nombre, 'tu club'),
            'Revisa la solicitud en el detalle de tu club.',
            jsonb_build_object(
                'clubId', new.club_id,
                'requestId', new.id,
                'fromUserId', new.user_id
            )
        );
    end loop;

    return new;
end;
$$;

revoke all on function public.notify_club_request_created() from public, anon, authenticated;
