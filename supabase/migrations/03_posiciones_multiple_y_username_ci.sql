-- =============================================================
-- FutFinder migration 03:
--   1. posicion_preferida pasa de text a text[] (multi-selección)
--   2. username queda case-insensitive (mayúsculas permitidas pero
--      "Carlos_10" y "carlos_10" se consideran iguales)
-- =============================================================
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- =============================================================

-- 1. posicion_preferida → text[]
-- Primero, drop del check constraint existente
alter table public.profiles
    drop constraint if exists profiles_posicion_preferida_check;

-- Quitamos el default antes de cambiar el tipo
alter table public.profiles
    alter column posicion_preferida drop default;

-- Convertimos cada valor único a un array de un elemento
alter table public.profiles
    alter column posicion_preferida type text[]
    using case
        when posicion_preferida is null then array['sin_definir']
        else array[posicion_preferida::text]
    end;

-- Nuevo default
alter table public.profiles
    alter column posicion_preferida set default array['sin_definir'];

-- Nuevo check: cada elemento debe estar en el catálogo válido
alter table public.profiles
    add constraint profiles_posicion_preferida_check
    check (
        posicion_preferida <@ array['arquero','defensa','medio','delantero','lateral','volante','sin_definir']
        and array_length(posicion_preferida, 1) >= 1
    );

-- 2. username case-insensitive: dropear unique constraint default
--    y reemplazar por un unique index sobre lower(username)
alter table public.profiles
    drop constraint if exists profiles_username_key;

create unique index if not exists profiles_username_ci_idx
    on public.profiles (lower(username))
    where username is not null;
