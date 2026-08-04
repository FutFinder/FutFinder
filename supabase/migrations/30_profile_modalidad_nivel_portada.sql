-- ============================================================
-- 30. Perfil de jugador: modalidad, nivel y portada
-- ============================================================
-- Idempotente: seguro de re-ejecutar.
--
-- Las tres columnas son NULLABLE a propósito. Los perfiles creados antes
-- de esta migración no las tienen y la UI muestra "FÚTBOL N.A." /
-- "NIVEL N.A." / portada vacía hasta que el jugador las complete.
-- No se asigna default para no inventar datos.
-- ============================================================

alter table public.profiles
    add column if not exists modalidad  text,
    add column if not exists nivel      text,
    add column if not exists banner_url text;

-- Los checks se re-crean para que la migración sea idempotente incluso si
-- las columnas ya existían sin restricción.
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conname = 'profiles_modalidad_check' and conrelid = 'public.profiles'::regclass
    ) then
        alter table public.profiles drop constraint profiles_modalidad_check;
    end if;
    if exists (
        select 1 from pg_constraint
        where conname = 'profiles_nivel_check' and conrelid = 'public.profiles'::regclass
    ) then
        alter table public.profiles drop constraint profiles_nivel_check;
    end if;
end $$;

-- Mismo vocabulario que clubs.modalidad (migración 29), para que un jugador
-- y un club se puedan comparar sin traducir valores.
alter table public.profiles
    add constraint profiles_modalidad_check
    check (modalidad is null or modalidad in ('futbol7', 'futbol11', 'ambos'));

-- Nivel autodeclarado por el jugador. No es un ranking calculado.
alter table public.profiles
    add constraint profiles_nivel_check
    check (nivel is null or nivel in ('A', 'B', 'C', 'D'));

comment on column public.profiles.modalidad is
    'Modalidad que juega: futbol7 | futbol11 | ambos. NULL = sin definir.';
comment on column public.profiles.nivel is
    'Nivel autodeclarado por el jugador (A-D). NULL = sin definir. NO es un ranking calculado por el sistema.';
comment on column public.profiles.banner_url is
    'Portada del perfil. Bucket avatars, ruta <user_id>/banner.<ext>. NULL = sin portada.';
