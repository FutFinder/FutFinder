-- =============================================================
-- FutFinder migration 41: ciclo formal de desafíos entre clubes
-- =============================================================
-- Pega esto entero en Supabase → SQL Editor → New query → Run.
-- Es idempotente: se puede volver a correr sin romper nada.
--
-- Qué había antes: `club_challenges` con cinco estados
-- (pendiente/aceptado/rechazado/cancelado/expirado) y ninguna noción de
-- plazos. Al aceptar, el cliente abría un DM entre dos administradores y
-- la RLS lo permitía por la excepción `chat_valid_club_challenge_dm()`
-- de la migración 37. Eso no puede cumplir "un chat con todos los
-- administradores de ambos clubes" ni sostener un ciclo con
-- vencimientos.
--
-- Qué agrega esta migración:
--   1. Los estados del ciclo formal, conservando los cinco antiguos.
--      `aceptado` queda como valor legado: no lo produce el código
--      nuevo, pero las filas que ya existen siguen funcionando con su
--      DM intacto. No se migra ninguna fila.
--   2. Las columnas de plazos y de propuesta preliminar.
--   3. `desafio_reglas()`, espejo de src/services/clubChallengeRules.js.
--   4. La guarda de backend contra desafiar a un club propio. Hasta
--      ahora eso solo se filtraba en la interfaz, así que un cliente
--      modificado podía saltárselo.
--
-- Las secciones de chat grupal, eventos y RPC de aceptación llegan en la
-- segunda parte de esta misma migración (Fase 2 del plan).
-- =============================================================

-- ── 1. ESTADOS DEL CICLO ────────────────────────────────────────
-- Se conservan los cinco valores antiguos para no invalidar ninguna
-- fila existente. Ver la máquina completa en clubChallengeRules.js.
alter table public.club_challenges
    drop constraint if exists club_challenges_estado_check;

alter table public.club_challenges
    add constraint club_challenges_estado_check
    check (estado in (
        -- ciclo formal
        'pendiente',
        'negociacion',
        'esperando_aprobacion',
        'publicado',
        'en_juego',
        'esperando_resultado',
        'finalizado',
        'rechazado',
        'sin_acuerdo',
        'cancelado',
        'resultado_en_disputa',
        'bloqueado_sancion',
        'expirado',
        -- legado: filas anteriores a esta migración
        'aceptado'
    ));

-- ── 2. COLUMNAS DE PLAZOS Y PROPUESTA PRELIMINAR ────────────────
-- `fecha_propuesta` ya existía y significa "fecha tentativa": se
-- conserva como el inicio del rango en vez de crear una columna
-- paralela que diga lo mismo.
alter table public.club_challenges
    add column if not exists fecha_hasta          timestamptz,
    add column if not exists modalidad            text,
    add column if not exists cupos_por_club       integer,
    add column if not exists metodo_inscripcion   text,
    add column if not exists negociacion_vence_at timestamptz,
    add column if not exists prorroga_abierta_at  timestamptz,
    add column if not exists prorroga_vence_at    timestamptz,
    add column if not exists motivo_cierre        text,
    add column if not exists estado_previo_sancion text,
    add column if not exists client_token         uuid;

alter table public.club_challenges
    drop constraint if exists club_challenges_modalidad_check;
alter table public.club_challenges
    add constraint club_challenges_modalidad_check
    check (modalidad is null or modalidad in ('futbol7', 'futbol11'));

-- Cupos POR CLUB, no del partido completo. El máximo de 15 no es una
-- preferencia: `matches.cupos_totales` tiene check (<= 30) y el total de
-- un partido de clubes es el doble de estos cupos.
alter table public.club_challenges
    drop constraint if exists club_challenges_cupos_check;
alter table public.club_challenges
    add constraint club_challenges_cupos_check
    check (cupos_por_club is null or cupos_por_club between 4 and 15);

alter table public.club_challenges
    drop constraint if exists club_challenges_metodo_check;
alter table public.club_challenges
    add constraint club_challenges_metodo_check
    check (metodo_inscripcion is null
           or metodo_inscripcion in ('orden_llegada', 'seleccion_admin'));

alter table public.club_challenges
    drop constraint if exists club_challenges_rango_fechas_check;
alter table public.club_challenges
    add constraint club_challenges_rango_fechas_check
    check (fecha_hasta is null
           or fecha_propuesta is null
           or fecha_hasta >= fecha_propuesta);

-- Publicación idempotente del desafío: reintentar con el mismo token no
-- crea una segunda fila.
create unique index if not exists club_challenges_client_token_uidx
    on public.club_challenges (client_token)
    where client_token is not null;

-- Un solo desafío ACTIVO por par de clubes, sin importar quién retó a
-- quién. El índice antiguo (`club_challenges_unique_pending`) es
-- direccional y solo cubre 'pendiente'; se conserva. Este cubre los
-- estados nuevos, que hoy no tienen ninguna fila, así que su creación no
-- puede fallar por datos preexistentes.
create unique index if not exists club_challenges_unique_activo
    on public.club_challenges (
        least(club_retador_id, club_retado_id),
        greatest(club_retador_id, club_retado_id)
    )
    where estado in (
        'negociacion', 'esperando_aprobacion', 'publicado',
        'en_juego', 'esperando_resultado'
    );

create index if not exists idx_club_challenges_vencimientos
    on public.club_challenges (estado, negociacion_vence_at, prorroga_vence_at)
    where estado in ('pendiente', 'negociacion', 'publicado', 'en_juego');

-- ── 3. desafio_reglas(): espejo de clubChallengeRules.js ────────
-- Misma función que `partido_reglas()` cumple para el módulo Partidos.
-- Si un valor cambia aquí, cambia en clubChallengeRules.js, o el cliente
-- empezará a ofrecer acciones que el servidor rechaza.
create or replace function public.desafio_reglas()
returns jsonb
language sql
immutable
as $$
    select jsonb_build_object(
        'negociacion_horas', 72,
        'prorroga_horas', 24,
        'cambio_limite_horas', 2,
        'cancelacion_sancion_horas', 2,
        'sancion_dias', 14,
        'expiracion_pendiente_dias', 7,
        'cupos_por_club_min', 4,
        'cupos_por_club_max', 15,
        'mensaje_max', 300,
        'instrucciones_max', 500,
        'metodos_inscripcion', jsonb_build_array('orden_llegada', 'seleccion_admin'),
        'estados_activos', jsonb_build_array(
            'negociacion', 'esperando_aprobacion', 'publicado',
            'en_juego', 'esperando_resultado', 'resultado_en_disputa'
        ),
        'estados_cerrados', jsonb_build_array(
            'finalizado', 'rechazado', 'sin_acuerdo', 'cancelado', 'expirado'
        )
    );
$$;

grant execute on function public.desafio_reglas() to authenticated, anon;

-- ── 4. GUARDA: no desafiar a un club propio ─────────────────────
-- La interfaz ya oculta los clubes propios de la lista de rivales, pero
-- eso es una comodidad, no un límite: cualquiera podía llamar a
-- PostgREST directamente con el id de su otro club. Esta guarda es la
-- que de verdad lo impide.
--
-- `security invoker` a propósito: la función solo consulta `club_members`
-- con datos que el propio usuario está insertando, así que no necesita
-- privilegios elevados y no revela membresías ajenas.
create or replace function public.club_challenges_valida_rival()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    if new.club_retador_id = new.club_retado_id then
        raise exception 'Un club no puede desafiarse a sí mismo'
            using errcode = 'check_violation';
    end if;

    if exists (
        select 1 from public.club_members m
        where m.user_id = new.creado_por
          and m.club_id = new.club_retado_id
    ) then
        raise exception 'No puedes desafiar a un club al que perteneces'
            using errcode = 'check_violation';
    end if;

    return new;
end;
$$;

drop trigger if exists trg_club_challenges_valida_rival on public.club_challenges;
create trigger trg_club_challenges_valida_rival
    before insert on public.club_challenges
    for each row execute function public.club_challenges_valida_rival();
