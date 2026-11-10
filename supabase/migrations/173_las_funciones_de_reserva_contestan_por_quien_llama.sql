-- =============================================================
-- 173. LAS FUNCIONES DE RESERVA CONTESTAN POR QUIEN LLAMA
--
-- Segunda pasada de seguridad (2026-11-09), punto «funciones que contestan
-- sobre otra persona». Eran cuatro. Se cierran dos y dos se dejan como
-- están, y las dos decisiones salen de mirar CADA llamada en el catálogo
-- (local y producción, 2026-11-09), no de la intuición.
--
-- ── LAS DOS QUE SE CIERRAN ────────────────────────────────────
-- `es_participante_de_reserva(reserva, user)` y
-- `es_organizador_de_reserva(reserva, user)` son `security definer` (las
-- políticas de `reservas` y `reserva_participantes` se preguntan la una por
-- la otra, y sin `definer` se muerden la cola) y `authenticated` las
-- ejecuta, porque las políticas se evalúan con el rol de quien consulta.
-- Por eso también respondían por `/rest/v1/rpc/...`: con el id de una
-- reserva, cualquiera con cuenta podía preguntar si la persona X la
-- organizó o juega en ella. La tabla dice otra cosa: una reserva sólo la
-- ve quien la organiza o participa.
--
-- Quién las llama, completo:
--   · Políticas: `reservas_select`, `reserva_participantes_select`,
--     `reserva_contacto_select` y `reserva_cobros_select`. Las cuatro pasan
--     `(select auth.uid())`.
--   · Funciones: `detalle_reserva` y `mis_reservas` pasan `v_me`, que es
--     `auth.uid()` y ya se comprobó no nulo unas líneas antes;
--     `actualizar_contacto_reserva` pasa `auth.uid()` directo.
--   · Cliente y Edge Functions: nadie las llama por RPC.
-- En TODAS, la persona por la que se pregunta es quien llama. Así que se
-- atan a eso, igual que la 171 con `is_blocked_pair`:
--   · con sesión y preguntando por OTRA persona → `false`, siempre;
--   · con sesión y preguntando por uno mismo → la verdad;
--   · sin sesión (`auth.uid()` nulo: cron, `service_role`, editor SQL) → la
--     verdad, porque ahí no hay a quién esconderle nada y `anon` no las
--     ejecuta desde la 114.
--
-- Ojo con lo que eso significa para quien organiza: preguntarle a la
-- función «¿fulano participa en MI reserva?» ahora contesta `false`. No es
-- una pérdida: nadie lo hacía, y la nómina de su reserva la sigue leyendo
-- por `reserva_participantes` (su política lo deja) y por
-- `detalle_reserva`.
--
-- No se revoca el EXECUTE: sin él, las cuatro políticas dejarían de
-- evaluarse y nadie leería su propia reserva.
--
-- ── LAS DOS QUE NO SE TOCAN, Y POR QUÉ ────────────────────────
-- `perfil_acepta_solicitudes(p_user)`: su único uso es la política
-- `friendships_insert`, que la llama con `addressee_id` — la persona a la
-- que se le manda la solicitud, que por definición NO es quien llama.
-- Atarla a `auth.uid()` rompería toda solicitud de amistad. Lo que deja
-- saber (si alguien tiene las solicitudes cerradas) es lo mismo que se
-- aprende intentando mandarle una.
--
-- `tiene_permiso_de_club(club, user, permiso)`: catorce políticas y siete
-- funciones la llaman con quien llama, pero
-- `chat_valid_club_challenge_dm(u1, u2)` pregunta por LAS DOS personas de
-- un mensaje directo entre clubes («¿los dos tienen permiso de chat?»), y
-- la usan las políticas `messages_read`, `messages_insert` y
-- `messages_update_read` con `sender_id` y `receiver_id`, además de
-- `get_chat_unread_counts` y `mark_thread_as_read`. Una de las dos
-- personas nunca es quien llama. Atarla dejaría sin leer ni escribir los
-- mensajes directos entre administradores de clubes en desafío. Lo que
-- deja saber (si una persona tiene tal permiso en tal club) es poco, y la
-- lista de integrantes y sus roles ya es legible con cuenta.
--
-- Si algún día se quiere cerrar esas dos, el camino no es atarlas: es
-- partirlas en una versión interna sin EXECUTE (para las funciones
-- `definer`) y una pública atada a quien llama (para las políticas).
--
-- Pruebas: supabase/tests/173_las_funciones_de_reserva_contestan_por_quien_llama_test.sql
-- =============================================================

create or replace function public.es_participante_de_reserva(p_reserva_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        -- Con sesión y preguntando por otra persona: no se contesta.
        when (select auth.uid()) is not null
             and (select auth.uid()) is distinct from p_user_id
        then false
        else exists (
            select 1 from public.reserva_participantes
             where reserva_id = p_reserva_id and user_id = p_user_id
        )
    end;
$$;

create or replace function public.es_organizador_de_reserva(p_reserva_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select case
        -- Con sesión y preguntando por otra persona: no se contesta.
        when (select auth.uid()) is not null
             and (select auth.uid()) is distinct from p_user_id
        then false
        else exists (
            select 1 from public.reservas
             where id = p_reserva_id and organizador_id = p_user_id
        )
    end;
$$;

-- `create or replace` conserva los privilegios; se reafirman por si una base
-- nueva llega acá con otros (mismo criterio que la 95 y la 171).
revoke execute on function public.es_participante_de_reserva(uuid, uuid) from public;
revoke execute on function public.es_participante_de_reserva(uuid, uuid) from anon;
grant execute on function public.es_participante_de_reserva(uuid, uuid) to authenticated;
revoke execute on function public.es_organizador_de_reserva(uuid, uuid) from public;
revoke execute on function public.es_organizador_de_reserva(uuid, uuid) from anon;
grant execute on function public.es_organizador_de_reserva(uuid, uuid) to authenticated;
