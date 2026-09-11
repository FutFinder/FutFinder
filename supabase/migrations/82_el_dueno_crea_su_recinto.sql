-- =============================================================
-- FutFinder migration 82: el dueño crea su propio recinto
-- =============================================================
-- HASTA ACÁ LOS RECINTOS SE CARGABAN A MANO. `complejos` y
-- `complejo_admins` no tienen ni una policy de escritura desde la 54 y la
-- 60: nadie puede crear un recinto ni intentándolo. Eso está bien como
-- default —dejar que cualquiera con cuenta se publique un recinto sería
-- regalar el buscador— pero no escala, y obliga al equipo a cargar cada
-- cancha, horario y tarifa de otra persona.
--
-- LA PUERTA SE ABRE CON LLAVE, NO SE SACA. El permiso de crear un recinto
-- es un objeto propio (`autorizaciones_recinto`) que solo puede fabricar
-- el equipo, y que la RPC consume. Sin autorización, `crear_mi_recinto`
-- no crea nada, y sigue sin haber policy de INSERT sobre `complejos`.
--
-- DE UN SOLO USO, decisión de Vicente (2026-09-11). Un permiso permanente
-- convierte a quien fue aprobado una vez en alguien que puede crear veinte
-- recintos, que es justo lo que se quiere evitar. Quien tiene dos sedes
-- manda dos solicitudes y se ven las dos. El uso se marca en la misma
-- transacción que crea el recinto, así que no hay ventana para gastarla
-- dos veces.
--
-- «DUEÑO» ERA UN ROL DENTRO DE UN RECINTO Y AHORA HAY DOS COSAS. El rol de
-- `complejo_admins` sigue siendo por recinto y existe solo cuando el
-- recinto ya existe; la autorización es lo de ANTES, y por eso no se pudo
-- resolver con el rol que ya había.
--
-- PUBLICAR PASA POR FUTFINDER, también decisión de Vicente. El dueño
-- prepara su recinto y PIDE revisión; publicar exige
-- `aprobado_futfinder`. Los recintos que ya existían quedan aprobados: no
-- se les quita algo que ya tenían por una migración.
--
-- EL RECINTO NACE SIN PUBLICAR Y SIN VERIFICAR. Son dos cosas distintas:
-- `publicado` es «sale en el buscador» y `verificado_futfinder` es la
-- insignia. Crear un recinto no da ninguna de las dos.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. El permiso ────────────────────────────────────────────────
create table if not exists public.autorizaciones_recinto (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    -- De qué solicitud salió. Nullable porque el equipo puede autorizar a
    -- alguien con quien habló por fuera, pero cuando viene de una
    -- solicitud queda el rastro de cuál.
    solicitud_id uuid references public.solicitudes_recinto(id) on delete set null,
    -- Para el que la mire dentro de un año y no se acuerde.
    nota text,

    -- Nulos hasta que se usa. Los dos se escriben juntos.
    complejo_id uuid references public.complejos(id) on delete set null,
    usada_at timestamptz,

    created_at timestamptz not null default now(),

    constraint autorizaciones_recinto_uso_coherente
        check ((usada_at is null) = (complejo_id is null))
);

create index if not exists idx_autorizaciones_recinto_user
    on public.autorizaciones_recinto(user_id) where usada_at is null;

-- Aprobar dos veces la misma solicitud no puede dar dos recintos.
create unique index if not exists autorizaciones_recinto_solicitud_uidx
    on public.autorizaciones_recinto(solicitud_id) where solicitud_id is not null;

alter table public.autorizaciones_recinto enable row level security;

-- Cada quien ve las suyas: es lo que le permite a la app mostrar «ya
-- puedes crear tu recinto». Sin policies de escritura — las crea el
-- equipo con `service_role`, que es lo que hace de esto una llave.
drop policy if exists "autorizaciones_recinto_select" on public.autorizaciones_recinto;
create policy "autorizaciones_recinto_select"
    on public.autorizaciones_recinto for select
    to authenticated
    using (user_id = auth.uid());

-- ── 2. La revisión de FutFinder antes de publicar ────────────────
alter table public.complejos
    add column if not exists aprobado_futfinder boolean not null default false;
alter table public.complejos
    add column if not exists revision_pedida_at timestamptz;

-- Los recintos que ya existían podían publicarse antes de que esto
-- existiera. Despublicarlos —o dejarlos sin poder republicar— por una
-- migración sería romper algo que funcionaba.
update public.complejos set aprobado_futfinder = true where not aprobado_futfinder;

-- ── 3. Crear mi recinto ──────────────────────────────────────────
create or replace function public.crear_mi_recinto(
    p_nombre text,
    p_direccion text,
    p_comuna text,
    p_region text,
    p_latitud numeric,
    p_longitud numeric,
    p_descripcion text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_auth public.autorizaciones_recinto;
    v_id uuid;
begin
    if v_me is null then
        raise exception 'No autenticado';
    end if;

    -- `for update` y no un simple select: dos toques seguidos del botón
    -- llegarían a la vez y gastarían la misma autorización dos veces.
    select * into v_auth
      from public.autorizaciones_recinto
     where user_id = v_me and usada_at is null
     order by created_at
     limit 1
       for update;

    if v_auth.id is null then
        return json_build_object('ok', false, 'reason',
            'Todavía no tienes autorización para crear un recinto.');
    end if;

    if coalesce(trim(p_nombre), '') = '' then
        return json_build_object('ok', false, 'reason', 'El recinto necesita un nombre');
    end if;
    if coalesce(trim(p_comuna), '') = '' then
        return json_build_object('ok', false, 'reason', 'Falta la comuna');
    end if;
    if p_latitud is null or p_longitud is null then
        return json_build_object('ok', false, 'reason',
            'Elige la dirección del buscador para fijar el punto en el mapa');
    end if;
    -- Chile continental, insular y austral. No es una validación fina: es
    -- para que un punto en otro continente no entre por un error de signo,
    -- que es como se ven los errores de coordenadas en la práctica.
    if p_latitud not between -56 and -17 or p_longitud not between -110 and -66 then
        return json_build_object('ok', false, 'reason',
            'Esas coordenadas no caen en Chile. Vuelve a elegir la dirección.');
    end if;

    insert into public.complejos (
        nombre, descripcion, direccion, comuna, region,
        latitud, longitud, publicado, verificado_futfinder,
        aprobado_futfinder, created_by
    )
    values (
        trim(p_nombre), nullif(trim(coalesce(p_descripcion, '')), ''),
        nullif(trim(coalesce(p_direccion, '')), ''), trim(p_comuna),
        nullif(trim(coalesce(p_region, '')), ''),
        p_latitud, p_longitud, false, false,
        false, v_me
    )
    returning id into v_id;

    -- El dueño y el recinto nacen juntos. Un recinto sin dueño no lo puede
    -- administrar nadie y habría que arreglarlo a mano.
    insert into public.complejo_admins (complejo_id, user_id, rol)
    values (v_id, v_me, 'dueño');

    update public.autorizaciones_recinto
       set usada_at = now(), complejo_id = v_id
     where id = v_auth.id;

    return json_build_object('ok', true, 'complejo_id', v_id);
end;
$$;

revoke all on function public.crear_mi_recinto(text, text, text, text, numeric, numeric, text)
    from public, anon;
grant execute on function public.crear_mi_recinto(text, text, text, text, numeric, numeric, text)
    to authenticated;

-- ── 4. Pedir la revisión ─────────────────────────────────────────
-- Mismas condiciones que publicar, para que nadie mande a revisar un
-- recinto vacío y el equipo pierda el viaje.
create or replace function public.admin_solicitar_revision_complejo(p_complejo_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_aprobado boolean;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;

    select aprobado_futfinder into v_aprobado
      from public.complejos where id = p_complejo_id;
    if v_aprobado then
        return json_build_object('ok', true, 'ya_estaba', true);
    end if;

    if not exists (
        select 1
          from public.canchas_reservables k
          join public.cancha_horario_reglas hr on hr.cancha_id = k.id
         where k.complejo_id = p_complejo_id and k.activa
    ) then
        return json_build_object('ok', false, 'reason',
            'Antes de pedir la revisión necesitas al menos una cancha activa con horario cargado');
    end if;

    update public.complejos
       set revision_pedida_at = now(), updated_at = now()
     where id = p_complejo_id;

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.admin_solicitar_revision_complejo(uuid) from public, anon;
grant execute on function public.admin_solicitar_revision_complejo(uuid) to authenticated;

-- ── 5. Publicar ahora exige la aprobación ────────────────────────
-- Mismo cuerpo de la 65 con una comprobación más. La firma y el tipo de
-- retorno no cambian, así que `create or replace` alcanza.
create or replace function public.admin_publicar_complejo(
    p_complejo_id uuid,
    p_publicado boolean
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

    if p_publicado then
        if not exists (
            select 1
              from public.canchas_reservables k
              join public.cancha_horario_reglas hr on hr.cancha_id = k.id
             where k.complejo_id = p_complejo_id
               and k.activa
        ) then
            raise exception 'Para publicar el recinto necesitas al menos una cancha activa con horario cargado';
        end if;

        if not exists (
            select 1 from public.complejos c
             where c.id = p_complejo_id and c.aprobado_futfinder
        ) then
            raise exception 'FutFinder todavía no aprueba este recinto. Pide la revisión y te avisamos.';
        end if;
    end if;

    -- Despublicar NO exige nada: si el recinto tiene que salir del
    -- buscador, sale. Es lo mismo que decidió la 65.
    update public.complejos
       set publicado = p_publicado,
           updated_at = now()
     where id = p_complejo_id;
end;
$$;

revoke all on function public.admin_publicar_complejo(uuid, boolean) from public, anon;
grant execute on function public.admin_publicar_complejo(uuid, boolean) to authenticated;

-- ── 6. Que el panel sepa en qué estado está ──────────────────────
-- `create or replace` no puede cambiar el tipo de fila de un `returns
-- table`: hay que soltarla, y el drop se lleva los grants.
drop function if exists public.admin_mis_complejos();

create function public.admin_mis_complejos()
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
    publicado boolean,
    aprobado_futfinder boolean,
    revision_pedida_at timestamptz,
    rating_avg numeric,
    rating_count integer,
    created_at timestamptz,
    updated_at timestamptz,
    rol text
)
language sql
security definer
set search_path = public
as $$
    select c.id, c.nombre, c.descripcion, c.direccion, c.region, c.comuna,
           c.latitud, c.longitud, c.foto_url, c.verificado_futfinder,
           c.publicado, c.aprobado_futfinder, c.revision_pedida_at,
           c.rating_avg, c.rating_count, c.created_at, c.updated_at,
           ca.rol
      from public.complejos c
      join public.complejo_admins ca on ca.complejo_id = c.id
     where ca.user_id = auth.uid()
     order by c.nombre;
$$;

revoke all on function public.admin_mis_complejos() from public, anon;
grant execute on function public.admin_mis_complejos() to authenticated;
