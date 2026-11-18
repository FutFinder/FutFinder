-- =============================================================
-- 175. EL CHAT LLEGA POR BROADCAST
--
-- Revisión de escalado del 2026-11-05 (sigue a la 170). El chat escuchaba
-- la tabla `messages` ENTERA por `postgres_changes`. Así funciona eso:
-- por cada fila que cambia, Realtime revisa la RLS de `messages` una vez
-- por cada persona conectada al canal, para decidir a quién se la manda.
-- Con 300 conectados, un mensaje son 300 consultas; el costo crece con
-- conectados × mensajes, y es lo primero que se cae con mucha gente.
--
-- Ahora el SERVIDOR decide a quién le llega cada mensaje y se lo manda a
-- un topic privado por persona, `chat:<user_id>`:
--
-- 1. `chat_destinatarios(m)` devuelve quién puede LEER ese mensaje. Es la
--    política `messages_read` escrita como conjunto: cada rama del OR es
--    una rama del UNION, con los mismos ayudantes (`chat_are_friends`,
--    `chat_valid_club_challenge_dm`, `chat_puede_ver_desafio`) y los mismos
--    estados de asistente. El arnés 175 compara, mensaje por mensaje y
--    persona por persona, lo que reparte esta función contra lo que la RLS
--    deja leer: si alguien cambia `messages_read` y no esta función, falla.
--    OJO: es SECURITY DEFINER y devuelve quién está en cada hilo, así que
--    nadie fuera del disparador la puede ejecutar.
--
-- 2. Un disparador AFTER INSERT/UPDATE/DELETE llama `realtime.send` una
--    vez por destinatario. El payload tiene la forma que ya leía el cliente
--    (`eventType`, `new`, `old`), así que las pantallas no cambian. Como
--    `realtime.send` escribe en `realtime.messages`, si la transacción del
--    mensaje se aborta no sale nada. `realtime.send` ya atrapa sus propios
--    errores: un fallo de Realtime no impide guardar el mensaje.
--    En UPDATE sólo se manda si la fila cambió de verdad (en la práctica,
--    `read_at` de un DM).
--
-- 3. Autorización del canal: una política SELECT sobre `realtime.messages`
--    deja a cada sesión unirse SÓLO a su propio topic `chat:<su id>`. No hay
--    política de INSERT: ningún cliente puede publicar en el topic de otro
--    (ni en el suyo) haciéndose pasar por el servidor.
--
-- Lo que NO cambia todavía, a propósito: `messages` sigue en la publicación
-- `supabase_realtime`. Los builds nativos ya instalados escuchan con
-- `postgres_changes` y se quedarían sin chat en vivo. Cuando todos los
-- teléfonos tengan un build con el cliente nuevo, una migración aparte la
-- saca de la publicación y ahí se cobra el ahorro completo.
-- =============================================================

-- ── 1. Quién puede leer un mensaje ──
create or replace function public.chat_destinatarios(m public.messages)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    -- DM: los dos lados, si la amistad (o el DM de desafío legado) sigue en pie.
    select u
      from unnest(array[m.sender_id, m.receiver_id]) as u
     where m.receiver_id is not null
       and m.match_id is null
       and m.club_id is null
       and (public.chat_are_friends(m.sender_id, m.receiver_id)
            or public.chat_valid_club_challenge_dm(m.sender_id, m.receiver_id))
    union
    -- Partido: inscritos y confirmados por GPS.
    select a.id_jugador
      from public.attendees a
     where m.match_id is not null
       and a.id_partido = m.match_id
       and a.estado in ('inscrito', 'confirmado_gps')
    union
    -- Club: sus miembros.
    select cm.user_id
      from public.club_members cm
     where m.club_id is not null
       and cm.club_id = m.club_id
    union
    -- Desafío: quien de los dos clubes tenga permiso de verlo.
    select cm.user_id
      from public.club_challenges c
      join public.club_members cm
        on cm.club_id in (c.club_retador_id, c.club_retado_id)
     where m.challenge_id is not null
       and c.id = m.challenge_id
       and public.chat_puede_ver_desafio(m.challenge_id, cm.user_id);
$$;

revoke all on function public.chat_destinatarios(public.messages) from public, anon, authenticated;

-- ── 2. El disparador que reparte ──
create or replace function public.chat_difundir_mensaje()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fila public.messages;
  v_payload jsonb;
  v_user uuid;
begin
  if tg_op = 'UPDATE' and new is not distinct from old then
    return null;
  end if;

  if tg_op = 'DELETE' then
    v_fila := old;
    v_payload := jsonb_build_object('eventType', 'DELETE', 'new', null, 'old', to_jsonb(old));
  else
    v_fila := new;
    v_payload := jsonb_build_object('eventType', tg_op, 'new', to_jsonb(new),
                                    'old', jsonb_build_object('id', new.id));
  end if;

  for v_user in select d from public.chat_destinatarios(v_fila) as d loop
    perform realtime.send(v_payload, tg_op, 'chat:' || v_user::text, true);
  end loop;

  return null;
end;
$$;

revoke all on function public.chat_difundir_mensaje() from public, anon, authenticated;

drop trigger if exists trg_chat_difundir_mensaje on public.messages;
create trigger trg_chat_difundir_mensaje
  after insert or update or delete on public.messages
  for each row execute function public.chat_difundir_mensaje();

-- ── 3. Cada sesión escucha sólo su topic ──
drop policy if exists chat_cada_uno_escucha_su_topic on realtime.messages;
create policy chat_cada_uno_escucha_su_topic on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and (select realtime.topic()) = 'chat:' || (select auth.uid())::text
  );
