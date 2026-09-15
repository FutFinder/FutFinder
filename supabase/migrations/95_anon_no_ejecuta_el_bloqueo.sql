-- =============================================================
-- 95. `anon` no ejecuta las funciones de bloqueo
-- =============================================================
-- Idempotente: seguro de re-ejecutar.
--
-- QUÉ ARREGLA
--   La migración 51 cerró sus tres funciones así:
--
--       revoke execute on function public.f(...) from public;
--       grant  execute on function public.f(...) to authenticated;
--
--   Eso NO logra lo que parece. Supabase trae un
--
--       alter default privileges in schema public
--           grant all on functions to anon, authenticated, service_role;
--
--   que le concede EXECUTE a `anon` de forma DIRECTA. `revoke ... from
--   public` quita el privilegio del pseudo-rol PUBLIC, no el concedido
--   directamente a `anon`, así que `anon` se lo queda. Comprobado el
--   2026-09-14: `has_function_privilege('anon', ..., 'execute')` devolvía
--   `true` para las tres.
--
-- POR QUÉ IMPORTA, Y CUÁNTO
--   `bloquear_usuario` y `desbloquear_usuario` se defienden solas: lo
--   primero que hacen es `if auth.uid() is null then raise exception 'No
--   autenticado'`. Llamarlas con la clave anon no lograba nada.
--
--   `is_blocked_pair` NO tiene esa guarda. Es SECURITY DEFINER, se salta
--   la RLS por diseño y devuelve un booleano para CUALQUIER par de UUID.
--   Los ids de `profiles` no son secretos, y la clave anon viaja dentro
--   del bundle de la app, así que se podía sondear el grafo de bloqueos
--   por `/rest/v1/rpc/is_blocked_pair` sin siquiera tener cuenta. Esa es
--   la puerta que cierra esta migración; las otras dos van incluidas
--   porque la intención de la 51 era la misma para las tres.
--
-- QUÉ NO CAMBIA
--   `authenticated` conserva EXECUTE en las tres, y tiene que
--   conservarlo: `is_blocked_pair` se evalúa DENTRO de la policy
--   `friendships_insert`, con el rol de quien inserta. Sin ese privilegio
--   no se podría enviar ninguna solicitud de amistad.
--
--   El cliente no llama nunca a `is_blocked_pair` (sólo la usa la
--   policy), y llama a las otras dos únicamente con sesión abierta
--   (`src/services/blockedUsers.js`), así que no hay flujo que dependa de
--   que `anon` pueda ejecutarlas.
--
-- ALCANCE DELIBERADAMENTE ESTRECHO
--   `get_advisors` reporta 67 funciones SECURITY DEFINER ejecutables por
--   `anon` en este proyecto. Es deuda de todo el esquema, no de la 51, y
--   varias de esas sí podrían usarse sin sesión a propósito (un buscador
--   público, por ejemplo). Cerrarlas en bloque sin revisar una por una
--   rompería flujos reales. Esta migración toca SOLO las tres de la 51.
--
-- Pruebas: supabase/tests/95_anon_no_ejecuta_el_bloqueo_test.sql
-- =============================================================

revoke execute on function public.is_blocked_pair(uuid, uuid) from anon;
revoke execute on function public.bloquear_usuario(uuid) from anon;
revoke execute on function public.desbloquear_usuario(uuid) from anon;

-- Reafirmado por si alguna ejecución futura de la 51 vuelve a crear las
-- funciones: `create or replace` conserva los privilegios, pero un
-- `drop`+`create` los repondría desde los default privileges.
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;
grant execute on function public.bloquear_usuario(uuid) to authenticated;
grant execute on function public.desbloquear_usuario(uuid) to authenticated;
