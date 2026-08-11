-- =============================================================
-- FutFinder migration 42: chat grupal de negociación del desafío
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- POR QUÉ ES UNA MIGRACIÓN NUEVA Y NO LA SEGUNDA MITAD DE LA 41:
-- la 41 ya está aplicada en el proyecto real. Editar una migración
-- aplicada deja el repositorio y la base contando historias distintas,
-- que es justo el problema que documenta la decisión C5 del plan.
--
-- Qué había antes: aceptar un desafío dejaba la fila en 'aceptado' y el
-- cliente abría un DM entre DOS administradores, permitido por la
-- excepción `chat_valid_club_challenge_dm()` de la migración 37. Eso no
-- puede cumplir "un chat con todos los administradores de ambos clubes"
-- y además se confunde con el mensaje privado que esos dos
-- administradores podrían tener por su cuenta.
--
-- Qué agrega esta migración:
--   1. `messages.challenge_id`: un cuarto tipo de destino, hermano de
--      receiver_id / match_id / club_id. El hilo es 'challenge:<id>'.
--   2. Los dos permisos del hilo, separados a propósito:
--      leer (cualquier estado) y escribir (solo estados activos), para
--      que un desafío cerrado quede archivado en solo lectura en vez de
--      desaparecer.
--   3. La cuarta rama en `messages_read`, `messages_insert`,
--      `get_chat_unread_counts()`, `get_my_threads()` y
--      `chat_notify_mention_all()`.
--   4. `club_challenge_events`: la bitácora que se intercala como
--      burbujas de sistema en el hilo.
--   5. La RPC `aceptar_desafio()`, que reemplaza al UPDATE directo del
--      cliente: mueve el desafío a 'negociacion', abre el plazo con la
--      hora del servidor, deja el mensaje de sistema y avisa a los
--      administradores de AMBOS clubes.
--
-- COMPATIBILIDAD: `chat_valid_club_challenge_dm()` no se toca. Los
-- desafíos que ya estaban en 'aceptado' conservan su DM funcionando. No
-- se migra ninguna fila.
--
-- OJO: todas las funciones y políticas de esta migración se reescriben
-- ENTERAS a partir de la versión DESPLEGADA (consultada del catálogo el
-- 2026-08-10), no de la que está en las migraciones del repositorio: el
-- esquema real tiene deriva respecto del repositorio.
-- =============================================================

-- ── 1. CUARTO TIPO DE DESTINO DE UN MENSAJE ─────────────────────
alter table public.messages
    add column if not exists challenge_id uuid
        references public.club_challenges(id) on delete cascade;

-- `messages_target_exactly_one` es la garantía estructural de que un
-- mensaje pertenece a UNA sola conversación. Sin ampliarla, ningún
-- mensaje de desafío podría insertarse: las tres alternativas actuales
-- exigen que uno de los otros tres destinos esté puesto.
-- Ampliarla es estrictamente más permisivo, así que ninguna fila
-- existente puede fallar la validación.
alter table public.messages
    drop constraint if exists messages_target_exactly_one;

alter table public.messages
    add constraint messages_target_exactly_one check (
        (receiver_id is not null and match_id is null and club_id is null and challenge_id is null)
     or (receiver_id is null and match_id is not null and club_id is null and challenge_id is null)
     or (receiver_id is null and match_id is null and club_id is not null and challenge_id is null)
     or (receiver_id is null and match_id is null and club_id is null and challenge_id is not null)
    );

create index if not exists idx_messages_challenge_created
    on public.messages (challenge_id, created_at desc)
    where challenge_id is not null;

-- ── 2. INMUTABILIDAD DEL DESTINO ────────────────────────────────
-- Reescrita entera desde la versión desplegada, sumando `challenge_id`:
-- si se pudiera mover un mensaje de hilo después del insert, se podría
-- meter un mensaje ajeno dentro de una negociación.
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
       or new.challenge_id is distinct from old.challenge_id
       or new.created_at is distinct from old.created_at
       or new.is_important is distinct from old.is_important
    then
        raise exception 'Un mensaje enviado no se puede modificar';
    end if;
    return new;
end;
$$;

-- ── 3. QUIÉN VE Y QUIÉN ESCRIBE EN EL HILO ──────────────────────
-- Dos permisos distintos a propósito.
--
-- El plan (tarea 2.1) pedía un solo helper que exigiera estado activo,
-- pero la tarea 3.1 pide que un desafío cerrado deje el hilo "archivado
-- como solo lectura". Con un helper único, cerrar el desafío borraría la
-- conversación de la bandeja y de la pantalla. Por eso se separan:
--   ver     → administrador vigente de cualquiera de los dos clubes,
--             en cualquier estado (el historial no se pierde nunca).
--   escribir→ además, el desafío tiene que seguir activo.
--
-- Los dos derivan de `club_members` EN VIVO: si a un administrador lo
-- degradan a jugador, pierde el acceso en la siguiente consulta sin que
-- nadie tenga que limpiar una lista de participantes.
--
-- `security invoker` a propósito, igual que los helpers de la migración
-- 37: solo leen tablas que el propio usuario ya puede leer
-- (`club_members` y `clubs` tienen `select` abierto), así que no hacen
-- falta privilegios elevados ni se revela nada nuevo.
create or replace function public.chat_puede_ver_desafio(
    p_challenge_id uuid,
    p_user uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
    select exists (
        select 1
        from public.club_challenges c
        join public.club_members m
          on m.user_id = p_user
         and m.rol = 'admin'
         and m.club_id in (c.club_retador_id, c.club_retado_id)
        where c.id = p_challenge_id
    );
$$;

-- El listado de estados activos NO se repite acá: sale de
-- `desafio_reglas()`, que es el espejo de clubChallengeRules.js. Si
-- mañana un estado deja de admitir mensajes, se cambia en un solo lugar.
create or replace function public.chat_puede_escribir_desafio(
    p_challenge_id uuid,
    p_user uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
    select exists (
        select 1
        from public.club_challenges c
        join public.club_members m
          on m.user_id = p_user
         and m.rol = 'admin'
         and m.club_id in (c.club_retador_id, c.club_retado_id)
        where c.id = p_challenge_id
          and c.estado in (
              select jsonb_array_elements_text(public.desafio_reglas() -> 'estados_activos')
          )
    );
$$;

grant execute on function public.chat_puede_ver_desafio(uuid, uuid) to authenticated;
grant execute on function public.chat_puede_escribir_desafio(uuid, uuid) to authenticated;

-- ── 4. RLS DE `messages`: CUARTA RAMA ───────────────────────────
-- Las dos políticas se reescriben ENTERAS desde la versión desplegada.
-- Las tres ramas antiguas quedan textualmente iguales; lo único nuevo es
-- la cuarta. Un mensaje de desafío no entra en ninguna de las tres
-- primeras porque todas exigen que su propio destino esté puesto, y el
-- CHECK de la sección 1 garantiza que solo hay uno.
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages
    for select
    using (
        (
            receiver_id is not null
            and match_id is null
            and club_id is null
            and (auth.uid() = sender_id or auth.uid() = receiver_id)
            and (
                public.chat_are_friends(sender_id, receiver_id)
                or public.chat_valid_club_challenge_dm(sender_id, receiver_id)
            )
        )
        or (
            match_id is not null
            and exists (
                select 1 from public.attendees a
                where a.id_partido = messages.match_id
                  and a.id_jugador = auth.uid()
                  and a.estado in ('inscrito', 'confirmado_gps')
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
        or (
            challenge_id is not null
            and public.chat_puede_ver_desafio(messages.challenge_id, auth.uid())
        )
    );

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
    for insert
    with check (
        auth.uid() = sender_id
        and (
            (
                receiver_id is not null
                and match_id is null
                and club_id is null
                and (
                    public.chat_are_friends(sender_id, receiver_id)
                    or public.chat_valid_club_challenge_dm(sender_id, receiver_id)
                )
            )
            or (
                match_id is not null
                and receiver_id is null
                and club_id is null
                and exists (
                    select 1 from public.attendees a
                    where a.id_partido = messages.match_id
                      and a.id_jugador = auth.uid()
                      and a.estado in ('inscrito', 'confirmado_gps')
                )
            )
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
            or (
                challenge_id is not null
                and receiver_id is null
                and match_id is null
                and club_id is null
                -- Escribir exige estado activo: un desafío cerrado deja
                -- el hilo legible pero mudo.
                and public.chat_puede_escribir_desafio(messages.challenge_id, auth.uid())
            )
        )
    );

-- `messages_delete` y `messages_update_read` NO cambian: la primera ya
-- cubre "mi propio mensaje" con `auth.uid() = sender_id` sea cual sea el
-- hilo, y la segunda es exclusiva de los DMs (el doble check del
-- emisor), que en un grupo no existe.

-- ── 5. /todos DENTRO DE LA NEGOCIACIÓN ──────────────────────────
-- `chat_validate_mention_all()` ya deja pasar estos mensajes (solo
-- rechaza `receiver_id is not null`), pero `chat_notify_mention_all()`
-- salía por el `else` y no avisaba a nadie: el mensaje habría quedado
-- marcado como mención sin mencionar a nadie. Reescrita entera desde la
-- versión desplegada con la rama de desafío.
create or replace function public.chat_notify_mention_all()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sender_username text;
    v_thread_key      text;
    v_thread_title    text;
    v_recipient_ids   uuid[];
    v_recipient_id    uuid;
    v_existing_id     uuid;
    v_existing_count  int;
begin
    if not new.mention_all then
        return new;
    end if;

    select username into v_sender_username
    from public.profiles where id = new.sender_id;

    if new.club_id is not null then
        v_thread_key := 'club:' || new.club_id::text;
        select nombre into v_thread_title from public.clubs where id = new.club_id;

        select array_agg(user_id) into v_recipient_ids
        from public.club_members
        where club_id = new.club_id
          and user_id <> new.sender_id;

    elsif new.match_id is not null then
        v_thread_key := 'match:' || new.match_id::text;
        select titulo into v_thread_title from public.matches where id = new.match_id;

        select array_agg(id_jugador) into v_recipient_ids
        from public.attendees
        where id_partido = new.match_id
          and estado in ('inscrito', 'confirmado_gps')
          and id_jugador <> new.sender_id;

    elsif new.challenge_id is not null then
        v_thread_key := 'challenge:' || new.challenge_id::text;

        select cr.nombre || ' vs ' || cd.nombre
        into   v_thread_title
        from   public.club_challenges c
        join   public.clubs cr on cr.id = c.club_retador_id
        join   public.clubs cd on cd.id = c.club_retado_id
        where  c.id = new.challenge_id;

        -- Los participantes del hilo son los administradores vigentes de
        -- los dos clubes, la misma definición que usa la RLS.
        select array_agg(distinct m.user_id) into v_recipient_ids
        from public.club_challenges c
        join public.club_members m
          on m.rol = 'admin'
         and m.club_id in (c.club_retador_id, c.club_retado_id)
        where c.id = new.challenge_id
          and m.user_id <> new.sender_id;
    else
        return new;
    end if;

    foreach v_recipient_id in array coalesce(v_recipient_ids, array[]::uuid[])
    loop
        select id, coalesce((data->>'mentionCount')::int, 1)
        into v_existing_id, v_existing_count
        from public.notifications
        where user_id = v_recipient_id
          and type = 'chat_mention_all'
          and read = false
          and data->>'threadKey' = v_thread_key
        order by created_at desc
        limit 1;

        if v_existing_id is not null then
            update public.notifications
            set title = coalesce(v_sender_username, 'Alguien')
                        || ' mencionó a todos en '
                        || coalesce(v_thread_title, 'el chat')
                        || ' (' || (v_existing_count + 1) || ')',
                body  = left(new.content, 100),
                data  = data || jsonb_build_object(
                    'mentionCount', v_existing_count + 1,
                    'fromUserId',   new.sender_id::text,
                    'messageId',    new.id::text
                ),
                read  = false
            where id = v_existing_id;
        else
            insert into public.notifications (user_id, type, title, body, data)
            values (
                v_recipient_id,
                'chat_mention_all',
                coalesce(v_sender_username, 'Alguien') || ' mencionó a todos en '
                    || coalesce(v_thread_title, 'el chat'),
                left(new.content, 100),
                jsonb_build_object(
                    'threadKey',    v_thread_key,
                    'fromUserId',   new.sender_id::text,
                    'messageId',    new.id::text,
                    'mentionCount', 1
                )
            );
        end if;
    end loop;

    return new;
end;
$$;

-- ── 6. NO LEÍDOS: CUARTA RAMA ───────────────────────────────────
-- Reescrita entera desde la versión desplegada. Si esto no se toca, el
-- hilo de desafío se queda con 0 no leídos para siempre y la tarjeta
-- nunca se apaga.
--
-- `get_chat_unread_total()` NO se toca: ya se apoya en esta función, así
-- que hereda la rama nueva sin cambios.
create or replace function public.get_chat_unread_counts()
returns table(thread_key text, unread integer, has_important boolean)
language plpgsql
stable
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then return; end if;

    return query
    with candidates as (
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
        select ('club:' || m.club_id::text),
               m.created_at, m.is_important, m.sender_id
          from public.messages m
         where m.club_id is not null
           and exists (
               select 1 from public.club_members cm
               where cm.club_id = m.club_id and cm.user_id = v_me
           )
        union all
        select ('dm:' || m.sender_id::text),
               m.created_at, m.is_important, m.sender_id
          from public.messages m
         where m.receiver_id = v_me
           and m.match_id is null
           and m.club_id is null
           and m.challenge_id is null
           and (
               public.chat_are_friends(m.sender_id, m.receiver_id)
               or public.chat_valid_club_challenge_dm(m.sender_id, m.receiver_id)
           )
        union all
        -- Desafío: los no leídos son de los administradores vigentes de
        -- cualquiera de los dos clubes, en cualquier estado — un desafío
        -- cerrado deja de aceptar mensajes, así que no puede sumar
        -- nuevos, pero los que quedaron sin leer se siguen contando.
        select ('challenge:' || m.challenge_id::text),
               m.created_at, m.is_important, m.sender_id
          from public.messages m
         where m.challenge_id is not null
           and exists (
               select 1
                 from public.club_challenges c
                 join public.club_members cm
                   on cm.user_id = v_me
                  and cm.rol = 'admin'
                  and cm.club_id in (c.club_retador_id, c.club_retado_id)
                where c.id = m.challenge_id
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

-- ── 7. BANDEJA: CUARTA RAMA DE get_my_threads() ─────────────────
-- Reescrita entera desde la versión desplegada.
--
-- Dos cambios además de la rama nueva:
--   a) `dm_peers` y `last_dm_msg` ahora exigen `challenge_id is null`.
--      Sin eso, un mensaje de desafío mío (receiver_id nulo) generaba un
--      "DM" con `other_id = null`. Hoy se caía solo en el join contra
--      `profiles`, pero era una fila fantasma esperando a romperse.
--   b) El hilo de desafío aparece cuando existe al menos un mensaje
--      suyo. Como `aceptar_desafio()` siempre deja el mensaje de
--      sistema, eso equivale a "desde que se aceptó" — y deja fuera
--      tanto los pendientes como los 'aceptado' legados, que siguen
--      viviendo en su DM.
create or replace function public.get_my_threads()
returns table(thread_key text, thread_type text, last_at timestamptz, payload jsonb)
language plpgsql
stable
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then return; end if;

    return query
    with
    my_matches as (
        select a.id_partido as match_id, a.inscrito_at
          from public.attendees a
         where a.id_jugador = v_me
    ),
    my_clubs as (
        select cm.club_id, cm.joined_at, cm.rol
          from public.club_members cm
         where cm.user_id = v_me
    ),
    club_member_counts as (
        select club_id, count(*)::int as member_count
          from public.club_members
         where club_id in (select club_id from my_clubs)
         group by club_id
    ),
    my_challenges as (
        select c.id, c.estado, c.club_retador_id, c.club_retado_id,
               c.negociacion_vence_at, c.prorroga_vence_at, c.prorroga_abierta_at,
               mine.club_id as mi_club_id
          from public.club_challenges c
          join lateral (
              select m.club_id
                from public.club_members m
               where m.user_id = v_me
                 and m.rol = 'admin'
                 and m.club_id in (c.club_retador_id, c.club_retado_id)
               limit 1
          ) mine on true
         where exists (
             select 1 from public.messages mm where mm.challenge_id = c.id
         )
    ),
    last_match_msg as (
        select distinct on (m.match_id)
               m.match_id, m.id, m.content, m.created_at, m.sender_id,
               coalesce(m.is_important, false) as is_important,
               coalesce(m.mention_all, false) as mention_all
          from public.messages m
         where m.match_id in (select match_id from my_matches)
         order by m.match_id, m.created_at desc
    ),
    last_club_msg as (
        select distinct on (m.club_id)
               m.club_id, m.id, m.content, m.created_at, m.sender_id,
               coalesce(m.is_important, false) as is_important,
               coalesce(m.mention_all, false) as mention_all
          from public.messages m
         where m.club_id in (select club_id from my_clubs)
         order by m.club_id, m.created_at desc
    ),
    last_challenge_msg as (
        select distinct on (m.challenge_id)
               m.challenge_id, m.id, m.content, m.created_at, m.sender_id,
               coalesce(m.is_important, false) as is_important,
               coalesce(m.mention_all, false) as mention_all
          from public.messages m
         where m.challenge_id in (select id from my_challenges)
         order by m.challenge_id, m.created_at desc
    ),
    dm_peers as (
        select distinct
               case when sender_id = v_me then receiver_id else sender_id end as other_id
          from public.messages
         where match_id is null and club_id is null and challenge_id is null
           and (sender_id = v_me or receiver_id = v_me)
    ),
    last_dm_msg as (
        select distinct on (p.other_id)
               p.other_id, m.id, m.content, m.created_at, m.sender_id,
               coalesce(m.is_important, false) as is_important,
               coalesce(m.mention_all, false) as mention_all
          from dm_peers p
          join public.messages m
            on m.match_id is null and m.club_id is null and m.challenge_id is null
           and (
                 (m.sender_id = v_me and m.receiver_id = p.other_id)
              or (m.sender_id = p.other_id and m.receiver_id = v_me)
               )
         order by p.other_id, m.created_at desc
    ),
    raw as (
        select
            'match:' || mm.match_id::text as thread_key,
            'match'::text as thread_type,
            coalesce(lmm.created_at, ma.hora, mm.inscrito_at) as last_at,
            jsonb_build_object(
                'match_id', mm.match_id,
                'titulo', ma.titulo,
                'cancha_nombre', ma.cancha_nombre,
                'comuna', ma.comuna,
                'hora', ma.hora,
                'estado', ma.estado,
                'id_organizador', ma.id_organizador,
                'foto_url', ma.foto_url,
                'inscrito_at', mm.inscrito_at,
                'last_message', case when lmm.id is null then null else jsonb_build_object(
                    'id', lmm.id,
                    'content', lmm.content,
                    'created_at', lmm.created_at,
                    'sender_id', lmm.sender_id,
                    'is_important', lmm.is_important,
                    'mention_all', lmm.mention_all,
                    'sender_username', sp.username
                ) end
            ) as payload
          from my_matches mm
          join public.matches ma on ma.id = mm.match_id
          left join last_match_msg lmm on lmm.match_id = mm.match_id
          left join public.profiles sp on sp.id = lmm.sender_id

        union all

        select
            'club:' || mc.club_id::text,
            'club'::text,
            coalesce(lcm.created_at, mc.joined_at),
            jsonb_build_object(
                'club_id', mc.club_id,
                'nombre', c.nombre,
                'foto_url', c.foto_url,
                'comuna', c.comuna,
                'member_count', coalesce(cmc.member_count, 1),
                'my_role', mc.rol,
                'last_message', case when lcm.id is null then null else jsonb_build_object(
                    'id', lcm.id,
                    'content', lcm.content,
                    'created_at', lcm.created_at,
                    'sender_id', lcm.sender_id,
                    'is_important', lcm.is_important,
                    'mention_all', lcm.mention_all,
                    'sender_username', sp2.username
                ) end
            )
          from my_clubs mc
          join public.clubs c on c.id = mc.club_id
          left join club_member_counts cmc on cmc.club_id = mc.club_id
          left join last_club_msg lcm on lcm.club_id = mc.club_id
          left join public.profiles sp2 on sp2.id = lcm.sender_id

        union all

        select
            'dm:' || ld.other_id::text,
            'dm'::text,
            ld.created_at,
            jsonb_build_object(
                'other_id', ld.other_id,
                'other_username', p.username,
                'other_foto_url', p.foto_url,
                'last_message', jsonb_build_object(
                    'id', ld.id,
                    'content', ld.content,
                    'created_at', ld.created_at,
                    'sender_id', ld.sender_id,
                    'is_important', ld.is_important,
                    'mention_all', ld.mention_all
                )
            )
          from last_dm_msg ld
          join public.profiles p on p.id = ld.other_id

        union all

        -- Desafío. El título lo arma el cliente con los dos clubes
        -- ("Retador vs Retado"), así que acá viajan los dos completos.
        -- `abierto_alguna_vez` es lo que apaga el acento rojo neón de la
        -- tarjeta: existe una fila en `chat_reads` para este hilo, es
        -- decir, este administrador ya lo abrió al menos una vez.
        select
            'challenge:' || mch.id::text,
            'challenge'::text,
            lchm.created_at,
            jsonb_build_object(
                'challenge_id', mch.id,
                'estado', mch.estado,
                'mi_club_id', mch.mi_club_id,
                'club_retador', jsonb_build_object(
                    'id', cr.id, 'nombre', cr.nombre, 'foto_url', cr.foto_url
                ),
                'club_retado', jsonb_build_object(
                    'id', cd.id, 'nombre', cd.nombre, 'foto_url', cd.foto_url
                ),
                'vence_at', coalesce(mch.prorroga_vence_at, mch.negociacion_vence_at),
                'prorroga_abierta', (mch.prorroga_abierta_at is not null),
                'abierto_alguna_vez', exists (
                    select 1 from public.chat_reads r
                     where r.user_id = v_me
                       and r.thread_key = 'challenge:' || mch.id::text
                ),
                'last_message', case when lchm.id is null then null else jsonb_build_object(
                    'id', lchm.id,
                    'content', lchm.content,
                    'created_at', lchm.created_at,
                    'sender_id', lchm.sender_id,
                    'is_important', lchm.is_important,
                    'mention_all', lchm.mention_all,
                    'sender_username', sp3.username
                ) end
            )
          from my_challenges mch
          join public.clubs cr on cr.id = mch.club_retador_id
          join public.clubs cd on cd.id = mch.club_retado_id
          left join last_challenge_msg lchm on lchm.challenge_id = mch.id
          left join public.profiles sp3 on sp3.id = lchm.sender_id
    )
    select
        r.thread_key,
        r.thread_type,
        r.last_at,
        r.payload
            || jsonb_build_object('unread', coalesce(u.unread, 0))
            || jsonb_build_object('has_important', coalesce(u.has_important, false))
            || jsonb_build_object('muted', (mu.thread_key is not null))
      from raw r
      left join public.get_chat_unread_counts() u on u.thread_key = r.thread_key
      left join public.chat_mutes mu on mu.user_id = v_me and mu.thread_key = r.thread_key
      left join public.chat_hides h  on h.user_id = v_me  and h.thread_key = r.thread_key
     where h.hidden_at is null or r.last_at > h.hidden_at
     order by r.last_at desc nulls last;
end;
$$;

-- ── 8. BITÁCORA DEL DESAFÍO ─────────────────────────────────────
-- Los eventos se intercalan en el hilo como burbujas de sistema. Es una
-- tabla aparte de `messages` a propósito: un evento no es de nadie, no
-- se puede responder ni borrar, y no debe contar como mensaje sin leer.
create table if not exists public.club_challenge_events (
    id           uuid primary key default gen_random_uuid(),
    challenge_id uuid not null references public.club_challenges(id) on delete cascade,
    tipo         text not null,
    actor_id     uuid references auth.users(id) on delete set null,
    club_id      uuid references public.clubs(id) on delete set null,
    payload      jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now()
);

-- El vocabulario cubre el ciclo completo del plan aunque las fases
-- siguientes todavía no emitan la mayoría: así no hay que volver a
-- tocar la restricción en cada migración.
alter table public.club_challenge_events
    drop constraint if exists club_challenge_events_tipo_check;
alter table public.club_challenge_events
    add constraint club_challenge_events_tipo_check
    check (tipo in (
        'aceptado', 'rechazado', 'cancelado', 'expirado',
        'prorroga_abierta', 'prorroga_respondida', 'sin_acuerdo',
        'propuesta_creada', 'propuesta_aprobada', 'propuesta_rechazada',
        'partido_publicado', 'cambio_propuesto', 'cambio_respondido',
        'encuentro_cancelado', 'sancion_aplicada', 'sancion_retirada',
        'resultado_propuesto', 'resultado_confirmado', 'resultado_disputado'
    ));

create index if not exists idx_club_challenge_events_challenge
    on public.club_challenge_events (challenge_id, created_at);

alter table public.club_challenge_events enable row level security;

-- Solo lectura, y solo para los mismos administradores que ven el hilo.
-- No hay política de insert/update/delete: la bitácora la escriben
-- únicamente las RPC `security definer` de este ciclo.
drop policy if exists club_challenge_events_read on public.club_challenge_events;
create policy club_challenge_events_read on public.club_challenge_events
    for select
    using (public.chat_puede_ver_desafio(challenge_id, auth.uid()));

-- ── 9. RPC: ACEPTAR EL DESAFÍO ──────────────────────────────────
-- Reemplaza al UPDATE directo que hacía el cliente
-- (`respondChallenge`). Todo lo que decide se deriva de `auth.uid()` y
-- de `now()` de PostgreSQL: nada de lo que mande el cliente se cree.
--
-- IDEMPOTENTE: pulsar dos veces no produce dos transiciones, ni dos
-- mensajes de sistema, ni dos tandas de avisos. La segunda llamada
-- encuentra el desafío ya en 'negociacion' y devuelve la fila tal cual.
--
-- El trigger `notify_club_challenge_responded` NO se dispara acá: solo
-- reacciona a 'aceptado' y 'rechazado', y este flujo pasa a
-- 'negociacion'. Por eso los avisos se insertan explícitamente, y por
-- eso no hay duplicados. Rechazar sigue pasando por el trigger antiguo.
create or replace function public.aceptar_desafio(p_challenge_id uuid)
returns public.club_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me         uuid := auth.uid();
    v_row        public.club_challenges;
    v_retador    text;
    v_retado     text;
    v_thread_key text;
    v_horas      int;
    v_admin      record;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    -- El bloqueo de fila es lo que hace segura la doble pulsación
    -- simultánea: la segunda transacción espera y ve el estado ya
    -- cambiado.
    select * into v_row
      from public.club_challenges
     where id = p_challenge_id
     for update;

    if not found then
        raise exception 'Este desafío ya no existe' using errcode = 'no_data_found';
    end if;

    -- Reintento: ya estaba aceptado. Se devuelve sin repetir efectos.
    if v_row.estado = 'negociacion' then
        return v_row;
    end if;

    if v_row.estado <> 'pendiente' then
        raise exception 'Este desafío ya no está pendiente'
            using errcode = 'check_violation';
    end if;

    -- Autorización: SOLO un administrador vigente del club retado.
    if not exists (
        select 1 from public.club_members m
        where m.user_id = v_me
          and m.club_id = v_row.club_retado_id
          and m.rol = 'admin'
    ) then
        raise exception 'Solo un administrador del club retado puede aceptar'
            using errcode = '42501';
    end if;

    v_horas := (public.desafio_reglas() ->> 'negociacion_horas')::int;

    begin
        update public.club_challenges
           set estado               = 'negociacion',
               responded_at         = now(),
               respondido_por       = v_me,
               negociacion_vence_at = now() + make_interval(hours => v_horas)
         where id = p_challenge_id
           and estado = 'pendiente'
        returning * into v_row;
    exception when unique_violation then
        -- `club_challenges_unique_activo`: ya hay otro desafío en curso
        -- entre estos dos clubes.
        raise exception 'Ya tienen un desafío en curso con este club'
            using errcode = 'unique_violation';
    end;

    v_thread_key := 'challenge:' || v_row.id::text;

    select nombre into v_retador from public.clubs where id = v_row.club_retador_id;
    select nombre into v_retado  from public.clubs where id = v_row.club_retado_id;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (
        v_row.id,
        'aceptado',
        v_me,
        v_row.club_retado_id,
        jsonb_build_object(
            'vence_at', v_row.negociacion_vence_at,
            'horas', v_horas
        )
    );

    -- Mensaje de sistema: además de dar contexto, es lo que hace que el
    -- hilo exista para `get_my_threads()` (que lista los desafíos con al
    -- menos un mensaje).
    insert into public.messages (sender_id, challenge_id, content)
    values (
        v_me,
        v_row.id,
        '⚔️ Desafío aceptado. Tienen ' || v_horas
            || ' horas para acordar cancha, fecha y hora del partido.'
    );

    -- Avisos a los administradores de AMBOS clubes, menos a quien
    -- acaba de aceptar (ya sabe lo que hizo).
    for v_admin in
        select m.user_id, m.club_id
          from public.club_members m
         where m.rol = 'admin'
           and m.club_id in (v_row.club_retador_id, v_row.club_retado_id)
           and m.user_id <> v_me
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (
            v_admin.user_id,
            'club_challenge_accepted',
            case when v_admin.club_id = v_row.club_retador_id
                 then '⚔️ ' || coalesce(v_retado, 'El club') || ' aceptó tu desafío'
                 else '⚔️ Desafío aceptado contra ' || coalesce(v_retador, 'otro club')
            end,
            'Se abrió el chat de negociación con los administradores de ambos clubes.',
            jsonb_build_object(
                'challengeId',   v_row.id,
                'clubRetadorId', v_row.club_retador_id,
                'clubRetadoId',  v_row.club_retado_id,
                'threadKey',     v_thread_key
            )
        );
    end loop;

    return v_row;
end;
$$;

revoke execute on function public.aceptar_desafio(uuid) from anon;
grant execute on function public.aceptar_desafio(uuid) to authenticated;
