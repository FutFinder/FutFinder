-- =============================================================
-- 169. LEER Y SILENCIAR CIERRAN EL AVISO
--
-- Los errores 4 y 5 de la auditoría de chats y avisos del 2026-09-23
-- (C04 y C05), la parte que vive en la base.
--
-- C04 — LEER UN DM NO CERRABA SU AVISO. `mark_chat_read` (migración 32)
-- avanzaba `chat_reads` y `messages.read_at`, pero no tocaba
-- `notifications`. El mensaje siguiente del mismo remitente encontraba en
-- `notify_message_new` (15) el aviso viejo con `read = false` y lo
-- ACTUALIZABA («te ha mandado 2 mensajes»): sin INSERT no hay push
-- (`notificar_push` es AFTER INSERT, 117) ni popup (el cliente sólo abre
-- popups por INSERT). Se leía la conversación y la siguiente no avisaba.
-- Ahora `mark_chat_read` cierra los avisos de ESE hilo: `message_new` y
-- `chat_mention_all` con el mismo `data.threadKey`. Sigue siendo
-- `security invoker`: el UPDATE corre con la RLS y el privilegio por
-- columna de quien lee (desde la 165 el dueño sólo puede escribir `read`),
-- así que nadie cierra avisos ajenos.
--
-- C05 — SILENCIAR NO SILENCIABA. `chat_mutes` sólo lo miraba la bandeja
-- de chats. Ahora:
--   · `notify_message_new` no crea el aviso de un DM si quien lo recibe
--     silenció ese hilo. El mensaje se entrega igual; lo que no hay es
--     aviso, push ni popup. (Un DM no puede ser `/importante`: ver
--     `messages_force_server_fields`, migración 32.)
--   · `chat_notify_mention_all` (`/todos`, 39 y 42) salta a quien silenció
--     el hilo, SALVO que el mensaje sea `/importante`: es la regla que la
--     pantalla del chat del club promete («los avisos marcados con
--     /importante te seguirán llegando»). El aviso lleva ahora
--     `important: true` cuando corresponde, que es lo que mira el popup del
--     cliente para dejarlo pasar.
--   · `send-push` también lo mira antes de mandar (por si el silencio
--     llega entre el aviso y el push) y anota `push_status =
--     'skipped_muted'`, un estado nuevo: se agrega a la restricción.
--
-- DECISIÓN DE PRODUCTO TOMADA ACÁ (revisable): `/todos` sin `/importante`
-- respeta el silencio. Si se quisiera que una mención a todos atraviese
-- el silencio, basta con sacar la condición del bloque del `/todos`.
--
-- Los cuerpos son los de la 15, la 32 y la 42 con sólo esos cambios.
-- Idempotente: `create or replace` y la restricción se reemplaza entera.
-- Pruebas: supabase/tests/169_leer_y_silenciar_cierran_el_aviso_test.sql
-- =============================================================

-- ── 1. El estado nuevo del push ──────────────────────────────────
alter table public.notifications drop constraint if exists notifications_push_status_check;
alter table public.notifications add constraint notifications_push_status_check
    check (push_status in ('pending', 'sending', 'sent', 'skipped_preference',
                           'skipped_no_token', 'skipped_muted', 'failed'));

-- ── 2. Leer cierra el aviso del hilo (C04) ───────────────────────
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

    -- 169: lo leído deja de estar pendiente también en la campana. Sin esto
    -- el próximo mensaje actualizaba el aviso viejo y no avisaba de nuevo.
    update public.notifications
    set    read = true
    where  user_id = v_me
      and  read = false
      and  type in ('message_new', 'chat_mention_all')
      and  data->>'threadKey' = p_thread_key;
end;
$$;

-- ── 3. El DM no avisa a quien lo silenció (C05) ──────────────────
create or replace function public.notify_message_new()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_sender_username  text;
    v_existing_id      uuid;
    v_existing_count   int;
begin
    -- Solo DMs: receiver_id seteado, match_id y club_id nulos
    if new.receiver_id is null
       or new.match_id is not null
       or new.club_id  is not null
    then
        return new;
    end if;

    -- 169: quien silenció este DM no recibe aviso (ni push ni popup). El
    -- mensaje ya quedó guardado: sólo se calla la alerta.
    if exists (
        select 1 from public.chat_mutes
         where user_id = new.receiver_id
           and thread_key = 'dm:' || new.sender_id::text
    ) then
        return new;
    end if;

    -- Nombre del remitente para el texto de la notificación
    select username
    into   v_sender_username
    from   public.profiles
    where  id = new.sender_id;

    -- ¿Hay ya una notif no leída de este remitente para este receptor?
    select id,
           coalesce((data->>'msgCount')::int, 1)
    into   v_existing_id, v_existing_count
    from   public.notifications
    where  user_id  = new.receiver_id
      and  type     = 'message_new'
      and  read     = false
      and  data->>'fromUserId' = new.sender_id::text
    order  by created_at desc
    limit  1;

    if v_existing_id is not null then
        -- Actualizar la notificación agrupada (no dispara push)
        update public.notifications
        set    title = coalesce(v_sender_username, 'Un jugador')
                       || ' te ha mandado '
                       || (v_existing_count + 1)
                       || ' mensajes',
               body  = 'Toca para ver la conversación.',
               data  = data || jsonb_build_object('msgCount', v_existing_count + 1),
               read  = false
        where  id = v_existing_id;
    else
        -- Insertar nueva notificación (dispara el push)
        insert into public.notifications (user_id, type, title, body, data)
        values (
            new.receiver_id,
            'message_new',
            coalesce(v_sender_username, 'Un jugador') || ' te envió un mensaje',
            left(new.content, 100),
            jsonb_build_object(
                'threadKey',  'dm:' || new.sender_id::text,
                'fromUserId', new.sender_id::text,
                'msgCount',   1
            )
        );
    end if;

    return new;
end;
$$;

-- ── 4. `/todos` respeta el silencio, salvo `/importante` (C05) ───
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
        -- 169: quien silenció el hilo no recibe el `/todos`, salvo que sea
        -- un aviso `/importante`.
        if not coalesce(new.is_important, false) and exists (
            select 1 from public.chat_mutes
             where user_id = v_recipient_id and thread_key = v_thread_key
        ) then
            continue;
        end if;

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
                    'messageId',    new.id::text,
                    'important',    coalesce(new.is_important, false)
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
                    'mentionCount', 1,
                    'important',    coalesce(new.is_important, false)
                )
            );
        end if;
    end loop;

    return new;
end;
$$;

-- Las funciones de disparador no son endpoints (migración 147).
revoke all on function public.notify_message_new() from public, anon, authenticated;
revoke all on function public.chat_notify_mention_all() from public, anon, authenticated;
