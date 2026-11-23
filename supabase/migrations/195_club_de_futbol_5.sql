-- 195. Fútbol 5 como modalidad de club.
--
-- La 183 abrió Fútbol 5 para los partidos y dejó los clubes en 7 / 11 a
-- propósito. Vicente pidió el 2026-11-19 que crear y editar club también
-- ofrezcan Fútbol 5.
--
-- `clubs.modalidad` es descriptiva: la muestran el banner, las tarjetas y la
-- meta de los rivales, y ninguna función ni política de la base la lee
-- (comprobado en `pg_proc` el 2026-11-19: el único 'ambos' es el de
-- `profiles.modalidad` en `buscar_jugadores`). Basta con ampliar el CHECK.
--
-- Lo que NO cambia:
--   · 'ambos' sigue significando 7 y 11: es lo que guardan los clubes que ya
--     lo eligieron.
--   · Los desafíos entre clubes (`club_challenges`, `club_open_challenges`)
--     siguen en 7 / 11. Un club de Fútbol 5 puede desafiar, pero el desafío
--     se acuerda en 7 u 11. Abrirlos a 5 es otra decisión.
--   · `profiles.modalidad` tampoco cambia.
--
-- Idempotente.

alter table public.clubs drop constraint if exists clubs_modalidad_check;
alter table public.clubs
    add constraint clubs_modalidad_check
    check (modalidad is null or modalidad in ('futbol5', 'futbol7', 'futbol11', 'ambos'));
