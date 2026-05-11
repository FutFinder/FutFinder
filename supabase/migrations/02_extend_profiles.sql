-- =============================================================
-- FutFinder migration 02: extender profiles para perfil completo
-- =============================================================
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- =============================================================

alter table public.profiles
    add column if not exists edad integer
        check (edad is null or (edad >= 12 and edad <= 99)),
    add column if not exists bio text,
    add column if not exists flanco text
        check (flanco is null or flanco in ('derecho','izquierdo','ambos')),
    add column if not exists mvps integer not null default 0;

-- Agregar region opcional en profile (comuna ya existe)
alter table public.profiles
    add column if not exists region text;
