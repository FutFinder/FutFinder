-- =============================================================
-- FutFinder migration 32: estado de lectura, silencio y avisos
--                         importantes del chat
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
-- Es idempotente y NO destructiva: no borra filas ni columnas.
--
-- Qué agrega y por qué:
--
--   1. chat_reads   — marcador agregado por conversación (una fila por
--                     usuario y thread_key). Reemplaza el hack que guardaba
--                     la última lectura del chat de club en AsyncStorage,
--                     que no se sincronizaba entre dispositivos y no existía
--                     para los chats de partido.
--   2. chat_mutes   — silenciar una conversación. Es POR USUARIO: silenciar
--                     no afecta a los demás participantes ni impide recibir
--                     los mensajes dentro de la app.
--   3. messages.is_important — avisos que rompen el silencio del chat del
--                     club (comando /importante). Solo los admins del club
--                     pueden marcarlos; lo valida un trigger, no la UI.
--   4. Triggers de integridad — el autor y el timestamp de un mensaje los
--                     pone el servidor, y nadie puede editar el contenido
--                     de un mensaje ya enviado (ni el suyo ni el ajeno).
--   5. RPCs agregadas para contar no leídos sin una query por fila.
-- =============================================================


-- 1. TABLA: chat_reads -----------------------------------------
-- thread_key usa el mismo formato que el cliente:
--   'dm:<userId>' | 'match:<matchId>' | 'club:<clubId>'
create table if not exists public.chat_reads (
    user_id      uuid        not null references public.profiles(id) on delete cascade,
    thread_key   text        not null check (length(thread_key) between 3 and 120),
    last_read_at timestamptz not null default now(),
    primary key (user_id, thread_key)
);

alter table public.chat_reads enable row level security;

drop policy if exists "chat_reads_select_own" on public.chat_reads;
create policy "chat_reads_select_own"
    on public.chat_reads for select
    using (auth.uid() = user_id);

drop policy if exists "chat_reads_insert_own" on public.chat_reads;
create policy "chat_reads_insert_own"
    on public.chat_reads for insert
    with check (auth.uid() = user_id);

drop policy if exists "chat_reads_update_own" on public.chat_reads;
create policy "chat_reads_update_own"
    on public.chat_reads for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "chat_reads_delete_own" on public.chat_reads;
create policy "chat_reads_delete_own"
    on public.chat_reads for delete
    using (auth.uid() = user_id);


-- 2. TABLA: chat_mutes -----------------------------------------
create table if not exists public.chat_mutes (
    user_id    uuid        not null references public.profiles(id) on delete cascade,
    thread_key text        not null check (length(thread_key) between 3 and 120),
    muted_at   timestamptz not null default now(),
    primary key (user_id, thread_key)
);

alter table public.chat_mutes enable row level security;

drop policy if exists "chat_mutes_select_own" on public.chat_mutes;
create policy "chat_mutes_select_own"
    on public.chat_mutes for select
    using (auth.uid() = user_id);

drop policy if exists "chat_mutes_insert_own" on public.chat_mutes;
create policy "chat_mutes_insert_own"
    on public.chat_mutes for insert
    with check (auth.uid() = user_id);

drop policy if exists "chat_mutes_delete_own" on public.chat_mutes;
create policy "chat_mutes_delete_own"
    on public.chat_mutes for delete
    using (auth.uid() = user_id);


-- 3. COLUMNA: messages.is_important ----------------------------
alter table public.messages
    add column if not exists is_important boolean not null default false;

-- Los avisos importantes son un caso raro dentro del chat del club, así que
-- el índice es parcial: solo indexa las filas que de verdad lo son.
create index if not exists idx_messages_club_important
    on public.messages (club_id, created_at desc)
    where is_important = true;

-- Índice que cubre el cálculo de no leídos de DMs entrantes.
create index if not exists idx_messages_dm_receiver_created
    on public.messages (receiver_id, created_at desc)
    where receiver_id is not null;


-- 4. INTEGRIDAD: autor, timestamp y contenido ------------------
-- La RLS ya obliga a que sender_id = auth.uid() al insertar, pero el
-- created_at venía del cliente (podía mandarse falseado) y la policy de
-- UPDATE dejaba al DESTINATARIO de un DM editar cualquier columna, incluido
-- el contenido del mensaje que le mandaron. Los dos triggers cierran eso.

create or replace function public.messages_force_server_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- El servidor decide autor y hora: nada de confiar en el cliente.
    new.sender_id  := coalesce(auth.uid(), new.sender_id);
    new.created_at := now();
    new.read_at    := null;

    -- Solo un admin del club puede marcar un mensaje como aviso importante.
    if new.is_important then
        if new.club_id is null then
            raise exception 'Solo el chat de un club admite avisos importantes';
        end if;
        if not exists (
            select 1 from public.club_members m
            where m.club_id = new.club_id
              and m.user_id = new.sender_id
              and m.rol = 'admin'
        ) then
            raise exception 'Solo un administrador del club puede enviar un aviso importante';
        end if;
    end if;

    return new;
end;
$$;

drop trigger if exists trg_messages_force_server_fields on public.messages;
create trigger trg_messages_force_server_fields
    before insert on public.messages
    for each row execute function public.messages_force_server_fields();

create or replace function public.messages_block_content_edits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Lo único que se puede cambiar de un mensaje ya enviado es read_at.
    if new.content      is distinct from old.content
       or new.sender_id is distinct from old.sender_id
       or new.receiver_id is distinct from old.receiver_id
       or new.match_id  is distinct from old.match_id
       or new.club_id   is distinct from old.club_id
       or new.created_at is distinct from old.created_at
       or new.is_important is distinct from old.is_important
    then
        raise exception 'Un mensaje enviado no se puede modificar';
    end if;
    return new;
end;
$$;

drop trigger if exists trg_messages_block_content_edits on public.messages;
create trigger trg_messages_block_content_edits
    before update on public.messages
    for each row execute function public.messages_block_content_edits();


-- 5. RPC: marcar una conversación como leída -------------------
-- Una sola escritura por conversación (no una por mensaje).
create or replace function public.mark_chat_read(p_thread_key text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null or p_thread_key is null then return; end if;

    insert into public.chat_reads (user_id, thread_key, last_read_at)
    values (v_me, p_thread_key, now())
    on conflict (user_id, thread_key)
    do update set last_read_at = now();

    -- En los DMs además marcamos read_at para el doble check del emisor.
    if p_thread_key like 'dm:%' then
        update public.messages
        set    read_at = now()
        where  receiver_id = v_me
          and  sender_id   = substring(p_thread_key from 4)::uuid
          and  match_id is null
          and  club_id  is null
          and  read_at  is null;
    end if;
end;
$$;


-- 6. RPC: no leídos por conversación (agregado, 1 sola query) ---
-- Devuelve solo las conversaciones que TIENEN algo sin leer.
create or replace function public.get_chat_unread_counts()
returns table (thread_key text, unread integer, has_important boolean)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then return; end if;

    return query
    with candidates as (
        -- Chats de partido en los que estoy inscrito
        select ('match:' || m.match_id::text) as tk,
               m.created_at, m.is_important, m.sender_id
          from public.messages m
         where m.match_id is not null
           and exists (
               select 1 from public.attendees a
               where a.id_partido = m.match_id and a.id_jugador = v_me
           )
        union all
        -- Chats de los clubes a los que pertenezco
        select ('club:' || m.club_id::text),
               m.created_at, m.is_important, m.sender_id
          from public.messages m
         where m.club_id is not null
           and exists (
               select 1 from public.club_members cm
               where cm.club_id = m.club_id and cm.user_id = v_me
           )
        union all
        -- DMs que me llegaron
        select ('dm:' || m.sender_id::text),
               m.created_at, m.is_important, m.sender_id
          from public.messages m
         where m.receiver_id = v_me
           and m.match_id is null
           and m.club_id  is null
    )
    select c.tk,
           count(*)::int,
           bool_or(coalesce(c.is_important, false))
      from candidates c
      left join public.chat_reads r
             on r.user_id = v_me and r.thread_key = c.tk
     where c.sender_id <> v_me
       and (r.last_read_at is null or c.created_at > r.last_read_at)
     group by c.tk;
end;
$$;


-- 7. RPC: total de no leídos para el badge del tab Chat --------
-- Las conversaciones silenciadas no suman al badge, EXCEPTO si tienen un
-- aviso /importante sin leer: ese siempre pasa.
create or replace function public.get_chat_unread_total()
returns integer
language sql
stable
security invoker
set search_path = public
as $$
    select coalesce(sum(u.unread), 0)::int
      from public.get_chat_unread_counts() u
      left join public.chat_mutes mu
             on mu.user_id = auth.uid() and mu.thread_key = u.thread_key
     where mu.thread_key is null or u.has_important;
$$;


-- 8. Limpieza al borrar cuenta ---------------------------------
-- La migración 21 borra los datos del usuario al eliminar la cuenta; las dos
-- tablas nuevas cuelgan de profiles con ON DELETE CASCADE, así que se van
-- solas. Se deja anotado para que no se busque un DELETE explícito.
