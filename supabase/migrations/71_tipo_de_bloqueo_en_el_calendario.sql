-- =============================================================
-- FutFinder migration 71: el calendario también sabe de qué tipo es
-- el bloqueo
-- =============================================================
-- LA 69 EXTENDIÓ LA AGENDA Y SE OLVIDÓ DEL CALENDARIO. `tipo`,
-- `contacto_nombre` y `contacto_telefono` llegan en el arreglo de bloqueos
-- de `admin_agenda_complejo`, pero el objeto `bloqueo` de cada slot de
-- `admin_calendario_cancha` sigue devolviendo solo `id`, `motivo` y las
-- horas.
--
-- Se nota recién al construir la pantalla: el calendario del día es donde
-- el recinto toca una hora marcada para corregirla, y sin `tipo` la hoja
-- de edición no puede saber si mostrar los campos de contacto ni con qué
-- valores llegar. La alternativa —pedir la agenda del complejo entero
-- para cruzar por id— sería una llamada de más para un dato que esta RPC
-- ya tiene en la mano.
--
-- Nada más cambia: la función se recrea completa e idéntica a la que dejó
-- la 67, salvo esas dos líneas. Misma firma, así que `create or replace`
-- basta.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create or replace function public.admin_calendario_cancha(
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
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;

    select * into v_cancha from public.canchas_reservables where id = p_cancha_id;
    if v_cancha is null then
        return json_build_object('ok', false, 'reason', 'Cancha no existe');
    end if;

    v_dow := extract(dow from p_fecha)::integer;
    v_slot_min := v_cancha.duracion_slot_min;

    select coalesce(json_agg(s order by s.hora_inicio), '[]'::json)
      into v_slots
      from (
          select to_char(g.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(g.hora_fin, 'HH24:MI')    as hora_fin,
                 -- Mismo precio que ve el jugador, resuelto por la misma
                 -- función: si el recinto viera otro número, el problema
                 -- sería del recinto y del soporte, no del jugador.
                 public.precio_de_bloque(p_cancha_id, p_fecha, g.hora_inicio) as precio,
                 case
                     when bl.id is not null then 'bloqueada'
                     when res.id is not null then 'reservada'
                     else 'libre'
                 end as estado,
                 case when bl.id is null then null else json_build_object(
                     'id', bl.id, 'motivo', bl.motivo, 'tipo', bl.tipo,
                     'contacto_nombre', bl.contacto_nombre,
                     'contacto_telefono', bl.contacto_telefono,
                     'hora_inicio', to_char(bl.hora_inicio, 'HH24:MI'),
                     'hora_fin', to_char(bl.hora_fin, 'HH24:MI')
                 ) end as bloqueo,
                 case when res.id is null then null else json_build_object(
                     'id', res.id, 'estado', res.estado,
                     'modalidad', res.modalidad, 'medio_pago', res.medio_pago,
                     'precio_total', res.precio_total,
                     'organizador_username', res.username,
                     'organizador_foto_url', res.foto_url,
                     'contacto_nombre', res.contacto_nombre,
                     'contacto_telefono', res.contacto_telefono
                 ) end as reserva,
                 -- Grupos que están juntando la plata sobre este bloque.
                 -- NO lo ocupan: el bloque sigue 'libre'.
                 (select count(*)
                    from public.reservas r2
                   where r2.cancha_id = p_cancha_id
                     and r2.fecha = p_fecha
                     and r2.estado in ('armando', 'procesando')
                     and g.hora_inicio < r2.hora_fin
                     and g.hora_fin > r2.hora_inicio) as grupos_en_curso
            from (
                select h as hora_inicio,
                       (h + (v_slot_min || ' minutes')::interval)::time as hora_fin
                  from (
                      select generate_series(
                                 (p_fecha + hr.hora_apertura)::timestamp,
                                 (p_fecha + hr.hora_cierre)::timestamp - (v_slot_min || ' minutes')::interval,
                                 (v_slot_min || ' minutes')::interval
                             )::time as h
                        from public.cancha_horario_reglas hr
                       where hr.cancha_id = p_cancha_id
                         and hr.dia_semana = v_dow
                  ) gen
            ) g
            left join lateral (
                select b.id, b.motivo, b.tipo, b.contacto_nombre, b.contacto_telefono,
                       b.hora_inicio, b.hora_fin
                  from public.cancha_bloqueos b
                 where b.cancha_id = p_cancha_id
                   and b.fecha = p_fecha
                   and g.hora_inicio < b.hora_fin
                   and (case when g.hora_fin <= g.hora_inicio then time '24:00' else g.hora_fin end) > b.hora_inicio
                 limit 1
            ) bl on true
            left join lateral (
                select r.id, r.estado, r.modalidad, r.medio_pago, r.precio_total,
                       p.username, p.foto_url,
                       case when public.contacto_visible(r.id) then ct.nombre end   as contacto_nombre,
                       case when public.contacto_visible(r.id) then ct.telefono end as contacto_telefono
                  from public.reservas r
                  join public.profiles p on p.id = r.organizador_id
                  left join public.reserva_contacto ct on ct.reserva_id = r.id
                 where r.cancha_id = p_cancha_id
                   and r.fecha = p_fecha
                   and r.estado = 'confirmada'
                   and g.hora_inicio < r.hora_fin
                   and (case when g.hora_fin <= g.hora_inicio then time '24:00' else g.hora_fin end) > r.hora_inicio
                 limit 1
            ) res on true
      ) s;

    return json_build_object(
        'ok', true,
        'cancha_id', p_cancha_id,
        'cancha_nombre', v_cancha.nombre,
        'duracion_slot_min', v_slot_min,
        'activa', v_cancha.activa,
        'fecha', to_char(p_fecha, 'YYYY-MM-DD'),
        'slots', v_slots
    );
end;
$$;

revoke all on function public.admin_calendario_cancha(uuid, date) from public, anon;
grant execute on function public.admin_calendario_cancha(uuid, date) to authenticated;
