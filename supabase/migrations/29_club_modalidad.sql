-- ============================================================
-- 29. Modalidad de juego del club (Fútbol 7 / Fútbol 11 / ambos)
-- ============================================================
-- Idempotente: seguro de re-ejecutar.
--
-- La columna es NULLABLE a propósito: los clubes creados antes de esta
-- migración no tienen modalidad y la UI muestra "FÚTBOL N.A." hasta que
-- un admin los edite. No se asigna un default para no inventar datos.
-- ============================================================

alter table public.clubs
    add column if not exists modalidad text;

-- El check se agrega aparte (y se re-crea) para que la migración sea
-- idempotente incluso si la columna ya existía sin restricción.
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conname = 'clubs_modalidad_check'
          and conrelid = 'public.clubs'::regclass
    ) then
        alter table public.clubs drop constraint clubs_modalidad_check;
    end if;
end $$;

alter table public.clubs
    add constraint clubs_modalidad_check
    check (modalidad is null or modalidad in ('futbol7', 'futbol11', 'ambos'));

comment on column public.clubs.modalidad is
    'Modalidad que practica el club: futbol7 | futbol11 | ambos. NULL = sin definir (clubes previos a esta migración).';
