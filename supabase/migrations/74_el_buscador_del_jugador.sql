-- =============================================================
-- FutFinder migration 74: el buscador del jugador
-- =============================================================
-- LA PANTALLA DE RESERVAS NECESITA UNA LISTA DE RECINTOS Y NO HAY DE DÓNDE
-- SACARLA sin hacer una llamada por cancha. `get_disponibilidad_cancha` es
-- de UNA cancha en UNA fecha: para armar el listado con «próxima hora libre»
-- habría que llamarla una vez por cancha de cada recinto — con diez recintos
-- de seis canchas son sesenta llamadas para pintar una pantalla.
--
-- `buscar_complejos()` lo resuelve en una consulta. Devuelve lo que el
-- listado muestra y nada más:
--
--   · `desde`: el precio más bajo al que se puede arrendar algo ahí. Mira las
--     tarifas por franja además del precio base, porque si una cancha tiene
--     una tarifa de $14.000 decir «desde $28.000» es mentir hacia arriba.
--   · `tipos`: los tipos de cancha ACTIVA, para el filtro de fútbol 5/7/11.
--   · `proxima_hora_libre`: el primer bloque de hoy que todavía se puede
--     reservar, en cualquiera de sus canchas. Es lo que hace útil el bloque
--     «juega hoy», y es justamente lo que no se puede calcular en el cliente.
--   · `distancia_km`: solo si se le pasan coordenadas. Haversine, sin PostGIS
--     — para ordenar una lista de recintos de una ciudad sobra.
--
-- POR QUÉ ES `security definer`. Para saber si un bloque está libre hay que
-- mirar `reservas`, y su RLS solo deja ver las propias: como función normal,
-- todos los bloques parecerían libres. Con `security definer` se salta la
-- RLS, así que el filtro `publicado` va escrito EXPLÍCITO acá adentro —
-- mismo criterio y mismo motivo que `get_disponibilidad_cancha`.
--
-- LO QUE NO DEVUELVE, a propósito: por qué una hora no está. Igual que la
-- disponibilidad del jugador, acá solo se dice cuál es la próxima hora libre;
-- nunca si lo que hay antes es una reserva de otro o una mantención.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── Distancia entre dos puntos, en kilómetros ────────────────────
-- Haversine sobre una esfera de 6371 km. El error contra la elipsoide real
-- es de ~0,5%, o sea metros en una escala urbana: para ordenar «cuál me
-- queda más cerca» sobra, y evita depender de PostGIS.
create or replace function public.distancia_km(
    p_lat1 numeric, p_lng1 numeric, p_lat2 numeric, p_lng2 numeric
)
returns numeric
language sql
immutable
as $$
    select case
        when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
        else round((
            6371 * 2 * asin(sqrt(
                power(sin(radians(p_lat2 - p_lat1) / 2), 2)
                + cos(radians(p_lat1)) * cos(radians(p_lat2))
                * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
            ))
        )::numeric, 1)
    end;
$$;

revoke all on function public.distancia_km(numeric, numeric, numeric, numeric) from public;
grant execute on function public.distancia_km(numeric, numeric, numeric, numeric) to authenticated, anon;

-- ── Buscar sin tildes ni mayúsculas ─────────────────────────────
-- «maipu» tiene que encontrar «Maipú» y «nunoa» a «Ñuñoa». Se hace con
-- `translate()` y no con la extensión `unaccent` para no sumar una
-- dependencia por esto: son seis vocales y la eñe. La ñ cae en n a
-- propósito — es lo mismo que hace `normalizar()` en el cliente, que usa
-- `normalize('NFD')`, y las dos formas tienen que coincidir.
create or replace function public.sin_tildes(p_texto text)
returns text
language sql
immutable
as $$
    select lower(translate(coalesce(p_texto, ''),
                           'áàäâéèëêíìïîóòöôúùüûñÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑ',
                           'aaaaeeeeiiiioooouuuunAAAAEEEEIIIIOOOOUUUUN'));
$$;

revoke all on function public.sin_tildes(text) from public;
grant execute on function public.sin_tildes(text) to authenticated, anon;

-- ── El listado ───────────────────────────────────────────────────
create or replace function public.buscar_complejos(
    p_lat numeric default null,
    p_lng numeric default null,
    p_query text default null,
    p_limit integer default 50
)
returns table (
    id uuid,
    nombre text,
    descripcion text,
    direccion text,
    comuna text,
    region text,
    latitud numeric,
    longitud numeric,
    foto_url text,
    verificado_futfinder boolean,
    rating_avg numeric,
    rating_count integer,
    tipos text[],
    canchas_activas integer,
    desde integer,
    proxima_hora_libre text,
    distancia_km numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_hoy date := (now() at time zone 'America/Santiago')::date;
    v_dow integer := extract(dow from (now() at time zone 'America/Santiago'))::integer;
    v_q text := nullif(trim(coalesce(p_query, '')), '');
begin
    return query
    with publicados as (
        select c.*
          from public.complejos c
         where c.publicado
           -- Sin tildes ni mayúsculas: «maipu» tiene que encontrar «Maipú».
           and (v_q is null
                or public.sin_tildes(c.nombre) ilike '%' || public.sin_tildes(v_q) || '%'
                or public.sin_tildes(coalesce(c.comuna, '')) ilike '%' || public.sin_tildes(v_q) || '%')
    ),
    canchas as (
        select k.*
          from public.canchas_reservables k
          join publicados p on p.id = k.complejo_id
         where k.activa
    ),
    -- Todos los bloques de HOY de todas esas canchas, con su disponibilidad.
    bloques as (
        select k.complejo_id,
               k.id as cancha_id,
               g.hora_inicio,
               (g.hora_inicio + (k.duracion_slot_min || ' minutes')::interval)::time as hora_fin
          from canchas k
          join public.cancha_horario_reglas hr
            on hr.cancha_id = k.id and hr.dia_semana = v_dow
          cross join lateral (
              select generate_series(
                         (v_hoy + hr.hora_apertura)::timestamp,
                         (v_hoy + hr.hora_cierre)::timestamp
                           - (k.duracion_slot_min || ' minutes')::interval,
                         (k.duracion_slot_min || ' minutes')::interval
                     )::time as hora_inicio
          ) g
    ),
    libres as (
        select b.complejo_id, min(b.hora_inicio) as hora
          from bloques b
         where public.inicio_de_reserva(v_hoy, b.hora_inicio) > now()
           and not exists (
               select 1 from public.reservas r
                where r.cancha_id = b.cancha_id
                  and r.fecha = v_hoy
                  and r.hora_inicio = b.hora_inicio
                  and r.estado = 'confirmada'
           )
           and not public.slot_bloqueado(b.cancha_id, v_hoy, b.hora_inicio, b.hora_fin)
         group by b.complejo_id
    ),
    precios as (
        select k.complejo_id,
               -- El piso real: la tarifa más barata si existe, si no el
               -- precio base. Decir «desde» un número más alto del que se
               -- puede pagar es mentir en la dirección que más molesta.
               min(least(
                   k.precio_hora,
                   coalesce((select min(t.precio) from public.cancha_tarifas t where t.cancha_id = k.id),
                            k.precio_hora)
               ))::integer as desde,
               array_agg(distinct k.tipo) as tipos,
               count(*)::integer as activas
          from canchas k
         group by k.complejo_id
    )
    select p.id,
           p.nombre,
           p.descripcion,
           p.direccion,
           p.comuna,
           p.region,
           p.latitud,
           p.longitud,
           p.foto_url,
           p.verificado_futfinder,
           p.rating_avg,
           p.rating_count,
           coalesce(pr.tipos, array[]::text[]),
           coalesce(pr.activas, 0),
           pr.desde,
           to_char(l.hora, 'HH24:MI'),
           public.distancia_km(p_lat, p_lng, p.latitud, p.longitud)
      from publicados p
      left join precios pr on pr.complejo_id = p.id
      left join libres  l  on l.complejo_id = p.id
     order by
       -- Con ubicación, por cercanía. Sin ella, los que tienen hora libre
       -- hoy primero: es lo que la pantalla ofrece resolver.
       public.distancia_km(p_lat, p_lng, p.latitud, p.longitud) nulls last,
       (l.hora is null),
       p.nombre
     limit greatest(1, least(coalesce(p_limit, 50), 100));
end;
$$;

revoke all on function public.buscar_complejos(numeric, numeric, text, integer) from public;
grant execute on function public.buscar_complejos(numeric, numeric, text, integer) to authenticated, anon;
