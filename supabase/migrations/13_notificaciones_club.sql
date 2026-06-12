-- =============================================================
-- FutFinder migration 13: notificaciones push de solicitudes de club
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Crea dos triggers sobre club_join_requests que insertan filas en
-- `notifications`. El Database Webhook existente (INSERT en
-- notifications → edge function send-push) se encarga del push,
-- igual que el resto de notificaciones de la app.
--
--   1. Jugador solicita entrar  → notifica a TODOS los admins del club
--      "⚽ {username} quiere unirse a {club}"
--   2. Admin acepta/rechaza     → notifica al solicitante
--      "✅/❌ Tu solicitud para unirte a {club} fue aceptada/rechazada"
--
-- Son security definer: insertan en notifications para otros usuarios
-- sin chocar con la RLS.
-- =============================================================

-- 1. Solicitud nueva → avisar a los admins del club ---------------
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
begin
    -- solo solicitudes (las invitaciones las ve el jugador en su pestaña)
    if new.tipo <> 'solicitud' then
        return new;
    end if;

    select nombre into v_club_nombre from public.clubs where id = new.club_id;
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

drop trigger if exists trg_notify_club_request_created on public.club_join_requests;
create trigger trg_notify_club_request_created
    after insert on public.club_join_requests
    for each row execute function public.notify_club_request_created();

-- 2. Solicitud respondida → avisar al solicitante -----------------
create or replace function public.notify_club_request_responded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_club_nombre text;
begin
    -- solo solicitudes que pasan de pendiente a respondida
    if new.tipo <> 'solicitud' or old.status <> 'pending' then
        return new;
    end if;
    if new.status not in ('approved', 'rejected') then
        return new;
    end if;

    select nombre into v_club_nombre from public.clubs where id = new.club_id;

    if new.status = 'approved' then
        insert into public.notifications (user_id, type, title, body, data)
        values (
            new.user_id,
            'club_request_accepted',
            '✅ Tu solicitud para unirte a ' || coalesce(v_club_nombre, 'el club') || ' fue aceptada',
            '¡Bienvenido al club! Ya puedes entrar al chat del equipo.',
            jsonb_build_object('clubId', new.club_id)
        );
    else
        insert into public.notifications (user_id, type, title, body, data)
        values (
            new.user_id,
            'club_request_rejected',
            '❌ Tu solicitud para unirte a ' || coalesce(v_club_nombre, 'el club') || ' fue rechazada',
            'Puedes buscar otros clubes en la pestaña Clubes.',
            jsonb_build_object('clubId', new.club_id)
        );
    end if;

    return new;
end;
$$;

drop trigger if exists trg_notify_club_request_responded on public.club_join_requests;
create trigger trg_notify_club_request_responded
    after update of status on public.club_join_requests
    for each row execute function public.notify_club_request_responded();
