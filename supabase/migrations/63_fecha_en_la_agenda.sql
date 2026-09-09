-- =============================================================
-- FutFinder migration 63: `fecha` en cada reserva de la agenda
-- =============================================================
-- Un solo campo, y lo encontró la verificación de contrato: al escribir
-- `src/services/recinto.js` y `src/utils/recintoAgenda.js` se comparó
-- lo que el cliente consume contra lo que las RPC devuelven de verdad,
-- y `admin_agenda_complejo` NO incluía `fecha` en cada reserva — solo
-- en la raíz de la respuesta.
--
-- POR QUÉ IMPORTA TANTO UN CAMPO: la migración 61 dejó a propósito en
-- el cliente el cálculo de si un partido ya se jugó, porque depende de
-- la hora LOCAL de Chile y `now()` en la base es UTC. Ese cálculo
-- necesita `fecha` + `hora_fin` de la reserva. Sin `fecha`, la función
-- del cliente recibía `undefined`, devolvía `false` y **una reserva ya
-- jugada nunca se marcaba como jugada en la agenda**. Sin error, sin
-- excepción, sin síntoma: solo el dato equivocado, que es la peor clase
-- de falla.
--
-- Se arregla en la base y no en el cliente porque el objeto tiene que
-- describirse solo: `admin_reserva_detalle` ya devuelve `fecha`, y
-- obligar a cada pantalla a acordarse de inyectar la fecha del día
-- garantiza que alguna se olvide.
--
-- Es la versión de la migración 62 (la vigente, con el desglose de la
-- comisión) con esa línea agregada y nada más.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create or replace function public.admin_agenda_complejo(
    p_complejo_id uuid,
    p_fecha date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reservas json;
    v_bloqueos json;
    v_resumen json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;

    select coalesce(json_agg(x order by x.hora_inicio, x.cancha_nombre), '[]'::json)
      into v_reservas
      from (
          select r.id,
                 r.cancha_id,
                 k.nombre                      as cancha_nombre,
                 k.tipo                        as cancha_tipo,
                 -- `fecha` en cada reserva y no solo en la raíz de la
                 -- respuesta: sin ella el cliente no puede saber si el
                 -- partido ya terminó. Ver el encabezado.
                 to_char(r.fecha, 'YYYY-MM-DD')    as fecha,
                 to_char(r.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(r.hora_fin, 'HH24:MI')    as hora_fin,
                 r.estado,
                 r.modalidad,
                 r.medio_pago,
                 r.precio_total,
                 -- Desglose de la comisión (migración 62). `left join`
                 -- porque una reserva anterior a esa migración no tiene
                 -- fila: en producción no existe ninguna, pero no se
                 -- asume que no exista.
                 coalesce(c.base, r.precio_total)                        as comision_base,
                 coalesce(c.monto, 0)                                    as comision,
                 coalesce(c.base, r.precio_total) - coalesce(c.monto, 0) as neto,
                 r.es_desafio_club,
                 r.n_jugadores,
                 p.username                    as organizador_username,
                 p.foto_url                    as organizador_foto_url,
                 -- Agregado, nunca la lista: el recinto necesita saber
                 -- si esto se va a completar, no quiénes son.
                 (select count(*) from public.reserva_participantes rp
                   where rp.reserva_id = r.id)                          as participantes_total,
                 (select count(*) from public.reserva_participantes rp
                   where rp.reserva_id = r.id and rp.estado = 'aceptado') as participantes_aceptados,
                 r.cancelada_at
            from public.reservas r
            join public.canchas_reservables k on k.id = r.cancha_id
            join public.profiles p            on p.id = r.organizador_id
            left join public.reserva_comisiones c on c.reserva_id = r.id
           where k.complejo_id = p_complejo_id
             and r.fecha = p_fecha
             and r.estado in ('confirmada', 'armando', 'procesando', 'cancelada')
      ) x;

    select coalesce(json_agg(y order by y.hora_inicio, y.cancha_nombre), '[]'::json)
      into v_bloqueos
      from (
          select b.id,
                 b.cancha_id,
                 k.nombre                      as cancha_nombre,
                 to_char(b.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(b.hora_fin, 'HH24:MI')    as hora_fin,
                 b.motivo
            from public.cancha_bloqueos b
            join public.canchas_reservables k on k.id = b.cancha_id
           where k.complejo_id = p_complejo_id
             and b.fecha = p_fecha
      ) y;

    select json_build_object(
               'reservas_confirmadas', count(*) filter (where r.estado = 'confirmada'),
               'reservas_en_curso',    count(*) filter (where r.estado in ('armando', 'procesando')),
               'reservas_canceladas',  count(*) filter (where r.estado = 'cancelada'),
               -- Solo lo confirmado suma plata: lo que está armando
               -- todavía no es un peso de nadie.
               'monto_confirmado',     coalesce(sum(r.precio_total) filter (where r.estado = 'confirmada'), 0),
               -- Solo las confirmadas pagan comisión: una cancelada no
               -- cobra nada, sin importar quién canceló ni cuándo. Por
               -- eso no hace falta borrar el monto al cancelar — queda
               -- congelado y simplemente no se suma.
               'comision_confirmada',  coalesce(sum(cc.monto) filter (where r.estado = 'confirmada'), 0),
               'neto_confirmado',      coalesce(sum(coalesce(cc.base, r.precio_total) - coalesce(cc.monto, 0))
                                                filter (where r.estado = 'confirmada'), 0),
               'bloqueos', (select count(*) from public.cancha_bloqueos b
                             join public.canchas_reservables k2 on k2.id = b.cancha_id
                            where k2.complejo_id = p_complejo_id and b.fecha = p_fecha),
               'canchas_activas', (select count(*) from public.canchas_reservables
                                    where complejo_id = p_complejo_id and activa),
               'canchas_total', (select count(*) from public.canchas_reservables
                                  where complejo_id = p_complejo_id)
           )
      into v_resumen
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      left join public.reserva_comisiones cc on cc.reserva_id = r.id
     where k.complejo_id = p_complejo_id
       and r.fecha = p_fecha;

    return json_build_object(
        'ok', true,
        'fecha', to_char(p_fecha, 'YYYY-MM-DD'),
        'resumen', v_resumen,
        'reservas', v_reservas,
        'bloqueos', v_bloqueos
    );
end;
$$;

revoke all on function public.admin_agenda_complejo(uuid, date) from public, anon;
grant execute on function public.admin_agenda_complejo(uuid, date) to authenticated;
