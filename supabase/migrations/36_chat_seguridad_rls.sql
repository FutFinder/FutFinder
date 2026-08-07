-- =============================================================
-- FutFinder migration 36: políticas de seguridad reales del chat
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
-- Es idempotente y no destructiva (solo reemplaza policies/funciones).
-- No modifica 11_clubes.sql: esta migración se corre DESPUÉS y
-- redefine las policies que esa migración dejó, igual que ya hizo
-- 20_fix_rls_clubs.sql con las policies de clubs.
--
-- Qué estaba mal:
--   - Cualquier usuario autenticado podía leer y escribir un DM con
--     cualquier otro usuario ("cualquier usuario puede mandar DMs por
--     ahora"), sin exigir amistad. `getThreadAccess()` en
--     src/services/messages.js sólo bloqueaba la ESCRITURA en el
--     cliente si no eran amigos, y ni siquiera eso: si llegaba un
--     `challengeId` desde el cliente, lo dejaba pasar sin validar nada
--     contra la base — la interfaz decidía, no la base de datos.
--   - El chat de un partido dejaba entrar a CUALQUIER fila de
--     `attendees`, incluyendo 'pendiente' (solicitud de aprobación
--     manual aún no aceptada), 'no_asistio' y 'cancelado'.
--
-- Qué queda:
--   - DM: sólo entre `sender_id`/`receiver_id` con amistad 'accepted',
--     salvo la única excepción de negocio real: admins de dos clubes
--     con un desafío (`club_challenges`) en estado 'aceptado' entre
--     ellos, para poder coordinar el partido ('pendiente' aún no
--     necesita chat porque la propuesta va en el propio desafío, y
--     'rechazado'/'cancelado' no dan acceso).
--   - Chat de partido: sólo asistentes con estado 'inscrito' o
--     'confirmado_gps' (el organizador queda incluido porque la
--     migración 05 lo inscribe automáticamente).
--   - Chat de club: sin cambios, sigue siendo sólo para miembros.
--   - Las mismas reglas aplican a SELECT, INSERT, marcador de lectura
--     (UPDATE de `read_at` y las RPC `mark_thread_as_read` /
--     `mark_chat_read`) y a los conteos de no leídos
--     (`get_chat_unread_counts` / `get_chat_unread_total`), porque
--     todas corren como el usuario invocante (security invoker) y
--     por lo tanto quedan sujetas a estas mismas policies de RLS.
--   - Realtime (`postgres_changes` sobre `public.messages`) también
--     queda cubierto: Supabase Realtime evalúa la policy de SELECT de
--     la tabla con el JWT del que se suscribe, así que un cambio que
--     una policy no deja leer tampoco se transmite por el websocket.
--   - La interfaz (`getThreadAccess()` en messages.js) sigue existiendo
--     sólo para dar feedback de UX (qué texto mostrar, deshabilitar un
--     botón). No es una medida de seguridad: aunque se la salte por
--     completo (llamando a la REST API o al RPC directo), estas
--     policies son las que de verdad deciden qué se puede leer/escribir.
-- =============================================================

-- 1. FUNCIÓN: ¿son amigos aceptados? ----------------------------
create or replace function public.chat_are_friends(p_user1 uuid, p_user2 uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.friendships f
        where f.status = 'accepted'
          and (
              (f.requester_id = p_user1 and f.addressee_id = p_user2)
              or (f.requester_id = p_user2 and f.addressee_id = p_user1)
          )
    );
$$;

-- 2. FUNCIÓN: única excepción válida sin amistad ----------------
-- Admins de dos clubes distintos con un desafío ACEPTADO entre ellos:
-- es el único momento en que la app promete coordinar "los detalles
-- del partido por el chat" (ver notify_club_challenge_responded en la
-- migración 26). Mientras el desafío está 'pendiente' todavía no hay
-- nada que coordinar (la propuesta ya viaja en el propio desafío:
-- fecha, zona, mensaje) y 'rechazado'/'cancelado' no dan acceso.
create or replace function public.chat_valid_club_challenge_dm(p_user1 uuid, p_user2 uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.club_challenges c
        join public.club_members m1
          on m1.user_id = p_user1
         and m1.rol = 'admin'
         and m1.club_id in (c.club_retador_id, c.club_retado_id)
        join public.club_members m2
          on m2.user_id = p_user2
         and m2.rol = 'admin'
         and m2.club_id in (c.club_retador_id, c.club_retado_id)
        where c.estado = 'aceptado'
          and m1.club_id <> m2.club_id
    );
$$;

-- 3. RLS: SELECT de messages -------------------------------------
drop policy if exists "messages_read" on public.messages;
create policy "messages_read"
    on public.messages for select
    using (
        (
            -- DM: sólo el propio remitente/destinatario, y sólo si son
            -- amigos aceptados o admins con un desafío de club vigente.
            receiver_id is not null and match_id is null and club_id is null
            and (auth.uid() = sender_id or auth.uid() = receiver_id)
            and (
                public.chat_are_friends(sender_id, receiver_id)
                or public.chat_valid_club_challenge_dm(sender_id, receiver_id)
            )
        )
        or (
            -- Grupo de partido: sólo asistentes realmente autorizados.
            match_id is not null
            and exists (
                select 1 from public.attendees a
                where a.id_partido = match_id
                  and a.id_jugador = auth.uid()
                  and a.estado in ('inscrito', 'confirmado_gps')
            )
        )
        or (
            -- Chat de club: sólo miembros del club.
            club_id is not null
            and exists (
                select 1 from public.club_members m
                where m.club_id = messages.club_id
                  and m.user_id = auth.uid()
            )
        )
    );

-- 4. RLS: INSERT de messages --------------------------------------
drop policy if exists "messages_insert" on public.messages;
create policy "messages_insert"
    on public.messages for insert
    with check (
        auth.uid() = sender_id
        and (
            (
                -- DM: exige amistad aceptada, salvo desafío de club vigente.
                receiver_id is not null and match_id is null and club_id is null
                and (
                    public.chat_are_friends(sender_id, receiver_id)
                    or public.chat_valid_club_challenge_dm(sender_id, receiver_id)
                )
            )
            or (
                -- Grupo de partido: debe ser asistente inscrito/confirmado.
                match_id is not null
                and receiver_id is null
                and club_id is null
                and exists (
                    select 1 from public.attendees a
                    where a.id_partido = match_id
                      and a.id_jugador = auth.uid()
                      and a.estado in ('inscrito', 'confirmado_gps')
                )
            )
            or (
                -- Chat de club: debe ser miembro del club.
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

-- 5. RLS: UPDATE (marcar como leído) -------------------------------
-- Sólo aplica a DMs (match_id/club_id no tienen receiver_id seteado),
-- y con la misma exigencia de amistad/desafío vigente: si la
-- conversación ya no es válida, tampoco se puede tocar su read_at.
drop policy if exists "messages_update_read" on public.messages;
create policy "messages_update_read"
    on public.messages for update
    using (
        auth.uid() = receiver_id
        and (
            public.chat_are_friends(sender_id, receiver_id)
            or public.chat_valid_club_challenge_dm(sender_id, receiver_id)
        )
    )
    with check (auth.uid() = receiver_id);

-- 6. RPC mark_thread_as_read: misma restricción -------------------
-- Es security definer (corre saltándose RLS), así que la restricción
-- hay que repetirla a mano dentro de la función.
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

    if p_other_user_id is null then return 0; end if;

    if not (
        public.chat_are_friends(v_me, p_other_user_id)
        or public.chat_valid_club_challenge_dm(v_me, p_other_user_id)
    ) then
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

-- 7. RPC get_chat_unread_counts: mismas restricciones en agregados -
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
        -- Chats de partido en los que estoy realmente autorizado
        select ('match:' || m.match_id::text) as tk,
               m.created_at, m.is_important, m.sender_id
          from public.messages m
         where m.match_id is not null
           and exists (
               select 1 from public.attendees a
               where a.id_partido = m.match_id
                 and a.id_jugador = v_me
                 and a.estado in ('inscrito', 'confirmado_gps')
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
        -- DMs válidos: amigos aceptados o desafío de club vigente
        select ('dm:' || m.sender_id::text),
               m.created_at, m.is_important, m.sender_id
          from public.messages m
         where m.receiver_id = v_me
           and m.match_id is null
           and m.club_id is null
           and (
               public.chat_are_friends(m.sender_id, m.receiver_id)
               or public.chat_valid_club_challenge_dm(m.sender_id, m.receiver_id)
           )
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

-- get_chat_unread_total no necesita cambios: agrega sobre
-- get_chat_unread_counts(), que ya quedó corregida arriba.
