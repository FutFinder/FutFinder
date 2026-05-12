-- =============================================================
-- FutFinder migration 05:
--   1. El anfitrión se inserta automáticamente como attendee
--      (así su propio chat de partido aparece al toque).
--   2. profiles.onboarding_completed + lat/lng persistentes para que
--      el usuario no repita ubicación/términos al volver a iniciar sesión.
-- =============================================================
-- Pega esto en Supabase → SQL Editor → New query → Run.
-- =============================================================

-- 1. Trigger: agregar organizador como attendee al crear partido
create or replace function public.add_organizer_as_attendee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.attendees (id_partido, id_jugador, estado)
    values (new.id, new.id_organizador, 'inscrito')
    on conflict (id_partido, id_jugador) do nothing;
    return new;
end;
$$;

drop trigger if exists trg_add_organizer_as_attendee on public.matches;
create trigger trg_add_organizer_as_attendee
    after insert on public.matches
    for each row execute function public.add_organizer_as_attendee();

-- 2. Backfill: a partidos ya existentes les agregamos al organizador
insert into public.attendees (id_partido, id_jugador, estado)
select m.id, m.id_organizador, 'inscrito'
from public.matches m
on conflict (id_partido, id_jugador) do nothing;

-- 3. Campos en profiles para onboarding y ubicación
alter table public.profiles
    add column if not exists onboarding_completed boolean not null default false,
    add column if not exists latitud numeric(10, 7),
    add column if not exists longitud numeric(10, 7),
    add column if not exists location_updated_at timestamptz;

-- 4. Backfill: usuarios actuales se consideran "ya onboarded"
--    (no queremos que el usuario de prueba repita todo).
update public.profiles
set onboarding_completed = true
where onboarding_completed = false;
