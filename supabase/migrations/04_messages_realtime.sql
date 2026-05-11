-- =============================================================
-- FutFinder migration 04: chat en tiempo real con Supabase Realtime
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
-- =============================================================

-- 1. TABLA: messages -------------------------------------------
-- Soporta dos tipos de conversación:
--   a) DM (1-a-1):  receiver_id setteado, match_id NULL
--   b) Match grupal: match_id setteado, receiver_id NULL
create table if not exists public.messages (
    id uuid primary key default uuid_generate_v4(),
    created_at timestamptz not null default now(),
    sender_id uuid not null references public.profiles(id) on delete cascade,
    receiver_id uuid references public.profiles(id) on delete cascade,
    match_id uuid references public.matches(id) on delete cascade,
    content text not null check (length(trim(content)) > 0 and length(content) <= 1000),
    read_at timestamptz, -- usado sólo en DMs; null = no leído

    constraint messages_target_exactly_one check (
        (receiver_id is not null and match_id is null)
        or (receiver_id is null and match_id is not null)
    ),
    constraint messages_not_self_dm check (
        receiver_id is null or receiver_id <> sender_id
    )
);

-- 2. ÍNDICES para queries rápidas ------------------------------
create index if not exists idx_messages_match_created
    on public.messages (match_id, created_at desc)
    where match_id is not null;

create index if not exists idx_messages_dm_pair_created
    on public.messages (sender_id, receiver_id, created_at desc)
    where match_id is null;

create index if not exists idx_messages_unread_for_receiver
    on public.messages (receiver_id, created_at desc)
    where read_at is null and match_id is null;

-- 3. RLS --------------------------------------------------------
alter table public.messages enable row level security;

-- SELECT: ves el mensaje si eres remitente, destinatario, o estás
-- inscrito en el partido del chat grupal.
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
    );

-- INSERT: sólo puedes mandar mensajes como tú; para grupales debes
-- estar inscrito al partido.
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert"
    on public.messages for insert
    with check (
        auth.uid() = sender_id
        and (
            -- DM: cualquier usuario puede mandar DMs por ahora
            (receiver_id is not null and match_id is null)
            -- Grupo: debe estar inscrito al partido
            or (
                match_id is not null
                and receiver_id is null
                and exists (
                    select 1 from public.attendees a
                    where a.id_partido = match_id
                      and a.id_jugador = auth.uid()
                )
            )
        )
    );

-- UPDATE: el destinatario puede marcar como leído (solo read_at)
drop policy if exists "messages_update_read" on public.messages;
create policy "messages_update_read"
    on public.messages for update
    using (auth.uid() = receiver_id)
    with check (auth.uid() = receiver_id);

-- 4. REALTIME: publica la tabla messages -----------------------
-- Esto es lo que hace que el cliente reciba INSERTS/UPDATES
-- en tiempo real vía websocket.
alter publication supabase_realtime add table public.messages;

-- 5. FUNCTION: marcar todos los mensajes de un hilo como leídos -
create or replace function public.mark_thread_as_read(
    p_other_user_id uuid default null,
    p_match_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_count integer;
begin
    if v_me is null then return 0; end if;

    if p_match_id is not null then
        -- Para grupos no hay read_at por usuario; placeholder.
        return 0;
    end if;

    update public.messages
    set read_at = now()
    where receiver_id = v_me
      and sender_id = p_other_user_id
      and match_id is null
      and read_at is null;

    get diagnostics v_count = row_count;
    return v_count;
end;
$$;
