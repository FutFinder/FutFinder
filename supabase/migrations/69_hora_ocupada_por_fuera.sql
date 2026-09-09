-- =============================================================
-- FutFinder migration 69: una hora ocupada por fuera de FutFinder
-- =============================================================
-- Un bloqueo servía para una sola cosa: cerrar una hora porque la cancha
-- no se puede usar. Pero un recinto marca horas por DOS motivos
-- distintos, y confundirlos le hace perder información:
--
--   · `cerrado` — mantención, riego, la cancha no está disponible.
--   · `externo` — alguien la arrendó por teléfono o llegó al mesón. La
--     cancha SÍ se va a usar, hay gente que va a llegar, y quien abre el
--     recinto necesita saberlo.
--
-- En el segundo caso se puede anotar un nombre y un teléfono, opcionales:
-- son de quien arrendó por fuera, para poder ubicarlo igual que a quien
-- reservó por la app.
--
-- QUÉ NO CAMBIA: la hora se bloquea igual en los dos casos. Para el
-- jugador ambos son idénticos —`get_disponibilidad_cancha` sigue
-- devolviendo solo `disponible: false`, sin decir por qué— y para
-- `crear_reserva` también. La diferencia es únicamente lo que ve el
-- recinto en su agenda.
--
-- SIN VENTANA DE TIEMPO, a diferencia del contacto de una reserva
-- (migración 67). Ahí el dato lo entrega un jugador de FutFinder para un
-- partido concreto y por eso caduca. Acá lo anota el propio recinto sobre
-- un arriendo suyo que nunca pasó por la app: es su registro, no un dato
-- que FutFinder le preste. `cancha_bloqueos` ya se lee solo desde la
-- administración del complejo (migración 60), así que no sale de ahí.
--
-- El teléfono se guarda normalizado con la misma función que la 67, para
-- que un número anotado a mano y uno que dejó un jugador se vean igual.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

alter table public.cancha_bloqueos
  add column if not exists tipo text not null default 'cerrado',
  add column if not exists contacto_nombre text,
  add column if not exists contacto_telefono text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'cancha_bloqueos_tipo_check'
    ) then
        alter table public.cancha_bloqueos
          add constraint cancha_bloqueos_tipo_check check (tipo in ('cerrado', 'externo'));
    end if;
    if not exists (
        select 1 from pg_constraint where conname = 'cancha_bloqueos_telefono_check'
    ) then
        alter table public.cancha_bloqueos
          add constraint cancha_bloqueos_telefono_check
          check (contacto_telefono is null or contacto_telefono ~ '^\+569\d{8}$');
    end if;
    -- Un contacto solo tiene sentido en un arriendo por fuera: no hay a
    -- quién llamar por una mantención.
    if not exists (
        select 1 from pg_constraint where conname = 'cancha_bloqueos_contacto_solo_externo'
    ) then
        alter table public.cancha_bloqueos
          add constraint cancha_bloqueos_contacto_solo_externo check (
              tipo = 'externo'
              or (contacto_nombre is null and contacto_telefono is null)
          );
    end if;
end $$;

-- ── Crear un bloqueo, con su motivo y su contacto ────────────────
-- Se ELIMINA la versión de cinco argumentos antes de crear la de ocho.
-- Agregar parámetros con `default` no reemplaza la función: crea una
-- SOBRECARGA, y entonces una llamada de cinco argumentos calza con las
-- dos y Postgres la rechaza por ambigua. Es la misma lección de las
-- migraciones 67 y 68 con `crear_reserva`.
drop function if exists public.admin_crear_bloqueo(uuid, date, time, time, text);

-- Es la versión de la migración 60 con tres parámetros nuevos al final.
-- Un teléfono que no sea móvil chileno se rechaza en vez de guardarse mal
-- y descubrirse el día que haya que llamar.
create or replace function public.admin_crear_bloqueo(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_hora_fin time,
    p_motivo text default null,
    p_tipo text default 'cerrado',
    p_contacto_nombre text default null,
    p_contacto_telefono text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_tel text;
    v_nombre text;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;
    if p_hora_fin <= p_hora_inicio then
        raise exception 'La hora de término tiene que ser posterior a la de inicio';
    end if;
    if coalesce(p_tipo, 'cerrado') not in ('cerrado', 'externo') then
        raise exception 'Motivo inválido';
    end if;

    if exists (
        select 1 from public.reservas r
         where r.cancha_id = p_cancha_id
           and r.fecha = p_fecha
           and r.estado = 'confirmada'
           and p_hora_inicio < r.hora_fin
           and p_hora_fin > r.hora_inicio
    ) then
        raise exception 'Ese horario tiene una reserva confirmada: cancélala antes de bloquearlo';
    end if;

    -- El contacto solo se guarda en un arriendo por fuera; si viene con
    -- una mantención se descarta en silencio, que es más amable que
    -- rechazar el bloqueo entero por un campo que la pantalla no debería
    -- haber mandado.
    if coalesce(p_tipo, 'cerrado') = 'externo' then
        v_nombre := nullif(trim(coalesce(p_contacto_nombre, '')), '');
        if p_contacto_telefono is not null and length(trim(p_contacto_telefono)) > 0 then
            v_tel := public.normaliza_telefono_cl(p_contacto_telefono);
            if v_tel is null then
                raise exception 'Revisa el teléfono: son 9 dígitos y parte con 9';
            end if;
        end if;
    end if;

    insert into public.cancha_bloqueos
        (cancha_id, fecha, hora_inicio, hora_fin, motivo, creado_por,
         tipo, contacto_nombre, contacto_telefono)
    values
        (p_cancha_id, p_fecha, p_hora_inicio, p_hora_fin, nullif(trim(p_motivo), ''), auth.uid(),
         coalesce(p_tipo, 'cerrado'), v_nombre, v_tel)
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.admin_crear_bloqueo(uuid, date, time, time, text, text, text, text) from public, anon;
grant execute on function public.admin_crear_bloqueo(uuid, date, time, time, text, text, text, text) to authenticated;

-- ── Corregir un bloqueo, incluido su contacto ────────────────────
drop function if exists public.admin_actualizar_bloqueo(uuid, date, time, time, text);

-- Es la versión de la migración 66 con los mismos tres campos. Pasar el
-- tipo a `cerrado` limpia el contacto: no hay a quién llamar por una
-- mantención, y dejarlo colgando ahí sería un dato personal sin motivo.
create or replace function public.admin_actualizar_bloqueo(
    p_bloqueo_id uuid,
    p_fecha date default null,
    p_hora_inicio time default null,
    p_hora_fin time default null,
    p_motivo text default null,
    p_tipo text default null,
    p_contacto_nombre text default null,
    p_contacto_telefono text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_b public.cancha_bloqueos;
    v_fecha date;
    v_desde time;
    v_hasta time;
    v_tipo text;
    v_nombre text;
    v_tel text;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select * into v_b from public.cancha_bloqueos where id = p_bloqueo_id;
    if v_b is null or not public.es_admin_cancha(v_b.cancha_id) then
        raise exception 'No administras este bloqueo';
    end if;

    v_fecha := coalesce(p_fecha, v_b.fecha);
    v_desde := coalesce(p_hora_inicio, v_b.hora_inicio);
    v_hasta := coalesce(p_hora_fin, v_b.hora_fin);
    v_tipo  := coalesce(p_tipo, v_b.tipo);

    if v_hasta <= v_desde then
        raise exception 'La hora de término tiene que ser posterior a la de inicio';
    end if;
    if v_tipo not in ('cerrado', 'externo') then
        raise exception 'Motivo inválido';
    end if;

    if exists (
        select 1 from public.reservas r
         where r.cancha_id = v_b.cancha_id
           and r.fecha = v_fecha
           and r.estado = 'confirmada'
           and v_desde < r.hora_fin
           and v_hasta > r.hora_inicio
    ) then
        raise exception 'Ese horario tiene una reserva confirmada: cancélala antes de bloquearlo';
    end if;

    if v_tipo = 'externo' then
        v_nombre := case when p_contacto_nombre is null then v_b.contacto_nombre
                         else nullif(trim(p_contacto_nombre), '') end;
        if p_contacto_telefono is null then
            v_tel := v_b.contacto_telefono;
        elsif length(trim(p_contacto_telefono)) = 0 then
            v_tel := null;
        else
            v_tel := public.normaliza_telefono_cl(p_contacto_telefono);
            if v_tel is null then
                raise exception 'Revisa el teléfono: son 9 dígitos y parte con 9';
            end if;
        end if;
    else
        v_nombre := null;
        v_tel := null;
    end if;

    update public.cancha_bloqueos set
        fecha       = v_fecha,
        hora_inicio = v_desde,
        hora_fin    = v_hasta,
        motivo      = case when p_motivo is null then motivo
                           else nullif(trim(p_motivo), '') end,
        tipo        = v_tipo,
        contacto_nombre   = v_nombre,
        contacto_telefono = v_tel
     where id = p_bloqueo_id;
end;
$$;

revoke all on function public.admin_actualizar_bloqueo(uuid, date, time, time, text, text, text, text) from public, anon;
grant execute on function public.admin_actualizar_bloqueo(uuid, date, time, time, text, text, text, text) to authenticated;

-- ── La agenda muestra las horas ocupadas por fuera ───────────────
-- Es la de la migración 68 con tres campos más en el arreglo de bloqueos.
-- El calendario NO los trae: ahí basta con que el bloque se vea ocupado y
-- con su motivo; el detalle de quién llega es de la agenda, que es la
-- vista con la que se abre el recinto.

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
                 -- Qué tiene que preparar el recinto. No es un detalle
                 -- contable: es la razón por la que la función sirve. Si el
                 -- recinto se entera de que tenía que prestar un balón
                 -- cuando el partido ya empezó, deja de usarla.
                 coalesce((select json_agg(json_build_object('nombre', rc.nombre, 'precio', rc.precio)
                                           order by rc.nombre)
                             from public.reserva_cobros rc where rc.reserva_id = r.id), '[]'::json) as cobros,
                 r.precio_cancha,
                 coalesce((select sum(rc.precio) from public.reserva_cobros rc
                            where rc.reserva_id = r.id), 0) as total_cobros,
                 -- Desglose de la comisión (migración 62). `left join`
                 -- porque una reserva anterior a esa migración no tiene
                 -- fila: en producción no existe ninguna, pero no se
                 -- asume que no exista.
                 coalesce(c.base, r.precio_total)                        as comision_base,
                 coalesce(c.monto, 0)                                    as comision,
                 coalesce(c.base, r.precio_total) - coalesce(c.monto, 0) as neto,
                 r.es_desafio_club,
                 r.n_jugadores,
                 -- Contacto del organizador, solo dentro de la ventana
                 -- (migración 67). Se filtra acá ADEMÁS de en la policy
                 -- porque esta función es `security definer` y se salta la
                 -- RLS: sin este `case`, el recinto vería el teléfono para
                 -- siempre.
                 case when public.contacto_visible(r.id) then ct.nombre end   as contacto_nombre,
                 case when public.contacto_visible(r.id) then ct.telefono end as contacto_telefono,
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
            left join public.reserva_contacto ct  on ct.reserva_id = r.id
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
                 b.motivo,
                 -- `externo` significa que la cancha SÍ se va a usar: hay
                 -- gente que va a llegar y quien abre el recinto tiene que
                 -- saberlo. Sin monto ni comisión, porque no pasó por la app.
                 b.tipo,
                 b.contacto_nombre,
                 b.contacto_telefono
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
