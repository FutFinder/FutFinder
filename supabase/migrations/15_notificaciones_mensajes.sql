-- =============================================================
-- FutFinder migration 15: notificaciones de mensajes directos
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Crea un trigger sobre messages (AFTER INSERT) que genera una
-- notificación de tipo 'message_new' solo para DMs.
--
-- AGRUPACIÓN: si ya existe una notificación no leída del mismo
-- remitente, se ACTUALIZA el contador en lugar de insertar una nueva.
-- Así el receptor ve "Juan te ha mandado 3 mensajes" en vez de tres
-- entradas separadas.
--
-- La primera notificación (INSERT) dispara el webhook → send-push.
-- Las siguientes (UPDATE) no disparan push adicionales a propósito:
-- no quieres 20 pushes por 20 mensajes del mismo chat.
-- =============================================================

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
        -- Actualizar la notificación agrupada (no dispara webhook push)
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
        -- Insertar nueva notificación (dispara webhook → push)
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

drop trigger if exists trg_notify_message_new on public.messages;
create trigger trg_notify_message_new
    after insert on public.messages
    for each row execute function public.notify_message_new();
