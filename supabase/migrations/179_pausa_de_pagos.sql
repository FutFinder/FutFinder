-- =============================================================
-- 179. UN INTERRUPTOR PARA DEJAR DE COBRAR
--
-- PARA QUÉ. El día que la pasarela cobre doble, Flow esté caído a medias o
-- haya un fallo nuestro en el camino del pago, lo primero es dejar de crear
-- cobros nuevos — sin desplegar nada y sin tocar los que ya están en vuelo.
-- Hasta hoy la única manera de «apagar» los pagos era borrar los secretos
-- de la Edge Function, y eso apaga también lo que NO hay que apagar:
-- `flow-confirmacion` necesita esas mismas credenciales para preguntarle a
-- Flow por un pago que la persona ya hizo.
--
-- QUÉ HACE. La bandera `pagos_en_pausa` (apagada = se cobra normal). Con la
-- bandera encendida:
--   · no nace ninguna fila en `pagos` (disparador `tg_pagos_en_pausa`,
--     antes de INSERT): ni por `iniciar_pago_reserva` ni por ninguna función
--     de pago que se agregue después;
--   · `pagar-reserva` la consulta ANTES de hablar con la base o con Flow y
--     contesta con un motivo que la app muestra (`pagos_en_pausa()`).
--
-- QUÉ NO HACE, A PROPÓSITO. No mira UPDATE: confirmar, rechazar, marcar
-- para devolver y devolver siguen funcionando con la bandera encendida. Un
-- pago que alguien ya hizo en Flow se registra igual. Tampoco toca el pago
-- con saldo (`balance_movimientos`): es otro camino y no pasa por `pagos`.
--
-- POR QUÉ DISPARADOR Y NO UN `if` EN `iniciar_pago_reserva`. La misma razón
-- de la 84 (`tg_pago_no_del_pasado`): cubre cualquier función de pago, y no
-- obliga a copiar acá el cuerpo vigente de una función larga.
--
-- CÓMO SE USA (editor SQL, como service_role):
--   update public.feature_flags
--      set activo = true, activado_at = coalesce(activado_at, now())
--    where nombre = 'pagos_en_pausa';       -- pausar
--   update public.feature_flags set activo = false
--    where nombre = 'pagos_en_pausa';       -- reanudar
--
-- Idempotente. No cambia nada mientras la bandera esté apagada, que es como
-- nace.
-- =============================================================

insert into public.feature_flags (nombre, activo, descripcion) values
  ('pagos_en_pausa', false,
   'Corta la creación de cobros nuevos con tarjeta. No afecta la confirmación ni la devolución de los que ya existen.')
on conflict (nombre) do nothing;

-- Lo que le pregunta la Edge Function. Función propia y no `flag_activo`
-- directo para que el nombre de la bandera viva en un solo lugar.
create or replace function public.pagos_en_pausa()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.flag_activo('pagos_en_pausa');
$$;

revoke all on function public.pagos_en_pausa() from public, anon, authenticated;
grant execute on function public.pagos_en_pausa() to service_role;

create or replace function public.tg_pagos_en_pausa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if public.flag_activo('pagos_en_pausa') then
        -- 55000 = object_not_in_prerequisite_state. Código propio para que
        -- quien lo reciba pueda distinguirlo de un fallo cualquiera.
        raise exception 'Los pagos con tarjeta están en pausa'
            using errcode = '55000', hint = 'pagos_en_pausa';
    end if;
    return NEW;
end;
$$;

revoke all on function public.tg_pagos_en_pausa() from public, anon, authenticated;

drop trigger if exists tg_pagos_en_pausa on public.pagos;
create trigger tg_pagos_en_pausa
    before insert on public.pagos
    for each row execute function public.tg_pagos_en_pausa();
