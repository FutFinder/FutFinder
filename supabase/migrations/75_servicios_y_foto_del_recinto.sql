-- =============================================================
-- FutFinder migration 75: los servicios del recinto y su foto
-- =============================================================
-- DOS HUECOS DE LA FICHA que quedaron a la vista al construirla.
--
-- 1. LOS SERVICIOS NO EXISTÍAN. El diseño de la ficha muestra chips
--    —estacionamiento, camarines, duchas, quincho— y no había dónde
--    guardarlos: la pantalla del jugador terminó mostrando los tipos de
--    cancha en su lugar, que es verdad pero no es lo que se pedía.
--
--    SE GUARDAN COMO CATÁLOGO CERRADO, no como texto libre, y es la
--    decisión que importa acá. Con texto libre un recinto escribe
--    «Estacionamiento», otro «estacionamientos» y un tercero «parking»,
--    y el día que se quiera filtrar por «con estacionamiento» no se
--    puede. Con una lista fija el filtro es trivial y los chips se ven
--    iguales en todas las fichas. El costo es que agregar un servicio
--    nuevo necesita una migración — y está bien: son diez y no cambian
--    seguido.
--
--    `iluminacion` y `graderias` son atributos de cancha más que de
--    recinto, pero el diseño los pone en la lista del recinto y así lo
--    entiende quien administra. Se dejan acá.
--
-- 2. LA FOTO NO TENÍA DÓNDE SUBIRSE. `complejos.foto_url` existía desde
--    la 54 y `admin_actualizar_complejo` la recibe, pero no había bucket
--    ni políticas, así que la pantalla decía «pendiente». Se crea
--    `complejo-fotos` con el mismo patrón que `club-logos`: lectura
--    pública —la foto la ve cualquiera en el buscador— y escritura solo
--    para quien administra ESE complejo, comprobado con
--    `es_admin_complejo()` sobre la primera carpeta de la ruta.
--
--    La ruta es `<complejo_id>/portada.<ext>`, así que la carpeta ES el
--    id del complejo y la política no necesita nada más.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Servicios ─────────────────────────────────────────────────
create table if not exists public.complejo_servicios (
    complejo_id uuid not null references public.complejos(id) on delete cascade,
    servicio text not null,
    created_at timestamptz not null default now(),

    primary key (complejo_id, servicio),

    constraint complejo_servicios_catalogo check (servicio in (
        'estacionamiento', 'camarines', 'duchas', 'banos', 'quincho',
        'iluminacion', 'arriendo_balon', 'kiosco', 'graderias', 'wifi'
    ))
);

alter table public.complejo_servicios enable row level security;

-- Misma regla que `complejo_cobros`: lo publicado lo ve cualquiera, y
-- quien administra el recinto lo ve siempre, publicado o no — si no, no
-- podría revisar su propia ficha antes de publicar.
drop policy if exists "complejo_servicios_select" on public.complejo_servicios;
create policy "complejo_servicios_select"
    on public.complejo_servicios for select
    using (
        exists (
            select 1 from public.complejos c
             where c.id = complejo_servicios.complejo_id and c.publicado
        )
        or public.es_admin_complejo(complejo_id)
    );
-- Sin policies de escritura: solo vía `admin_actualizar_servicios`.

-- ── 2. Guardar la lista completa, de una ─────────────────────────
-- Recibe la lista ENTERA y reemplaza lo que había, en vez de tener un
-- «agregar» y un «quitar»: la pantalla es un conjunto de chips que se
-- encienden y apagan, y mandar el estado final evita que dos toques
-- rápidos dejen la base en un estado que la pantalla no muestra.
--
-- Un servicio fuera del catálogo se RECHAZA en vez de ignorarse: si la
-- pantalla manda algo que no existe es un error de la pantalla, y
-- descartarlo en silencio lo escondería.
create or replace function public.admin_actualizar_servicios(
    p_complejo_id uuid,
    p_servicios text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_malo text;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;

    select s into v_malo
      from unnest(coalesce(p_servicios, array[]::text[])) as s
     where s not in ('estacionamiento', 'camarines', 'duchas', 'banos', 'quincho',
                     'iluminacion', 'arriendo_balon', 'kiosco', 'graderias', 'wifi')
     limit 1;
    if v_malo is not null then
        raise exception 'Servicio desconocido: %', v_malo;
    end if;

    delete from public.complejo_servicios
     where complejo_id = p_complejo_id
       and servicio <> all (coalesce(p_servicios, array[]::text[]));

    insert into public.complejo_servicios (complejo_id, servicio)
    select p_complejo_id, s
      from unnest(coalesce(p_servicios, array[]::text[])) as s
        on conflict (complejo_id, servicio) do nothing;
end;
$$;

revoke all on function public.admin_actualizar_servicios(uuid, text[]) from public, anon;
grant execute on function public.admin_actualizar_servicios(uuid, text[]) to authenticated;

-- ── 3. El bucket de la foto ──────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('complejo-fotos', 'complejo-fotos', true, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

-- La foto de portada la ve cualquiera: es lo primero que se ve al buscar.
drop policy if exists "complejo_fotos_public_read" on storage.objects;
create policy "complejo_fotos_public_read"
    on storage.objects for select
    using (bucket_id = 'complejo-fotos');

-- Escribe solo quien administra ESE complejo. La primera carpeta de la
-- ruta es el `complejo_id`, así que la comprobación es directa.
drop policy if exists "complejo_fotos_admin_upload" on storage.objects;
create policy "complejo_fotos_admin_upload"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'complejo-fotos'
        and public.es_admin_complejo(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "complejo_fotos_admin_update" on storage.objects;
create policy "complejo_fotos_admin_update"
    on storage.objects for update
    to authenticated
    using (
        bucket_id = 'complejo-fotos'
        and public.es_admin_complejo(((storage.foldername(name))[1])::uuid)
    );

drop policy if exists "complejo_fotos_admin_delete" on storage.objects;
create policy "complejo_fotos_admin_delete"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'complejo-fotos'
        and public.es_admin_complejo(((storage.foldername(name))[1])::uuid)
    );

-- ── 4. Quitar la foto ────────────────────────────────────────────
-- `admin_actualizar_complejo` no sirve para esto: su `coalesce` trata el
-- null como «no cambiar», así que no hay forma de vaciar `foto_url` por
-- ahí. En vez de cambiarle el significado al null —que rompería los
-- otros campos— se agrega una función que hace solo esto.
create or replace function public.admin_quitar_foto_complejo(p_complejo_id uuid)
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
    update public.complejos set foto_url = null, updated_at = now()
     where id = p_complejo_id;
end;
$$;

revoke all on function public.admin_quitar_foto_complejo(uuid) from public, anon;
grant execute on function public.admin_quitar_foto_complejo(uuid) to authenticated;
