-- =============================================================
-- 131. LA BANDEJA MIRA EL PERMISO, Y EL DM DICE COMO ESTA LA AMISTAD
--
-- Dos correcciones de `get_my_threads()`, la RPC de la bandeja de chat.
-- Se reescribe entera porque es la unica forma de tocarla; lo demas queda
-- exactamente igual que en la migracion 42.
--
-- 1) EL HILO DEL DESAFIO SE LISTA POR PERMISO, NO POR ROL.
--    `my_challenges` exigia `m.rol = 'admin'`, pero quien puede LEER ese
--    hilo lo decide `chat_puede_ver_desafio()` (migracion 119), que
--    pregunta por el permiso `chatClubs`. Desde que ese permiso se puede
--    delegar, un capitan o un jugador con `chatClubs` concedido recibia el
--    aviso, podia abrir el hilo y escribir en el, pero la conversacion no
--    aparecia en su bandeja: no tenia forma de volver a encontrarla.
--
--    `tiene_permiso_de_club()` devuelve true para un administrador sin
--    mirar nada mas, asi que la condicion nueva es un SUPERCONJUNTO de la
--    vieja: ningun administrador pierde un hilo. Con cero delegaciones de
--    `chatClubs` el resultado es identico al de hoy.
--
--    El mismo criterio ya esta aplicado del lado del cliente en
--    `getThreadParticipants()`, que incluye a los delegados: era la RPC la
--    que se habia quedado atras.
--
-- 2) EL DM VIAJA CON EL ESTADO DE LA AMISTAD.
--    La rama de DM se basa solo en que exista al menos un mensaje, sin
--    mirar `friendships`, y el cliente escribia el subtitulo «Amigos» fijo.
--    Resultado: la bandeja llamaba «Amigos» a alguien con quien la amistad
--    se deshizo o se bloqueo, mientras el hilo decia lo contrario al
--    abrirlo. Ahora el payload trae `friend_status` y el subtitulo sale de
--    ahi, con los mismos textos que usa `getThreadAccess`.
--
--    Es un campo ANADIDO al jsonb: una app vieja que no lo lea sigue
--    funcionando igual.
--
-- No cambia la firma, ni los permisos, ni ninguna otra rama.
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

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
                 and public.tiene_permiso_de_club(m.club_id, v_me, 'chatClubs')
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
                'friend_status', (
                    select f.status
                      from public.friendships f
                     where (f.requester_id = v_me and f.addressee_id = ld.other_id)
                        or (f.requester_id = ld.other_id and f.addressee_id = v_me)
                     order by f.created_at desc
                     limit 1
                ),
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
