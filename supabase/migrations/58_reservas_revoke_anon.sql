-- =============================================================
-- FutFinder migration 58: revoca EXECUTE de `anon` en las RPC del
-- vertical de Reservas que son solo para usuarios autenticados
-- =============================================================
-- Las migraciones 55/56 revocaron EXECUTE de estas funciones solo desde
-- `public` antes de conceder a `authenticated` — pero Supabase concede
-- EXECUTE a `anon` (y a `authenticated`) por privilegio por defecto en
-- cada función nueva, aparte del privilegio de PUBLIC. `revoke ... from
-- public` NO quita ese privilegio propio de `anon`: hace falta
-- revocarlo explícitamente (mismo defecto que ya documentó y corrigió
-- la migración 43 para `procesar_vencimientos_desafios`, y que la
-- migración 55 ya corrigió para `vencer_reservas_pasadas` — esta
-- migración cierra el mismo hueco en el resto de las RPC del vertical).
--
-- Impacto práctico: bajo. Todas estas funciones ya empiezan con
-- `if auth.uid() is null then return ... 'No autenticado' end if`, y una
-- llamada de `anon` (sin JWT firmado) siempre trae `auth.uid()` en NULL
-- — así que hoy ya devuelven ese rechazo, nunca ejecutan lógica de
-- negocio. Este cambio es defensa en profundidad y consistencia con el
-- resto del código, no el cierre de un agujero explotable.
--
-- `get_disponibilidad_cancha` (migración 54) queda afuera a propósito:
-- esa sí está pensada para `anon` (disponibilidad es información
-- pública, se muestra antes de iniciar sesión).
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

revoke execute on function public.es_participante_de_reserva(uuid, uuid) from anon;
revoke execute on function public.es_organizador_de_reserva(uuid, uuid) from anon;
revoke execute on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid) from anon;
revoke execute on function public.invitar_participante_reserva(uuid, uuid, text) from anon;
revoke execute on function public.rechazar_invitacion_reserva(uuid) from anon;
revoke execute on function public.autorizar_cobro_reserva(uuid, integer) from anon;
revoke execute on function public.confirmar_reserva(uuid) from anon;
revoke execute on function public.recalcular_cuota_reserva(uuid, integer) from anon;
revoke execute on function public.cancelar_reserva(uuid, text) from anon;
revoke execute on function public.responder_cancelacion_desafio(uuid, boolean) from anon;
revoke execute on function public.cargar_balance(integer, text) from anon;
revoke execute on function public.get_mi_balance() from anon;
