-- =============================================================
-- FutFinder — migración 44c: editar un partido vuelve a funcionar
--
-- INDEPENDIENTE DE LA 44b. No tiene nada que ver con los partidos de
-- clubes ni con la ubicación protegida; se encontró al probar aquélla y
-- se corrige aparte a propósito. El sufijo `c` sólo indica que es una
-- corrección que entra sobre la serie 44, no que corrija a la 44.
--
-- EL FALLO. `notify_match_updated()` acumula en un `text[]` los campos
-- que cambiaron:
--
--     v_cambios := v_cambios || 'la fecha y hora';
--
-- PostgreSQL tiene dos operadores candidatos para `||` con un arreglo a
-- la izquierda —`anyarray || anyelement` y `anyarray || anyarray`— y
-- con un literal SIN TIPO a la derecha resuelve el segundo: intenta
-- leer «la fecha y hora» como literal de arreglo y falla con
-- «malformed array literal». Como el trigger es `AFTER UPDATE` sobre
-- `matches`, el error sube y aborta la actualización entera.
--
-- El efecto real, comprobado contra el proyecto: cambiar la HORA, la
-- CANCHA, la COMUNA o la CUOTA de cualquier partido —normal o de
-- clubes— era imposible. Editar un partido estaba roto. Sólo pasaba
-- cambiar la descripción, porque entonces ninguno de los cuatro campos
-- vigilados se mueve y la función sale antes por su `return`.
--
-- Nunca saltó en las pruebas porque `notify_match_updated` no está
-- versionada —es de los objetos aplicados por consola que documenta el
-- P1 de pendientes— y ninguna prueba SQL actualizaba un partido.
--
-- EL ARREGLO: `array_append()`, que no tiene ambigüedad posible. La
-- alternativa sería castear cada literal a `::text`; `array_append` dice
-- lo que hace y no depende de que nadie olvide el casteo al añadir un
-- campo nuevo mañana.
--
-- Lo demás de la función queda EXACTAMENTE igual: los mismos cuatro
-- campos vigilados, el mismo texto, los mismos destinatarios (los
-- inscritos, nunca el organizador) y la misma salida temprana cuando el
-- partido se está cancelando.
-- =============================================================

create or replace function public.notify_match_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cambios text[] := array[]::text[];
    v_row     record;
    v_body    text;
begin
    if new.estado = 'cancelado' then
        return new; -- la cancelación tiene su propio aviso
    end if;

    -- `array_append` y no `||`: con un literal sin tipo, `||` resuelve
    -- `anyarray || anyarray` e intenta leer el texto como arreglo.
    if new.hora is distinct from old.hora then
        v_cambios := array_append(v_cambios, 'la fecha y hora');
    end if;
    if new.cancha_nombre is distinct from old.cancha_nombre then
        v_cambios := array_append(v_cambios, 'la cancha');
    end if;
    if new.comuna is distinct from old.comuna then
        v_cambios := array_append(v_cambios, 'la comuna');
    end if;
    if new.precio_cuota is distinct from old.precio_cuota then
        v_cambios := array_append(v_cambios, 'la cuota');
    end if;

    if array_length(v_cambios, 1) is null then
        return new;
    end if;

    v_body := format('El organizador cambió %s de «%s».',
                     array_to_string(v_cambios, ', '), new.titulo);

    for v_row in
        select id_jugador from public.attendees
        where id_partido = new.id
          and estado in ('pendiente', 'inscrito', 'confirmado_gps')
          and id_jugador <> new.id_organizador
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_updated', 'Cambió tu partido', v_body,
                jsonb_build_object('matchId', new.id));
    end loop;

    return new;
end;
$$;
