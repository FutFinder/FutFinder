-- 123. Mover un partido avisa dónde es ahora, y mira la agenda de los que ya están.
--
-- Los dos P2 de la revisión del 21 de septiembre de 2026 que tocan la edición
-- (N05 y N06).
--
--  N05  CAMBIAR EL LUGAR NO AVISABA SI LA CANCHA Y LA COMUNA CONSERVABAN EL
--       NOMBRE. El organizador elige otro punto del buscador dentro de la
--       misma comuna, deja escrito el mismo nombre de cancha, y cambian la
--       dirección y las coordenadas: cero avisos `match_updated`. El inscrito
--       llega a la cancha vieja. Como control, cambiar la cuota después sí
--       avisaba: la función vigilaba cuatro campos y el lugar no era ninguno.
--
--  N06  CAMBIAR LA HORA PODÍA DEJAR A UN INSCRITO EN DOS PARTIDOS A LA VEZ.
--       La 109 serializa la agenda del jugador CUANDO EL JUGADOR ENTRA: el
--       trigger está en `attendees`. Mover `matches.hora` no vuelve a validar
--       nada, así que el organizador de B podía correr su partido encima de A
--       y dejar a X inscrito en los dos. `get_schedule_conflict` recién lo
--       nota después, cuando ya está guardado y no hay a quién reclamarle.
--
-- LO QUE SE DECIDIÓ PARA N06: se impide el cambio conflictivo. La alternativa
-- —guardar y ofrecerle al jugador una salida sin sanción— deja al organizador
-- con un partido que su gente no puede jugar y descubre el problema cuando ya
-- no hay tiempo de arreglarlo. El error nombra cuántos inscritos chocan; el
-- organizador puede sacarlos del plantel y volver a mover la hora, o mover la
-- hora a otra parte. Es la misma regla que ya viven los jugadores al entrar
-- (CHOQUE_HORARIO), aplicada al otro lado de la puerta.
--
-- Y SE HACE BAJO LOS MISMOS BLOQUEOS DE LA 109, no sólo con una consulta: el
-- trigger toma el `pg_advisory_xact_lock(107, hashtext(jugador))` de cada
-- inscrito antes de mirar. Así una inscripción que está entrando a esa hora en
-- otro partido y esta reprogramación no pueden cruzarse: una espera a la otra
-- y la segunda ve lo que la primera dejó. El orden es por `id_jugador`, para
-- que dos reprogramaciones simultáneas tomen los mismos bloqueos en el mismo
-- orden y no se traben entre ellas.
--
-- OJO CON `notify_match_updated`: lo que corre en producción NO es la versión
-- de la 44c sino la de la 46, que distingue el partido entre clubes («los dos
-- clubes acordaron…») y le avisa también al organizador cuando es de clubes.
-- Comprobado leyendo `pg_proc` el 2026-09-21. Esta migración parte de ESA y le
-- suma el lugar; si se partiera de la 44c se perdería el texto de los clubes.
--
-- Regresión: supabase/tests/123_mover_el_partido_avisa_y_mira_la_agenda_test.sql

-- ---------------------------------------------------------------------------
-- N05. El lugar es un cambio que hay que avisar.
--
-- Se avisa por dirección Y por coordenadas: el buscador puede entregar dos
-- puntos distintos con el mismo texto de dirección (otra sugerencia dentro de
-- la misma cuadra), y «llegaste a 400 m de donde se juega» es exactamente el
-- problema que este aviso existe para evitar. Un solo texto —«la dirección»—
-- aunque se muevan las dos cosas: el inscrito no necesita saber cuál de los
-- dos campos se movió, necesita saber que el lugar cambió.
-- ---------------------------------------------------------------------------
create or replace function public.notify_match_updated()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cambios text[] := array[]::text[];
    v_row     record;
    v_body    text;
    v_club    boolean := new.challenge_proposal_id is not null;
begin
    if new.estado = 'cancelado' then
        return new; -- la cancelación tiene su propio aviso
    end if;

    -- `array_append` y no `||`: con un literal sin tipo, `||` resuelve
    -- `anyarray || anyarray` e intenta leer el texto como arreglo (44c).
    if new.hora is distinct from old.hora then
        v_cambios := array_append(v_cambios, 'la fecha y hora');
    end if;
    if new.cancha_nombre is distinct from old.cancha_nombre then
        v_cambios := array_append(v_cambios, 'la cancha');
    end if;
    if new.comuna is distinct from old.comuna then
        v_cambios := array_append(v_cambios, 'la comuna');
    end if;
    if new.direccion is distinct from old.direccion
       or new.latitud is distinct from old.latitud
       or new.longitud is distinct from old.longitud then
        v_cambios := array_append(v_cambios, 'la dirección');
    end if;
    if new.precio_cuota is distinct from old.precio_cuota then
        v_cambios := array_append(v_cambios, 'la cuota');
    end if;

    if array_length(v_cambios, 1) is null then
        return new;
    end if;

    if v_club then
        v_body := format('Los dos clubes acordaron cambiar %s de «%s».',
                         array_to_string(v_cambios, ', '), new.titulo);
    else
        v_body := format('El organizador cambió %s de «%s».',
                         array_to_string(v_cambios, ', '), new.titulo);
    end if;

    for v_row in
        select id_jugador from public.attendees
        where id_partido = new.id
          and estado in ('pendiente', 'inscrito', 'confirmado_gps')
          and (v_club or id_jugador <> new.id_organizador)
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_updated', 'Cambió tu partido', v_body,
                jsonb_build_object('matchId', new.id));
    end loop;

    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- N06. Reprogramar es una operación que mira a los que ya están.
-- ---------------------------------------------------------------------------
create or replace function public.tg_reprogramar_mira_la_agenda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_hora   timestamptz := new.hora;
    v_dur    integer := coalesce(new.duracion_min, 90);
    v_club   boolean := coalesce(new.challenge_proposal_id is not null, false);
    v_choques integer := 0;
    r        record;
begin
    -- Cancelar no reprograma. Y el trigger se dispara por estar `hora` en el
    -- `set`, aunque el valor no cambie: la mayoría de las ediciones mandan el
    -- formulario entero y no mueven la hora.
    if new.estado = 'cancelado' then
        return new;
    end if;
    if new.hora is not distinct from old.hora
       and coalesce(new.duracion_min, 90) is not distinct from coalesce(old.duracion_min, 90) then
        return new;
    end if;

    -- Los mismos bloqueos de la 109, en orden estable por jugador. Esperar
    -- ANTES de mirar es lo que hace que la consulta de abajo vea lo que otra
    -- transacción acaba de confirmar, en vez de la agenda de hace un rato.
    for r in
        select distinct a.id_jugador
          from public.attendees a
         where a.id_partido = new.id
           and a.estado in ('inscrito', 'confirmado_gps')
           and (v_club or a.id_jugador is distinct from new.id_organizador)
         order by 1
    loop
        perform pg_advisory_xact_lock(107, hashtext(r.id_jugador::text));
    end loop;

    -- Cuántos inscritos quedarían con dos partidos encima a la vez. Se cuentan
    -- PERSONAS y no choques, porque el mensaje habla de gente.
    -- El organizador de un partido normal queda fuera, igual que en
    -- `tg_enforce_join_rules`: su agenda no la administra esta regla.
    select count(distinct a.id_jugador) into v_choques
      from public.attendees a
      join public.attendees otra
        on otra.id_jugador = a.id_jugador
       and otra.id_partido <> a.id_partido
       and otra.estado in ('inscrito', 'confirmado_gps')
      join public.matches m on m.id = otra.id_partido
     where a.id_partido = new.id
       and a.estado in ('inscrito', 'confirmado_gps')
       and (v_club or a.id_jugador is distinct from new.id_organizador)
       and m.estado = any (public.estados_que_ocupan_horario())
       and v_hora < m.hora + make_interval(mins => coalesce(m.duracion_min, 90))
       and m.hora < v_hora + make_interval(mins => v_dur);

    -- El mensaje lleva las dos cosas a propósito: la frase en español, que es
    -- lo único que ve una versión de la app que todavía no traduce este caso
    -- —y no hay OTA—, y el código con el número, que es lo que el cliente
    -- nuevo busca para poner su propio texto.
    if v_choques > 0 then
        raise exception
          'No se puede mover: % inscrito(s) quedarían con dos partidos a la vez (CHOQUE_AGENDA_INSCRITOS:%)',
          v_choques, v_choques;
    end if;

    return new;
end;
$$;

drop trigger if exists tg_matches_reprogramar on public.matches;
create trigger tg_matches_reprogramar
    before update of hora, duracion_min on public.matches
    for each row
    execute function public.tg_reprogramar_mira_la_agenda();
