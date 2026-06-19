-- =============================================================
-- FutFinder migration 27: partidos de club (Parte 2)
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
--
-- Extiende `matches` para que un partido pueda ser "de clubes": dos clubes
-- asignados (local y visitante) + el desafío que lo originó. Un partido normal
-- tiene estas columnas en null y se comporta exactamente igual que siempre.
-- =============================================================

alter table public.matches
    add column if not exists club_local_id     uuid references public.clubs(id) on delete set null;
alter table public.matches
    add column if not exists club_visitante_id uuid references public.clubs(id) on delete set null;
alter table public.matches
    add column if not exists challenge_id       uuid references public.club_challenges(id) on delete set null;

-- Quién respondió el desafío (el admin del retado que aceptó), para que el
-- admin retador pueda abrir el DM con esa persona.
alter table public.club_challenges
    add column if not exists respondido_por uuid references public.profiles(id) on delete set null;

create index if not exists idx_matches_club_local
    on public.matches (club_local_id) where club_local_id is not null;
create index if not exists idx_matches_club_visitante
    on public.matches (club_visitante_id) where club_visitante_id is not null;

-- No se necesita RLS nueva: la inserción la sigue haciendo el organizador
-- (admin que crea el partido) bajo la política matches_create_auth existente.
