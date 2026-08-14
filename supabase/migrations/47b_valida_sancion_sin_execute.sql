-- =============================================================
-- FutFinder — migración 47b: la función de trigger de la sanción
-- deja de ser ejecutable por los roles del cliente.
--
-- POR QUÉ EXISTE. La 47 creó `club_challenges_valida_sancion()` como
-- `security definer` —no le queda otra: `club_esta_sancionado()` está
-- revocada de `authenticated`, así que un trigger `security invoker` no
-- podría llamarla— pero se le olvidó revocarle el `EXECUTE`. La propia
-- cabecera de la 47 dice que toda función nueva revoca de `public` y
-- recién después concede lo que haga falta; ésta no lo hizo, y el
-- advisor de Supabase la marcó por partida doble:
-- `anon_security_definer_function_executable` y su gemela de
-- `authenticated`.
--
-- QUÉ TAN GRAVE ERA. Poco: llamarla directamente por
-- `/rest/v1/rpc/club_challenges_valida_sancion` falla con
-- `0A000 — trigger functions can only be called as triggers`, que es
-- PostgreSQL negándose antes de ejecutar una sola línea del cuerpo. No
-- había forma de sacarle nada. Pero «hoy no se puede explotar» no es lo
-- mismo que «está bien puesto»: la superficie expuesta se cierra igual,
-- porque la próxima función que se escriba copiando ésta puede no tener
-- la misma suerte.
--
-- POR QUÉ UNA MIGRACIÓN APARTE Y NO UN PARCHE A LA 47. La 47 ya está
-- aplicada en producción (2026-08-14). Editarla dejaría el archivo del
-- repositorio diciendo una cosa y la base otra hasta que alguien la
-- volviera a correr entera, que es justo el desajuste que la 43b/43c/43d
-- y la 44b/44c/44d evitaron con archivos sufijados.
--
-- REVOCAR NO ROMPE EL TRIGGER. PostgreSQL comprueba el privilegio
-- `EXECUTE` de una función de trigger al crear el trigger, no cada vez
-- que dispara: al saltar lo hace el ejecutor por cuenta de la tabla, no
-- del rol que hizo el `insert`. El arnés `47b_..._test.sql` lo demuestra
-- en vez de suponerlo — inserta un desafío como `authenticated` con el
-- club sancionado y comprueba que sigue rechazándose con el mensaje de
-- la sanción.
--
-- ALCANCE: sólo esta función. Las 17 funciones de trigger heredadas que
-- el advisor marca por lo mismo (`notify_*`, `tg_*`,
-- `club_challenges_valida_rival`…) NO se tocan acá: son deuda anterior,
-- ninguna es de esta unidad, y arreglarlas de paso metería en un commit
-- de la Tarea 5.1 un cambio que nadie revisó. Queda anotado en
-- `docs/memoria/operacion/pendientes.md`.
--
-- Es idempotente: revocar un privilegio que ya no está es una operación
-- sin efecto, así que se puede volver a correr las veces que sea.
-- =============================================================

-- `from public` y no sólo `from anon`: `revoke ... from anon` NO quita el
-- EXECUTE que PostgreSQL concede a PUBLIC por defecto, y ése es el que
-- de verdad abre la función a todo el mundo. Es la lección de la 42b.
revoke execute on function public.club_challenges_valida_sancion()
    from public, anon, authenticated;

comment on function public.club_challenges_valida_sancion() is
    'Trigger BEFORE INSERT de club_challenges: impide crear un desafío si alguno de los dos clubes está sancionado (migración 47). Es security definer porque consulta club_esta_sancionado(), que está revocada de authenticated; la 47b le quitó el EXECUTE a los tres roles del cliente, y el trigger sigue disparando porque el privilegio se comprueba al crear el trigger, no al ejecutarlo.';
