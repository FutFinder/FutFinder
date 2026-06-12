-- =============================================================
-- FutFinder migration 14: notificaciones push de membresía
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Dos triggers sobre club_members:
--
--   1. AFTER INSERT → nuevo miembro: avisa a TODOS los miembros
--      actuales del club (excepto al recién llegado).
--      "⚽ {username} se unió a {club}"
--
--   2. AFTER DELETE → miembro se va: avisa a todos los ADMINS
--      del club (excepto si solo quedaba 1 miembro y el club
--      se eliminó en cascada — en ese caso no hay admins).
--      "👋 {username} abandonó {club}"
--
-- Son security definer: insertan en notifications para otros
-- usuarios sin chocar con la RLS, igual que los de migración 13.
-- =============================================================

-- 1. Nuevo miembro → avisar a todos los miembros del club -----
create or replace function public.notify_club_member_joined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_club_nombre text;
    v_username    text;
    v_member      record;
begin
    select nombre into v_club_nombre from public.clubs where id = new.club_id;
    select username into v_username  from public.profiles where id = new.user_id;

    -- Notifica a todos los miembros existentes, excepto al recién llegado
    for v_member in
        select user_id from public.club_members
        where club_id = new.club_id
          and user_id <> new.user_id
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_member.user_id,
            'club_member_joined',
            '⚽ ' || coalesce(v_username, 'Un jugador') || ' se unió a ' || coalesce(v_club_nombre, 'tu club'),
            'El club sigue creciendo.',
            jsonb_build_object(
                'clubId',     new.club_id,
                'fromUserId', new.user_id
            )
        );
    end loop;

    return new;
end;
$$;

drop trigger if exists trg_notify_club_member_joined on public.club_members;
create trigger trg_notify_club_member_joined
    after insert on public.club_members
    for each row execute function public.notify_club_member_joined();

-- 2. Miembro se va → avisar a los admins del club -------------
create or replace function public.notify_club_member_left()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_club_nombre text;
    v_username    text;
    v_admin       record;
begin
    -- Si el club ya no existe (cascade delete porque era el último
    -- miembro y se borró el club) la query devuelve null y no pasa nada.
    select nombre into v_club_nombre from public.clubs where id = old.club_id;
    if v_club_nombre is null then
        return old;
    end if;

    select username into v_username from public.profiles where id = old.user_id;

    -- Solo notifica a admins (excepto si el que se fue era admin y ya no está)
    for v_admin in
        select user_id from public.club_members
        where club_id = old.club_id
          and rol = 'admin'
          and user_id <> old.user_id
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_admin.user_id,
            'club_member_left',
            '👋 ' || coalesce(v_username, 'Un jugador') || ' abandonó ' || v_club_nombre,
            'Puedes invitar a otros jugadores para completar el equipo.',
            jsonb_build_object(
                'clubId',     old.club_id,
                'fromUserId', old.user_id
            )
        );
    end loop;

    return old;
end;
$$;

drop trigger if exists trg_notify_club_member_left on public.club_members;
create trigger trg_notify_club_member_left
    after delete on public.club_members
    for each row execute function public.notify_club_member_left();
