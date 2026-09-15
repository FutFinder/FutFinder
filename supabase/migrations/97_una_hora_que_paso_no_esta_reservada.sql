-- =============================================================
-- FutFinder migration 97: una hora que pasó no está «Reservada»
-- =============================================================
-- A LAS 23:30 EL RECINTO SE VE COMPLETAMENTE COPADO, Y NO LO ESTÁ.
-- Abriendo la app de noche, la grilla de hoy mostraba «0 de 14 libres» y
-- las catorce horas tachadas con la etiqueta «Reservada». De esas
-- catorce, TRECE no las reservó nadie: el día simplemente se acabó.
--
-- El servidor estaba bien —la 84 dejó de ofrecer bloques ya empezados— y
-- el error es de lo que la pantalla puede DECIR: `disponible: false` es
-- lo único que llega, así que «no se puede reservar» y «alguien la tomó»
-- se pintan igual. La etiqueta «Reservada» se eligió en su momento
-- (cuando la única causa de no-disponible era una reserva o un bloqueo) y
-- desde la 84 miente en el caso más frecuente del día.
--
-- No es un detalle estético: alguien que entra a las 23:00, ve todo
-- «Reservada» y concluye que el recinto siempre está lleno, no vuelve a
-- mirar. Es la clase de error que se lleva un cliente sin dejar rastro.
--
-- SE AGREGA `pasada`, Y NO UN «MOTIVO» GENERAL. La regla de privacidad
-- del vertical es que el jugador NUNCA sabe por qué una hora no está: ni
-- que hay una reserva de otra persona, ni que el recinto cerró por
-- mantención. Eso no se toca. Pero «esa hora ya pasó» no es información
-- de nadie: es el reloj, y el teléfono ya lo sabe. Distinguir solo ese
-- caso deja la pantalla honesta sin abrir nada.
--
-- POR QUÉ NO LO CALCULA EL CLIENTE. Podría comparar la hora del bloque
-- con la del teléfono, pero eso es una segunda copia de una regla de
-- tiempo — y este proyecto ya arrastró un error de huso por tener el
-- corte en dos partes (migración 70). `inicio_de_reserva` resuelve
-- America/Santiago; el teléfono de alguien en otro huso, no.
--
-- `disponible` NO CAMBIA de significado: una hora pasada sigue viniendo
-- con `disponible: false`, así que nada de lo que ya leía esta función se
-- rompe por el campo nuevo.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create or replace function public.get_disponibilidad_cancha(p_cancha_id uuid, p_fecha date)
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
    -- por lo tanto se salta la RLS.
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
               -- Precio del bloque (migración 64).
               'precio', public.precio_de_bloque(p_cancha_id, p_fecha, s.hora_inicio),
               -- NUEVO EN LA 97: si la hora ya pasó. No rompe la regla de
               -- privacidad —el reloj no es información de nadie— y es lo
               -- único que le permite a la pantalla no llamar «Reservada»
               -- a media jornada que nadie tomó.
               'pasada', public.inicio_de_reserva(p_fecha, s.hora_inicio) <= now(),
               -- Un bloque que YA EMPEZÓ no se ofrece (migración 84). Se
               -- compara con `inicio_de_reserva`, que resuelve el huso de
               -- Chile; con `current_date` volvería el error de la 70.
               'disponible', public.inicio_de_reserva(p_fecha, s.hora_inicio) > now()
               and not exists (
                   select 1 from public.reservas r
                    where r.cancha_id = p_cancha_id
                      and r.fecha = p_fecha
                      and r.hora_inicio = s.hora_inicio
                      and r.estado = 'confirmada'
               )
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
