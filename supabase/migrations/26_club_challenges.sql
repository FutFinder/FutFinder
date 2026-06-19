-- =============================================================
-- FutFinder migration 26: desafíos entre clubes (Parte 1)
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Crea:
--   - Tabla club_challenges (un club reta a otro)
--   - RLS: ver si soy miembro de cualquiera de los dos clubes; crear si soy
--     admin del retador; responder/cancelar si soy admin involucrado
--   - Amplía notifications_type_check con los tipos de desafío
--   - Triggers de notificación:
--       * desafío creado    → avisa a TODOS los miembros del club retado
--       * desafío respondido → avisa a los admins del club retador
-- =============================================================

-- 1. TABLA: club_challenges ---------------------------------------
create table if not exists public.club_challenges (
    id uuid primary key default gen_random_uuid(),
    club_retador_id uuid not null references public.clubs(id) on delete cascade,
    club_retado_id  uuid not null references public.clubs(id) on delete cascade,
    creado_por      uuid not null references public.profiles(id) on delete cascade,
    fecha_propuesta timestamptz,
    zona            text,
    mensaje         text check (mensaje is null or length(mensaje) <= 300),
    estado          text not null default 'pendiente'
        check (estado in ('pendiente','aceptado','rechazado','cancelado')),
    match_id        uuid references public.matches(id) on delete set null,
    created_at      timestamptz not null default now(),
    responded_at    timestamptz,
    constraint club_challenges_distinct check (club_retador_id <> club_retado_id)
);

create index if not exists idx_club_challenges_retado
    on public.club_challenges (club_retado_id, created_at desc);
create index if not exists idx_club_challenges_retador
    on public.club_challenges (club_retador_id, created_at desc);

-- No dos desafíos pendientes simultáneos del mismo retador al mismo retado
create unique index if not exists club_challenges_unique_pending
    on public.club_challenges (club_retador_id, club_retado_id)
    where estado = 'pendiente';

-- 2. RLS ----------------------------------------------------------
alter table public.club_challenges enable row level security;

drop policy if exists "club_challenges_select" on public.club_challenges;
drop policy if exists "club_challenges_insert" on public.club_challenges;
drop policy if exists "club_challenges_update" on public.club_challenges;
drop policy if exists "club_challenges_delete" on public.club_challenges;

-- ver: miembro de cualquiera de los dos clubes
create policy "club_challenges_select"
    on public.club_challenges for select
    using (
        exists (
            select 1 from public.club_members m
            where m.user_id = auth.uid()
              and m.club_id in (club_retador_id, club_retado_id)
        )
    );

-- crear: admin del club retador, y registrando quién lo creó
create policy "club_challenges_insert"
    on public.club_challenges for insert
    with check (
        creado_por = auth.uid()
        and exists (
            select 1 from public.club_members m
            where m.user_id = auth.uid()
              and m.club_id = club_retador_id
              and m.rol = 'admin'
        )
    );

-- responder (retado) o cancelar (retador): admin de alguno de los dos clubes
create policy "club_challenges_update"
    on public.club_challenges for update
    using (
        exists (
            select 1 from public.club_members m
            where m.user_id = auth.uid()
              and m.club_id in (club_retador_id, club_retado_id)
              and m.rol = 'admin'
        )
    );

-- borrar: admin del club retador (limpieza; normalmente se usa estado='cancelado')
create policy "club_challenges_delete"
    on public.club_challenges for delete
    using (
        exists (
            select 1 from public.club_members m
            where m.user_id = auth.uid()
              and m.club_id = club_retador_id
              and m.rol = 'admin'
        )
    );

-- 3. Ampliar notifications_type_check -----------------------------
alter table public.notifications
    drop constraint if exists notifications_type_check;

alter table public.notifications
    add constraint notifications_type_check
    check (type = any (array[
        -- tipos originales
        'match_join',
        'friend_request',
        'friend_accept',
        'message_new',
        'match_reminder',
        'match_rate',
        'join_request',
        'join_approved',
        'join_rejected',
        'match_cancelled',
        -- tipos de club (migraciones 13-16)
        'club_request',
        'club_request_accepted',
        'club_request_rejected',
        'club_member_joined',
        'club_member_left',
        'club_invite_accepted',
        -- desafíos entre clubes (migración 26)
        'club_challenge',
        'club_challenge_accepted',
        'club_challenge_rejected'
    ]::text[]));

-- 4. TRIGGER: desafío creado → avisar al club retado ---------------
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

    -- avisa a TODOS los miembros del club retado (incluye a sus admins)
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

-- 5. TRIGGER: desafío respondido → avisar al club retador ----------
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
