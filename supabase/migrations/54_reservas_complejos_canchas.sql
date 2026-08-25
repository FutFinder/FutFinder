-- =============================================================
-- FutFinder migration 54: vertical de Reservas — complejos, canchas
-- reservables, reglas de horario y disponibilidad
-- =============================================================
-- Fundaciones del vertical de reserva de canchas. No existía ninguna
-- tabla de esto en el repositorio: `canchas` (deployed, no versionada)
-- es un registro de autocompletado de texto libre que llena
-- `tg_register_cancha` cuando alguien escribe el nombre de una cancha al
-- crear un partido normal — no tiene precio, horario ni relación con
-- reservar de verdad. Por eso la tabla de canchas RESERVABLES de este
-- vertical se llama `canchas_reservables`, no `canchas`: mismo nombre
-- hubiera chocado con esa tabla ya real y en uso.
--
-- `tipo` de cancha es un enum propio, no `clubs.modalidad`
-- (`utils/clubMeta.js` → `MODALIDADES`/`esModalidadValida`): ese describe
-- el estilo de UN CLUB (futbol7/futbol11/ambos, sin guion bajo, sin
-- fútbol 5, sin CHECK en la base), no la construcción de una cancha
-- física — y una cancha real no puede ser "ambos" a la vez como sí puede
-- serlo un club. Son conceptos distintos; no se fusionan.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. TABLA: complejos ──────────────────────────────────────────
create table if not exists public.complejos (
    id uuid primary key default gen_random_uuid(),
    nombre text not null,
    descripcion text,
    direccion text,
    region text,
    comuna text not null,
    latitud numeric(10, 7) not null check (latitud between -90 and 90),
    longitud numeric(10, 7) not null check (longitud between -180 and 180),
    foto_url text,
    verificado_futfinder boolean not null default false,
    rating_avg numeric(3, 2),
    rating_count integer not null default 0,
    created_by uuid references public.profiles(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_complejos_comuna on public.complejos(comuna);
create index if not exists idx_complejos_region on public.complejos(region);
-- Sin PostGIS: igual que `matches`/`haversine_meters`, la cercanía se
-- calcula en la app o en una función propia sobre estas dos columnas.
create index if not exists idx_complejos_lat_lng on public.complejos(latitud, longitud);

alter table public.complejos enable row level security;

-- Lectura pública (descubrimiento). Sin policies de insert/update/delete
-- a propósito: por ahora solo `service_role` carga complejos, desde el
-- SQL Editor o el dashboard — no hay todavía un rol de admin de recinto.
drop policy if exists "complejos_select" on public.complejos;
create policy "complejos_select"
    on public.complejos for select
    using (true);

-- ── 2. TABLA: canchas_reservables ────────────────────────────────
create table if not exists public.canchas_reservables (
    id uuid primary key default gen_random_uuid(),
    complejo_id uuid not null references public.complejos(id) on delete cascade,
    nombre text not null,
    tipo text not null check (tipo in ('futbol_5', 'futbol_7', 'futbol_11')),
    precio_hora integer not null check (precio_hora >= 0),
    duracion_slot_min integer not null default 60 check (duracion_slot_min > 0),
    activa boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_canchas_reservables_complejo on public.canchas_reservables(complejo_id);

alter table public.canchas_reservables enable row level security;

drop policy if exists "canchas_reservables_select" on public.canchas_reservables;
create policy "canchas_reservables_select"
    on public.canchas_reservables for select
    using (true);

-- ── 3. TABLA: cancha_horario_reglas ──────────────────────────────
-- Plantilla recurrente (día de semana + rango horario), NO filas por
-- día: la disponibilidad de un slot concreto se calcula cruzando esta
-- regla con `reservas` en `get_disponibilidad_cancha()` más abajo.
create table if not exists public.cancha_horario_reglas (
    id uuid primary key default gen_random_uuid(),
    cancha_id uuid not null references public.canchas_reservables(id) on delete cascade,
    dia_semana integer not null check (dia_semana between 0 and 6), -- 0 = domingo, igual que extract(dow from ...)
    hora_apertura time not null,
    hora_cierre time not null,

    constraint cancha_horario_reglas_rango check (hora_cierre > hora_apertura)
);

create index if not exists idx_cancha_horario_reglas_cancha on public.cancha_horario_reglas(cancha_id);

alter table public.cancha_horario_reglas enable row level security;

drop policy if exists "cancha_horario_reglas_select" on public.cancha_horario_reglas;
create policy "cancha_horario_reglas_select"
    on public.cancha_horario_reglas for select
    using (true);

-- ── 4. NOTIFICACIONES: nuevos tipos del vertical de Reservas ─────
-- Mismo patrón que la migración 16: se reescribe el CHECK completo con
-- la lista acumulada. Reutiliza `public.notifications` (user_id, type,
-- title, body, data jsonb) que ya existe — no se crea una tabla aparte.
-- `reserva_cancelacion_solicitada` y `reserva_invitacion_rechazada` se
-- agregan además de los tipos pedidos: sin la primera, el club que no
-- pidió la cancelación no tiene cómo enterarse de que hay algo que
-- responder; sin la segunda, el organizador no se entera cuando un
-- capitán o jugador convocado rechaza (ver migración 55).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
    check (type in (
        -- tipos previos (hasta la migración 48)
        'match_join', 'friend_request', 'friend_accept', 'message_new',
        'match_reminder', 'match_rate', 'join_request', 'join_approved',
        'join_rejected', 'match_cancelled', 'match_updated', 'match_slot_free',
        'waitlist_turn', 'match_left', 'match_attendance',
        'club_request', 'club_request_accepted', 'club_request_rejected',
        'club_member_joined', 'club_member_left', 'club_invite_accepted',
        'club_challenge', 'club_challenge_accepted', 'club_challenge_rejected',
        'chat_mention_all',
        'club_challenge_extension', 'club_challenge_closed',
        'club_challenge_proposal', 'club_challenge_proposal_rejected',
        'club_match_published', 'club_match_reserva_omitida',
        'club_match_change', 'club_match_change_responded',
        'club_match_cancelled', 'club_sancionado', 'club_revision_resuelta',
        'club_resultado_propuesto', 'club_resultado_confirmado', 'club_resultado_disputado',
        -- tipos nuevos del vertical de Reservas (migraciones 54-57)
        'reserva_confirmada', 'reserva_cancelada',
        'reserva_invitacion_capitan', 'reserva_invitacion_jugador',
        'reserva_invitacion_rechazada',
        'reserva_cuota_recalculada', 'reserva_saldo_insuficiente',
        'reserva_cancelacion_solicitada', 'balance_cargado'
    ));

-- ── 5. RPC: get_disponibilidad_cancha ────────────────────────────
-- SECURITY DEFINER a propósito: tiene que ver TODAS las reservas
-- 'confirmada' de esa cancha/fecha para decir bien qué slot está libre,
-- sin que la RLS de `reservas` (solo organizador/participantes,
-- migración 55) se lo oculte. Nunca devuelve de quién es cada reserva,
-- solo `disponible: true/false` por slot — mismo criterio que
-- `count_reports_against`.
--
-- Esta función referencia `public.reservas`, que recién se crea en la
-- migración 55 (posterior). Es seguro: PL/pgSQL no valida contra el
-- catálogo al CREAR la función, solo al EJECUTARLA — y para entonces
-- las migraciones 54-57 ya se aplicaron todas, en orden. No cambiar el
-- orden de estos cuatro archivos.
create or replace function public.get_disponibilidad_cancha(
    p_cancha_id uuid,
    p_fecha date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha public.canchas_reservables;
    v_dow integer;
    v_slot_min integer;
    v_slots json;
begin
    select * into v_cancha from public.canchas_reservables where id = p_cancha_id;
    if v_cancha is null then
        return json_build_object('ok', false, 'reason', 'Cancha no existe');
    end if;
    if not v_cancha.activa then
        return json_build_object('ok', false, 'reason', 'Cancha no disponible');
    end if;

    v_dow := extract(dow from p_fecha)::integer;
    v_slot_min := v_cancha.duracion_slot_min;

    select coalesce(json_agg(json_build_object(
               'hora_inicio', to_char(s.hora_inicio, 'HH24:MI'),
               'hora_fin', to_char(s.hora_inicio + (v_slot_min || ' minutes')::interval, 'HH24:MI'),
               -- Solo 'confirmada' bloquea el slot: 'procesando' es el
               -- estado inicial de toda reserva 'completa' apenas se
               -- crea, ANTES de que nadie pague un peso. Bloquearlo acá
               -- contradecía la regla de negocio — mientras se arma el
               -- grupo (o se procesa el pago, para 'completa'), el
               -- horario sigue disponible para otros hasta que alguien
               -- de verdad confirma. `crear_reserva` ya lo hacía bien;
               -- esta era la única función con el criterio equivocado.
               'disponible', not exists (
                   select 1 from public.reservas r
                    where r.cancha_id = p_cancha_id
                      and r.fecha = p_fecha
                      and r.hora_inicio = s.hora_inicio
                      and r.estado = 'confirmada'
               )
           ) order by s.hora_inicio), '[]'::json)
      into v_slots
      from (
          select generate_series(
                     (p_fecha + r.hora_apertura)::timestamp,
                     (p_fecha + r.hora_cierre)::timestamp - (v_slot_min || ' minutes')::interval,
                     (v_slot_min || ' minutes')::interval
                 )::time as hora_inicio
            from public.cancha_horario_reglas r
           where r.cancha_id = p_cancha_id
             and r.dia_semana = v_dow
      ) s;

    return json_build_object('ok', true, 'slots', v_slots);
end;
$$;

revoke all on function public.get_disponibilidad_cancha(uuid, date) from public;
grant execute on function public.get_disponibilidad_cancha(uuid, date) to authenticated, anon;
