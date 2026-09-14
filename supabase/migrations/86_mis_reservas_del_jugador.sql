-- =============================================================
-- FutFinder migration 86: mis reservas, del lado del jugador
-- =============================================================
-- EL JUGADOR NO TENÍA DÓNDE VER LO QUE RESERVÓ. Podía buscar, elegir,
-- pagar… y después no había ninguna pantalla que le mostrara su reserva.
-- Es el hueco más grande del flujo y salió de recorrerlo entero.
--
-- POR QUÉ UNA RPC Y NO UNA CONSULTA DIRECTA. La RLS de `reservas` ya deja
-- ver las propias, pero la pantalla necesita el nombre del recinto y de la
-- cancha, y esos viven en `canchas_reservables` y `complejos`, cuya RLS
-- solo muestra lo PUBLICADO. Un recinto que se despublica —o que sale de
-- FutFinder— haría desaparecer de la lista una reserva que la persona
-- pagó. Con `security definer` la reserva se ve siempre, que es lo que
-- corresponde: es suya.
--
-- DEVUELVE SI SE PUEDE CANCELAR, Y HASTA CUÁNDO. La regla no es obvia:
-- una reserva en `armando` o `procesando` se cancela cuando sea —no se
-- pagó nada— y las 12 horas aplican SOLO a una confirmada. Si la pantalla
-- la recalculara, serían dos copias de una regla de plata que ya se
-- movió una vez de lugar (migración 70). Se calcula acá, con
-- `inicio_de_reserva()`, que es la que resuelve el huso de Chile.
--
-- INCLUYE LAS RESERVAS EN LAS QUE SOY INVITADO, no solo las que organicé:
-- si me sumaron a un partido, esa reserva también es mía y también quiero
-- saber a qué hora es. `soy_organizador` las distingue, porque las
-- acciones no son las mismas.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

drop function if exists public.mis_reservas(integer);

create function public.mis_reservas(p_limite integer default 60)
returns table (
    id uuid,
    fecha date,
    hora_inicio time,
    hora_fin time,
    inicio timestamptz,
    estado text,
    modalidad text,
    medio_pago text,
    precio_total integer,
    cuota integer,
    soy_organizador boolean,
    cancha_id uuid,
    cancha_nombre text,
    cancha_tipo text,
    complejo_id uuid,
    complejo_nombre text,
    complejo_direccion text,
    complejo_comuna text,
    complejo_foto_url text,
    complejo_latitud numeric,
    complejo_longitud numeric,
    pago_estado text,
    cobros json,
    puede_cancelar boolean,
    cancelacion_hasta timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        return;
    end if;

    return query
    select r.id,
           r.fecha,
           r.hora_inicio,
           r.hora_fin,
           public.inicio_de_reserva(r.fecha, r.hora_inicio) as inicio,
           r.estado,
           r.modalidad,
           r.medio_pago,
           r.precio_total,
           r.cuota,
           (r.organizador_id = v_me) as soy_organizador,
           k.id,
           k.nombre,
           k.tipo,
           c.id,
           c.nombre,
           c.direccion,
           c.comuna,
           c.foto_url,
           c.latitud,
           c.longitud,
           -- El último pago de la reserva. Nulo mientras no se intentó
           -- pagar; es lo que le permite a la pantalla ofrecer «continuar
           -- al pago» sin adivinar.
           (select p.estado from public.pagos p
             where p.reserva_id = r.id
             order by p.created_at desc limit 1) as pago_estado,
           -- Nombre y precio CONGELADOS en la reserva (migración 68): lo
           -- que se cobró ese día, no lo que el cobro vale hoy.
           (select coalesce(json_agg(json_build_object('nombre', rc.nombre, 'precio', rc.precio)
                            order by rc.precio), '[]'::json)
              from public.reserva_cobros rc where rc.reserva_id = r.id) as cobros,
           -- Sin pagar se cancela siempre; ya confirmada, solo hasta 12
           -- horas antes. Misma regla que `cancelar_reserva`.
           (r.estado in ('armando', 'procesando')
            or (r.estado = 'confirmada'
                and now() <= public.inicio_de_reserva(r.fecha, r.hora_inicio) - interval '12 hours')
           ) as puede_cancelar,
           case when r.estado = 'confirmada'
                then public.inicio_de_reserva(r.fecha, r.hora_inicio) - interval '12 hours'
                else null end as cancelacion_hasta
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      join public.complejos c on c.id = k.complejo_id
     where r.organizador_id = v_me
        or public.es_participante_de_reserva(r.id, v_me)
     order by public.inicio_de_reserva(r.fecha, r.hora_inicio) desc
     limit greatest(1, least(coalesce(p_limite, 60), 200));
end;
$$;

revoke all on function public.mis_reservas(integer) from public, anon;
grant execute on function public.mis_reservas(integer) to authenticated;
