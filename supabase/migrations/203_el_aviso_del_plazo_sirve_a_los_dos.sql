-- =============================================================
-- FutFinder migration 203: el aviso del plazo sirve a los dos capitanes
-- =============================================================
-- Revisión con un desafío real (2026-11-27): cuando vencen los 15 minutos,
-- `soltar_reservas_de_desafio_vencidas()` (202) cancela la reserva con un
-- motivo, y `cancelar_reserva_interna` manda ESE texto como aviso a TODOS
-- los participantes. El texto decía «el club rival no pagó su mitad», y el
-- capitán rival —que es justamente quien no pagó— recibía que «el rival» no
-- había pagado.
--
-- La frase nueva es verdad para los dos lados, sin decir quién es «el
-- rival»: «Pasaron los 15 minutos sin las dos mitades pagadas…». Sólo cambia
-- ese texto; el resto del cuerpo es el de la 202.
--
-- Idempotente.
-- =============================================================

create or replace function public.soltar_reservas_de_desafio_vencidas()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_soltadas integer := 0;
begin
    -- El disparador de los eventos lee este motivo para decir POR QUÉ se
    -- soltó. Es local a la transacción.
    perform set_config('futfinder.motivo_soltar', 'plazo', true);

    for v_id in
        select r.id
          from public.reservas r
          join public.matches m on m.reserva_id = r.id
         where r.es_desafio_club
           and r.estado in ('armando', 'procesando')
           and public.plazo_de_la_reserva_del_desafio(r.id) < now()
    loop
        -- Este texto le llega a LOS DOS capitanes: no puede decir «el rival».
        perform public.cancelar_reserva_interna(
            v_id,
            'Pasaron los 15 minutos sin las dos mitades pagadas. Se soltó la cancha y no se le cobró nada a nadie.');
        v_soltadas := v_soltadas + 1;
    end loop;

    return json_build_object('ok', true, 'soltadas', v_soltadas);
end;
$$;

revoke all on function public.soltar_reservas_de_desafio_vencidas() from public, anon, authenticated;
