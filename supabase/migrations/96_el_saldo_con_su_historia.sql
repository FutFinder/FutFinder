-- =============================================================
-- FutFinder migration 96: el saldo, con la historia de cada peso
-- =============================================================
-- NO HAY NINGUNA PANTALLA DONDE VER EL SALDO. `get_mi_balance` existe
-- desde la 56 y hasta hoy no la llamaba nadie más que un aviso de la
-- pantalla del grupo. Con el pago dividido andando, alguien a quien le
-- cobraron su parte no tiene dónde comprobarlo.
--
-- EL SALDO NO ES DE RESERVAS, ES DE LA PERSONA. El pago entre capitanes
-- (modalidad 'capitanes', migración 55) también exige Balance, así que
-- cuando un desafío de clubes ofrezca reservar la cancha, el saldo va a
-- importar fuera del vertical de Reservas. Por eso la pantalla vive en
-- Perfil y Reservas solo tiene un acceso directo.
--
-- LO QUE FALTABA ERA EL CONTEXTO, NO EL NÚMERO. Los movimientos venían
-- como `{tipo, monto, reserva_id}`: un «-9000» con un uuid al lado. Para
-- que la lista sirva de algo hay que poder leer «Cancha 1 · Baby, jueves
-- 17» y reconocer el partido. Se agregan el nombre de la cancha, el del
-- recinto y la fecha y hora de la reserva.
--
-- SE DEVUELVEN DATOS, NO TEXTO ARMADO. La etiqueta que ve la persona
-- («Cargaste saldo», «Pagaste tu parte», «Te devolvimos») se compone en
-- el cliente, donde se puede probar con `node --test` y cambiar sin una
-- migración. La base no debería ser dueña de las palabras de una
-- pantalla.
--
-- `security definer` PARA QUE UN RECINTO DESPUBLICADO NO BORRE TU
-- HISTORIAL. La RLS de `complejos` solo muestra lo publicado; sin esto,
-- el día que un recinto sale de FutFinder, los cobros que esa persona
-- pagó ahí se quedarían sin nombre. Es el mismo motivo por el que
-- `mis_reservas` es una RPC y no una consulta directa (migración 86).
--
-- OJO CON LA SOBRECARGA: agregar `p_limite` con `default` NO reemplaza
-- `get_mi_balance()`, crea una SEGUNDA función, y entonces la llamada
-- sin argumentos calza con las dos y Postgres la rechaza por ambigua.
-- Ya pasó tres veces en este proyecto (la 67, la 68 y la 69). Por eso se
-- suelta la vieja primero — y por eso hay que volver a conceder los
-- permisos, que `drop` se lleva consigo.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

drop function if exists public.get_mi_balance();
drop function if exists public.get_mi_balance(integer);

create function public.get_mi_balance(p_limite integer default 50)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_saldo integer;
    v_movimientos json;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    -- El saldo es la SUMA DEL LIBRO, siempre, y nunca un campo guardado
    -- aparte (migración 56): así no hay forma de que el número que se
    -- muestra se desincronice de los movimientos que lo explican. Se
    -- calcula sobre TODO el historial aunque la lista venga recortada.
    select coalesce(sum(monto), 0) into v_saldo
      from public.balance_movimientos where user_id = v_me;

    select coalesce(json_agg(t order by t.created_at desc), '[]'::json)
      into v_movimientos
      from (
        select m.id, m.tipo, m.monto, m.created_at, m.metodo_carga, m.reserva_id,
               k.nombre as cancha_nombre,
               c.nombre as complejo_nombre,
               r.fecha as reserva_fecha,
               r.hora_inicio as reserva_hora
          from public.balance_movimientos m
          left join public.reservas r on r.id = m.reserva_id
          left join public.canchas_reservables k on k.id = r.cancha_id
          left join public.complejos c on c.id = k.complejo_id
         where m.user_id = v_me
         order by m.created_at desc
         limit greatest(1, least(coalesce(p_limite, 50), 200))
      ) t;

    return json_build_object(
        'ok', true,
        'saldo', v_saldo,
        'movimientos', v_movimientos,
        -- Para que la pantalla sepa si la lista está recortada sin tener
        -- que contar filas por su cuenta.
        'total_movimientos', (select count(*) from public.balance_movimientos where user_id = v_me)
    );
end;
$$;

revoke all on function public.get_mi_balance(integer) from public, anon;
grant execute on function public.get_mi_balance(integer) to authenticated;
