-- 197. Desafíos entre clubes y alineación de Fútbol 5.
--
-- La 195 dejó a un club ser de Fútbol 5, pero sus desafíos seguían en 7 / 11
-- y la alineación sólo tenía tableros de 7 y 11. Vicente pidió el
-- 2026-11-19 abrir los dos.
--
-- Qué cambia:
--   · `club_challenges`, `club_challenge_proposals` y `club_open_challenges`
--     aceptan 'futbol5'.
--   · `crear_propuesta_oficial` (la única función que nombraba las
--     modalidades a mano; comprobado en `pg_proc`) acepta 'futbol5'. Se
--     cambia sólo esa línea sobre el cuerpo que está en producción.
--   · `club_lineups.modo` acepta 5 (arquero + 4).
--
-- Lo que NO hace falta tocar: los cupos por club van de 4 a 15
-- (`desafio_reglas`, los CHECK de las tres tablas y `matches`), y cinco por
-- lado cabe; `aprobar_propuesta` copia la modalidad al partido, y
-- `matches.modalidad` acepta 'futbol5' desde la 183.
--
-- Idempotente.

alter table public.club_challenges drop constraint if exists club_challenges_modalidad_check;
alter table public.club_challenges
    add constraint club_challenges_modalidad_check
    check (modalidad is null or modalidad in ('futbol5', 'futbol7', 'futbol11'));

alter table public.club_challenge_proposals drop constraint if exists club_challenge_proposals_modalidad_check;
alter table public.club_challenge_proposals
    add constraint club_challenge_proposals_modalidad_check
    check (modalidad in ('futbol5', 'futbol7', 'futbol11'));

alter table public.club_open_challenges drop constraint if exists club_open_challenges_modalidad_check;
alter table public.club_open_challenges
    add constraint club_open_challenges_modalidad_check
    check (modalidad in ('futbol5', 'futbol7', 'futbol11'));

alter table public.club_lineups drop constraint if exists club_lineups_modo_check;
alter table public.club_lineups
    add constraint club_lineups_modo_check
    check (modo in (5, 7, 11));

do $$
declare
  v_def text;
  v_nuevo text;
begin
  v_def := pg_get_functiondef('public.crear_propuesta_oficial(uuid, jsonb, uuid)'::regprocedure);
  if v_def like '%(''futbol5'', ''futbol7'', ''futbol11'')%' then
    return;  -- ya aplicada
  end if;
  v_nuevo := replace(v_def,
    'not in (''futbol7'', ''futbol11'')',
    'not in (''futbol5'', ''futbol7'', ''futbol11'')');
  if v_nuevo = v_def then
    raise exception '197: crear_propuesta_oficial cambió; no encontré la lista de modalidades';
  end if;
  execute v_nuevo;
end $$;
