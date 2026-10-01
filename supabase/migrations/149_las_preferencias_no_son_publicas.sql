-- =============================================================
-- 149. LAS PREFERENCIAS DEL PERFIL NO SON PÚBLICAS
--
-- ⚠️  **NO APLICAR HASTA DISTRIBUIR UN BUILD.** Es la segunda mitad de la
-- 148, y la única que cambia privilegios. Separada a propósito.
--
-- POR QUÉ NO SE PUEDE APLICAR TODAVÍA. Quitarle a `authenticated` el
-- `select` de TABLA sobre `profiles` hace que `select('*')` falle entero
-- con «permission denied». Las apps que ya están instaladas lo usan en
-- cuatro lugares —`getMyProfile`, `getMyProfileWithStatus`,
-- `getProfileById` y `getCurrentProfile`— y **no hay actualizaciones por
-- aire**: `expo-updates` no está instalado, así que el arreglo del
-- cliente no llega hasta que se distribuye un build. Aplicar esto antes
-- deja a esas apps sin pantalla de perfil, sin Ajustes y sin Inicio.
--
-- Es exactamente el mismo problema que los tipos de carácter de la
-- contraseña, que están esperando por lo mismo y por eso van juntos.
--
-- QUÉ CIERRA. Nueve columnas que hoy puede leer cualquier cuenta con
-- sesión sobre cualquier perfil descubrible: los cuatro `notif_*`,
-- `pref_region`, `pref_comuna`, `search_radius_km` y los dos `privacy_*`.
-- Dicen dónde busca partidos cada persona, en qué radio, si acepta
-- solicitudes y si eligió ocultarse.
--
-- LO QUE HACE FALTA ANTES, y ya está hecho:
--   · la migración **148**, con `mis_ajustes()` —para que el dueño siga
--     leyendo lo suyo, porque los privilegios por columna no son por
--     fila— y con la política de amistad rehecha sobre
--     `perfil_acepta_solicitudes()`, que si no fallaría CERRADA;
--   · el cliente, que ya no pide `select('*')` en ninguno de los cuatro
--     sitios y trae las nueve por la RPC. Está en el repositorio desde el
--     2026-10-01.
--
-- `service_role` NO entra en el revoke: es con lo que `send-push` lee las
-- preferencias de aviso para decidir si manda el push.
--
-- CONSECUENCIA OPERATIVA: al pasar de un `select` de tabla a uno por
-- columna, **una columna nueva de `profiles` nace sin lectura para el
-- cliente** hasta que se le conceda. Es un defecto que se nota enseguida,
-- no en silencio, pero quien agregue una columna tiene que acordarse —y
-- de agregarla también a `COLUMNAS_PUBLICAS` en
-- `src/services/perfilColumnas.js`, que una prueba compara contra esta
-- migración.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/149_las_preferencias_no_son_publicas_test.sql
-- =============================================================

do $$
declare
  v_publicas text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_publicas
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'profiles'
     and column_name not in (
       'privacy_friend_requests', 'privacy_visible_in_search',
       'notif_matches', 'notif_clubs', 'notif_chat', 'notif_friends',
       'pref_region', 'pref_comuna', 'search_radius_km');

  revoke select on public.profiles from anon, authenticated;
  execute format('grant select (%s) on public.profiles to anon, authenticated', v_publicas);
end $$;
