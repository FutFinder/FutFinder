-- =============================================================
-- FutFinder — migración 49: el historial real del club y sus
-- estadísticas (Tarea 6.2 del plan de desafíos entre clubes).
--
-- QUÉ HACE: dos funciones de LECTURA, ninguna escritura, ninguna
-- tabla nueva y ninguna política tocada.
--
--   `historial_club(club, limite)`   → los encuentros DISPUTADOS del
--                                      club, con marcador confirmado.
--   `club_estadisticas(club)`        → PJ, V, E, D, GF y GC.
--
-- POR QUÉ HACE FALTA, teniendo ya `historial_publico_club()`:
--
--   1. UN PARTIDO SIN RESULTADO CONFIRMADO NO ES UN PARTIDO JUGADO.
--      `historial_publico_club()` hace un LEFT JOIN contra
--      `club_match_results`: devuelve la fila de cualquier partido
--      `finalizado` aunque nadie haya confirmado el marcador, y la
--      tarjeta del historial la pintaba como «Finalizado» con un «vs»
--      donde va el score. Y eso PASA de verdad:
--      `save_match_attendance()` (migración 33) pone
--      `matches.estado = 'finalizado'` en cuanto el organizador
--      registra la asistencia, sin mirar `club_match_results`. Acá el
--      join es INTERNO: sin resultado `confirmado` el encuentro no
--      sale, ni con marcador nulo ni de ninguna otra forma.
--
--      `historial_publico_club()` NO se toca. Su forma y su semántica
--      son el contrato que fijó la 44d y que su prueba comprueba
--      (`44d_partido_privado_test.sql`, caso 15: un `finalizado` sin
--      resultado sí aparece en la proyección pública). Cambiarle el
--      join rompería una prueba verde de una migración ya aplicada
--      para arreglar algo que se arregla acá, sin tocarla.
--
--   2. LA TARJETA NECESITA MÁS QUE CLUBES, DÍA Y MARCADOR. Escudos,
--      hora, cancha y tipo de partido. Los escudos (`clubs.foto_url`)
--      y el tipo (`matches.nivel`) son públicos: `clubs` se lee sin
--      restricción y el nivel no dice dónde ni cuándo juega nadie.
--      LA HORA EXACTA Y LA CANCHA NO: son el dato operativo que la
--      44d protege, y sólo viajan cuando quien pregunta pertenece a
--      uno de los dos clubes del encuentro — que es exactamente a
--      quien la RLS de `matches` ya le deja ver la fila entera. Para
--      cualquier otro llegan en `null` y la interfaz simplemente no
--      dibuja esa línea. `soy_integrante` viaja explícito para que la
--      pantalla no tenga que deducirlo de un `null`.
--
--   3. LA PERSPECTIVA ES DEL CLUB QUE PREGUNTA, NO DEL LOCAL. `V`
--      significa «ganó `p_club_id`», sea local o visitante — la misma
--      expresión que ya usan `club_record()` y
--      `historial_publico_club()`, sin una regla nueva.
--
-- `club_estadisticas()` REUTILIZA `club_record()` EN VEZ DE REPETIRLO:
-- V, E y D salen de esa función, no de una copia de su `case`. Lo
-- único que agrega son los tres agregados que no existían (PJ, GF y
-- GC), imposibles de calcular en el cliente sin mentir, porque el
-- historial viaja paginado y sumar goles de 20 filas no es el total
-- del club. `club_record()` queda intacta y sigue siendo la fuente de
-- V/E/D.
--
-- QUÉ NO HACE: no cuenta un resultado `propuesto` ni uno `rechazado`
-- (garantía 5 de la 48), no publica nómina, cuota ni ubicación, y no
-- inventa un historial para el club que todavía no jugó: devuelve cero
-- filas, que es lo que hay.
-- =============================================================

-- ── 1. EL HISTORIAL REAL ─────────────────────────────────────────
create or replace function public.historial_club(
    p_club_id uuid,
    p_limit   integer default 20
)
returns table (
    match_id                uuid,
    fecha                   date,
    hora                    timestamptz,
    club_local_id           uuid,
    club_local_nombre       text,
    club_local_foto_url     text,
    club_visitante_id       uuid,
    club_visitante_nombre   text,
    club_visitante_foto_url text,
    goles_local             integer,
    goles_visitante         integer,
    resultado               text,
    cancha_nombre           text,
    nivel                   text,
    soy_integrante          boolean
)
language sql
stable
security definer
set search_path = public
as $$
    select
        m.id,
        -- El día siempre, en la zona del país: es lo que la 44d ya
        -- publicaba y lo que se lee en la tarjeta.
        (m.hora at time zone 'America/Santiago')::date,
        -- La hora exacta y la cancha, sólo para los dos clubes.
        case when yo.integrante then m.hora else null end,
        m.club_local_id,
        cl.nombre,
        cl.foto_url,
        m.club_visitante_id,
        cv.nombre,
        cv.foto_url,
        r.goles_local,
        r.goles_visitante,
        case
            when r.goles_local = r.goles_visitante then 'E'
            when p_club_id = m.club_local_id and r.goles_local > r.goles_visitante then 'V'
            when p_club_id = m.club_visitante_id and r.goles_visitante > r.goles_local then 'V'
            else 'D'
        end,
        case when yo.integrante then m.cancha_nombre else null end,
        m.nivel,
        yo.integrante
      from public.matches m
      join public.clubs cl on cl.id = m.club_local_id
      join public.clubs cv on cv.id = m.club_visitante_id
      -- INTERNO a propósito: ver el punto 1 de la cabecera.
      join public.club_match_results r
        on r.match_id = m.id and r.estado = 'confirmado'
      cross join lateral (
        select exists (
            select 1
              from public.club_members cm
             where cm.user_id = auth.uid()
               and cm.club_id in (m.club_local_id, m.club_visitante_id)
        ) as integrante
      ) yo
     where m.challenge_proposal_id is not null
       and m.estado = 'finalizado'
       and p_club_id in (m.club_local_id, m.club_visitante_id)
     order by m.hora desc
     limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke execute on function public.historial_club(uuid, integer) from public;
grant execute on function public.historial_club(uuid, integer) to anon, authenticated;

comment on function public.historial_club(uuid, integer) is
    'Historial de encuentros DISPUTADOS de un club (migración 49): sólo partidos finalizados CON resultado confirmado, con V/E/D desde la perspectiva de p_club_id. Escudos y nivel son públicos; la hora exacta y la cancha sólo viajan si quien pregunta pertenece a uno de los dos clubes. historial_publico_club() sigue siendo la proyección estrictamente pública de la 44d.';

-- ── 2. LAS ESTADÍSTICAS REALES ───────────────────────────────────
create or replace function public.club_estadisticas(p_club_id uuid)
returns table (
    pj integer,
    v  integer,
    e  integer,
    d  integer,
    gf integer,
    gc integer
)
language sql
stable
security definer
set search_path = public
as $$
    select g.pj, rec.v, rec.e, rec.d, g.gf, g.gc
      -- V/E/D salen de club_record(), no de una copia de su `case`.
      -- Siempre devuelve exactamente una fila (agregado sin group by),
      -- así que este producto cartesiano es una fila con una fila.
      from public.club_record(p_club_id) rec,
           (select
                count(*)::integer as pj,
                coalesce(sum(case when r.club_local_id = p_club_id
                                  then r.goles_local
                                  else r.goles_visitante end), 0)::integer as gf,
                coalesce(sum(case when r.club_local_id = p_club_id
                                  then r.goles_visitante
                                  else r.goles_local end), 0)::integer as gc
              from public.club_match_results r
             where r.estado = 'confirmado'
               and p_club_id in (r.club_local_id, r.club_visitante_id)) g;
$$;

revoke execute on function public.club_estadisticas(uuid) from public;
grant execute on function public.club_estadisticas(uuid) to anon, authenticated;

comment on function public.club_estadisticas(uuid) is
    'PJ, V, E, D, GF y GC de un club contando sólo club_match_results.estado = confirmado (migración 49). V/E/D los delega en club_record(); GF y GC miran el marcador desde el lado del club, sea local o visitante. Siempre devuelve una fila, con ceros si el club no jugó todavía.';
