-- 183. Fútbol 5 como modalidad de partido.
--
-- `matches.modalidad` sólo aceptaba 'futbol7' y 'futbol11' (migración 33).
-- Esta migración suma 'futbol5' para los partidos normales: se publican por
-- `publicar_partido_con_asientos` (182), que inserta la modalidad tal cual
-- viene y deja que el CHECK decida, así que basta con ampliar el CHECK.
--
-- Lo que NO cambia, a propósito:
--   · `clubs.modalidad`, `profiles.modalidad`, `club_challenges.modalidad` y
--     `club_open_challenges.modalidad` siguen en 7 / 11. Los desafíos entre
--     clubes y el perfil son otro producto; abrirlos a Fútbol 5 es otra decisión.
--   · Ninguna RPC ni política: ninguna mira el valor de la modalidad.
--
-- Idempotente: se puede correr dos veces.

alter table public.matches drop constraint if exists matches_modalidad_check;
alter table public.matches
    add constraint matches_modalidad_check
    check (modalidad is null or modalidad in ('futbol5', 'futbol7', 'futbol11'));
