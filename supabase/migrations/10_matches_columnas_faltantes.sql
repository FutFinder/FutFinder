-- 10 — Columnas de matches que ya existían en la base remota pero no en el esquema.
--
-- duracion_min, aprobacion y min_trust_score se agregaron a mano por el dashboard
-- y el código ya las usa (src/services/matches.js, ChatThreadScreen, MatchDetailScreen,
-- CreateMatchScreen, SearchScreen, HomeScreen), pero faltaban en schema.sql y en las
-- migraciones. Esta migración las formaliza con los mismos defaults/constraints que el
-- código asume, para que un entorno limpio quede idéntico al remoto.
--
--   • duracion_min     → duración del partido en minutos (default 90).
--   • aprobacion       → 'inmediata' (cualquiera entra) o 'manual' (el organizador aprueba).
--   • min_trust_score  → trust score mínimo para inscribirse (0 = sin requisito).

alter table public.matches
    add column if not exists duracion_min integer default 90;

alter table public.matches
    add column if not exists aprobacion text default 'inmediata'
        check (aprobacion in ('inmediata','manual'));

alter table public.matches
    add column if not exists min_trust_score integer default 0;
