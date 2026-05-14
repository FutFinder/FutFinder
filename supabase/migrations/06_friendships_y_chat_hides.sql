-- =============================================================
-- FutFinder migration 06: amistades + esconder conversaciones
-- =============================================================
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- =============================================================

-- 1. FRIENDSHIPS -----------------------------------------------
create table if not exists public.friendships (
    id uuid primary key default uuid_generate_v4(),
    requester_id uuid not null references public.profiles(id) on delete cascade,
    addressee_id uuid not null references public.profiles(id) on delete cascade,
    status text not null
        check (status in ('pending', 'accepted', 'rejected', 'blocked'))
        default 'pending',
    created_at timestamptz not null default now(),
    responded_at timestamptz,

    constraint friendships_no_self check (requester_id <> addressee_id),
    constraint friendships_unique_pair unique (requester_id, addressee_id)
);

create index if not exists idx_friendships_requester on public.friendships(requester_id);
create index if not exists idx_friendships_addressee on public.friendships(addressee_id);
create index if not exists idx_friendships_status on public.friendships(status);

alter table public.friendships enable row level security;

-- Veo solicitudes/amistades en las que estoy involucrado
drop policy if exists "friendships_select" on public.friendships;
create policy "friendships_select" on public.friendships for select
    using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Solo puedo crear solicitudes COMO requester
drop policy if exists "friendships_insert" on public.friendships;
create policy "friendships_insert" on public.friendships for insert
    with check (auth.uid() = requester_id);

-- Solo el addressee puede aceptar/rechazar (cambiar status)
drop policy if exists "friendships_update_addressee" on public.friendships;
create policy "friendships_update_addressee" on public.friendships for update
    using (auth.uid() = addressee_id);

-- Cualquiera de los dos puede borrar (unfriend / cancel request)
drop policy if exists "friendships_delete" on public.friendships;
create policy "friendships_delete" on public.friendships for delete
    using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- 2. CHAT HIDES -----------------------------------------------
-- Esconde un hilo de la vista del usuario sin borrar mensajes.
-- Si llega un mensaje nuevo posterior a hidden_at, el hilo reaparece.
create table if not exists public.chat_hides (
    id uuid primary key default uuid_generate_v4(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    thread_key text not null,
    hidden_at timestamptz not null default now(),
    unique (user_id, thread_key)
);

create index if not exists idx_chat_hides_user on public.chat_hides(user_id);

alter table public.chat_hides enable row level security;

drop policy if exists "chat_hides_owner_all" on public.chat_hides;
create policy "chat_hides_owner_all" on public.chat_hides for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- 3. FUNCTION: contar solicitudes pendientes para el badge -----
create or replace function public.count_pending_friend_requests()
returns integer
language sql
security definer
set search_path = public
as $$
    select count(*)::int from public.friendships
    where addressee_id = auth.uid() and status = 'pending';
$$;
