-- =============================================================
-- FutFinder migration 60: cuentas de administrador de complejo y
-- bloqueos puntuales de cancha
-- =============================================================
-- Hasta acá el vertical de Reservas no tenía dueño del lado del recinto:
-- la migración 54 dejó `complejos`, `canchas_reservables` y
-- `cancha_horario_reglas` de lectura pública y SIN policies de escritura
-- a propósito, con la nota "por ahora solo `service_role` carga
-- complejos, desde el SQL Editor o el dashboard — no hay todavía un rol
-- de admin de recinto". Esta migración crea ese rol.
--
-- UNA SOLA PUERTA (mismo criterio que la migración 50): esta migración
-- NO agrega policies de INSERT/UPDATE/DELETE a `complejos`,
-- `canchas_reservables` ni `cancha_horario_reglas`. Todo lo que un
-- administrador escribe pasa por las RPC `admin_*` de más abajo, todas
-- `security definer` y todas validando `es_admin_complejo()` antes de
-- tocar una fila. Así la autorización vive en un solo lugar auditable en
-- vez de repartirse entre nueve policies.
--
-- EL PRIMER DUEÑO NO SE AUTOCREA, y es deliberado:
-- `admin_agregar_admin` exige que quien llama ya sea `dueño`, así que no
-- hay forma de nombrarse administrador a sí mismo desde la app. La
-- primera fila de `complejo_admins` la inserta `service_role` desde el
-- SQL Editor, igual que hoy se carga el propio complejo. Un flujo de
-- "solicitar administrar este recinto" es otro proyecto, con
-- verificación de identidad de por medio.
--
-- LOS BLOQUEOS TIENEN QUE BLOQUEAR: `cancha_bloqueos` sola no sirve de
-- nada, porque `get_disponibilidad_cancha` (migración 54) y
-- `crear_reserva` (migración 55) solo miran `reservas` con estado
-- 'confirmada'. Sin el cableado del final de este archivo, un
-- administrador marcaría mantención y el bloque seguiría apareciendo
-- libre Y reservable. Por eso las dos funciones se reemplazan acá para
-- consultar `slot_bloqueado()`, un único predicado de solape compartido:
-- duplicar la condición en las dos funciones es exactamente cómo se
-- desincronizan (una diría libre y la otra ocupado).
--
-- `cancha_bloqueos` NO es de lectura pública, a diferencia de las otras
-- tablas del vertical: `motivo` puede ser información privada del
-- recinto ("arriendo a la empresa tal") y `creado_por` es una persona.
-- Solo los administradores de ese complejo leen la tabla. El calendario
-- público se entera de un bloqueo únicamente a través de
-- `get_disponibilidad_cancha`, que es `security definer` y devuelve solo
-- `disponible: false`, sin decir si es por reserva ajena o por
-- mantención — mismo criterio que la migración 54 aplicó a `reservas`.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. TABLA: complejo_admins ────────────────────────────────────
create table if not exists public.complejo_admins (
    id uuid primary key default gen_random_uuid(),
    complejo_id uuid not null references public.complejos(id) on delete cascade,
    user_id uuid not null references public.profiles(id) on delete cascade,
    rol text not null default 'admin' check (rol in ('dueño', 'admin')),
    created_at timestamptz not null default now(),

    unique (complejo_id, user_id)
);

create index if not exists idx_complejo_admins_user on public.complejo_admins(user_id);
create index if not exists idx_complejo_admins_complejo on public.complejo_admins(complejo_id);

alter table public.complejo_admins enable row level security;

-- ── 2. TABLA: cancha_bloqueos ────────────────────────────────────
-- Bloqueos puntuales (mantención, arriendo externo, torneo cerrado).
-- Son de una FECHA concreta, no recurrentes: lo recurrente ya lo cubre
-- `cancha_horario_reglas`, que define cuándo la cancha abre.
create table if not exists public.cancha_bloqueos (
    id uuid primary key default gen_random_uuid(),
    cancha_id uuid not null references public.canchas_reservables(id) on delete cascade,
    fecha date not null,
    hora_inicio time not null,
    hora_fin time not null,
    motivo text check (motivo is null or length(motivo) <= 300),
    creado_por uuid references public.profiles(id),
    created_at timestamptz not null default now(),

    constraint cancha_bloqueos_rango check (hora_fin > hora_inicio)
);

create index if not exists idx_cancha_bloqueos_cancha_fecha on public.cancha_bloqueos(cancha_id, fecha);

alter table public.cancha_bloqueos enable row level security;

-- ── 3. HELPERS ───────────────────────────────────────────────────
-- `security definer` para no recursionar: la policy de
-- `complejo_admins` consulta `complejo_admins`, y sin definer eso
-- reentra en su propia RLS.
--
-- Un solo argumento a propósito. La versión de dos argumentos
-- (`p_user_id` arbitrario) permitía a cualquier autenticado sondear
-- quién administra qué complejo; acá el sujeto es siempre `auth.uid()`,
-- así que no hay nada que sondear.
create or replace function public.es_admin_complejo(p_complejo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from public.complejo_admins
         where complejo_id = p_complejo_id
           and user_id = auth.uid()
    );
$$;

revoke all on function public.es_admin_complejo(uuid) from public, anon;
grant execute on function public.es_admin_complejo(uuid) to authenticated;

create or replace function public.es_admin_cancha(p_cancha_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.canchas_reservables c
          join public.complejo_admins ca on ca.complejo_id = c.complejo_id
         where c.id = p_cancha_id
           and ca.user_id = auth.uid()
    );
$$;

revoke all on function public.es_admin_cancha(uuid) from public, anon;
grant execute on function public.es_admin_cancha(uuid) to authenticated;

-- Único predicado de solape, compartido por la disponibilidad y por
-- `crear_reserva`. Intervalo semiabierto: un bloqueo de 14:00 a 16:00
-- tapa los slots 14:00-15:00 y 15:00-16:00, y no toca el de 13:00-14:00.
--
-- El `case` de `v_fin` cubre el borde de la medianoche: en Postgres
-- `time '23:00' + interval '1 hour'` da '00:00', no '24:00', así que un
-- slot que cierra a medianoche llega acá con `hora_fin < hora_inicio` y
-- sin este ajuste ningún bloqueo lo taparía. Los bloqueos en sí no
-- pueden envolverse: `cancha_bloqueos_rango` lo impide.
create or replace function public.slot_bloqueado(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_hora_fin time
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
          from public.cancha_bloqueos b
         where b.cancha_id = p_cancha_id
           and b.fecha = p_fecha
           and p_hora_inicio < b.hora_fin
           and (case when p_hora_fin <= p_hora_inicio then time '24:00' else p_hora_fin end) > b.hora_inicio
    );
$$;

-- Nadie la llama directo: solo se usa dentro de funciones `security
-- definer`, que la ejecutan como su dueño y no necesitan este grant.
revoke all on function public.slot_bloqueado(uuid, date, time, time) from public, anon, authenticated;

-- ── 4. POLICIES (después de los helpers, que las policies invocan) ──
-- `to authenticated` a propósito y no `using (...)` a secas: si la
-- policy aplicara también a `anon`, una consulta de `anon` evaluaría
-- `es_admin_complejo()` y chocaría con un error de privilegio en vez de
-- devolver cero filas, que es lo correcto.
drop policy if exists "complejo_admins_select" on public.complejo_admins;
create policy "complejo_admins_select"
    on public.complejo_admins for select
    to authenticated
    using (
        user_id = auth.uid()
        or public.es_admin_complejo(complejo_id)
    );
-- Sin policies de escritura: `complejo_admins` se escribe solo vía
-- `admin_agregar_admin`/`admin_quitar_admin` (o `service_role`).

drop policy if exists "cancha_bloqueos_select" on public.cancha_bloqueos;
create policy "cancha_bloqueos_select"
    on public.cancha_bloqueos for select
    to authenticated
    using (public.es_admin_cancha(cancha_id));
-- Sin policies de escritura: solo vía `admin_crear_bloqueo` /
-- `admin_eliminar_bloqueo`.

-- ── 5. NOTIFICACIONES: nuevo tipo ────────────────────────────────
-- Mismo patrón que las migraciones 16 y 54: se reescribe el CHECK
-- completo con la lista acumulada. Sin este aviso, que te nombren
-- administrador de un recinto es invisible: no hay ninguna otra
-- pantalla donde te enterarías.
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
        -- tipos del vertical de Reservas (migraciones 54-57)
        'reserva_confirmada', 'reserva_cancelada',
        'reserva_invitacion_capitan', 'reserva_invitacion_jugador',
        'reserva_invitacion_rechazada',
        'reserva_cuota_recalculada', 'reserva_saldo_insuficiente',
        'reserva_cancelacion_solicitada', 'balance_cargado',
        -- tipo nuevo de administración de recinto (migración 60)
        'complejo_admin_agregado'
    ));

-- ── 6. RPC de administración ─────────────────────────────────────
-- Todas `security definer` (escriben en tablas sin policies de
-- escritura) y todas validan `es_admin_complejo`/`es_admin_cancha`
-- antes de tocar una fila.
--
-- Estas levantan `raise exception` en vez de devolver
-- `{ok: false, reason: ...}` como el resto del vertical de Reservas, y
-- es a propósito: acá un fallo de permisos significa que la interfaz
-- ofreció un botón que no correspondía — un error de programación, no
-- un rechazo de negocio que el usuario deba poder leer y reintentar.
-- Los rechazos que SÍ son de negocio (bloquear un horario ya reservado)
-- también levantan excepción, con un mensaje redactado para mostrarse.

-- Los complejos que administra quien llama, con su rol: la interfaz
-- necesita el rol para saber si muestra la gestión de administradores
-- (solo el dueño la tiene).
create or replace function public.admin_mis_complejos()
returns table (
    id uuid,
    nombre text,
    descripcion text,
    direccion text,
    region text,
    comuna text,
    latitud numeric,
    longitud numeric,
    foto_url text,
    verificado_futfinder boolean,
    rating_avg numeric,
    rating_count integer,
    created_at timestamptz,
    updated_at timestamptz,
    rol text
)
language sql
stable
security definer
set search_path = public
as $$
    select c.id, c.nombre, c.descripcion, c.direccion, c.region, c.comuna,
           c.latitud, c.longitud, c.foto_url, c.verificado_futfinder,
           c.rating_avg, c.rating_count, c.created_at, c.updated_at,
           ca.rol
      from public.complejos c
      join public.complejo_admins ca on ca.complejo_id = c.id
     where ca.user_id = auth.uid()
     order by c.nombre;
$$;

revoke all on function public.admin_mis_complejos() from public, anon;
grant execute on function public.admin_mis_complejos() to authenticated;

-- `coalesce` en cada campo: un NULL significa "no cambiar", no "borrar".
-- Por eso no se puede vaciar la descripción o la dirección desde acá;
-- si alguna vez hace falta, se agrega un parámetro explícito de borrado
-- en vez de cambiarle el significado al NULL.
create or replace function public.admin_actualizar_complejo(
    p_complejo_id uuid,
    p_nombre text default null,
    p_descripcion text default null,
    p_direccion text default null,
    p_foto_url text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;
    if p_nombre is not null and length(trim(p_nombre)) = 0 then
        raise exception 'El nombre del complejo no puede quedar vacío';
    end if;

    update public.complejos set
        nombre      = coalesce(nullif(trim(p_nombre), ''), nombre),
        descripcion = coalesce(p_descripcion, descripcion),
        direccion   = coalesce(p_direccion, direccion),
        foto_url    = coalesce(p_foto_url, foto_url),
        updated_at  = now()
     where id = p_complejo_id;
end;
$$;

revoke all on function public.admin_actualizar_complejo(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_actualizar_complejo(uuid, text, text, text, text) to authenticated;

-- `tipo` se valida acá además del CHECK de la tabla: el CHECK daría un
-- error de constraint ilegible, y este es un valor que llega de un
-- selector de la interfaz.
create or replace function public.admin_crear_cancha(
    p_complejo_id uuid,
    p_nombre text,
    p_tipo text,
    p_precio_hora integer,
    p_duracion_slot_min integer default 60
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;
    if p_nombre is null or length(trim(p_nombre)) = 0 then
        raise exception 'La cancha necesita un nombre';
    end if;
    if p_tipo not in ('futbol_5', 'futbol_7', 'futbol_11') then
        raise exception 'Tipo de cancha inválido';
    end if;
    if p_precio_hora is null or p_precio_hora < 0 then
        raise exception 'El precio por hora no puede ser negativo';
    end if;
    if p_duracion_slot_min is null or p_duracion_slot_min <= 0 then
        raise exception 'La duración del bloque tiene que ser mayor a cero';
    end if;

    insert into public.canchas_reservables
        (complejo_id, nombre, tipo, precio_hora, duracion_slot_min)
    values
        (p_complejo_id, trim(p_nombre), p_tipo, p_precio_hora, p_duracion_slot_min)
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.admin_crear_cancha(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.admin_crear_cancha(uuid, text, text, integer, integer) to authenticated;

-- El `tipo` no se puede cambiar: una cancha de futbol_7 no se convierte
-- en futbol_11 sin obra. Si el recinto la rehace, se crea otra cancha y
-- se desactiva la anterior, para no reescribir el tipo de las reservas
-- históricas.
create or replace function public.admin_actualizar_cancha(
    p_cancha_id uuid,
    p_nombre text default null,
    p_precio_hora integer default null,
    p_duracion_slot_min integer default null,
    p_activa boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;
    if p_precio_hora is not null and p_precio_hora < 0 then
        raise exception 'El precio por hora no puede ser negativo';
    end if;
    if p_duracion_slot_min is not null and p_duracion_slot_min <= 0 then
        raise exception 'La duración del bloque tiene que ser mayor a cero';
    end if;

    update public.canchas_reservables set
        nombre            = coalesce(nullif(trim(p_nombre), ''), nombre),
        precio_hora       = coalesce(p_precio_hora, precio_hora),
        duracion_slot_min = coalesce(p_duracion_slot_min, duracion_slot_min),
        activa            = coalesce(p_activa, activa)
     where id = p_cancha_id;
end;
$$;

revoke all on function public.admin_actualizar_cancha(uuid, text, integer, integer, boolean) from public, anon;
grant execute on function public.admin_actualizar_cancha(uuid, text, integer, integer, boolean) to authenticated;

-- Rechaza reglas solapadas del mismo día: dos reglas que se pisan hacen
-- que el `generate_series` de `get_disponibilidad_cancha` emita el mismo
-- slot dos veces, y el calendario muestra horarios duplicados.
create or replace function public.admin_upsert_horario_regla(
    p_cancha_id uuid,
    p_dia_semana integer,
    p_hora_apertura time,
    p_hora_cierre time,
    p_regla_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;
    if p_dia_semana is null or p_dia_semana not between 0 and 6 then
        raise exception 'Día de la semana inválido';
    end if;
    if p_hora_cierre <= p_hora_apertura then
        raise exception 'La hora de cierre tiene que ser posterior a la de apertura';
    end if;

    if exists (
        select 1 from public.cancha_horario_reglas r
         where r.cancha_id = p_cancha_id
           and r.dia_semana = p_dia_semana
           and (p_regla_id is null or r.id <> p_regla_id)
           and p_hora_apertura < r.hora_cierre
           and p_hora_cierre > r.hora_apertura
    ) then
        raise exception 'Ya hay un horario que se cruza con este ese día';
    end if;

    if p_regla_id is not null then
        update public.cancha_horario_reglas set
            dia_semana    = p_dia_semana,
            hora_apertura = p_hora_apertura,
            hora_cierre   = p_hora_cierre
         where id = p_regla_id
           and cancha_id = p_cancha_id
        returning id into v_id;

        if v_id is null then
            raise exception 'Ese horario no pertenece a esta cancha';
        end if;
    else
        insert into public.cancha_horario_reglas
            (cancha_id, dia_semana, hora_apertura, hora_cierre)
        values
            (p_cancha_id, p_dia_semana, p_hora_apertura, p_hora_cierre)
        returning id into v_id;
    end if;

    return v_id;
end;
$$;

revoke all on function public.admin_upsert_horario_regla(uuid, integer, time, time, uuid) from public, anon;
grant execute on function public.admin_upsert_horario_regla(uuid, integer, time, time, uuid) to authenticated;

create or replace function public.admin_eliminar_horario_regla(p_regla_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha_id uuid;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select cancha_id into v_cancha_id
      from public.cancha_horario_reglas
     where id = p_regla_id;

    if v_cancha_id is null or not public.es_admin_cancha(v_cancha_id) then
        raise exception 'No administras este horario';
    end if;

    delete from public.cancha_horario_reglas where id = p_regla_id;
end;
$$;

revoke all on function public.admin_eliminar_horario_regla(uuid) from public, anon;
grant execute on function public.admin_eliminar_horario_regla(uuid) to authenticated;

-- Rechaza bloquear un horario con una reserva ya confirmada: dejar el
-- bloque simultáneamente reservado y bloqueado es un estado ambiguo, y
-- la salida correcta es cancelar esa reserva primero (con su reembolso),
-- no taparla.
create or replace function public.admin_crear_bloqueo(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_hora_fin time,
    p_motivo text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;
    if p_hora_fin <= p_hora_inicio then
        raise exception 'La hora de término tiene que ser posterior a la de inicio';
    end if;

    if exists (
        select 1 from public.reservas r
         where r.cancha_id = p_cancha_id
           and r.fecha = p_fecha
           and r.estado = 'confirmada'
           and p_hora_inicio < r.hora_fin
           and p_hora_fin > r.hora_inicio
    ) then
        raise exception 'Ese horario tiene una reserva confirmada: cancélala antes de bloquearlo';
    end if;

    insert into public.cancha_bloqueos
        (cancha_id, fecha, hora_inicio, hora_fin, motivo, creado_por)
    values
        (p_cancha_id, p_fecha, p_hora_inicio, p_hora_fin, nullif(trim(p_motivo), ''), auth.uid())
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.admin_crear_bloqueo(uuid, date, time, time, text) from public, anon;
grant execute on function public.admin_crear_bloqueo(uuid, date, time, time, text) to authenticated;

create or replace function public.admin_eliminar_bloqueo(p_bloqueo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha_id uuid;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select cancha_id into v_cancha_id
      from public.cancha_bloqueos
     where id = p_bloqueo_id;

    if v_cancha_id is null or not public.es_admin_cancha(v_cancha_id) then
        raise exception 'No administras este bloqueo';
    end if;

    delete from public.cancha_bloqueos where id = p_bloqueo_id;
end;
$$;

revoke all on function public.admin_eliminar_bloqueo(uuid) from public, anon;
grant execute on function public.admin_eliminar_bloqueo(uuid) to authenticated;

-- Solo un `dueño` suma administradores, y NO puede tocar la fila de otro
-- dueño. Esas dos reglas juntas garantizan que un complejo nunca quede
-- sin dueño: nadie se rebaja a sí mismo por descuido (la propia fila de
-- quien llama es de un dueño, así que cae en el mismo rechazo) y nadie
-- degrada a un par. Cambiar de dueño es una operación deliberada de
-- `service_role`.
create or replace function public.admin_agregar_admin(
    p_complejo_id uuid,
    p_user_id uuid,
    p_rol text default 'admin'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_complejo_nombre text;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if p_rol not in ('dueño', 'admin') then
        raise exception 'Rol inválido';
    end if;
    if not exists (
        select 1 from public.complejo_admins
         where complejo_id = p_complejo_id
           and user_id = auth.uid()
           and rol = 'dueño'
    ) then
        raise exception 'Solo el dueño del complejo puede agregar administradores';
    end if;
    if not exists (select 1 from public.profiles where id = p_user_id) then
        raise exception 'Esa persona no existe';
    end if;
    if exists (
        select 1 from public.complejo_admins
         where complejo_id = p_complejo_id
           and user_id = p_user_id
           and rol = 'dueño'
    ) then
        raise exception 'No puedes cambiarle el rol a un dueño del complejo';
    end if;

    insert into public.complejo_admins (complejo_id, user_id, rol)
    values (p_complejo_id, p_user_id, p_rol)
    on conflict (complejo_id, user_id) do update set rol = excluded.rol;

    select nombre into v_complejo_nombre from public.complejos where id = p_complejo_id;

    insert into public.notifications (user_id, type, title, body, data)
    values (
        p_user_id,
        'complejo_admin_agregado',
        'Ahora administras un recinto',
        'Te nombraron ' || p_rol || ' de ' || coalesce(v_complejo_nombre, 'un complejo') || '.',
        jsonb_build_object('complejoId', p_complejo_id, 'rol', p_rol)
    );
end;
$$;

revoke all on function public.admin_agregar_admin(uuid, uuid, text) from public, anon;
grant execute on function public.admin_agregar_admin(uuid, uuid, text) to authenticated;

create or replace function public.admin_quitar_admin(
    p_complejo_id uuid,
    p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not exists (
        select 1 from public.complejo_admins
         where complejo_id = p_complejo_id
           and user_id = auth.uid()
           and rol = 'dueño'
    ) then
        raise exception 'Solo el dueño del complejo puede quitar administradores';
    end if;
    if exists (
        select 1 from public.complejo_admins
         where complejo_id = p_complejo_id
           and user_id = p_user_id
           and rol = 'dueño'
    ) then
        raise exception 'No puedes quitar a un dueño del complejo';
    end if;

    delete from public.complejo_admins
     where complejo_id = p_complejo_id
       and user_id = p_user_id;
end;
$$;

revoke all on function public.admin_quitar_admin(uuid, uuid) from public, anon;
grant execute on function public.admin_quitar_admin(uuid, uuid) to authenticated;

-- ── 7. CABLEADO: los bloqueos tienen que bloquear ────────────────
-- Las dos funciones de abajo son las de las migraciones 54 y 55,
-- reemplazadas con `create or replace` (mismo patrón que las
-- migraciones 37, 42b, 43b y 47b) con UN solo cambio cada una: ahora
-- consultan `slot_bloqueado()`. El resto del cuerpo es idéntico al
-- original; se copia completo porque Postgres no permite parchear el
-- cuerpo de una función por partes.
--
-- Sin este cableado, `cancha_bloqueos` no tendría ningún efecto: la
-- disponibilidad pintaría el bloque libre y `crear_reserva` lo dejaría
-- reservar. Es la mitad del sentido de esta migración.

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
               -- Cableado de los bloqueos de administración (migración
               -- 60). Sin esta condición `cancha_bloqueos` sería
               -- decorativa: el bloque marcado por mantención seguiría
               -- pintándose libre. No se distingue "ocupado" de
               -- "bloqueado" a propósito: el criterio de esta función es
               -- no revelar POR QUÉ un slot no está, solo que no está.
               and not public.slot_bloqueado(
                   p_cancha_id, p_fecha, s.hora_inicio,
                   s.hora_inicio + (v_slot_min || ' minutes')::interval
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
-- `anon` conserva EXECUTE a propósito, igual que en la migración 54: la
-- disponibilidad es información pública, se muestra sin iniciar sesión.
grant execute on function public.get_disponibilidad_cancha(uuid, date) to authenticated, anon;

create or replace function public.crear_reserva(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_modalidad text,
    p_medio_pago text default 'balance',
    p_n_jugadores integer default null,
    p_es_desafio_club boolean default false,
    p_club_organizador_id uuid default null,
    p_club_rival_id uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_cancha public.canchas_reservables;
    v_hora_fin time;
    v_precio_total integer;
    v_cuota integer;
    v_estado text;
    v_reserva_id uuid;
    v_ocupada boolean;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    if p_modalidad not in ('completa', 'capitanes', 'jugadores') then
        return json_build_object('ok', false, 'reason', 'Modalidad inválida');
    end if;
    if p_medio_pago not in ('balance', 'tarjeta') then
        return json_build_object('ok', false, 'reason', 'Medio de pago inválido');
    end if;
    -- Regla de negocio: capitanes/jugadores requieren Balance.
    if p_modalidad in ('capitanes', 'jugadores') and p_medio_pago <> 'balance' then
        return json_build_object('ok', false, 'reason', 'Esta modalidad requiere Balance FutFinder');
    end if;
    if p_modalidad = 'jugadores' and (p_n_jugadores is null or p_n_jugadores < 2) then
        return json_build_object('ok', false, 'reason', 'Indica cuántos jugadores participan (mínimo 2)');
    end if;
    if p_es_desafio_club and (p_club_organizador_id is null or p_club_rival_id is null) then
        return json_build_object('ok', false, 'reason', 'Falta indicar los clubes del desafío');
    end if;

    -- Normaliza parámetros que no aplican a la modalidad/tipo elegido,
    -- para que un caller que los manda de todos modos no choque contra
    -- el CHECK de la tabla (eso sería un error de sistema por un
    -- descuido del cliente, no un rechazo de negocio real).
    if p_modalidad <> 'jugadores' then
        p_n_jugadores := null;
    end if;
    if not p_es_desafio_club then
        p_club_organizador_id := null;
        p_club_rival_id := null;
    end if;

    select * into v_cancha from public.canchas_reservables where id = p_cancha_id;
    if v_cancha is null or not v_cancha.activa then
        return json_build_object('ok', false, 'reason', 'Cancha no disponible');
    end if;

    v_hora_fin := p_hora_inicio + (v_cancha.duracion_slot_min || ' minutes')::interval;
    v_precio_total := v_cancha.precio_hora;

    select exists (
        select 1 from public.reservas
         where cancha_id = p_cancha_id
           and fecha = p_fecha
           and hora_inicio = p_hora_inicio
           and estado = 'confirmada'
    ) into v_ocupada;
    if v_ocupada then
        return json_build_object('ok', false, 'reason', 'ocupado');
    end if;

    -- Cableado de los bloqueos de administración (migración 60). Va
    -- aparte de `v_ocupada` y con su propio `reason`: para quien reserva
    -- son lo mismo (no puede tomar ese horario), pero el recinto y el
    -- soporte necesitan poder distinguir "otro se te adelantó" de "el
    -- complejo cerró ese bloque".
    if public.slot_bloqueado(p_cancha_id, p_fecha, p_hora_inicio, v_hora_fin) then
        return json_build_object('ok', false, 'reason', 'bloqueado');
    end if;

    if p_modalidad = 'jugadores' then
        v_cuota := ceil(v_precio_total::numeric / p_n_jugadores);
    end if;

    v_estado := case when p_modalidad = 'completa' then 'procesando' else 'armando' end;

    insert into public.reservas (
        cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
        precio_total, modalidad, medio_pago, n_jugadores, cuota, estado,
        es_desafio_club, club_organizador_id, club_rival_id
    ) values (
        p_cancha_id, v_me, p_fecha, p_hora_inicio, v_hora_fin,
        v_precio_total, p_modalidad, p_medio_pago, p_n_jugadores, v_cuota, v_estado,
        p_es_desafio_club, p_club_organizador_id, p_club_rival_id
    )
    returning id into v_reserva_id;

    -- El organizador cuenta como participante (y pagador) en capitanes y
    -- jugadores; en 'completa' no aplica reserva_participantes (spec).
    if p_modalidad in ('capitanes', 'jugadores') then
        insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
        values (v_reserva_id, v_me, 'organizador', 'aceptado');
    end if;

    return json_build_object('ok', true, 'reserva_id', v_reserva_id);
end;
$$;


revoke all on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid) from public, anon;
grant execute on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid) to authenticated;
