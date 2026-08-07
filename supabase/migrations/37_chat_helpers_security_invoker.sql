-- =============================================================
-- FutFinder migration 37: cierra el leak de anon en los helpers
--                         de chat de la migración 36
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Qué estaba mal: `chat_are_friends` y `chat_valid_club_challenge_dm`
-- (migración 36) quedaron como SECURITY DEFINER. Postgres otorga
-- EXECUTE a PUBLIC por defecto en funciones nuevas, así que quedaban
-- expuestas como RPC de PostgREST (`/rest/v1/rpc/chat_are_friends`)
-- también para el rol `anon`: cualquiera, sin loguearse, podía pasar
-- dos uuids cualquiera y enterarse de si son amigos o si dos clubes
-- tienen un desafío aceptado, porque al ser SECURITY DEFINER la
-- función se saltaba por completo la RLS de `friendships` /
-- `club_challenges` / `club_members`. El advisor de seguridad de
-- Supabase (anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable) lo marcó justo
-- después de aplicar la 36.
--
-- La corrección es simplemente sacarles el SECURITY DEFINER: como
-- SECURITY INVOKER, la consulta interna de cada función queda sujeta
-- a la RLS de la tabla que consulta, evaluada con el auth.uid() real
-- de quien llama:
--   - Uso legítimo (desde las policies de `messages`): el llamador es
--     siempre uno de los dos `p_user1`/`p_user2` (así están armadas las
--     policies de la 36), y para ESE par la RLS de `friendships` /
--     `club_challenges` sí lo deja ver la fila relevante → el resultado
--     no cambia.
--   - Llamada directa vía RPC (anon o cualquier autenticado ajeno a la
--     consulta): auth.uid() no coincide con ninguno de los dos ids, la
--     RLS de la tabla consultada no le deja ver la fila → la función
--     devuelve `false` en vez de la verdad, sin filtrar nada.
-- =============================================================

create or replace function public.chat_are_friends(p_user1 uuid, p_user2 uuid)
returns boolean
language sql
stable
security invoker
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

create or replace function public.chat_valid_club_challenge_dm(p_user1 uuid, p_user2 uuid)
returns boolean
language sql
stable
security invoker
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
