-- =============================================================
-- FutFinder migration 87: devolver un pago
-- =============================================================
-- `estado = 'reversar'` ES PLATA DE ALGUIEN QUE NO RECIBIÓ NADA. Lo pone
-- `confirmar_pago` (migración 78) cuando el jugador pagó y, entre medio,
-- otro grupo se llevó el bloque: la plata se movió y no hay cancha.
--
-- La 78 dejó el estado y el índice, pero no dejó cómo salir de él. Una vez
-- devuelto el dinero no había forma de anotarlo, así que la lista de
-- pendientes iba a crecer para siempre y a la tercera nadie iba a saber
-- cuál ya estaba resuelta.
--
-- ESTA MIGRACIÓN NO DEVUELVE PLATA. Devolverla es una llamada a Flow que
-- necesita credenciales que todavía no existen. Lo que hace es dejar el
-- ciclo cerrado: 'reversar' → 'reversado', con quién lo hizo, cuándo y
-- una nota. El día que la pasarela esté conectada, la Edge Function llama
-- a esta misma función después de que Flow confirme la devolución.
--
-- SOLO `service_role`. La devolución la hace el equipo, no el jugador ni
-- el recinto: es plata de FutFinder saliendo. Igual que
-- `confirmar_pago` y `rechazar_pago`.
--
-- NO SE BORRA NI SE REESCRIBE EL PAGO. Queda la fila con su monto, su
-- orden y la respuesta cruda del proveedor: cuando alguien reclame por un
-- cobro, eso es lo único que va a servir.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

alter table public.pagos add column if not exists reversado_at timestamptz;
alter table public.pagos add column if not exists reversa_nota text;
alter table public.pagos add column if not exists reversado_por uuid references public.profiles(id);

-- Para la revisión diaria: lo que se debe, de lo más viejo a lo más nuevo.
create index if not exists idx_pagos_por_devolver
    on public.pagos(pagado_at) where estado = 'reversar';

create or replace function public.marcar_pago_reversado(
    p_pago_id uuid,
    p_nota text default null,
    p_reversado_por uuid default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_pago public.pagos;
begin
    select * into v_pago from public.pagos where id = p_pago_id for update;

    if v_pago.id is null then
        return json_build_object('ok', false, 'reason', 'Ese pago no existe');
    end if;

    -- Ya estaba devuelto: anotarlo dos veces no es un error, pero tampoco
    -- puede pisar la fecha ni la nota de la primera vez.
    if v_pago.estado = 'reversado' then
        return json_build_object('ok', true, 'ya_estaba', true,
                                 'reversado_at', v_pago.reversado_at);
    end if;

    -- Y NO se puede marcar como devuelto algo que no había que devolver.
    -- Un pago 'pagado' con su reserva confirmada es plata bien cobrada;
    -- dejarlo pasar acá sería descuadrar la caja con una sola consulta.
    if v_pago.estado <> 'reversar' then
        return json_build_object('ok', false, 'reason',
            'Ese pago está en estado ' || v_pago.estado || ', no hay nada que devolver');
    end if;

    update public.pagos
       set estado = 'reversado',
           reversado_at = now(),
           reversa_nota = nullif(trim(coalesce(p_nota, '')), ''),
           reversado_por = p_reversado_por,
           actualizado_at = now()
     where id = p_pago_id;

    return json_build_object('ok', true, 'pago_id', p_pago_id, 'monto', v_pago.monto);
end;
$$;

revoke all on function public.marcar_pago_reversado(uuid, text, uuid)
    from public, anon, authenticated;
