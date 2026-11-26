-- 199. El nivel del club.
--
-- Decisión de Vicente (2026-11-26, rediseño de Clubes): cada club elige su
-- nivel y lo puede cambiar después desde «Editar club». Reemplaza al rating
-- (`4.2 ★`) en la cabecera de la ficha y en las tarjetas de rival.
--
-- HASTA HOY LA COLUMNA NO EXISTÍA. El cliente pedía `club.nivel` y pintaba un
-- chip «NIVEL …» que nunca se dibujaba: `clubs` no tenía esa columna en
-- producción (comprobado el 2026-11-26 con un `select nivel from clubs`, que
-- devuelve 42703). El `nivel` con `default 'recreativo'` de `schema.sql` es el
-- de `matches`, no el del club.
--
-- CINCO VALORES, de menor a mayor: recreativo, amateur, intermedio,
-- competitivo, elite. `null` es «el club no eligió» y la interfaz no dibuja
-- nada: no es lo mismo que «recreativo», el mismo criterio de la 156.
--
-- LO QUE NO CAMBIA: el nivel de los PARTIDOS (`matches.nivel`) y el de las
-- propuestas oficiales (`club_challenge_proposals.nivel`) siguen con sus tres
-- valores. Son otra cosa —qué tan exigente es UN encuentro— y los leen
-- `MatchCard`, los filtros de Partidos y `aprobar_propuesta()`. Ampliarlos es
-- otra decisión, y no hace falta para que un club diga su nivel.
--
-- PRIVILEGIOS POR COLUMNA. `clubs` concede INSERT y UPDATE a `authenticated`
-- columna por columna (banner_url, comuna, descripcion, …, tema), así que una
-- columna nueva nace sin que nadie pueda escribirla desde la app. La policy
-- `clubs_update` sigue decidiendo QUIÉN; esto sólo abre la columna.
--
-- Idempotente.

alter table public.clubs add column if not exists nivel text;

alter table public.clubs drop constraint if exists clubs_nivel_check;
alter table public.clubs
  add constraint clubs_nivel_check
  check (nivel is null or nivel in ('recreativo', 'amateur', 'intermedio', 'competitivo', 'elite'));

comment on column public.clubs.nivel is
  'Nivel que el club declara de sí mismo (migración 199). NULL = no eligió; la interfaz no dibuja nada.';

grant insert (nivel), update (nivel) on public.clubs to authenticated;
