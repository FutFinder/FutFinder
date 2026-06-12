-- =============================================================
-- FutFinder migration 09: Clubes (Fase 1)
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Crea:
--   - Tabla clubs (plan estandar/premium)
--   - Tabla club_members (un jugador = un solo club)
--   - Tabla club_join_requests (solicitudes e invitaciones)
--   - Trigger que valida límites de miembros/admins según plan
--   - Columna club_id en messages (chat interno del club)
-- =============================================================

-- 1. TABLA: clubs ----------------------------------------------
create table if not exists public.clubs (
    id uuid primary key default uuid_generate_v4(),
    nombre text not null check (length(trim(nombre)) between 3 and 40),
    -- slug para la futura página pública www.futfinder.com/club/<slug>
    slug text not null,
    descripcion text check (descripcion is null or length(descripcion) <= 500),
    foto_url text,
    region text,
    comuna text,
    plan text not null default 'estandar' check (plan in ('estandar', 'premium')),
    verificado boolean not null default false,
    created_by uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now()
);

-- nombre y slug case-insensitive únicos (mismo patrón que username)
create unique index if not exists clubs_nombre_ci_idx
    on public.clubs (lower(nombre));
create unique index if not exists clubs_slug_ci_idx
    on public.clubs (lower(slug));

-- 2. TABLA: club_members ---------------------------------------
create table if not exists public.club_members (
    id uuid primary key default uuid_generate_v4(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    rol text not null default 'jugador' check (rol in ('admin', 'jugador')),
    joined_at timestamptz not null default now(),

    -- un jugador defiende una sola camiseta
    constraint club_members_one_club_per_user unique (user_id)
);

create index if not exists idx_club_members_club
    on public.club_members (club_id, joined_at);

-- 3. TABLA: club_join_requests ---------------------------------
-- tipo 'solicitud'  → el jugador pide entrar, un admin responde
-- tipo 'invitacion' → un admin invita, el jugador responde
create table if not exists public.club_join_requests (
    id uuid primary key default uuid_generate_v4(),
    club_id uuid not null references public.clubs(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    tipo text not null check (tipo in ('solicitud', 'invitacion')),
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    responded_at timestamptz
);

-- sin duplicados pendientes para el mismo club+jugador
create unique index if not exists club_join_requests_pending_idx
    on public.club_join_requests (club_id, user_id)
    where status = 'pending';

create index if not exists idx_club_join_requests_user
    on public.club_join_requests (user_id, status);

-- 4. TRIGGER: límites de miembros y admins según plan -----------
-- Estándar: máx 15 integrantes, 1 admin
-- Premium:  máx 26 integrantes, 3 admins
create or replace function public.check_club_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_plan text;
    v_members integer;
    v_admins integer;
    v_max_members integer;
    v_max_admins integer;
begin
    select plan into v_plan from public.clubs where id = new.club_id;
    if v_plan is null then
        raise exception 'Club no encontrado';
    end if;

    if v_plan = 'premium' then
        v_max_members := 26;
        v_max_admins := 3;
    else
        v_max_members := 15;
        v_max_admins := 1;
    end if;

    -- cuenta sin incluir la fila que se está insertando/actualizando
    select count(*) into v_members
    from public.club_members
    where club_id = new.club_id and id <> new.id;

    select count(*) into v_admins
    from public.club_members
    where club_id = new.club_id and rol = 'admin' and id <> new.id;

    if tg_op = 'INSERT' and v_members >= v_max_members then
        raise exception 'El club alcanzó el límite de % integrantes de su plan', v_max_members;
    end if;

    if new.rol = 'admin' and v_admins >= v_max_admins then
        raise exception 'El club alcanzó el límite de % administradores de su plan', v_max_admins;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_check_club_limits on public.club_members;
create trigger trg_check_club_limits
    before insert or update of rol on public.club_members
    for each row execute function public.check_club_limits();

-- 5. RLS: clubs --------------------------------------------------
alter table public.clubs enable row level security;

-- cualquiera puede ver clubes (para buscarlos y solicitar entrar)
drop policy if exists "clubs_read" on public.clubs;
create policy "clubs_read"
    on public.clubs for select
    using (true);

-- crear club: cualquiera autenticado (el servicio lo agrega como admin)
drop policy if exists "clubs_insert" on public.clubs;
create policy "clubs_insert"
    on public.clubs for insert
    with check (auth.uid() = created_by);

-- editar club: solo admins del club (plan y verificado NO se editan
-- desde el cliente: se gestionan manualmente hasta integrar pagos)
drop policy if exists "clubs_update" on public.clubs;
create policy "clubs_update"
    on public.clubs for update
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = id and m.user_id = auth.uid() and m.rol = 'admin'
        )
    );

-- borrar club: solo admins
drop policy if exists "clubs_delete" on public.clubs;
create policy "clubs_delete"
    on public.clubs for delete
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = id and m.user_id = auth.uid() and m.rol = 'admin'
        )
    );

-- 6. RLS: club_members -------------------------------------------
alter table public.club_members enable row level security;

-- los perfiles y reputación de los integrantes son visibles (feature
-- del plan), así que la membresía es pública
drop policy if exists "club_members_read" on public.club_members;
create policy "club_members_read"
    on public.club_members for select
    using (true);

-- insertar miembro directamente: solo el fundador al crear su club
-- (los demás entran vía trigger al aprobarse su request, ver sección 7b)
drop policy if exists "club_members_insert" on public.club_members;
create policy "club_members_insert"
    on public.club_members for insert
    with check (
        auth.uid() = user_id
        and rol = 'admin'
        and exists (
            select 1 from public.clubs c
            where c.id = club_id and c.created_by = auth.uid()
        )
        and not exists (
            select 1 from public.club_members m where m.club_id = club_id
        )
    );

-- salir del club (yo) o expulsar (admin del club)
drop policy if exists "club_members_delete" on public.club_members;
create policy "club_members_delete"
    on public.club_members for delete
    using (
        auth.uid() = user_id
        or exists (
            select 1 from public.club_members m
            where m.club_id = club_id and m.user_id = auth.uid() and m.rol = 'admin'
        )
    );

-- promover/degradar rol: solo admins del club
drop policy if exists "club_members_update" on public.club_members;
create policy "club_members_update"
    on public.club_members for update
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_id and m.user_id = auth.uid() and m.rol = 'admin'
        )
    );

-- 7. RLS: club_join_requests -------------------------------------
alter table public.club_join_requests enable row level security;

-- ves la request si es tuya o si eres admin del club
drop policy if exists "club_join_requests_read" on public.club_join_requests;
create policy "club_join_requests_read"
    on public.club_join_requests for select
    using (
        auth.uid() = user_id
        or exists (
            select 1 from public.club_members m
            where m.club_id = club_id and m.user_id = auth.uid() and m.rol = 'admin'
        )
    );

-- crear:
--   solicitud  → la creo yo para mí
--   invitacion → la crea un admin del club para otro jugador
drop policy if exists "club_join_requests_insert" on public.club_join_requests;
create policy "club_join_requests_insert"
    on public.club_join_requests for insert
    with check (
        (tipo = 'solicitud' and auth.uid() = user_id)
        or (
            tipo = 'invitacion'
            and auth.uid() <> user_id
            and exists (
                select 1 from public.club_members m
                where m.club_id = club_id and m.user_id = auth.uid() and m.rol = 'admin'
            )
        )
    );

-- responder:
--   solicitud  → responde un admin del club
--   invitacion → responde el jugador invitado
drop policy if exists "club_join_requests_update" on public.club_join_requests;
create policy "club_join_requests_update"
    on public.club_join_requests for update
    using (
        (tipo = 'solicitud' and exists (
            select 1 from public.club_members m
            where m.club_id = club_id and m.user_id = auth.uid() and m.rol = 'admin'
        ))
        or (tipo = 'invitacion' and auth.uid() = user_id)
    );

-- cancelar mi propia solicitud pendiente
drop policy if exists "club_join_requests_delete" on public.club_join_requests;
create policy "club_join_requests_delete"
    on public.club_join_requests for delete
    using (auth.uid() = user_id and status = 'pending');

-- 7b. TRIGGER: al aprobar una request se crea la membresía -----------
-- Cubre ambos flujos sin pasos extra del jugador:
--   - admin aprueba solicitud  → jugador entra al instante
--   - jugador acepta invitación → entra al instante
-- Es security definer, así que no choca con la RLS de club_members.
-- Si el club está lleno, trg_check_club_limits lanza la excepción y
-- la aprobación completa se revierte (el error llega a quien aprueba).
create or replace function public.handle_club_request_approved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'approved' and old.status = 'pending' then
        insert into public.club_members (club_id, user_id, rol)
        values (new.club_id, new.user_id, 'jugador');
        new.responded_at := coalesce(new.responded_at, now());
    end if;
    return new;
end;
$$;

drop trigger if exists trg_club_request_approved on public.club_join_requests;
create trigger trg_club_request_approved
    before update of status on public.club_join_requests
    for each row execute function public.handle_club_request_approved();

-- 8. CHAT del club: columna club_id en messages -------------------
-- Todo en una transacción implícita: si algo falla, no queda a medias.
alter table public.messages
    add column if not exists club_id uuid references public.clubs(id) on delete cascade;

-- el constraint pasa de "receiver XOR match" a "receiver XOR match XOR club"
alter table public.messages
    drop constraint if exists messages_target_exactly_one;
alter table public.messages
    add constraint messages_target_exactly_one check (
        (receiver_id is not null and match_id is null and club_id is null)
        or (receiver_id is null and match_id is not null and club_id is null)
        or (receiver_id is null and match_id is null and club_id is not null)
    );

create index if not exists idx_messages_club_created
    on public.messages (club_id, created_at desc)
    where club_id is not null;

-- 9. RLS de messages: agregar el caso club -------------------------
-- (recreamos las policies de la migración 04 sumando la rama club)
drop policy if exists "messages_read" on public.messages;
create policy "messages_read"
    on public.messages for select
    using (
        auth.uid() = sender_id
        or auth.uid() = receiver_id
        or (
            match_id is not null
            and exists (
                select 1 from public.attendees a
                where a.id_partido = match_id
                  and a.id_jugador = auth.uid()
            )
        )
        or (
            club_id is not null
            and exists (
                select 1 from public.club_members m
                where m.club_id = messages.club_id
                  and m.user_id = auth.uid()
            )
        )
    );

drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert"
    on public.messages for insert
    with check (
        auth.uid() = sender_id
        and (
            -- DM: cualquier usuario puede mandar DMs por ahora
            (receiver_id is not null and match_id is null and club_id is null)
            -- Grupo de partido: debe estar inscrito al partido
            or (
                match_id is not null
                and receiver_id is null
                and club_id is null
                and exists (
                    select 1 from public.attendees a
                    where a.id_partido = match_id
                      and a.id_jugador = auth.uid()
                )
            )
            -- Chat de club: debe ser miembro del club
            or (
                club_id is not null
                and receiver_id is null
                and match_id is null
                and exists (
                    select 1 from public.club_members m
                    where m.club_id = messages.club_id
                      and m.user_id = auth.uid()
                )
            )
        )
    );
