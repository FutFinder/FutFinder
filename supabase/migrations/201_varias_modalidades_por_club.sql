-- 201. Un club puede jugar varias modalidades.
--
-- Vicente pidió el 2026-11-26 que al crear y editar un club se puedan marcar
-- Fútbol 5, 7 y 11 en cualquier combinación, y que la ficha las muestre
-- juntas: «Fútbol 5, 7», «Fútbol 5, 7, 11».
--
-- `clubs.modalidad` sigue siendo texto y descriptiva: ninguna función ni
-- política la lee (comprobado en `pg_proc` el 2026-11-26: `aprobar_propuesta`
-- y `crear_propuesta_oficial` mencionan clubs y modalidad, pero la modalidad
-- que usan es la de la propuesta, no la del club). Por eso cada combinación
-- es un valor canónico más del CHECK y no hace falta pasarla a un arreglo:
--
--   futbol5 · futbol7 · futbol11            una sola
--   futbol5_7 · futbol5_11 · ambos (7 y 11) dos
--   futbol5_7_11                            las tres
--
-- 'ambos' se queda como el valor de 7 y 11: lo guardan los clubes que ya lo
-- eligieron y lo entienden las versiones anteriores de la app. Las versiones
-- anteriores no conocen los valores nuevos y simplemente no muestran la
-- modalidad; nada se rompe.
--
-- No cambia nada de los desafíos: el partido entre clubes se sigue acordando
-- en UNA modalidad (`club_challenges`, `club_challenge_proposals`,
-- `club_open_challenges`).
--
-- Idempotente.

alter table public.clubs drop constraint if exists clubs_modalidad_check;
alter table public.clubs
    add constraint clubs_modalidad_check
    check (modalidad is null or modalidad in (
        'futbol5', 'futbol7', 'futbol11',
        'futbol5_7', 'futbol5_11', 'ambos',
        'futbol5_7_11'
    ));
