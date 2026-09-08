-- =============================================================
-- FutFinder migration 61: el recinto puede leer sus propias reservas
-- =============================================================
-- LO QUE ESTO ARREGLA: hasta acá un administrador de complejo no podía
-- ver NI UNA de las reservas de su propio recinto. La policy
-- `reservas_select` (migración 55) deja leer solo al organizador y a los
-- participantes de cada reserva:
--
--     using (auth.uid() = organizador_id
--            or es_participante_de_reserva(id, auth.uid()))
--
-- Un admin de complejo no cae en ninguna de las dos ramas. Con la
-- migración 60 ya podía editar su ficha, sus canchas, sus horarios y
-- bloquear horas — pero no tenía forma de saber quién le había
-- reservado. Sin esto no existen el panel, la agenda ni el calendario
-- del recinto.
--
-- POR QUÉ RPC Y NO UNA POLICY NUEVA: se podría agregar una rama
-- `es_admin_cancha(cancha_id)` a `reservas_select` y dejar que el
-- recinto lea la tabla directo. No se hace, por dos razones. La primera
-- es la de la migración 50 y la 60: una sola puerta, la autorización en
-- un lugar auditable. La segunda es de privacidad, y es la que manda:
-- leyendo la tabla directo el recinto se llevaría TODAS las columnas de
-- todas sus reservas, incluidos los ids de los clubes y de las personas,
-- para siempre y sin límite. Estas funciones devuelven una vista
-- deliberadamente recortada, y ese recorte se puede razonar leyendo un
-- archivo.
--
-- QUÉ VE EL RECINTO, Y QUÉ NO:
--   · Ve a quien ORGANIZA: su `username` y su foto. Nada más — el
--     modelo no tiene nombre, correo ni teléfono de nadie (eso llega en
--     una migración posterior, guardado en la reserva y no en el perfil).
--   · NO ve al resto de los participantes. De un pago dividido entre
--     diez recibe "8 de 10 aceptaron", nunca los diez `username`. El
--     recinto necesita saber si la reserva va a completarse, no quiénes
--     son. Mismo criterio que la 44b con la ubicación de los clubes y
--     que la 54 con `get_disponibilidad_cancha`.
--   · NO ve nada de reservas de OTROS complejos, obviamente: las tres
--     funciones validan `es_admin_complejo`/`es_admin_cancha` antes de
--     mirar una fila.
--
-- LO QUE TODAVÍA NO ESTÁ ACÁ, a propósito: la comisión de FutFinder, el
-- teléfono y el nombre de contacto, y los cobros adicionales. Las tres
-- son decisiones ya tomadas pero son migraciones propias, y ninguna
-- existe todavía en el esquema. `precio_total` de hoy es solo el precio
-- de la cancha. Cuando lleguen, estas funciones se extienden con
-- `create or replace` — el cliente NO debe calcular la comisión por su
-- cuenta a partir de un porcentaje, porque va congelada por reserva.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Agenda del día de un complejo ─────────────────────────────
-- Sirve a la agenda (una lista cronológica del día) y de paso al panel:
-- el `resumen` trae los contadores que el panel muestra arriba, así la
-- pantalla principal se arma con una sola llamada.
--
-- Devuelve las reservas Y los bloqueos en dos arreglos separados en vez
-- de una lista mezclada con columnas nulas: son dos cosas distintas —una
-- la pidió un jugador, la otra la marcó el propio recinto— y el cliente
-- las intercala por hora para pintarlas juntas.
--
-- Estados incluidos: 'confirmada', 'armando', 'procesando' y
-- 'cancelada'. Quedan fuera 'rechazada' y 'vencida': son intentos que
-- nunca ocuparon el horario y solo ensucian la agenda.
--
-- OJO con 'armando'/'procesando': esas reservas NO tienen el horario
-- tomado. Regla central del vertical (migración 55): mientras una
-- reserva no está 'confirmada' el bloque sigue disponible para otros
-- grupos, y el primero que confirma se lo lleva. Se devuelven para que
-- el recinto sepa que hay un grupo juntando la plata, no para que dé la
-- hora por vendida.
--
-- No se calcula acá si un partido "ya se jugó": eso depende de la hora
-- LOCAL de Chile y `now()` en la base es UTC. Lo compara el cliente, que
-- ya tiene el criterio de fecha local en `reservasRules.js` justamente
-- para no correrse un día.
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
                 to_char(r.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(r.hora_fin, 'HH24:MI')    as hora_fin,
                 r.estado,
                 r.modalidad,
                 r.medio_pago,
                 r.precio_total,
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

-- ── 2. Calendario de una cancha, con el POR QUÉ de cada bloque ───
-- La contracara de `get_disponibilidad_cancha` (migración 54). Esa es
-- pública y devuelve solo `disponible: true/false`, sin decir nunca por
-- qué un bloque no está — criterio deliberado, para no filtrarle a
-- cualquiera si hay una reserva ajena o una mantención. El recinto SÍ
-- necesita el motivo: es su operación.
--
-- Tres estados, y el orden de precedencia importa:
--   'bloqueada' — el propio recinto cerró la hora. Gana sobre todo.
--   'reservada' — hay una reserva CONFIRMADA encima.
--   'libre'     — se puede reservar.
--
-- `grupos_en_curso` va aparte del estado a propósito: un bloque con un
-- grupo juntando la plata sigue estando LIBRE. Es la regla central del
-- vertical y la interfaz tiene que poder decirlo sin mentir ("hay un
-- grupo armando, la hora sigue disponible").
--
-- El solape se calcula por rango y no por hora de inicio exacta, a
-- diferencia de la función pública: si alguna vez se cambia
-- `duracion_slot_min` de una cancha con reservas ya hechas, una reserva
-- de 90 min tiene que ocupar los dos bloques de 60 que pisa, no
-- desaparecer del calendario del recinto.
create or replace function public.admin_calendario_cancha(
    p_cancha_id uuid,
    p_fecha date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha public.canchas_reservables;
    v_dow integer;
    v_slot_min integer;
    v_slots json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_cancha(p_cancha_id) then
        raise exception 'No administras esta cancha';
    end if;

    select * into v_cancha from public.canchas_reservables where id = p_cancha_id;
    if v_cancha is null then
        return json_build_object('ok', false, 'reason', 'Cancha no existe');
    end if;

    v_dow := extract(dow from p_fecha)::integer;
    v_slot_min := v_cancha.duracion_slot_min;

    select coalesce(json_agg(s order by s.hora_inicio), '[]'::json)
      into v_slots
      from (
          select to_char(g.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(g.hora_fin, 'HH24:MI')    as hora_fin,
                 case
                     when bl.id is not null then 'bloqueada'
                     when res.id is not null then 'reservada'
                     else 'libre'
                 end as estado,
                 case when bl.id is null then null else json_build_object(
                     'id', bl.id, 'motivo', bl.motivo,
                     'hora_inicio', to_char(bl.hora_inicio, 'HH24:MI'),
                     'hora_fin', to_char(bl.hora_fin, 'HH24:MI')
                 ) end as bloqueo,
                 case when res.id is null then null else json_build_object(
                     'id', res.id, 'estado', res.estado,
                     'modalidad', res.modalidad, 'medio_pago', res.medio_pago,
                     'precio_total', res.precio_total,
                     'organizador_username', res.username,
                     'organizador_foto_url', res.foto_url
                 ) end as reserva,
                 -- Grupos que están juntando la plata sobre este bloque.
                 -- NO lo ocupan: el bloque sigue 'libre'.
                 (select count(*)
                    from public.reservas r2
                   where r2.cancha_id = p_cancha_id
                     and r2.fecha = p_fecha
                     and r2.estado in ('armando', 'procesando')
                     and g.hora_inicio < r2.hora_fin
                     and g.hora_fin > r2.hora_inicio) as grupos_en_curso
            from (
                select h as hora_inicio,
                       (h + (v_slot_min || ' minutes')::interval)::time as hora_fin
                  from (
                      select generate_series(
                                 (p_fecha + hr.hora_apertura)::timestamp,
                                 (p_fecha + hr.hora_cierre)::timestamp - (v_slot_min || ' minutes')::interval,
                                 (v_slot_min || ' minutes')::interval
                             )::time as h
                        from public.cancha_horario_reglas hr
                       where hr.cancha_id = p_cancha_id
                         and hr.dia_semana = v_dow
                  ) gen
            ) g
            left join lateral (
                select b.id, b.motivo, b.hora_inicio, b.hora_fin
                  from public.cancha_bloqueos b
                 where b.cancha_id = p_cancha_id
                   and b.fecha = p_fecha
                   and g.hora_inicio < b.hora_fin
                   and (case when g.hora_fin <= g.hora_inicio then time '24:00' else g.hora_fin end) > b.hora_inicio
                 limit 1
            ) bl on true
            left join lateral (
                select r.id, r.estado, r.modalidad, r.medio_pago, r.precio_total,
                       p.username, p.foto_url
                  from public.reservas r
                  join public.profiles p on p.id = r.organizador_id
                 where r.cancha_id = p_cancha_id
                   and r.fecha = p_fecha
                   and r.estado = 'confirmada'
                   and g.hora_inicio < r.hora_fin
                   and (case when g.hora_fin <= g.hora_inicio then time '24:00' else g.hora_fin end) > r.hora_inicio
                 limit 1
            ) res on true
      ) s;

    return json_build_object(
        'ok', true,
        'cancha_id', p_cancha_id,
        'cancha_nombre', v_cancha.nombre,
        'duracion_slot_min', v_slot_min,
        'activa', v_cancha.activa,
        'fecha', to_char(p_fecha, 'YYYY-MM-DD'),
        'slots', v_slots
    );
end;
$$;

revoke all on function public.admin_calendario_cancha(uuid, date) from public, anon;
grant execute on function public.admin_calendario_cancha(uuid, date) to authenticated;

-- ── 3. Detalle de una reserva ────────────────────────────────────
-- Lo que el recinto necesita al abrir una fila de la agenda. Va aparte
-- de la agenda para no arrastrar el agregado de participantes en cada
-- una de las filas del día.
--
-- Sigue sin devolver la identidad de los participantes: solo cuántos
-- son, cuántos aceptaron y cuánto falta. Con eso el recinto sabe si la
-- reserva va a completarse, que es lo único que le toca saber.
create or replace function public.admin_reserva_detalle(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha_id uuid;
    v_out json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select cancha_id into v_cancha_id from public.reservas where id = p_reserva_id;

    if v_cancha_id is null or not public.es_admin_cancha(v_cancha_id) then
        raise exception 'Esa reserva no es de un recinto que administres';
    end if;

    select json_build_object(
               'ok', true,
               'id', r.id,
               'cancha_id', r.cancha_id,
               'cancha_nombre', k.nombre,
               'cancha_tipo', k.tipo,
               'complejo_id', k.complejo_id,
               'fecha', to_char(r.fecha, 'YYYY-MM-DD'),
               'hora_inicio', to_char(r.hora_inicio, 'HH24:MI'),
               'hora_fin', to_char(r.hora_fin, 'HH24:MI'),
               'estado', r.estado,
               'modalidad', r.modalidad,
               'medio_pago', r.medio_pago,
               'precio_total', r.precio_total,
               'n_jugadores', r.n_jugadores,
               'cuota', r.cuota,
               'es_desafio_club', r.es_desafio_club,
               'organizador_username', p.username,
               'organizador_foto_url', p.foto_url,
               'created_at', r.created_at,
               'confirmada_at', r.confirmada_at,
               'cancelada_at', r.cancelada_at,
               'cancelacion_estado', r.cancelacion_estado,
               'participantes_total', (select count(*) from public.reserva_participantes rp
                                        where rp.reserva_id = r.id),
               'participantes_aceptados', (select count(*) from public.reserva_participantes rp
                                            where rp.reserva_id = r.id and rp.estado = 'aceptado'),
               'participantes_pendientes', (select count(*) from public.reserva_participantes rp
                                             where rp.reserva_id = r.id and rp.estado = 'pendiente')
           )
      into v_out
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      join public.profiles p            on p.id = r.organizador_id
     where r.id = p_reserva_id;

    return v_out;
end;
$$;

revoke all on function public.admin_reserva_detalle(uuid) from public, anon;
grant execute on function public.admin_reserva_detalle(uuid) to authenticated;
