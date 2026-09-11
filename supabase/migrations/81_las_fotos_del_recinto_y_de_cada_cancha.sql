-- =============================================================
-- FutFinder migration 81: las fotos del recinto y de cada cancha
-- =============================================================
-- HASTA ACÁ EL RECINTO TENÍA UNA SOLA FOTO. La 75 creó el bucket y la
-- portada (`complejos.foto_url`), que es la que lo representa en el
-- buscador. Pero una portada no alcanza para que alguien decida: el
-- jugador quiere ver CÓMO ES el lugar —los camarines, la iluminación de
-- noche, el estacionamiento— y quiere ver la cancha que está a punto de
-- arrendar, no una foto genérica del recinto.
--
-- Se agregan las dos cosas que faltaban, que son distintas entre sí:
--
--   · GALERÍA DEL RECINTO (`complejo_fotos`): varias fotos sueltas, para
--     dar contexto. No reemplazan a la portada — la portada sigue siendo
--     la única que sale en el listado, porque una tarjeta de resultado
--     muestra UNA imagen y tiene que ser la que el recinto eligió.
--   · FOTO DE CADA CANCHA (`canchas_reservables.foto_url`): una sola por
--     cancha. Es una columna y no una tabla porque no hay galería de
--     cancha: o está la foto de esa cancha, o no está.
--
-- POR QUÉ UN TOPE DE OCHO. Sin límite, esto termina siendo el álbum de
-- alguien y la pantalla del jugador deja de ser útil. Ocho alcanza para
-- mostrar un recinto completo y sigue cargando rápido en datos móviles.
-- El tope se aplica en el servidor porque un límite que solo vive en la
-- pantalla no es un límite.
--
-- NO HACEN FALTA POLÍTICAS DE STORAGE NUEVAS. Las de la 75 miran la
-- PRIMERA carpeta de la ruta (`(storage.foldername(name))[1]`) y exigen
-- `es_admin_complejo` sobre ella, así que todo lo que cuelgue de
-- `<complejoId>/...` ya está cubierto: `galeria/<uuid>.jpg` y
-- `canchas/<canchaId>.jpg` entran por la misma puerta que `portada.jpg`.
--
-- LAS POLICIES VAN PARTIDAS EN DOS, como en la 76 y la 77: la rama que
-- llama a `es_admin_complejo` —concedida solo a `authenticated`— no puede
-- ir en un `or` con la pública, porque Postgres no garantiza el orden de
-- evaluación y `anon` termina con «permission denied for function».
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La galería del recinto ────────────────────────────────────
create table if not exists public.complejo_fotos (
    id uuid primary key default gen_random_uuid(),
    complejo_id uuid not null references public.complejos(id) on delete cascade,
    url text not null,
    -- Para poder mostrarlas siempre en el mismo orden. Se asigna al
    -- insertar; no hay pantalla para reordenar todavía y no se inventa
    -- una RPC que nadie llama.
    orden integer not null default 0,
    created_at timestamptz not null default now()
);

create index if not exists idx_complejo_fotos_complejo
    on public.complejo_fotos(complejo_id, orden, created_at);

alter table public.complejo_fotos enable row level security;

drop policy if exists "complejo_fotos_select" on public.complejo_fotos;
drop policy if exists "complejo_fotos_select_publico" on public.complejo_fotos;
drop policy if exists "complejo_fotos_select_admin" on public.complejo_fotos;

-- Sin sesión y con sesión: las de un recinto publicado.
create policy "complejo_fotos_select_publico"
    on public.complejo_fotos for select
    using (
        exists (
            select 1 from public.complejos c
             where c.id = complejo_fotos.complejo_id and c.publicado
        )
    );

-- Y quien administra el recinto las ve aunque todavía no esté publicado:
-- es la lista que edita mientras lo carga.
create policy "complejo_fotos_select_admin"
    on public.complejo_fotos for select
    to authenticated
    using (public.es_admin_complejo(complejo_id));

-- ── 2. Agregar una foto a la galería ─────────────────────────────
create or replace function public.admin_agregar_foto_complejo(
    p_complejo_id uuid,
    p_url text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cuantas integer;
    v_orden integer;
    v_id uuid;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;
    if coalesce(trim(p_url), '') = '' then
        return json_build_object('ok', false, 'reason', 'Falta la foto');
    end if;

    select count(*) into v_cuantas
      from public.complejo_fotos where complejo_id = p_complejo_id;

    if v_cuantas >= 8 then
        return json_build_object('ok', false, 'reason',
            'Ya tienes ocho fotos. Quita una antes de subir otra.');
    end if;

    select coalesce(max(orden), -1) + 1 into v_orden
      from public.complejo_fotos where complejo_id = p_complejo_id;

    insert into public.complejo_fotos (complejo_id, url, orden)
    values (p_complejo_id, trim(p_url), v_orden)
    returning id into v_id;

    return json_build_object('ok', true, 'foto_id', v_id, 'orden', v_orden,
                             'cuantas', v_cuantas + 1);
end;
$$;

revoke all on function public.admin_agregar_foto_complejo(uuid, text) from public, anon;
grant execute on function public.admin_agregar_foto_complejo(uuid, text) to authenticated;

-- ── 3. Quitar una foto de la galería ─────────────────────────────
-- Devuelve la `url` para que el cliente pueda borrar también el archivo
-- del bucket. Si no la devolviera, cada foto quitada dejaría un archivo
-- huérfano que nadie sabe a quién pertenecía.
create or replace function public.admin_quitar_foto_galeria(p_foto_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_foto public.complejo_fotos;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select * into v_foto from public.complejo_fotos where id = p_foto_id;
    if v_foto.id is null then
        return json_build_object('ok', true, 'ya_estaba', true);
    end if;
    if not public.es_admin_complejo(v_foto.complejo_id) then
        raise exception 'No administras este complejo';
    end if;

    delete from public.complejo_fotos where id = p_foto_id;
    return json_build_object('ok', true, 'url', v_foto.url);
end;
$$;

revoke all on function public.admin_quitar_foto_galeria(uuid) from public, anon;
grant execute on function public.admin_quitar_foto_galeria(uuid) to authenticated;

-- ── 4. La foto de cada cancha ────────────────────────────────────
alter table public.canchas_reservables
    add column if not exists foto_url text;

-- `null` QUITA la foto, y acá eso es correcto aunque en
-- `admin_actualizar_complejo` un `null` signifique «no cambiar». La
-- diferencia es que esta función hace UNA sola cosa: si la llamas, es
-- porque quieres cambiar la foto. No hay ambigüedad que resolver.
create or replace function public.admin_actualizar_foto_cancha(
    p_cancha_id uuid,
    p_foto_url text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_anterior text;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;

    select foto_url into v_anterior
      from public.canchas_reservables where id = p_cancha_id;

    update public.canchas_reservables
       set foto_url = nullif(trim(coalesce(p_foto_url, '')), '')
     where id = p_cancha_id;

    return json_build_object('ok', true, 'anterior', v_anterior);
end;
$$;

revoke all on function public.admin_actualizar_foto_cancha(uuid, text) from public, anon;
grant execute on function public.admin_actualizar_foto_cancha(uuid, text) to authenticated;

-- ── 5. Que la lista de canchas del panel traiga la foto ──────────
-- `create or replace` NO puede cambiar el tipo de fila de un `returns
-- table`: hay que soltarla primero, y eso se lleva los grants, así que se
-- vuelven a dar abajo. El cuerpo es el de la migración 72 con una sola
-- línea agregada.
drop function if exists public.admin_canchas_complejo(uuid);

create function public.admin_canchas_complejo(p_complejo_id uuid)
returns table (
    id uuid,
    complejo_id uuid,
    nombre text,
    tipo text,
    precio_hora integer,
    duracion_slot_min integer,
    activa boolean,
    foto_url text,
    tiene_horario boolean,
    tiene_tarifas boolean,
    dias_con_horario integer
)
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

    return query
    select k.id,
           k.complejo_id,
           k.nombre,
           k.tipo,
           k.precio_hora,
           k.duracion_slot_min,
           k.activa,
           k.foto_url,
           exists (select 1 from public.cancha_horario_reglas hr where hr.cancha_id = k.id) as tiene_horario,
           exists (select 1 from public.cancha_tarifas t where t.cancha_id = k.id)          as tiene_tarifas,
           (select count(distinct hr.dia_semana)::integer
              from public.cancha_horario_reglas hr
             where hr.cancha_id = k.id)                                                     as dias_con_horario
      from public.canchas_reservables k
     where k.complejo_id = p_complejo_id
     order by k.activa desc, k.nombre;
end;
$$;

revoke all on function public.admin_canchas_complejo(uuid) from public, anon;
grant execute on function public.admin_canchas_complejo(uuid) to authenticated;
