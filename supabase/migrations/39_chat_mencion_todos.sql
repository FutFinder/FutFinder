-- =============================================================
-- FutFinder migration 39: /todos — mención a todo el grupo en el chat
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin efectos secundarios.
--
-- Antes, /todos se reconocía en el compositor (utils/chatMeta.js) pero no
-- hacía nada real: el comando se recortaba del texto y el mensaje se
-- enviaba como cualquier otro. Esto lo implementa de verdad:
--
--   1. `messages.mention_all` marca un mensaje como "/todos".
--   2. Trigger BEFORE INSERT: /todos solo existe en chats grupales
--      (partido o club) — se rechaza en un DM sin importar qué mande el
--      cliente. La RLS de messages_insert (migración 36) ya exige que el
--      remitente sea de verdad participante del grupo al que escribe; esta
--      guarda es la validación específica de la operación /todos en sí.
--   3. Trigger AFTER INSERT: arma la lista de destinatarios DEL LADO DEL
--      SERVIDOR — jugadores de `club_members` o inscritos/organizador de
--      `attendees` — nunca a partir de nada que venga en el mensaje del
--      cliente. Cada destinatario recibe un aviso 'chat_mention_all'; si ya
--      tenía uno sin leer de este mismo hilo, se ACTUALIZA en vez de
--      duplicarse (mismo patrón que 'message_new' en la migración 15).
--   4. El push externo de 'chat_mention_all' respeta `notif_chat` igual que
--      cualquier otro aviso de chat — ver el mapeo espejado en
--      src/utils/notificationPreferences.js y
--      supabase/functions/send-push/pushLogic.ts.
--
-- Pruebas manuales: supabase/tests/39_chat_mention_all_test.sql
-- =============================================================

-- 1. Columna: messages.mention_all ----------------------------------
alter table public.messages
    add column if not exists mention_all boolean not null default false;

-- 2. Ampliar notifications_type_check --------------------------------
alter table public.notifications
    drop constraint if exists notifications_type_check;

alter table public.notifications
    add constraint notifications_type_check
    check (type = any (array[
        'match_join','friend_request','friend_accept','message_new',
        'match_reminder','match_rate','join_request','join_approved',
        'join_rejected','match_cancelled',
        'match_updated','match_slot_free','waitlist_turn','match_left',
        'match_attendance',
        'club_request','club_request_accepted','club_request_rejected',
        'club_member_joined','club_member_left','club_invite_accepted',
        'club_challenge','club_challenge_accepted','club_challenge_rejected',
        -- /todos en chats grupales (migración 39)
        'chat_mention_all'
    ]::text[]));

-- 3. Guarda: /todos solo existe en chats grupales ---------------------
create or replace function public.chat_validate_mention_all()
returns trigger
language plpgsql
as $$
begin
    if new.mention_all and new.receiver_id is not null then
        raise exception 'El comando /todos solo existe en chats grupales (partido o club).'
            using errcode = '22023'; -- invalid_parameter_value
    end if;
    return new;
end;
$$;

drop trigger if exists trg_chat_validate_mention_all on public.messages;
create trigger trg_chat_validate_mention_all
    before insert on public.messages
    for each row execute function public.chat_validate_mention_all();

-- 4. Trigger: fan-out de avisos a los participantes reales -------------
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

        -- Incluye al organizador: un trigger anterior ya lo agrega como
        -- attendee ('inscrito') al crear el partido.
        select array_agg(id_jugador) into v_recipient_ids
        from public.attendees
        where id_partido = new.match_id
          and estado in ('inscrito', 'confirmado_gps')
          and id_jugador <> new.sender_id;
    else
        -- Defensivo: la guarda BEFORE INSERT ya descarta el caso DM.
        return new;
    end if;

    foreach v_recipient_id in array coalesce(v_recipient_ids, array[]::uuid[])
    loop
        -- ¿Ya tiene un aviso sin leer de este mismo hilo? Se actualiza en
        -- vez de insertar uno nuevo (no duplicar), igual que agrupa
        -- 'message_new' varios mensajes del mismo remitente.
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

drop trigger if exists trg_chat_notify_mention_all on public.messages;
create trigger trg_chat_notify_mention_all
    after insert on public.messages
    for each row execute function public.chat_notify_mention_all();
