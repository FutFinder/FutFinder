-- =============================================================
-- 98. `anon` no notifica, no recalcula y no cuenta reportes
-- =============================================================
-- Idempotente: seguro de re-ejecutar.
--
-- CONTINÚA LA 95
--   La 95 explicó el mecanismo y cerró las tres funciones del bloqueo:
--   el `revoke execute ... from public` que usan casi todas las
--   migraciones NO quita el EXECUTE que Supabase le concede a `anon`
--   directamente por default privileges. Esta migración cierra las tres
--   funciones restantes donde eso sí tiene consecuencias.
--
-- LA REVISIÓN COMPLETA (2026-09-15)
--   `get_advisors` reportaba 64 funciones SECURITY DEFINER ejecutables
--   por `anon`. Revisadas una por una:
--
--     · 38 son funciones de TRIGGER (sin argumentos). No se pueden
--       invocar de forma útil por RPC. Ruido del advisor.
--     · 14 tienen guarda explícita `if auth.uid() is null then ...`.
--       Se defienden solas.
--     · 12 son invocables con argumentos. De esas:
--         - 4 se defienden con `auth.uid()` dentro de un WHERE o un
--           `return 0` temprano, no con la guarda habitual:
--           transfer_club_admin, mark_thread_as_read,
--           get_schedule_conflict, historial_club.
--         - 5 son de SOLO LECTURA sobre datos públicos y se dejan como
--           están a propósito: buscar_complejos,
--           get_disponibilidad_cancha, club_estadisticas, club_record,
--           historial_publico_club. Son el catálogo público de la app;
--           cerrarlas rompería la navegación sin sesión.
--         - 3 son las que cierra esta migración.
--
-- QUÉ CIERRA Y POR QUÉ
--
--   1. `create_notification(uuid,text,text,text,jsonb)` — LA GRAVE.
--      No comprueba NADA: sólo `if p_user_id is null then return`. Es
--      SECURITY DEFINER, así que se salta la RLS de `notifications` e
--      inserta la fila que le pidan. Comprobado en una transacción
--      revertida: actuando como `anon`, sin cuenta, se creó una
--      notificación titulada «Tu cuenta será suspendida» dirigida a un
--      usuario real. Como la clave anon viaja dentro del bundle de la
--      app, cualquiera podía mandar avisos de phishing que llegan con
--      la apariencia de ser de FutFinder.
--
--   2. `count_reports_against(uuid)` — filtra moderación.
--      Devuelve cuántos reportes PENDIENTES hay contra cualquier
--      persona. La tabla `user_reports` (migración 31) tiene RLS
--      justamente para ocultar quién reportó a quién; esta función
--      dejaba asomarse al dato agregado sin tener cuenta.
--
--   3. `recalc_user_ratings(uuid)` — escribe sin permiso.
--      Actualiza `profiles.rating_*` de cualquier usuario. El daño es
--      limitado (recalcula desde `ratings`, no deja fijar un valor
--      arbitrario), pero es una escritura sobre una tabla ajena abierta
--      a cualquiera, y el cliente no la llama nunca.
--
-- QUÉ NO SE ROMPE
--   `authenticated` conserva las tres. Importa especialmente para las
--   dos primeras:
--     · `create_notification` la llaman por dentro approve_join,
--       reject_join, request_join, swap_match, cancel_match_and_join,
--       send_match_reminders, send_rating_reminders y los triggers
--       tg_notify_*. Ninguno de esos caminos es alcanzable por `anon`
--       (no puede insertar amistades, mensajes ni inscripciones).
--     · `recalc_user_ratings` la llama el trigger tg_ratings_recalc al
--       insertar en `ratings`, que siempre ocurre con sesión.
--     · `count_reports_against` la llama el cliente desde
--       `src/services/reports.js`, siempre con sesión.
--
--   El arnés cubre los dos caminos internos de punta a punta (casos 4 y
--   5), para que una revocación de más no pase callada.
--
-- Pruebas: supabase/tests/98_anon_no_notifica_ni_recalcula_test.sql
-- =============================================================

-- OJO CON EL ORDEN: hay que revocar de PUBLIC **y** de anon.
-- `CREATE FUNCTION` concede EXECUTE a PUBLIC por defecto, y estas tres se
-- crearon sin revocarlo. Revocar sólo de `anon` no sirve: lo seguiría
-- heredando por PUBLIC. (La 95 pudo revocar sólo de `anon` porque la
-- migración 51 ya había hecho el `revoke ... from public`.)
-- Comprobado con el arnés: con sólo el revoke de anon, el caso 1 falla.
revoke execute on function public.create_notification(uuid, text, text, text, jsonb) from public;
revoke execute on function public.count_reports_against(uuid) from public;
revoke execute on function public.recalc_user_ratings(uuid) from public;

revoke execute on function public.create_notification(uuid, text, text, text, jsonb) from anon;
revoke execute on function public.count_reports_against(uuid) from anon;
revoke execute on function public.recalc_user_ratings(uuid) from anon;

grant execute on function public.create_notification(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.count_reports_against(uuid) to authenticated;
grant execute on function public.recalc_user_ratings(uuid) to authenticated;
