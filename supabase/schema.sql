-- =============================================================
-- FutFinder · Schema completo Supabase (Fase 2 — Beta Santiago)
-- =============================================================
-- Pega TODO este archivo en Supabase → SQL Editor → New query → Run.
-- Es idempotente: puedes correrlo más de una vez sin que se rompa.
-- =============================================================

-- 1. EXTENSIONS -------------------------------------------------
-- `with schema extensions` NO es decorativo. Sin él la extensión cae en el
-- primer esquema del `search_path`, que para `postgres` es `public`, y ahí
-- nace con sus funciones ejecutables por `anon` —supautils las instala como
-- `supabase_admin`, así que ni siquiera se pueden revocar después—. En
-- producción ya vive en `extensions`; esto es para que una base nueva nazca
-- igual. Ver la migración 116.
create extension if not exists "uuid-ossp" with schema extensions;

-- `pg_net` y `pg_cron`. **Nadie en el repositorio las creaba**, y el
-- repositorio las usa: la migración 38 escribe `net.http_response_result` y
-- la 146 llama `cron.schedule`. En producción están desde que Supabase las
-- instaló a mano, así que la falta no se notó nunca — salió al construir la
-- primera base vacía desde este repositorio, el 2026-10-14, con
-- `schema "net" does not exist` en la migración 38.
--
-- Van donde están en producción, que no es el mismo sitio para las dos:
-- `pg_net` en `extensions` (y expone su esquema `net`), `pg_cron` donde
-- Supabase la pone. Copiar el esquema importa: ver la migración 116 y la
-- nota de memoria sobre por qué una extensión en `public` queda ejecutable
-- por `anon` y ya no se puede revocar.
create extension if not exists pg_net  with schema extensions;
create extension if not exists pg_cron;

-- 2. TABLE: profiles -------------------------------------------
-- 1:1 con auth.users (id mismo). Se crea automáticamente con trigger.
create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text,
    foto_url text,
    posicion_preferida text[] not null default array['sin_definir'] check (
        posicion_preferida <@ array['arquero','defensa','medio','delantero','lateral','volante','sin_definir']
        and array_length(posicion_preferida, 1) >= 1
    ),
    flanco text check (flanco is null or flanco in ('derecho','izquierdo','ambos')),
    edad integer check (edad is null or (edad >= 12 and edad <= 99)),
    bio text,
    mvps integer not null default 0,
    trust_score integer not null default 100 check (trust_score >= 0 and trust_score <= 100),
    partidos_jugados integer not null default 0,
    asistencias_confirmadas integer not null default 0,
    region text,
    comuna text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Unique case-insensitive: "Carlos" y "carlos" cuentan como el mismo
create unique index if not exists profiles_username_ci_idx
    on public.profiles (lower(username))
    where username is not null;

-- 3. TABLE: matches --------------------------------------------
-- Foco geográfico: Santiago de Chile
create table if not exists public.matches (
    id uuid primary key default uuid_generate_v4(),
    id_organizador uuid not null references public.profiles(id) on delete cascade,
    titulo text not null,
    region text,
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
    -- Duración del partido en minutos (define la ventana de confirmación GPS, ver migración 09)
    duracion_min integer default 90,
    -- 'inmediata' = cualquiera entra; 'manual' = el organizador aprueba cada inscripción
    aprobacion text default 'inmediata'
        check (aprobacion in ('inmediata','manual')),
    -- Trust score mínimo exigido para inscribirse (0 = sin requisito)
    min_trust_score integer default 0,
    created_at timestamptz not null default now()
);

create index if not exists idx_matches_region on public.matches(region);
create index if not exists idx_matches_comuna on public.matches(comuna);
create index if not exists idx_matches_hora on public.matches(hora);
create index if not exists idx_matches_estado on public.matches(estado);
create index if not exists idx_matches_organizador on public.matches(id_organizador);

-- Tres columnas de `matches` que NO las crea nadie, ni acá ni en ninguna
-- migración, y que producción sí tiene. Mismo caso que las cuatro tablas de
-- más abajo: existen desde antes del historial versionado. La migración 146
-- cazó las dos de `profiles` y estas tres se le pasaron.
--
--   · `direccion`               la escribe la publicación de un partido y la
--                               lee la migración 44b, que es donde reventó
--                               la construcción en frío del 2026-10-14.
--   · `reminder_sent_at`        el recordatorio de una hora antes.
--   · `rating_reminder_sent_at` el recordatorio de calificar.
--
-- Van como `alter … add column if not exists` y no dentro del `create table`
-- de arriba a propósito: el `create` es `if not exists`, así que sobre una
-- base que ya tiene `matches` no se evaluaría nunca. Es el mismo motivo por
-- el que la 146 puso así las dos columnas de `profiles`.
alter table public.matches add column if not exists direccion text;
alter table public.matches add column if not exists reminder_sent_at timestamptz;
alter table public.matches add column if not exists rating_reminder_sent_at timestamptz;

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
    v_window_end timestamptz;
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

    -- Fin de ventana = fin real del partido + 30 min de gracia.
    v_window_end := v_match.hora
        + (coalesce(v_match.duracion_min, 90) || ' minutes')::interval
        + interval '30 minutes';
    v_within_window := now() between (v_match.hora - interval '30 minutes')
                                 and v_window_end;

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
            'reason', 'Fuera de la ventana de confirmación (30 min antes / hasta 30 min después de terminar)',
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


-- 11. LAS FUNCIONES DEL CIMIENTO --------------------------------
--
-- Mismo caso que las tablas de más abajo, y con el mismo descubrimiento: la
-- migración 146 las transcribió de producción, pero corre en la posición
-- 146 y la **88** ya llama a `search_canchas`. Construir desde cero fallaba
-- ahí con `function public.search_canchas(text, integer) does not exist`.
--
-- Se copian acá las secciones 2 y 6 de la 146. Lo que NO se copia son sus
-- disparadores (sección 7): **dependen de funciones que crean otras
-- migraciones** —`tg_register_cancha` entre ellas— así que no pueden ir
-- antes que ellas y se quedan donde están. La 146 no se toca: con todo en
-- `if not exists`, cuando le llega su turno ya no hace nada.

-- ── 2. create_notification ───────────────────────────────────────
-- Antes de las funciones que notifican. El cuerpo inserta en
-- `notifications`, que se crea más abajo: plpgsql no valida el cuerpo al
-- crear la función, así que el orden entre estas dos no importa.
do $$
begin
  if to_regprocedure('public.create_notification(uuid,text,text,text,jsonb)') is null then
    execute $fn$
      create function public.create_notification(
        p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
      returns void language plpgsql security definer set search_path to 'public'
      as $body$
      begin
        if p_user_id is null then
          return;
        end if;
        insert into public.notifications(user_id, type, title, body, data)
        values (p_user_id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb));
      end;
      $body$;
    $fn$;
  end if;
end $$;

-- ── 6. Las funciones que faltaban ────────────────────────────────
do $$
begin
  if to_regprocedure('public.search_canchas(text,integer)') is null then
    execute $fn$
      create function public.search_canchas(p_query text, p_limit integer default 5)
      returns table (id uuid, nombre text, direccion text, comuna text, region text,
                     latitud double precision, longitud double precision, usos_count integer)
      language plpgsql stable set search_path to 'public'
      as $body$
      declare
        v_q text := public.norm_text(coalesce(p_query, ''));
      begin
        if v_q = '' or length(v_q) < 2 then return; end if;
        return query
          select c.id, c.nombre, c.direccion, c.comuna, c.region,
                 c.latitud, c.longitud, c.usos_count
          from public.canchas c
          where c.nombre_norm like '%' || v_q || '%'
             or coalesce(c.direccion,'') ilike '%' || p_query || '%'
          order by c.usos_count desc, c.updated_at desc
          limit p_limit;
      end
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.recalc_user_ratings(uuid)') is null then
    execute $fn$
      create function public.recalc_user_ratings(p_user_id uuid)
      returns void language plpgsql security definer set search_path to 'public'
      as $body$
      begin
        update public.profiles p
           set rating_puntualidad_avg = coalesce(s.avg_p, 0),
               rating_fairplay_avg    = coalesce(s.avg_f, 0),
               rating_nivel_avg       = coalesce(s.avg_n, 0),
               rating_count           = coalesce(s.cnt, 0)
          from (
            select round(avg(puntualidad)::numeric, 2) as avg_p,
                   round(avg(fairplay)::numeric,    2) as avg_f,
                   round(avg(nivel)::numeric,       2) as avg_n,
                   count(*)                            as cnt
            from public.ratings
            where rated_id = p_user_id
          ) s
         where p.id = p_user_id;
      end;
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.tg_ratings_recalc()') is null then
    execute $fn$
      create function public.tg_ratings_recalc()
      returns trigger language plpgsql security definer set search_path to 'public'
      as $body$
      begin
        if tg_op = 'DELETE' then
          perform public.recalc_user_ratings(old.rated_id);
          return old;
        else
          perform public.recalc_user_ratings(new.rated_id);
          if tg_op = 'UPDATE' and old.rated_id <> new.rated_id then
            perform public.recalc_user_ratings(old.rated_id);
          end if;
          return new;
        end if;
      end;
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.tg_match_future_only()') is null then
    execute $fn$
      create function public.tg_match_future_only()
      returns trigger language plpgsql set search_path to 'public'
      as $body$
      begin
        if new.hora <= now() then
          raise exception 'La fecha y hora del partido ya pasaron';
        end if;
        return new;
      end
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.tg_notify_friend_request()') is null then
    execute $fn$
      create function public.tg_notify_friend_request()
      returns trigger language plpgsql security definer set search_path to 'public'
      as $body$
      declare
        v_username text;
      begin
        if new.status <> 'pending' then
          return new;
        end if;
        select username into v_username from public.profiles where id = new.requester_id;
        perform public.create_notification(
          new.addressee_id,
          'friend_request',
          'Nueva solicitud de amistad',
          coalesce(v_username, 'Alguien') || ' quiere ser tu amigo',
          jsonb_build_object('friendshipId', new.id, 'fromUserId', new.requester_id)
        );
        return new;
      end;
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.tg_notify_friend_accept()') is null then
    execute $fn$
      create function public.tg_notify_friend_accept()
      returns trigger language plpgsql security definer set search_path to 'public'
      as $body$
      declare
        v_username text;
      begin
        if new.status <> 'accepted' or old.status = 'accepted' then
          return new;
        end if;
        select username into v_username from public.profiles where id = new.addressee_id;
        perform public.create_notification(
          new.requester_id,
          'friend_accept',
          'Solicitud aceptada',
          coalesce(v_username, 'Tu amigo') || ' aceptó tu solicitud',
          jsonb_build_object('friendshipId', new.id, 'fromUserId', new.addressee_id)
        );
        return new;
      end;
      $body$;
    $fn$;
  end if;
end $$;

-- `tg_auto_suspend`, en su forma ANTERIOR a TrueScore.
--
-- Es el último hueco que encontró la construcción en frío: la migración 88
-- le fija el `search_path` y la función se versionó recién en la **134**,
-- cuarenta y seis migraciones después. En producción existía desde antes,
-- sin versionar, y la 146 no la transcribió justamente porque para entonces
-- la 134 ya la había creado.
--
-- No se copia la versión de la 134 porque esa consulta `flag_activo()`, que
-- también crea la 134: sería arrastrar la cascada entera. Lo que va acá es
-- la conducta ORIGINAL, que está dentro de esa misma función de la 134 — su
-- rama `else`, la que corre cuando el flag de TrueScore está apagado. La
-- 134 la reemplaza con `create or replace` cuando le toca.
create or replace function public.tg_auto_suspend()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.trust_score <= 0 and coalesce(old.trust_score, 100) > 0 then
    new.estado := 'suspendido';
    new.suspended_until := now() + interval '7 days';
    new.trust_score := 0;
  end if;
  return new;
end $$;

-- 12. LAS CUATRO TABLAS DEL CIMIENTO ----------------------------
--
-- POR QUÉ ESTÁN ACÁ Y NO EN UNA MIGRACIÓN, y vale la pena contarlo porque
-- costó un arranque en frío.
--
-- `canchas`, `notifications`, `push_tokens` y `ratings` existían en
-- producción desde antes del historial versionado. La migración **146** las
-- transcribió al repositorio y lo demostró con una huella md5 del catálogo
-- idéntica antes y después de aplicarla. Esa prueba era buena **para
-- producción**, donde las tablas ya estaban, y no decía nada sobre una base
-- nueva: la 146 corre en la posición 146, y
--
--     `notifications` la usa la migración  16
--     `canchas`       la usa la migración 101
--     `ratings`       la usa la migración 124
--
-- O sea: construir desde cero fallaba en la **16**, con
-- `relation "public.notifications" does not exist`, ciento treinta
-- migraciones antes de que nada las creara. Se descubrió el 2026-10-14
-- levantando por primera vez una base vacía desde este repositorio.
--
-- Están copiadas tal cual de la 146, que las transcribió de producción. La
-- 146 **no se toca** —está aplicada— y como todo lo suyo va con
-- `if not exists`, sobre una base nueva se vuelve inofensiva: llega y ya
-- está todo puesto.

-- `create table if not exists` lleva dentro sus restricciones, así que
-- contra producción no se evalúa ninguna y contra una base vacía quedan
-- todas puestas de una vez.

-- `norm_text` va primero: `canchas.nombre_norm` es una columna GENERADA a
-- partir de ella, así que la función tiene que existir antes que la tabla.
-- Copiada de la migración 146.
do $$
begin
  if to_regprocedure('public.norm_text(text)') is null then
    execute $fn$
      create function public.norm_text(s text)
      returns text language sql immutable set search_path to 'public'
      as $body$
        select lower(translate(coalesce(s,''), 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuaeiouunn'))
      $body$;
    $fn$;
  end if;
end $$;

create table if not exists public.canchas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  -- GENERADA, no un `default`. La migración 146 la transcribió como
  -- `default public.norm_text(nombre)` y eso Postgres no lo acepta —«cannot
  -- use column reference in DEFAULT expression»—. En producción nunca se
  -- notó porque la tabla ya existía y el `create table if not exists` jamás
  -- se evaluó; la huella md5 de la 146 demostraba que no cambiaba nada, no
  -- que la transcripción fuera correcta. Salió al construir la primera base
  -- vacía, el 2026-10-14. Esto es lo que de verdad hay en producción
  -- (`attgenerated = 's'`).
  nombre_norm text generated always as (public.norm_text(nombre)) stored,
  direccion   text,
  comuna      text,
  region      text,
  latitud     double precision,
  longitud    double precision,
  usos_count  integer not null default 1,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint canchas_nombre_norm_comuna_key unique (nombre_norm, comuna)
);
create index if not exists canchas_comuna_idx on public.canchas using btree (comuna);
create index if not exists canchas_norm_idx   on public.canchas using btree (nombre_norm);

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null,
  title           text not null,
  body            text,
  data            jsonb default '{}'::jsonb,
  read            boolean not null default false,
  created_at      timestamptz not null default now(),
  push_status     text not null default 'pending',
  push_claimed_at timestamptz,
  constraint notifications_push_status_check check (push_status in
    ('pending','sending','sent','skipped_preference','skipped_no_token','failed'))
);
create index if not exists notifications_user_idx
  on public.notifications using btree (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications using btree (user_id) where (read = false);

-- `notifications_type_check` NO va acá. Es la lista de los 53 tipos de
-- aviso y la han ampliado catorce migraciones posteriores; copiarla
-- fijaría una versión vieja y la próxima migración que agregue un tipo
-- chocaría. En una base nueva la restricción la pone la migración que
-- corresponda. La guarda real de que ningún tipo se quede sin categoría
-- es `src/utils/__tests__/avisosCompletos.test.js`.

create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null,
  platform    text,
  device_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint push_tokens_platform_check check (platform in ('ios','android','web')),
  constraint push_tokens_user_id_token_key unique (user_id, token)
);
create index if not exists push_tokens_user_idx on public.push_tokens using btree (user_id);

create table if not exists public.ratings (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  rater_id    uuid not null references auth.users(id) on delete cascade,
  rated_id    uuid not null references auth.users(id) on delete cascade,
  puntualidad smallint not null,
  fairplay    smallint not null,
  nivel       smallint not null,
  comentario  text,
  created_at  timestamptz not null default now(),
  constraint ratings_check             check (rater_id <> rated_id),
  constraint ratings_puntualidad_check check (puntualidad >= 1 and puntualidad <= 5),
  constraint ratings_fairplay_check    check (fairplay >= 1 and fairplay <= 5),
  constraint ratings_nivel_check       check (nivel >= 1 and nivel <= 5),
  constraint ratings_match_id_rater_id_rated_id_key unique (match_id, rater_id, rated_id)
);
create index if not exists ratings_match_idx on public.ratings using btree (match_id);
create index if not exists ratings_rated_idx on public.ratings using btree (rated_id);

alter table public.canchas       enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens   enable row level security;
alter table public.ratings       enable row level security;


-- 13. LAS DOS COLUMNAS DE ESTADO DE CUENTA -----------------------
-- Mismo caso: las lee `tg_auto_suspend`, `reactivate_suspended` y la
-- tarjeta de estado de cuenta, y las creaba la 146. Sin ellas una base
-- nueva no arranca el perfil.

-- Las lee `tg_auto_suspend`, `reactivate_suspended` y toda la tarjeta de
-- estado de cuenta. Sin ellas, una base nueva no arranca el perfil.
-- Las cuatro medias de valoración. **Tampoco las crea nadie**, y producción
-- sí las tiene: las escribe `recalc_user_ratings()` —que la migración 146 sí
-- transcribió— y las leen la búsqueda de jugadores (142), el perfil por
-- relación (143) y el panel de administradores (121).
--
-- Salieron al correr los 120 arneses contra la base recién construida, el
-- 2026-10-15: cuatro de ellos morían con `column p.rating_count does not
-- exist`. La comparación del día anterior no las vio porque contaba
-- OBJETOS —72 tablas, 285 funciones— y los objetos coincidían; lo que no
-- coincidía eran sus columnas. Contar no es comparar.
alter table public.profiles add column if not exists rating_puntualidad_avg numeric(3,2) default 0;
alter table public.profiles add column if not exists rating_fairplay_avg    numeric(3,2) default 0;
alter table public.profiles add column if not exists rating_nivel_avg       numeric(3,2) default 0;
alter table public.profiles add column if not exists rating_count           integer      default 0;

alter table public.profiles add column if not exists estado text not null default 'activo';
alter table public.profiles add column if not exists suspended_until timestamptz;
