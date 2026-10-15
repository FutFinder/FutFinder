-- =============================================================
-- 158. LA BASE NUEVA NACE IGUAL DE CERRADA
--
-- EN PRODUCCIÓN ESTO NO CAMBIA NADA, y ése es justo el punto.
--
-- `reactivate_suspended()` es `security definer`, la llama un cron y en
-- producción su ACL es `postgres` y `service_role`: ningún cliente la
-- ejecuta. Pero en una base construida desde cero **sí**, y por un motivo
-- que ya conocemos: la migración 146 la CREA —en producción no, porque la
-- función ya existía y el guardia de existencia la saltaba— y al crearse
-- hereda los privilegios por omisión, que conceden `execute` a
-- `authenticated`.
--
-- Se midió el 2026-10-15 comparando la base recién construida contra
-- producción: de las 285 funciones de `public`, **una sola** difería.
-- Producción tenía 168 ejecutables por `authenticated` y la base nueva 169.
--
-- QUÉ TAN GRAVE ES: poco, y conviene decirlo en vez de inflarlo. La función
-- sólo levanta suspensiones **ya vencidas** (`suspended_until <= now()`),
-- así que llamarla antes de tiempo no adelanta nada. Lo que arregla esta
-- migración no es un abuso posible, es que una base nueva no nazca más
-- abierta que la que está en producción — que es lo único que hace
-- confiable reconstruir.
--
-- NO SE TOCA LA 146. Está aplicada, y editarla no cambiaría producción ni
-- la base de nadie que ya la haya corrido. Esto se revoca aparte, que
-- además deja el motivo escrito donde se puede leer.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/158_la_base_nueva_nace_igual_de_cerrada_test.sql
-- =============================================================

revoke execute on function public.reactivate_suspended() from public, anon, authenticated;

comment on function public.reactivate_suspended() is
  'Levanta las suspensiones ya vencidas. La llama un cron, no el cliente: su execute es solo de postgres y service_role. La migracion 158 lo revoca porque una base construida desde cero la crea (via la 146) y heredaria el execute por omision.';
