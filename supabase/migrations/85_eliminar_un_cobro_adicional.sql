-- =============================================================
-- FutFinder migration 85: eliminar un cobro adicional
-- =============================================================
-- SE PODÍA APAGAR UN COBRO PERO NO SACARLO. La 68 dejó `activo` para
-- dejar de ofrecerlo sin perder el historial, y eso está bien para un
-- cobro que ya se usó. Pero uno que se creó por error —un nombre mal
-- escrito, un precio de prueba— se queda para siempre en la lista del
-- recinto, apagado y estorbando.
--
-- NO SE PUEDE BORRAR TODO SIEMPRE, y no es una decisión de diseño: hay
-- una clave foránea de `reserva_cobros.cobro_id` a `complejo_cobros(id)`
-- sin cascada. Borrar un cobro que está en una reserva ya hecha reventaría
-- la consulta, y con cascada se llevaría por delante la línea de una
-- reserva que alguien pagó.
--
-- Así que la función hace lo que se puede en cada caso, EN UN SOLO PASO:
--
--   · nunca usado  → se borra de verdad y desaparece de la lista;
--   · ya usado     → se apaga, y se DICE que se apagó y por qué. Deja de
--                    ofrecerse a los jugadores, que es lo que la persona
--                    quería, sin reescribir lo que ya se cobró.
--
-- Devolver `resultado` con cuál de los dos pasó es lo que le permite a la
-- pantalla decir la verdad en vez de un «listo» que a veces miente.
--
-- EL PERMISO NO SE COMPRUEBA ACÁ: el disparador `tg_permiso_cobros` de la
-- 83 ya cubre INSERT, UPDATE y DELETE sobre `complejo_cobros`, así que un
-- administrador sin `puede_cobros` no pasa ni por el borrado ni por el
-- apagado. Repetirlo sería tener dos reglas que mantener sincronizadas.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create or replace function public.admin_eliminar_cobro(p_cobro_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cobro public.complejo_cobros;
    v_usos integer;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select * into v_cobro from public.complejo_cobros where id = p_cobro_id;
    if v_cobro.id is null then
        -- Tocar dos veces el botón no es un error.
        return json_build_object('ok', true, 'resultado', 'ya_no_estaba');
    end if;
    if not public.es_admin_complejo(v_cobro.complejo_id) then
        raise exception 'No administras este complejo';
    end if;

    select count(*) into v_usos
      from public.reserva_cobros rc where rc.cobro_id = p_cobro_id;

    if v_usos = 0 then
        delete from public.complejo_cobros where id = p_cobro_id;
        return json_build_object('ok', true, 'resultado', 'eliminado');
    end if;

    -- Ya se cobró alguna vez: se apaga. Si ya estaba apagado, igual se
    -- devuelve 'apagado' — el resultado para la persona es el mismo y no
    -- hay nada que explicarle sobre el estado anterior.
    update public.complejo_cobros set activo = false where id = p_cobro_id;

    return json_build_object('ok', true, 'resultado', 'apagado', 'usos', v_usos);
end;
$$;

revoke all on function public.admin_eliminar_cobro(uuid) from public, anon;
grant execute on function public.admin_eliminar_cobro(uuid) to authenticated;
