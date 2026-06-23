-- =============================================================
-- FutFinder migration 28: arreglo integral de desafíos entre clubes
-- =============================================================
-- IDEMPOTENTE: pégala entera en Supabase → SQL Editor → Run, sin importar
-- qué migraciones previas (26/27) corriste. Repara columnas, estados,
-- expiración a 7 días y los triggers de notificación.
-- =============================================================

-- 1. COLUMNAS QUE PUDIERON FALTAR (migración 27) -------------------
alter table public.club_challenges
    add column if not exists respondido_por uuid references public.profiles(id) on delete set null;

alter table public.matches
    add column if not exists club_local_id     uuid references public.clubs(id) on delete set null;
alter table public.matches
    add column if not exists club_visitante_id uuid references public.clubs(id) on delete set null;
alter table public.matches
    add column if not exists challenge_id       uuid references public.club_challenges(id) on delete set null;

create index if not exists idx_matches_club_local
    on public.matches (club_local_id) where club_local_id is not null;
create index if not exists idx_matches_club_visitante
    on public.matches (club_visitante_id) where club_visitante_id is not null;

-- 2. ESTADO 'expirado' + índice único de pendiente ----------------
alter table public.club_challenges
    drop constraint if exists club_challenges_estado_check;
alter table public.club_challenges
    add constraint club_challenges_estado_check
    check (estado in ('pendiente','aceptado','rechazado','cancelado','expirado'));

-- Un solo desafío pendiente por par retador→retado (anti-spam).
create unique index if not exists club_challenges_unique_pending
    on public.club_challenges (club_retador_id, club_retado_id)
    where estado = 'pendiente';

-- 3. EXPIRACIÓN AUTOMÁTICA A 7 DÍAS -------------------------------
-- No hay cron: el cliente llama a esta RPC al listar/crear desafíos.
-- SECURITY DEFINER para poder expirar desafíos de cualquier club.
create or replace function public.expire_old_challenges()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.club_challenges
    set estado = 'expirado', responded_at = now()
    where estado = 'pendiente'
      and created_at < now() - interval '7 days';
end;
$$;

grant execute on function public.expire_old_challenges() to authenticated, anon;

-- 4. NOTIFICACIONES: tipos + triggers (recreados) -----------------
alter table public.notifications
    drop constraint if exists notifications_type_check;
alter table public.notifications
    add constraint notifications_type_check
    check (type = any (array[
        'match_join','friend_request','friend_accept','message_new',
        'match_reminder','match_rate','join_request','join_approved',
        'join_rejected','match_cancelled',
        'club_request','club_request_accepted','club_request_rejected',
        'club_member_joined','club_member_left','club_invite_accepted',
        'club_challenge','club_challenge_accepted','club_challenge_rejected'
    ]::text[]));

-- 4a. Desafío creado → avisar a TODOS los miembros del club retado
create or replace function public.notify_club_challenge_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_retador text;
    v_member record;
begin
    select nombre into v_retador from public.clubs where id = new.club_retador_id;

    for v_member in
        select user_id from public.club_members where club_id = new.club_retado_id
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_member.user_id,
            'club_challenge',
            '⚔️ ' || coalesce(v_retador, 'Un club') || ' desafió a tu club',
            'Un administrador puede aceptar o rechazar el reto.',
            jsonb_build_object(
                'challengeId', new.id,
                'clubRetadorId', new.club_retador_id,
                'clubRetadoId', new.club_retado_id
            )
        );
    end loop;

    return new;
end;
$$;

drop trigger if exists trg_notify_club_challenge_created on public.club_challenges;
create trigger trg_notify_club_challenge_created
    after insert on public.club_challenges
    for each row execute function public.notify_club_challenge_created();

-- 4b. Desafío respondido (aceptado/rechazado) → avisar al retador
create or replace function public.notify_club_challenge_responded()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_retado text;
    v_admin record;
begin
    if old.estado <> 'pendiente' or new.estado not in ('aceptado','rechazado') then
        return new;
    end if;

    select nombre into v_retado from public.clubs where id = new.club_retado_id;

    for v_admin in
        select user_id from public.club_members
        where club_id = new.club_retador_id and rol = 'admin'
    loop
        if new.estado = 'aceptado' then
            insert into public.notifications (user_id, type, title, body, data)
            values (
                v_admin.user_id,
                'club_challenge_accepted',
                '✅ ' || coalesce(v_retado, 'El club') || ' aceptó tu desafío',
                'Coordinen los detalles del partido por el chat.',
                jsonb_build_object('challengeId', new.id, 'clubRetadorId', new.club_retador_id, 'clubRetadoId', new.club_retado_id)
            );
        else
            insert into public.notifications (user_id, type, title, body, data)
            values (
                v_admin.user_id,
                'club_challenge_rejected',
                '❌ ' || coalesce(v_retado, 'El club') || ' rechazó tu desafío',
                'Puedes desafiar a otros equipos desde tu club.',
                jsonb_build_object('challengeId', new.id, 'clubRetadorId', new.club_retador_id, 'clubRetadoId', new.club_retado_id)
            );
        end if;
    end loop;

    return new;
end;
$$;

drop trigger if exists trg_notify_club_challenge_responded on public.club_challenges;
create trigger trg_notify_club_challenge_responded
    after update of estado on public.club_challenges
    for each row execute function public.notify_club_challenge_responded();
