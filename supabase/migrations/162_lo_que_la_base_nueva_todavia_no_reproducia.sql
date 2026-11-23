-- =============================================================
-- FutFinder migration 162: lo que la base nueva todavía no reproducía
-- =============================================================
-- La migración 146 cerró cinco huecos entre el repositorio y producción.
-- Quedaban siete más, y sólo salieron al comparar las dos bases **objeto
-- por objeto** el 2026-10-16, no por conteos: columnas, privilegios,
-- políticas y disparadores ya cuadraban, pero las RESTRICCIONES, los
-- ÍNDICES y dos CUERPOS de función no.
--
-- CÓMO SE COMPARA UN CUERPO. El `prosrc` de producción no es el del
-- archivo: lo que se aplica por el editor/MCP llega sin comentarios y con
-- los saltos de línea comidos. Comparar `md5(prosrc)` a secas da 285
-- diferencias y ninguna es real. Quitando comentarios y TODO el espacio en
-- blanco —la misma transformación en los dos lados— quedan **dos**, y las
-- dos importan.
--
-- 1. `solicitar_revision_sancion` — PRODUCCIÓN TIENE RAZÓN Y EL
--    REPOSITORIO NO. Busca el informe de incomparecencia del encuentro
--    filtrando además por `club_reportado_id = v_club`; el archivo 47c lo
--    hace sólo por `challenge_id`. La función hermana de esa MISMA
--    migración (`reportar_incomparecencia`, línea 551) sí filtra, y lleva
--    el comentario que lo explica: «el otro club puede tener su propio
--    informe, y ése no es el reintento de éste». Sin el filtro, un club
--    que NO fue reportado puede pedir revisión apoyándose en el informe
--    del otro, y el expediente que se congela en `contexto` retrata al
--    club equivocado. Alguien lo arregló en el editor y nunca lo escribió.
--
-- 2. `notify_club_challenge_responded` — sólo texto. Producción manda
--    «Coordinen los detalles por el chat.» y «Puedes desafiar a otros
--    equipos.»; las migraciones 26 y 28 dicen «…los detalles del partido
--    por el chat.» y «…a otros equipos desde tu club.». No hay forma de
--    saber cuál es la intención vigente, así que **se conserva lo que la
--    gente recibe hoy** y el repositorio deja de decir otra cosa. Si se
--    prefieren los textos largos, está anotado en `pendientes.md` y es una
--    línea.
--
-- 3. Tres CHECK que producción tiene y `schema.sql` no declara:
--    `matches_duracion_min_check`, `matches_min_trust_score_check` y
--    `profiles_estado_check`. Son guardas de integridad reales: una base
--    nueva aceptaba un partido de 5000 minutos, un `min_trust_score` de
--    -3 y un perfil en estado 'cualquier_cosa'.
--
-- 4. `idx_profiles_username` existe en producción y no está versionado.
--
-- 5. `idx_matches_con_reserva` es al revés: lo crea la migración 99 y
--    producción no lo tiene. Es un índice NO único sobre exactamente la
--    misma columna y el mismo predicado que `matches_reserva_uidx`, que sí
--    es único — o sea, peso muerto. Se retira, y así los dos lados quedan
--    iguales por el lado bueno.
--
-- En producción esta migración NO cambia nada: los cinco objetos ya están
-- como quedan acá y los dos cuerpos también. Lo que arregla es la base que
-- el repositorio construye desde cero.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Las tres restricciones que faltaban ───────────────────────
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'matches_duracion_min_check'
                    and conrelid = 'public.matches'::regclass) then
        alter table public.matches
            add constraint matches_duracion_min_check
            check (duracion_min >= 10 and duracion_min <= 300);
    end if;

    if not exists (select 1 from pg_constraint where conname = 'matches_min_trust_score_check'
                    and conrelid = 'public.matches'::regclass) then
        alter table public.matches
            add constraint matches_min_trust_score_check
            check (min_trust_score >= 0 and min_trust_score <= 100);
    end if;

    if not exists (select 1 from pg_constraint where conname = 'profiles_estado_check'
                    and conrelid = 'public.profiles'::regclass) then
        alter table public.profiles
            add constraint profiles_estado_check
            check (estado in ('activo','suspendido'));
    end if;
end $$;

-- ── 2. El índice que producción tiene y el repositorio no ────────
create index if not exists idx_profiles_username on public.profiles (username);

-- ── 3. Y el que sobra ────────────────────────────────────────────
-- `matches_reserva_uidx` ya es un único sobre (reserva_id) where
-- reserva_id is not null. Este repetía lo mismo sin ser único.
drop index if exists public.idx_matches_con_reserva;

-- ── 4. Los dos cuerpos ───────────────────────────────────────────
-- SE PARCHEA EL CUERPO DESPLEGADO, no se transcribe. Transcribir una
-- función larga a mano es exactamente como se perdieron la 48b y la 50:
-- se reconstruye desde una copia vieja y se revierte una decisión sin que
-- nadie lo note. `pg_get_functiondef` devuelve lo que la base tiene AHORA
-- —cabecera, argumentos, `security definer` y `search_path` incluidos— y
-- el `replace` falla ruidosamente si el ancla no está o está dos veces.
do $$
declare
    v_def  text;
    v_oid  oid;
    v_ancla text;
    v_n    int;
begin
    select p.oid, pg_get_functiondef(p.oid) into v_oid, v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'solicitar_revision_sancion';

    if v_oid is null then
        raise exception '162: no existe public.solicitar_revision_sancion';
    end if;

    if position('club_reportado_id = v_club' in v_def) > 0 then
        raise notice '162: solicitar_revision_sancion ya filtra por club_reportado_id';
    else
        v_ancla := 'from public.club_match_noshow_reports where challenge_id = v_row.id;';
        select count(*) into v_n
          from regexp_matches(v_def, replace(v_ancla, '.', '\.'), 'g');
        if v_n <> 1 then
            raise exception '162: el ancla de solicitar_revision_sancion aparece % veces, no 1', v_n;
        end if;
        v_def := replace(v_def, v_ancla,
            'from public.club_match_noshow_reports where challenge_id = v_row.id'
            || ' and club_reportado_id = v_club;');
        execute v_def;
    end if;
end $$;

do $$
declare
    v_def text;
    v_oid oid;
begin
    select p.oid, pg_get_functiondef(p.oid) into v_oid, v_def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'notify_club_challenge_responded';

    if v_oid is null then
        raise exception '162: no existe public.notify_club_challenge_responded';
    end if;

    if position('Coordinen los detalles del partido por el chat.' in v_def) > 0 then
        v_def := replace(v_def,
            'Coordinen los detalles del partido por el chat.',
            'Coordinen los detalles por el chat.');
    end if;
    if position('Puedes desafiar a otros equipos desde tu club.' in v_def) > 0 then
        v_def := replace(v_def,
            'Puedes desafiar a otros equipos desde tu club.',
            'Puedes desafiar a otros equipos.');
    end if;
    execute v_def;
end $$;
