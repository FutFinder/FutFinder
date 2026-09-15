-- =============================================================
-- FutFinder migration 101: responder la cancelación del desafío
-- =============================================================
-- LA RESERVA DE UN DESAFÍO NO SE PODÍA CANCELAR NUNCA.
--
-- `cancelar_reserva` no cancela una reserva entre clubes: le PIDE al otro
-- club que acepte, porque cancelarle la cancha al rival por tu cuenta no
-- corresponde. Manda el aviso, deja `cancelacion_estado = 'solicitada'`…
-- y ahí moría. `responder_cancelacion_desafio` existe desde la 55 y
-- NINGUNA pantalla la llamaba: no había forma de aceptar ni de rechazar.
-- Y si el otro club volvía a pedir cancelar, solo repetía la solicitud.
--
-- Plata retenida sin salida: una reserva confirmada que nadie puede
-- cancelar se cobra igual, y el único camino era entrar a la base.
--
-- Salió buscando funciones del servidor que nadie llama. De 146
-- concedidas a `authenticated`, solo dos estaban huérfanas, y esta es la
-- que tenía dinero detrás.
--
-- ── 1. RECHAZAR TAMBIÉN AVISA ──
-- La función aceptaba y rechazaba bien, pero al rechazar no le decía
-- nada a quien lo había pedido: se quedaba esperando una respuesta que
-- ya había llegado. Es el mismo silencio que esta migración viene a
-- tapar, una capa más adentro.
--
-- ── 2. LA LISTA TIENE QUE SABERLO ──
-- `mis_reservas` no devolvía `cancelacion_estado`, así que la pantalla no
-- podía ni mostrar que había una solicitud. Se agrega junto con
-- `puedo_responder_cancelacion`, que la calcula el servidor: el cliente
-- no puede leer `club_members` del club ajeno para saber si le toca a él.
--
-- ES EL CLUB QUE NO PIDIÓ, Y SOLO SU ADMIN. La regla ya estaba en la
-- función; acá se repite para que el botón aparezca exactamente donde se
-- puede apretar, y no en la pantalla del que ya pidió.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 0. El aviso del rechazo ──────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
    type = any (array[
        'match_join', 'friend_request', 'friend_accept', 'message_new',
        'match_reminder', 'match_rate', 'join_request', 'join_approved',
        'join_rejected', 'match_cancelled', 'match_updated', 'match_slot_free',
        'waitlist_turn', 'match_left', 'match_attendance', 'club_request',
        'club_request_accepted', 'club_request_rejected', 'club_member_joined',
        'club_member_left', 'club_invite_accepted', 'club_challenge',
        'club_challenge_accepted', 'club_challenge_rejected', 'chat_mention_all',
        'club_challenge_extension', 'club_challenge_closed',
        'club_challenge_proposal', 'club_challenge_proposal_rejected',
        'club_match_published', 'club_match_reserva_omitida', 'club_match_change',
        'club_match_change_responded', 'club_match_cancelled', 'club_sancionado',
        'club_revision_resuelta', 'club_resultado_propuesto',
        'club_resultado_confirmado', 'club_resultado_disputado',
        'reserva_confirmada', 'reserva_cancelada', 'reserva_invitacion_capitan',
        'reserva_invitacion_jugador', 'reserva_invitacion_rechazada',
        'reserva_cuota_recalculada', 'reserva_saldo_insuficiente',
        'reserva_cancelacion_solicitada', 'balance_cargado',
        'complejo_admin_agregado',
        'reserva_recordatorio_pago', 'reserva_participante_quitado',
        -- Nuevo en la 101:
        'reserva_cancelacion_rechazada'
    ])
);

-- ── 1. Rechazar avisa a quien lo pidió ───────────────────────────
create or replace function public.responder_cancelacion_desafio(
    p_reserva_id uuid,
    p_acepta boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_mi_club_id uuid;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if not v_reserva.es_desafio_club or v_reserva.cancelacion_estado <> 'solicitada' then
        return json_build_object('ok', false, 'reason', 'No hay una solicitud de cancelación pendiente');
    end if;

    -- Responde el club que NO la pidió: el que pidió ya dijo lo suyo.
    select m.club_id into v_mi_club_id
      from public.club_members m
     where m.user_id = v_me and m.rol = 'admin'
       and m.club_id in (v_reserva.club_organizador_id, v_reserva.club_rival_id)
       and m.club_id <> v_reserva.cancelacion_solicitada_por_club_id
     limit 1;

    if v_mi_club_id is null then
        return json_build_object('ok', false, 'reason', 'Solo el club que no pidió la cancelación puede responder');
    end if;

    if not p_acepta then
        update public.reservas set cancelacion_estado = 'rechazada' where id = p_reserva_id;

        -- NUEVO EN LA 101: avisar. Antes el club que pidió cancelar se
        -- quedaba esperando una respuesta que ya había llegado.
        insert into public.notifications (user_id, type, title, body, data)
        select m.user_id, 'reserva_cancelacion_rechazada', 'El otro club no quiere cancelar',
               'La cancha del desafío sigue reservada. Hablen y vuelvan a intentarlo si hace falta.',
               jsonb_build_object('reservaId', p_reserva_id)
          from public.club_members m
         where m.rol = 'admin' and m.club_id = v_reserva.cancelacion_solicitada_por_club_id;

        return json_build_object('ok', true, 'cancelacion_estado', 'rechazada');
    end if;

    -- Aceptar es cancelar de verdad: se reusa la misma cola que el resto
    -- —devolver, marcar cancelada, avisar— en vez de repetirla acá.
    return public.cancelar_reserva_interna(
        p_reserva_id,
        'El otro club aceptó cancelar la reserva del desafío.'
    );
end;
$$;

revoke all on function public.responder_cancelacion_desafio(uuid, boolean) from public, anon;
grant execute on function public.responder_cancelacion_desafio(uuid, boolean) to authenticated;

-- ── 2. La lista tiene que poder mostrarlo ────────────────────────
-- `create or replace` no puede cambiar el tipo de fila de un
-- `returns table`: hay que soltar y recrear, y volver a conceder.
drop function if exists public.mis_reservas(integer);

create function public.mis_reservas(p_limite integer default 60)
returns table (
    id uuid,
    fecha date,
    hora_inicio time,
    hora_fin time,
    inicio timestamptz,
    estado text,
    modalidad text,
    medio_pago text,
    precio_total integer,
    cuota integer,
    soy_organizador boolean,
    cancha_id uuid,
    cancha_nombre text,
    cancha_tipo text,
    complejo_id uuid,
    complejo_nombre text,
    complejo_direccion text,
    complejo_comuna text,
    complejo_foto_url text,
    complejo_latitud numeric,
    complejo_longitud numeric,
    pago_estado text,
    cobros json,
    puede_cancelar boolean,
    cancelacion_hasta timestamptz,
    n_jugadores integer,
    cupos integer,
    listos integer,
    mi_estado text,
    es_desafio_club boolean,
    cancelacion_estado text,
    puedo_responder_cancelacion boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        return;
    end if;

    return query
    select r.id,
           r.fecha,
           r.hora_inicio,
           r.hora_fin,
           public.inicio_de_reserva(r.fecha, r.hora_inicio) as inicio,
           r.estado,
           r.modalidad,
           r.medio_pago,
           r.precio_total,
           r.cuota,
           (r.organizador_id = v_me) as soy_organizador,
           k.id,
           k.nombre,
           k.tipo,
           c.id,
           c.nombre,
           c.direccion,
           c.comuna,
           c.foto_url,
           c.latitud,
           c.longitud,
           (select p.estado from public.pagos p
             where p.reserva_id = r.id
             order by p.created_at desc limit 1) as pago_estado,
           (select coalesce(json_agg(json_build_object('nombre', rc.nombre, 'precio', rc.precio)
                            order by rc.precio), '[]'::json)
              from public.reserva_cobros rc where rc.reserva_id = r.id) as cobros,
           (r.estado in ('armando', 'procesando')
            or (r.estado = 'confirmada'
                and now() <= public.inicio_de_reserva(r.fecha, r.hora_inicio) - interval '12 hours')
           ) as puede_cancelar,
           case when r.estado = 'confirmada'
                then public.inicio_de_reserva(r.fecha, r.hora_inicio) - interval '12 hours'
                else null end as cancelacion_hasta,
           r.n_jugadores,
           case when r.modalidad = 'completa' then 1
                when r.modalidad = 'capitanes' then 2
                else r.n_jugadores end as cupos,
           (select count(*)::integer
              from public.reserva_participantes rp
             where rp.reserva_id = r.id
               and rp.estado = 'aceptado'
               and exists (
                   select 1 from public.autorizaciones_cobro ac
                    where ac.reserva_id = r.id and ac.user_id = rp.user_id
                      and ac.vigente = true
                      and ac.monto = case when r.modalidad = 'capitanes'
                                          then ceil(r.precio_total::numeric / 2)::integer
                                          else r.cuota end
               )) as listos,
           (select rp.estado from public.reserva_participantes rp
             where rp.reserva_id = r.id and rp.user_id = v_me) as mi_estado,
           r.es_desafio_club,
           r.cancelacion_estado,
           -- Lo calcula el servidor porque el cliente NO puede leer
           -- `club_members` del club ajeno para saber si le toca a él.
           -- Y es el club que NO pidió: el que pidió ya dijo lo suyo.
           (r.es_desafio_club
            and r.cancelacion_estado = 'solicitada'
            and exists (
                select 1 from public.club_members m
                 where m.user_id = v_me and m.rol = 'admin'
                   and m.club_id in (r.club_organizador_id, r.club_rival_id)
                   and m.club_id is distinct from r.cancelacion_solicitada_por_club_id
            )) as puedo_responder_cancelacion
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      join public.complejos c on c.id = k.complejo_id
     where r.organizador_id = v_me
        or public.es_participante_de_reserva(r.id, v_me)
        -- UN ADMIN DE CLUB VE LA CANCHA DEL DESAFÍO DE SU CLUB aunque no
        -- juegue. Sin esto, el hueco quedaba a medio tapar: quien tiene que
        -- RESPONDER la cancelación es un `admin`, y quien está DENTRO de la
        -- reserva es el `capitan` — pueden ser dos personas distintas, así
        -- que el admin nunca veía la reserva ni el botón. De paso resuelve
        -- que hoy, si reserva el capitán, el admin del club no ve nada.
        or (r.es_desafio_club and exists (
                select 1 from public.club_members m
                 where m.user_id = v_me and m.rol = 'admin'
                   and m.club_id in (r.club_organizador_id, r.club_rival_id)
            ))
     order by public.inicio_de_reserva(r.fecha, r.hora_inicio) desc
     limit greatest(1, least(coalesce(p_limite, 60), 200));
end;
$$;

revoke all on function public.mis_reservas(integer) from public, anon;
grant execute on function public.mis_reservas(integer) to authenticated;
