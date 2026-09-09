-- =============================================================
-- FutFinder migration 65: un recinto se publica cuando está listo
-- =============================================================
-- EL HUECO: `complejos_select` era `using (true)` desde la migración 54,
-- así que TODO recinto cargado quedaba público y reservable desde el
-- primer segundo. Eso rompe tres situaciones distintas, y las tres son
-- reales:
--
--   · Cargar un recinto para probar —o uno que todavía está negociando—
--     lo publica como si fuera cliente. Un jugador podría reservar en un
--     complejo que no sabe que FutFinder existe.
--   · Dar de alta un recinto de verdad lleva varios pasos: canchas,
--     horarios, tarifas, ficha. Con el modelo viejo aparecía en el
--     buscador a mitad de camino, vacío o con precios sin cargar.
--   · El día que haga falta suspender un recinto, no había cómo.
--
-- `publicado` arranca en `false`, que es lo correcto: se carga, se
-- revisa, se publica. Las migraciones 54 a 64 no dejaron ningún complejo
-- en producción, así que no hay nada que rellenar; si hubiera, habría que
-- correr un `update ... set publicado = true` para los que ya estaban
-- visibles.
--
-- QUÉ IMPLICA NO ESTAR PUBLICADO: no aparece en el descubrimiento, sus
-- canchas tampoco, y `get_disponibilidad_cancha` se niega a devolver
-- horarios. O sea, no se puede reservar. Lo que NO cambia son las
-- reservas ya confirmadas: siguen existiendo, siguen en la agenda del
-- recinto y el jugador las sigue viendo. Despublicar es dejar de recibir
-- reservas nuevas, no cancelar las que hay — mismo criterio que
-- desactivar una cancha en la migración 60.
--
-- QUIÉN PUBLICA: el propio administrador del recinto, cuando termina de
-- cargarlo. FutFinder ya controla quién existe (el complejo y su primer
-- dueño los crea `service_role`), así que no hace falta un segundo
-- permiso — y obligar a pedirle a FutFinder que apriete un botón para
-- salir a la venta es fricción sin ningún beneficio.
--
-- CON UNA CONDICIÓN, que es la regla que el propio diseño ya enunciaba:
-- no se puede publicar un recinto sin al menos una cancha ACTIVA y con
-- horario cargado. Sin eso el recinto aparece en el buscador y no se le
-- puede reservar nada, que es peor que no aparecer.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

alter table public.complejos
  add column if not exists publicado boolean not null default false;

create index if not exists idx_complejos_publicado on public.complejos(publicado) where publicado;

-- ── Descubrimiento: solo lo publicado ────────────────────────────
drop policy if exists "complejos_select" on public.complejos;
create policy "complejos_select"
    on public.complejos for select
    using (publicado);

-- Las canchas de un recinto no publicado tampoco se ven. Sin esto, el
-- complejo quedaría oculto pero sus canchas visibles, y cualquiera con
-- el `cancha_id` podría trabajar contra él.
drop policy if exists "canchas_reservables_select" on public.canchas_reservables;
create policy "canchas_reservables_select"
    on public.canchas_reservables for select
    using (
        exists (
            select 1 from public.complejos c
             where c.id = canchas_reservables.complejo_id
               and c.publicado
        )
    );

-- ── Publicar y despublicar ───────────────────────────────────────
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
    end if;

    update public.complejos
       set publicado = p_publicado,
           updated_at = now()
     where id = p_complejo_id;
end;
$$;

revoke all on function public.admin_publicar_complejo(uuid, boolean) from public, anon;
grant execute on function public.admin_publicar_complejo(uuid, boolean) to authenticated;

-- ── El panel necesita saber si está publicado ───────────────────
-- `admin_mis_complejos` de la migración 60 con una columna más. Es
-- `security definer`, así que sigue devolviendo los recintos NO
-- publicados a quien los administra — que es justamente el caso de un
-- recinto a medio cargar.
--
-- HACE FALTA EL `drop` y no alcanza `create or replace`: agregar una
-- columna a un `returns table` cambia el tipo de la fila de salida, y
-- Postgres lo rechaza con «cannot change return type of existing
-- function». Es distinto de cambiar el cuerpo, que sí se reemplaza en
-- caliente. El `drop` se lleva los privilegios, así que los `grant` de
-- abajo no son decorativos: sin ellos la función quedaría sin permisos.
-- Nada más en la base depende de esta función (la llama solo el
-- cliente), así que el `drop` es seguro.
drop function if exists public.admin_mis_complejos();

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
    publicado boolean,
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
           c.publicado,
           c.rating_avg, c.rating_count, c.created_at, c.updated_at,
           ca.rol
      from public.complejos c
      join public.complejo_admins ca on ca.complejo_id = c.id
     where ca.user_id = auth.uid()
     order by c.nombre;
$$;

revoke all on function public.admin_mis_complejos() from public, anon;
grant execute on function public.admin_mis_complejos() to authenticated;

-- ── La disponibilidad respeta lo no publicado ───────────────────
-- Es la versión de la migración 64 (la vigente, con el precio por
-- franja) con el chequeo de `publicado` agregado.

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
    -- Recinto no publicado: no se puede reservar (migración 65). Va acá
    -- y no solo en la policy porque esta función es `security definer` y
    -- por lo tanto se salta la RLS: sin este chequeo, cualquiera con un
    -- `cancha_id` obtendría los horarios de un recinto que todavía no
    -- salió a la venta.
    if not exists (
        select 1 from public.complejos c
         where c.id = v_cancha.complejo_id and c.publicado
    ) then
        return json_build_object('ok', false, 'reason', 'Cancha no disponible');
    end if;

    v_dow := extract(dow from p_fecha)::integer;
    v_slot_min := v_cancha.duracion_slot_min;

    select coalesce(json_agg(json_build_object(
               'hora_inicio', to_char(s.hora_inicio, 'HH24:MI'),
               'hora_fin', to_char(s.hora_inicio + (v_slot_min || ' minutes')::interval, 'HH24:MI'),
               -- Precio del bloque (migración 64). Antes no hacía falta
               -- porque toda la cancha valía lo mismo; con franjas, el
               -- jugador elegiría una hora sin saber cuánto cuesta.
               'precio', public.precio_de_bloque(p_cancha_id, p_fecha, s.hora_inicio),
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
grant execute on function public.get_disponibilidad_cancha(uuid, date) to authenticated, anon;
