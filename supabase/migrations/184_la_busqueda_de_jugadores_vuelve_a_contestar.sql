-- =============================================================
-- FutFinder — migración 184: la búsqueda de jugadores vuelve a contestar.
--
-- EL SÍNTOMA (visto el 2026-11-18 en www.futfinder.cl). Buscar «vicente22»
-- en Partidos → Jugadores decía «Sin resultados», aunque el perfil existe y
-- está visible en búsquedas. Los registros de la API muestran que CADA
-- llamada a `rpc/buscar_jugadores` contestaba **405**, no una lista vacía:
-- la pantalla trata el error como cero resultados.
--
-- LA CAUSA. `buscar_jugadores` nació `stable` (migración 142): sólo leía.
-- La 166 le inyectó en la primera línea `perform _exigir_limite(...)`, que
-- ESCRIBE (un upsert en `rate_limit_hits`). PostgREST ejecuta las funciones
-- `stable` e `immutable` dentro de una transacción de sólo lectura, así que
-- el upsert falla con 25006 (`read_only_sql_transaction`), que PostgREST
-- traduce a 405. Roto desde que la 166 llegó a producción (2026-11-05).
--
-- Los arneses no lo vieron porque llaman la función por SQL, en una
-- transacción normal de escritura: ahí el upsert pasa. Sólo falla por la
-- API. `registrar_telefono`, la otra a la que la 166 le puso el límite, ya
-- era `volatile` y no tiene el problema; es la única otra en esa situación.
--
-- EL ARREGLO. Declararla `volatile`, que es lo que es desde la 166. No se
-- toca el cuerpo, los privilegios ni el límite. El arnés de esta migración
-- vigila que NINGUNA función que llame a `_exigir_limite` quede `stable` o
-- `immutable`, para que la próxima no repita esto.
-- =============================================================

alter function public.buscar_jugadores(text, text, text, text, text, integer, integer, integer)
  volatile;
