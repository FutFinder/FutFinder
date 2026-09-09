-- =============================================================
-- FutFinder migration 72: las canchas de mi recinto
-- =============================================================
-- UN ADMINISTRADOR NO PODÍA LISTAR SUS PROPIAS CANCHAS. La 65 acotó la
-- policy de `canchas_reservables` a los complejos publicados —correcto:
-- sin eso un recinto oculto quedaba con sus canchas a la vista— pero eso
-- deja al dueño de un recinto NO publicado sin forma de verlas, que es
-- justo el estado en que se carga un recinto nuevo.
--
-- Se nota recién al construir la pantalla: el calendario es por cancha, y
-- para elegir cuál hay que poder listarlas. Ninguna de las RPC existentes
-- sirve — `admin_mis_complejos` no baja a las canchas, y la agenda solo
-- nombra las que tuvieron movimiento ese día.
--
-- No se toca la policy: se agrega una RPC, que es la puerta por la que ya
-- entra todo lo demás del recinto (mismo criterio que la migración 50).
-- Así el descubrimiento del jugador sigue viendo solo lo publicado, y la
-- administración pasa por una función que valida quién llama.
--
-- QUÉ DEVUELVE DE MÁS: `tiene_horario` y `tiene_tarifas`. La primera es la
-- condición que exige `admin_publicar_complejo` («al menos una cancha
-- activa con horario cargado»), así que la pantalla puede decir qué falta
-- antes de que el servidor rechace. La segunda distingue una cancha con
-- precio único de una con tarifas por franja, que se administran distinto.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create or replace function public.admin_canchas_complejo(p_complejo_id uuid)
returns table (
    id uuid,
    complejo_id uuid,
    nombre text,
    tipo text,
    precio_hora integer,
    duracion_slot_min integer,
    activa boolean,
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
