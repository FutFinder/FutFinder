-- Bloqueo de usuarios.
--
-- `friendships.status` ya admitía el valor 'blocked' desde la migración 06 y
-- `src/services/messages.js` ya sabía mostrar "Conversación no disponible"
-- para ese estado, pero nada en el código llegaba a escribirlo: era una
-- puerta preparada y nunca usada. No se reutiliza esa columna como fuente de
-- verdad del bloqueo porque `friendships_delete` deja borrar la fila a
-- CUALQUIERA de los dos — si el bloqueo viviera solo ahí, la persona
-- bloqueada podría desbloquearse a sí misma borrando la fila desde su propio
-- cliente. Por eso el bloqueo vive en una tabla nueva que solo el bloqueador
-- puede leer, crear o borrar, y la fila de `friendships` se actualiza además
-- a 'blocked' como EFECTO del bloqueo (no como su registro), solo para
-- heredar gratis el corte de chat ya existente y el mensaje que messages.js
-- ya sabía mostrar.
create table if not exists public.blocked_users (
    id uuid primary key default gen_random_uuid(),
    blocker_id uuid not null references public.profiles(id) on delete cascade,
    blocked_id uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint blocked_users_no_self check (blocker_id <> blocked_id),
    constraint blocked_users_unique unique (blocker_id, blocked_id)
);

create index if not exists idx_blocked_users_blocker on public.blocked_users(blocker_id);

alter table public.blocked_users enable row level security;

-- Solo el bloqueador ve, crea y borra sus propias filas. La persona
-- bloqueada nunca tiene una fila propia que la deje ver ni tocar esto: no
-- hay forma de que se entere de que la bloquearon por esta vía.
drop policy if exists "blocked_users_select_own" on public.blocked_users;
create policy "blocked_users_select_own" on public.blocked_users for select
    using (auth.uid() = blocker_id);

drop policy if exists "blocked_users_insert_own" on public.blocked_users;
create policy "blocked_users_insert_own" on public.blocked_users for insert
    with check (auth.uid() = blocker_id);

drop policy if exists "blocked_users_delete_own" on public.blocked_users;
create policy "blocked_users_delete_own" on public.blocked_users for delete
    using (auth.uid() = blocker_id);

-- Existe un bloqueo entre dos personas, en cualquier dirección. SECURITY
-- DEFINER a propósito: la RLS de arriba no deja ver la fila de la otra
-- dirección, y esta función solo devuelve un booleano, nunca la fila ni
-- quién bloqueó a quién.
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select exists (
        select 1 from public.blocked_users
         where (blocker_id = a and blocked_id = b)
            or (blocker_id = b and blocked_id = a)
    );
$$;

revoke execute on function public.is_blocked_pair(uuid, uuid) from public;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

-- Un bloqueo activo impide nuevas solicitudes de amistad en cualquier
-- dirección, además del filtro de privacidad que ya puso la migración 35.
drop policy if exists "friendships_insert" on public.friendships;
create policy "friendships_insert" on public.friendships for insert
    with check (
        auth.uid() = requester_id
        and exists (
            select 1 from public.profiles p
            where p.id = addressee_id
              and p.privacy_friend_requests <> 'nobody'
        )
        and not public.is_blocked_pair(requester_id, addressee_id)
    );

-- Bloquear a otro usuario.
create or replace function public.bloquear_usuario(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;
    if p_blocked_id is null or p_blocked_id = v_me then
        raise exception 'Usuario inválido' using errcode = '22023';
    end if;

    insert into public.blocked_users (blocker_id, blocked_id)
    values (v_me, p_blocked_id)
    on conflict (blocker_id, blocked_id) do nothing;

    -- Efecto: si ya había una amistad (en cualquier estado, en cualquier
    -- dirección), pasa a 'blocked'. Esto es lo único que necesita la RLS de
    -- chat (`friendships_accepted`, migración 36) para cortar el DM: solo
    -- deja pasar 'accepted', así que cualquier otro valor ya lo bloquea.
    update public.friendships
       set status = 'blocked', responded_at = now()
     where status <> 'blocked'
       and (
             (requester_id = v_me and addressee_id = p_blocked_id)
          or (requester_id = p_blocked_id and addressee_id = v_me)
       );
end;
$$;

revoke execute on function public.bloquear_usuario(uuid) from public;
grant execute on function public.bloquear_usuario(uuid) to authenticated;

-- Deshacer un bloqueo propio.
create or replace function public.desbloquear_usuario(p_blocked_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    delete from public.blocked_users
     where blocker_id = v_me and blocked_id = p_blocked_id;

    -- La fila de friendships que quedó en 'blocked' se borra (no se
    -- restaura a 'accepted': si quieren volver a ser amigos, mandan una
    -- solicitud nueva). Se borra solo si sigue en 'blocked' para no tocar
    -- una fila que haya cambiado de estado por otro motivo, y solo la que
    -- involucra a este par, para no afectar un bloqueo que siga vigente en
    -- la otra dirección.
    if not public.is_blocked_pair(v_me, p_blocked_id) then
        delete from public.friendships
         where status = 'blocked'
           and (
                 (requester_id = v_me and addressee_id = p_blocked_id)
              or (requester_id = p_blocked_id and addressee_id = v_me)
           );
    end if;
end;
$$;

revoke execute on function public.desbloquear_usuario(uuid) from public;
grant execute on function public.desbloquear_usuario(uuid) to authenticated;
