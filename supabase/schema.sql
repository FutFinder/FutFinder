-- =============================================================
-- FutFinder · Schema completo Supabase (Fase 2 — Beta Santiago)
-- =============================================================
-- Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
-- Es idempotente: puedes correrlo más de una vez sin que se rompa.
-- =============================================================

-- 1. EXTENSIONS -------------------------------------------------
create extension if not exists "uuid-ossp";

-- 2. TABLE: profiles -------------------------------------------
-- 1:1 con auth.users (id mismo). Se crea automáticamente con trigger.
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text unique,
    foto_url text,
    posicion_preferida text check (
        posicion_preferida in (
            'arquero','defensa','medio','delantero','lateral','volante','sin_definir'
        )
    ) default 'sin_definir',
    trust_score integer not null default 100 check (trust_score >= 0 and trust_score <= 100),
    partidos_jugados integer not null default 0,
    asistencias_confirmadas integer not null default 0,
    comuna text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_username on public.profiles(username);

-- 3. TABLE: matches --------------------------------------------
-- Foco geográfico: Santiago de Chile
create table if not exists public.matches (
    id uuid primary key default uuid_generate_v4(),
    id_organizador uuid not null references public.profiles(id) on delete cascade,
    titulo text not null,
    comuna text not null,
    cancha_nombre text not null,
    -- Ubicación GPS desglosada (más simple que PostGIS para empezar)
    latitud numeric(10, 7) not null check (latitud between -90 and 90),
    longitud numeric(10, 7) not null check (longitud between -180 and 180),
    hora timestamptz not null,
    cupos_totales integer not null check (cupos_totales > 0 and cupos_totales <= 30),
    cupos_disponibles integer not null check (cupos_disponibles >= 0),
    precio_cuota integer not null default 0 check (precio_cuota >= 0),
    nivel text check (nivel in ('recreativo','intermedio','competitivo')) default 'recreativo',
    descripcion text,
    estado text not null default 'abierto'
        check (estado in ('abierto','lleno','en_curso','finalizado','cancelado')),
    created_at timestamptz not null default now()
);

create index if not exists idx_matches_comuna on public.matches(comuna);
create index if not exists idx_matches_hora on public.matches(hora);
create index if not exists idx_matches_estado on public.matches(estado);
create index if not exists idx_matches_organizador on public.matches(id_organizador);

-- 4. TABLE: attendees ------------------------------------------
create table if not exists public.attendees (
    id uuid primary key default uuid_generate_v4(),
    id_partido uuid not null references public.matches(id) on delete cascade,
    id_jugador uuid not null references public.profiles(id) on delete cascade,
    estado text not null default 'inscrito'
        check (estado in ('inscrito','confirmado_gps','no_asistio','cancelado')),
    inscrito_at timestamptz not null default now(),
    confirmado_at timestamptz,
    distancia_metros numeric(10,2),
    unique (id_partido, id_jugador)
);

create index if not exists idx_attendees_partido on public.attendees(id_partido);
create index if not exists idx_attendees_jugador on public.attendees(id_jugador);

-- 5. TRIGGER: crear profile cuando se registra un nuevo user ---
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, username, comuna)
    values (
        new.id,
        coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
        coalesce(new.raw_user_meta_data->>'comuna', null)
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 6. FUNCTION: distancia haversine (metros) --------------------
create or replace function public.haversine_meters(
    lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric
)
returns numeric
language plpgsql
immutable
as $$
declare
    r constant numeric := 6371000; -- radio de la Tierra en metros
    dlat numeric;
    dlon numeric;
    a numeric;
    c numeric;
begin
    dlat := radians(lat2 - lat1);
    dlon := radians(lon2 - lon1);
    a := sin(dlat/2) * sin(dlat/2)
       + cos(radians(lat1)) * cos(radians(lat2))
       * sin(dlon/2) * sin(dlon/2);
    c := 2 * atan2(sqrt(a), sqrt(1-a));
    return r * c;
end;
$$;

-- 7. FUNCTION: confirmar asistencia con GPS --------------------
-- Lógica de Trust Score:
--   - Si jugador está a <= 200m de la cancha y dentro de la ventana
--     [hora-30min, hora+90min] → marcamos 'confirmado_gps' y +1 al trust_score
--   - Si llega tarde (>90min después) o muy lejos → no se confirma
create or replace function public.confirm_attendance_gps(
    p_match_id uuid,
    p_user_lat numeric,
    p_user_lng numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_match record;
    v_attendance record;
    v_distance numeric;
    v_within_window boolean;
    v_user_id uuid := auth.uid();
begin
    if v_user_id is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id;
    if v_match is null then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;

    select * into v_attendance
    from public.attendees
    where id_partido = p_match_id and id_jugador = v_user_id;

    if v_attendance is null then
        return json_build_object('ok', false, 'reason', 'No estás inscrito en este partido');
    end if;

    if v_attendance.estado = 'confirmado_gps' then
        return json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    end if;

    v_distance := public.haversine_meters(
        v_match.latitud, v_match.longitud, p_user_lat, p_user_lng
    );

    v_within_window := now() between (v_match.hora - interval '30 minutes')
                                 and (v_match.hora + interval '90 minutes');

    if v_distance > 200 then
        return json_build_object(
            'ok', false,
            'reason', 'Estás demasiado lejos de la cancha',
            'distance', v_distance
        );
    end if;

    if not v_within_window then
        return json_build_object(
            'ok', false,
            'reason', 'Fuera de la ventana de confirmación (30 min antes / 90 min después)',
            'distance', v_distance
        );
    end if;

    update public.attendees
    set estado = 'confirmado_gps',
        confirmado_at = now(),
        distancia_metros = v_distance
    where id = v_attendance.id;

    update public.profiles
    set trust_score = least(trust_score + 1, 100),
        asistencias_confirmadas = asistencias_confirmadas + 1
    where id = v_user_id;

    return json_build_object(
        'ok', true,
        'distance', v_distance,
        'reason', 'Asistencia confirmada por GPS'
    );
end;
$$;

-- 8. FUNCTION: unirse a un partido (decrementa cupo atomically) ----
-- Idempotente: si el jugador ya estaba inscrito, NO descuenta otro cupo.
create or replace function public.join_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    v_match record;
    v_inserted_id uuid;
begin
    if v_user_id is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if v_match is null then
        return json_build_object('ok', false, 'reason', 'Partido no existe');
    end if;
    if v_match.cupos_disponibles <= 0 then
        return json_build_object('ok', false, 'reason', 'Partido lleno');
    end if;
    if v_match.estado <> 'abierto' then
        return json_build_object('ok', false, 'reason', 'Partido no está abierto');
    end if;

    -- Solo insertamos si NO estaba ya inscrito.
    insert into public.attendees(id_partido, id_jugador)
    values (p_match_id, v_user_id)
    on conflict (id_partido, id_jugador) do nothing
    returning id into v_inserted_id;

    -- Si v_inserted_id es null, ya estaba inscrito → no descontamos cupo
    if v_inserted_id is null then
        return json_build_object('ok', true, 'already', true,
                                 'reason', 'Ya estabas inscrito en este partido');
    end if;

    update public.matches
    set cupos_disponibles = cupos_disponibles - 1,
        estado = case when cupos_disponibles - 1 = 0 then 'lleno' else estado end
    where id = p_match_id;

    return json_build_object('ok', true);
end;
$$;

-- 9. ROW LEVEL SECURITY ----------------------------------------
alter table public.profiles  enable row level security;
alter table public.matches   enable row level security;
alter table public.attendees enable row level security;

-- profiles: cualquiera ve, sólo el dueño actualiza
drop policy if exists "profiles_read_all"     on public.profiles;
drop policy if exists "profiles_update_self"  on public.profiles;
create policy "profiles_read_all"
    on public.profiles for select using (true);
create policy "profiles_update_self"
    on public.profiles for update using (auth.uid() = id);

-- matches: lectura pública, sólo authed crea, sólo organizador edita/borra
drop policy if exists "matches_read_all"     on public.matches;
drop policy if exists "matches_create_auth"  on public.matches;
drop policy if exists "matches_update_owner" on public.matches;
drop policy if exists "matches_delete_owner" on public.matches;
create policy "matches_read_all"
    on public.matches for select using (true);
create policy "matches_create_auth"
    on public.matches for insert
    with check (auth.uid() = id_organizador);
create policy "matches_update_owner"
    on public.matches for update using (auth.uid() = id_organizador);
create policy "matches_delete_owner"
    on public.matches for delete using (auth.uid() = id_organizador);

-- attendees: lectura pública, sólo se inserta a sí mismo, sólo edita los suyos
drop policy if exists "attendees_read_all"   on public.attendees;
drop policy if exists "attendees_insert_self" on public.attendees;
drop policy if exists "attendees_update_self" on public.attendees;
drop policy if exists "attendees_delete_self" on public.attendees;
create policy "attendees_read_all"
    on public.attendees for select using (true);
create policy "attendees_insert_self"
    on public.attendees for insert with check (auth.uid() = id_jugador);
create policy "attendees_update_self"
    on public.attendees for update using (auth.uid() = id_jugador);
create policy "attendees_delete_self"
    on public.attendees for delete using (auth.uid() = id_jugador);

-- 10. SEED DEMO (opcional, comuna Providencia / Ñuñoa) ----------
-- Borra estas líneas si no quieres datos de prueba.
-- Se necesita un profile real (creado al registrarse alguien) para inserts.
-- Las dejamos comentadas; tú las descomentas cuando tengas un user_id real.
--
-- insert into public.matches
--   (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
--    hora, cupos_totales, cupos_disponibles, precio_cuota, nivel)
-- values
--   ('TU-USER-ID-AQUÍ', 'Pichanga Providencia', 'Providencia',
--    'Complejo Manquehue', -33.4172, -70.6068,
--    now() + interval '1 day', 10, 4, 4500, 'intermedio');
