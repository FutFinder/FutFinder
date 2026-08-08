-- =============================================================
-- FutFinder migration 40: RPC única para la bandeja de chat
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin efectos secundarios.
--
-- Qué estaba mal: `listMyThreads()` (src/services/messages.js) armaba la
-- bandeja con ~11 round-trips y, para "el último mensaje de cada
-- conversación", bajaba hasta 300 mensajes de TODOS los partidos (o TODOS
-- los clubes, o TODOS los DMs) juntos y agrupaba en JavaScript quedándose
-- con el primero de cada thread_key. Con actividad pareja entre varias
-- conversaciones, ese límite de 300 es arbitrario: una conversación
-- ruidosa podía desplazar a las demás fuera de la ventana y dejarlas con
-- una vista previa vieja (o directamente sin vista previa), aunque
-- tuvieran mensajes nuevos.
--
-- Qué agrega esta migración:
--   `get_my_threads()` — una sola RPC que devuelve una fila por
--   conversación (partido / club / DM) con:
--     - su último mensaje real, calculado con DISTINCT ON particionado
--       por conversación (índices idx_messages_match_created /
--       idx_messages_club_created de la migración 04/11 ya cubren esto),
--       así que el límite es "una fila por thread_key", no un tope global.
--     - el remitente de ese último mensaje.
--     - el conteo de no leídos (reutiliza get_chat_unread_counts(), sin
--       duplicar esa lógica).
--     - silenciado (chat_mutes) y escondido (chat_hides), aplicados server-
--       side — un hilo escondido sin actividad posterior ya no vuelve.
--     - ya ordenada por actividad más reciente.
--
--   El resto de campos específicos de cada tipo (título, cancha, comuna,
--   member_count, rol, foto...) viaja en una columna `payload` (jsonb) en
--   vez de columnas anchas: evita el riesgo de desalinear tipos entre las
--   tres ramas del UNION ALL, y el cliente ya sabía leer esa forma (era
--   básicamente la que armaba a mano).
--
--   SECURITY INVOKER a propósito (ver migración 37: un SECURITY DEFINER
--   aquí filtraría datos de partidos/clubes/DMs ajenos a quien la llame
--   directo por RPC). Bajo INVOKER, la RLS de `messages` / `club_members` /
--   `attendees` ya restringe exactamente igual que las queries del cliente
--   que reemplaza — no cambia qué se puede ver, solo cuántas veces hay que
--   preguntarlo.
-- =============================================================

create or replace function public.get_my_threads()
returns table (
    thread_key  text,
    thread_type text,
    last_at     timestamptz,
    payload     jsonb
)
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
    -- Último mensaje POR CONVERSACIÓN, sin tope global: DISTINCT ON
    -- particiona por match_id/club_id, así que una conversación ruidosa
    -- nunca puede desplazar el último mensaje de otra.
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
    dm_peers as (
        select distinct
               case when sender_id = v_me then receiver_id else sender_id end as other_id
          from public.messages
         where match_id is null and club_id is null
           and (sender_id = v_me or receiver_id = v_me)
    ),
    last_dm_msg as (
        select distinct on (p.other_id)
               p.other_id, m.id, m.content, m.created_at, m.sender_id,
               coalesce(m.is_important, false) as is_important,
               coalesce(m.mention_all, false) as mention_all
          from dm_peers p
          join public.messages m
            on m.match_id is null and m.club_id is null
           and (
                 (m.sender_id = v_me and m.receiver_id = p.other_id)
              or (m.sender_id = p.other_id and m.receiver_id = v_me)
               )
         order by p.other_id, m.created_at desc
    ),
    raw as (
        -- ── Partidos: todo en el que esté inscrito, con o sin mensajes ──
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

        -- ── Clubes: uno por club al que pertenezco ──
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

        -- ── DMs: solo los que ya tienen al menos un mensaje ──
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
     -- Un hilo escondido reaparece solo si hay actividad posterior al escondite.
     where h.hidden_at is null or r.last_at > h.hidden_at
     order by r.last_at desc nulls last;
end;
$$;
