-- =============================================================
-- FutFinder migration 01: agregar columna `region` a matches
-- =============================================================
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- Es seguro correrlo varias veces (idempotente).
-- =============================================================

-- 1. Agregar columna region (nullable, para no romper filas existentes)
alter table public.matches
    add column if not exists region text;

-- 2. Backfill: a las filas existentes que tienen comuna conocida les ponemos
--    "Región Metropolitana de Santiago" como default razonable, ya que era
--    el foco inicial. Si tienes partidos en otras regiones, los cambias en
--    Table Editor.
update public.matches
set region = 'Región Metropolitana de Santiago'
where region is null;

-- 3. Índice para filtrar rápido por región
create index if not exists idx_matches_region on public.matches(region);
