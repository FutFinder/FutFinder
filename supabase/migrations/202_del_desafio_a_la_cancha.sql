-- =============================================================
-- FutFinder migration 202: del desafío a la cancha
-- =============================================================
-- Diseño «FutFinder · Clubes (preservas)», decisiones de Vicente del
-- 2026-11-26:
--   · Variante A: en la propuesta oficial se ELIGE la cancha de FutFinder,
--     sin pagar; al aprobarse, el club local reserva con un toque.
--   · El capitán rival tiene 15 MINUTOS para pagar su mitad. Si no paga, la
--     cancha se suelta sola.
--   · La cancelación sigue siendo la regla única de 12 h (no se toca).
--   · El pago sigue siendo con Balance (no se toca).
--
-- ── 1. LA CANCHA ELEGIDA EN LA PROPUESTA ──
-- `club_challenge_proposals.cancha_reservable_id`. NO se pasa por
-- `crear_propuesta_oficial`: ese cuerpo lo parchó la 197 con una expresión
-- regular y no se reescribe por un dato opcional. La pantalla crea la
-- propuesta y enseguida la anota con `anotar_cancha_de_la_propuesta`; si eso
-- fallara, la propuesta queda con su cancha escrita, que es exactamente lo
-- que había antes. Sólo quien la creó la anota, y sólo mientras está
-- pendiente: una propuesta ya aprobada no cambia de cancha por detrás.
--
-- ── 2. EL PLAZO DE 15 MINUTOS ──
-- No es una columna: se calcula. Es la hora en que el club local puso su
-- mitad (o, si todavía no la pone, la hora en que creó la reserva) más 15
-- minutos. Una columna se habría podido desincronizar del pago; esto no.
-- Autorizar no mueve plata —se cobra al confirmar, con los dos adentro—,
-- así que soltar una reserva vencida no tiene nada que devolver: la mitad
-- del local se libera sin cobrarse.
--
-- `soltar_reservas_de_desafio_vencidas()` corre cada minuto. Sólo mira
-- reservas de desafío enlazadas a un partido: las reservas sueltas siguen con
-- su regla de siempre (vencen a la hora de juego).
--
-- ── 3. EL CHAT CUENTA LO QUE PASA CON LA CANCHA ──
-- Cuatro eventos nuevos del desafío —`cancha_reservada`, `mitad_pagada`,
-- `reserva_confirmada`, `cancha_soltada`— escritos por DISPARADORES y no por
-- cada RPC: la reserva cambia de estado desde varias funciones y desde el
-- cron, y la que se olvide de anotar el evento dejaría el chat contando otra
-- historia.
--
-- ── 4. LO QUE EL CHAT NECESITA SABER, EN UNA LLAMADA ──
-- `cancha_del_desafio(challenge_id)`: quién es local, si puedo elegir o
-- reservar, la cancha elegida en la propuesta, la reserva viva con quién
-- pagó y el plazo. La pantalla no puede leer `reservas` ni `club_members`
-- del club rival por su cuenta.
--
-- Idempotente.
-- =============================================================

-- ── 1. La cancha de la propuesta ─────────────────────────────────
alter table public.club_challenge_proposals
    add column if not exists cancha_reservable_id uuid
        references public.canchas_reservables(id) on delete set null;

create or replace function public.anotar_cancha_de_la_propuesta(
    p_propuesta_id uuid,
    p_cancha_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_prop public.club_challenge_proposals;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_prop from public.club_challenge_proposals where id = p_propuesta_id for update;
    if v_prop is null then
        return json_build_object('ok', false, 'reason', 'Esa propuesta no existe');
    end if;
    if v_prop.creada_por is distinct from v_me then
        return json_build_object('ok', false, 'reason', 'Solo quien creó la propuesta puede anotar su cancha');
    end if;
    if v_prop.estado <> 'pendiente' then
        return json_build_object('ok', false, 'reason', 'La propuesta ya fue respondida');
    end if;

    if p_cancha_id is not null and not exists (
        select 1
          from public.canchas_reservables k
          join public.complejos c on c.id = k.complejo_id
         where k.id = p_cancha_id and k.activa and c.publicado and c.aprobado_futfinder
    ) then
        return json_build_object('ok', false, 'reason', 'Esa cancha no está disponible en FutFinder');
    end if;

    update public.club_challenge_proposals
       set cancha_reservable_id = p_cancha_id
     where id = p_propuesta_id;

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.anotar_cancha_de_la_propuesta(uuid, uuid) from public, anon;
grant execute on function public.anotar_cancha_de_la_propuesta(uuid, uuid) to authenticated;

-- ── 2. El plazo de 15 minutos ────────────────────────────────────
create or replace function public.plazo_de_la_reserva_del_desafio(p_reserva_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
               (select rp.autorizado_at
                  from public.reserva_participantes rp
                 where rp.reserva_id = r.id and rp.rol = 'organizador' and rp.autorizado_at is not null),
               r.created_at
           ) + interval '15 minutes'
      from public.reservas r
     where r.id = p_reserva_id
       and r.es_desafio_club
       and r.estado in ('armando', 'procesando');
$$;

revoke all on function public.plazo_de_la_reserva_del_desafio(uuid) from public, anon, authenticated;

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
        perform public.cancelar_reserva_interna(
            v_id,
            'Pasaron los 15 minutos y el club rival no pagó su mitad. Se soltó la cancha y no se cobró nada.');
        v_soltadas := v_soltadas + 1;
    end loop;

    return json_build_object('ok', true, 'soltadas', v_soltadas);
end;
$$;

revoke all on function public.soltar_reservas_de_desafio_vencidas() from public, anon, authenticated;

do $$
begin
    if exists (select 1 from cron.job where jobname = 'futfinder-soltar-canchas-de-desafio') then
        perform cron.unschedule('futfinder-soltar-canchas-de-desafio');
    end if;
    perform cron.schedule(
        'futfinder-soltar-canchas-de-desafio',
        '* * * * *',
        'select public.soltar_reservas_de_desafio_vencidas();'
    );
end $$;

-- ── 3. Los eventos del chat ──────────────────────────────────────
alter table public.club_challenge_events drop constraint if exists club_challenge_events_tipo_check;
alter table public.club_challenge_events
    add constraint club_challenge_events_tipo_check
    check (tipo = any (array[
        'aceptado', 'rechazado', 'cancelado', 'expirado', 'prorroga_abierta',
        'prorroga_respondida', 'sin_acuerdo', 'propuesta_creada', 'propuesta_aprobada',
        'propuesta_rechazada', 'partido_publicado', 'partido_en_juego', 'esperando_resultado',
        'cambio_propuesto', 'cambio_respondido', 'encuentro_cancelado', 'sancion_aplicada',
        'sancion_retirada', 'incomparecencia_reportada', 'revision_solicitada',
        'revision_resuelta', 'resultado_propuesto', 'resultado_confirmado',
        'resultado_disputado', 'resultado_reabierto',
        -- 202
        'cancha_reservada', 'mitad_pagada', 'reserva_confirmada', 'cancha_soltada'
    ]));

-- El desafío de una reserva, si la reserva es la cancha de un partido de
-- clubes. `null` para todas las demás.
create or replace function public.desafio_de_la_reserva(p_reserva_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
    select m.challenge_id from public.matches m
     where m.reserva_id = p_reserva_id and m.challenge_id is not null
     limit 1;
$$;

revoke all on function public.desafio_de_la_reserva(uuid) from public, anon, authenticated;

create or replace function public.datos_de_la_reserva_para_el_chat(p_reserva_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    select jsonb_build_object(
               'reserva_id', r.id,
               'recinto', c.nombre,
               'cancha', k.nombre,
               'fecha', r.fecha,
               'hora', to_char(r.hora_inicio, 'HH24:MI'))
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      join public.complejos c on c.id = k.complejo_id
     where r.id = p_reserva_id;
$$;

revoke all on function public.datos_de_la_reserva_para_el_chat(uuid) from public, anon, authenticated;

-- 3a. Se enlazó una reserva al partido.
create or replace function public.evento_cancha_reservada()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    if new.reserva_id is not null
       and new.reserva_id is distinct from old.reserva_id
       and new.challenge_id is not null then
        insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
        values (new.challenge_id, 'cancha_reservada', auth.uid(), new.club_local_id,
                public.datos_de_la_reserva_para_el_chat(new.reserva_id));
    end if;
    return new;
end;
$$;

drop trigger if exists trg_evento_cancha_reservada on public.matches;
create trigger trg_evento_cancha_reservada
    after update of reserva_id on public.matches
    for each row execute function public.evento_cancha_reservada();

-- 3b. Un capitán puso su mitad. Si fue el local, al rival le corre el reloj
-- y se le avisa: es el aviso que la lámina 8 pone en el teléfono.
create or replace function public.evento_mitad_pagada()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_reserva public.reservas;
    v_desafio uuid;
    v_club uuid;
    v_club_nombre text;
    v_rival record;
begin
    -- El pago es `autorizado_at`, no `estado`: el organizador nace
    -- 'aceptado' (es quien creó la reserva) y su pago no cambia el estado.
    -- Sólo cuenta el PRIMER pago de cada capitán.
    if new.autorizado_at is null or old.autorizado_at is not null
       or new.rol not in ('organizador', 'capitan') then
        return new;
    end if;
    select * into v_reserva from public.reservas where id = new.reserva_id;
    if v_reserva is null or not v_reserva.es_desafio_club or v_reserva.modalidad <> 'capitanes' then
        return new;
    end if;
    v_desafio := public.desafio_de_la_reserva(new.reserva_id);
    if v_desafio is null then
        return new;
    end if;

    v_club := case when new.rol = 'organizador' then v_reserva.club_organizador_id
                   else v_reserva.club_rival_id end;
    select nombre into v_club_nombre from public.clubs where id = v_club;

    insert into public.club_challenge_events (challenge_id, tipo, actor_id, club_id, payload)
    values (v_desafio, 'mitad_pagada', new.user_id, v_club,
            public.datos_de_la_reserva_para_el_chat(new.reserva_id)
              || jsonb_build_object('club', v_club_nombre, 'monto', new.monto_autorizado));

    if new.rol = 'organizador' then
        for v_rival in
            select user_id from public.reserva_participantes
             where reserva_id = new.reserva_id and rol = 'capitan' and estado = 'pendiente'
        loop
            insert into public.notifications (user_id, type, title, body, data)
            values (v_rival.user_id, 'reserva_recordatorio_pago',
                    coalesce(v_club_nombre, 'El club local') || ' reservó la cancha',
                    'Tienes 15 minutos para pagar tu mitad. Si no, la cancha se suelta.',
                    jsonb_build_object('reservaId', new.reserva_id));
        end loop;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_evento_mitad_pagada on public.reserva_participantes;
create trigger trg_evento_mitad_pagada
    after update of autorizado_at on public.reserva_participantes
    for each row execute function public.evento_mitad_pagada();

-- 3c. La reserva se confirmó o se soltó.
create or replace function public.evento_estado_de_la_reserva()
returns trigger
language plpgsql
set search_path = public
as $$
declare
    v_desafio uuid;
    v_motivo text;
begin
    if new.estado = old.estado or not new.es_desafio_club then
        return new;
    end if;
    v_desafio := public.desafio_de_la_reserva(new.id);
    if v_desafio is null then
        return new;
    end if;

    if new.estado = 'confirmada' then
        insert into public.club_challenge_events (challenge_id, tipo, club_id, payload)
        values (v_desafio, 'reserva_confirmada', new.club_organizador_id,
                public.datos_de_la_reserva_para_el_chat(new.id));
    elsif new.estado in ('cancelada', 'vencida', 'rechazada')
          and old.estado in ('armando', 'procesando', 'confirmada') then
        v_motivo := coalesce(nullif(current_setting('futfinder.motivo_soltar', true), ''),
                             case when new.estado = 'vencida' then 'vencida' else 'cancelada' end);
        insert into public.club_challenge_events (challenge_id, tipo, club_id, payload)
        values (v_desafio, 'cancha_soltada', new.club_organizador_id,
                public.datos_de_la_reserva_para_el_chat(new.id)
                  || jsonb_build_object('motivo', v_motivo,
                                        'estaba_confirmada', old.estado = 'confirmada'));
    end if;
    return new;
end;
$$;

drop trigger if exists trg_evento_estado_de_la_reserva on public.reservas;
create trigger trg_evento_estado_de_la_reserva
    after update of estado on public.reservas
    for each row execute function public.evento_estado_de_la_reserva();

-- ── 4. Lo que el chat necesita saber ─────────────────────────────
create or replace function public.cancha_del_desafio(p_challenge_id uuid)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_ch public.club_challenges;
    v_match public.matches;
    v_rol_local text;
    v_rol_visita text;
    v_prop record;
    v_res record;
    v_capitan uuid;
    v_mitad integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_ch from public.club_challenges where id = p_challenge_id;
    if v_ch is null then
        return json_build_object('ok', false, 'reason', 'Ese desafío no existe');
    end if;

    select rol into v_rol_local from public.club_members
     where club_id = v_ch.club_retador_id and user_id = v_me;
    select rol into v_rol_visita from public.club_members
     where club_id = v_ch.club_retado_id and user_id = v_me;
    if v_rol_local is null and v_rol_visita is null then
        return json_build_object('ok', false, 'reason', 'No eres de ninguno de los dos clubes');
    end if;

    if v_ch.match_id is not null then
        select * into v_match from public.matches where id = v_ch.match_id;
    end if;

    -- La cancha elegida: la de la propuesta aprobada o, si no hay, la de la
    -- pendiente.
    select p.id as propuesta_id, p.estado, p.fecha, p.created_at,
           k.id as cancha_id, k.nombre as cancha_nombre, k.tipo as cancha_tipo,
           c.id as complejo_id, c.nombre as complejo_nombre, c.direccion, c.comuna
      into v_prop
      from public.club_challenge_proposals p
      join public.canchas_reservables k on k.id = p.cancha_reservable_id
      join public.complejos c on c.id = k.complejo_id
     where p.challenge_id = p_challenge_id
       and p.estado in ('aprobada', 'pendiente')
     order by (p.estado = 'aprobada') desc, p.created_at desc
     limit 1;

    -- Corre siempre, aunque no haya reserva: un `record` que nunca recibió un
    -- `select into` revienta al leerlo, y sin filas queda en nulos.
    select r.id, r.estado, r.fecha, to_char(r.hora_inicio, 'HH24:MI') as hora,
               r.precio_total, r.cancelacion_estado,
               k.nombre as cancha_nombre, c.nombre as complejo_nombre, c.id as complejo_id,
               exists (select 1 from public.reserva_participantes rp
                        where rp.reserva_id = r.id and rp.rol = 'organizador' and rp.autorizado_at is not null) as pago_local,
               exists (select 1 from public.reserva_participantes rp
                        where rp.reserva_id = r.id and rp.rol = 'capitan' and rp.autorizado_at is not null) as pago_rival,
               (select rp.user_id from public.reserva_participantes rp
                 where rp.reserva_id = r.id and rp.rol = 'capitan' limit 1) as capitan_rival,
               public.plazo_de_la_reserva_del_desafio(r.id) as plazo_at
          into v_res
          from public.reservas r
          join public.canchas_reservables k on k.id = r.cancha_id
          join public.complejos c on c.id = k.complejo_id
         where r.id = v_match.reserva_id;

    v_capitan := coalesce(v_res.capitan_rival, public.capitan_del_club(v_ch.club_retado_id));
    v_mitad := case when v_res.id is not null then ceil(v_res.precio_total::numeric / 2)::integer end;

    return json_build_object(
        'ok', true,
        'estado_desafio', v_ch.estado,
        'soy_local', coalesce(v_rol_local in ('admin', 'capitan'), false),
        'soy_visitante', v_rol_visita is not null,
        'club_local', (select json_build_object('id', id, 'nombre', nombre) from public.clubs where id = v_ch.club_retador_id),
        'club_visitante', (select json_build_object('id', id, 'nombre', nombre) from public.clubs where id = v_ch.club_retado_id),
        'modalidad', v_ch.modalidad,
        'match_id', v_match.id,
        'match_estado', v_match.estado,
        'hora_partido', v_match.hora,
        -- Elegir cancha es de la negociación; reservar, del partido publicado.
        'puedo_elegir', coalesce(v_rol_local in ('admin', 'capitan'), false)
            and v_ch.estado = 'negociacion',
        'puedo_reservar', coalesce(v_rol_local in ('admin', 'capitan'), false)
            and v_match.id is not null and v_match.estado = 'abierto'
            and coalesce(v_res.estado, 'ninguna') not in ('armando', 'procesando', 'confirmada'),
        'rival_sin_capitan', public.capitan_del_club(v_ch.club_retado_id) is null,
        'capitan_rival_username', (select username from public.profiles where id = v_capitan),
        'soy_capitan_rival', coalesce(v_capitan = v_me, false),
        'cancha_elegida', case when v_prop.cancha_id is null then null else json_build_object(
            'propuesta_id', v_prop.propuesta_id,
            'propuesta_estado', v_prop.estado,
            'fecha', v_prop.fecha,
            'verificada_at', v_prop.created_at,
            'cancha_id', v_prop.cancha_id,
            'cancha_nombre', v_prop.cancha_nombre,
            'cancha_tipo', v_prop.cancha_tipo,
            'complejo_id', v_prop.complejo_id,
            'complejo_nombre', v_prop.complejo_nombre,
            'direccion', v_prop.direccion,
            'comuna', v_prop.comuna) end,
        'reserva', case when v_res.id is null then null else json_build_object(
            'id', v_res.id,
            'estado', v_res.estado,
            'fecha', v_res.fecha,
            'hora', v_res.hora,
            'precio_total', v_res.precio_total,
            'mitad', v_mitad,
            'cancha_nombre', v_res.cancha_nombre,
            'complejo_nombre', v_res.complejo_nombre,
            'complejo_id', v_res.complejo_id,
            'pago_local', v_res.pago_local,
            'pago_rival', v_res.pago_rival,
            'plazo_at', v_res.plazo_at,
            'cancelacion_estado', v_res.cancelacion_estado) end
    );
end;
$$;

revoke all on function public.cancha_del_desafio(uuid) from public, anon;
grant execute on function public.cancha_del_desafio(uuid) to authenticated;
