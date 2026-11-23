-- Cuenta para quien revisa la app en App Store y Google Play: le pone
-- contenido para que no la encuentre vacía (Apple rechaza por la guía 2.1).
--
-- No crea la cuenta de revisión: esa la registra Vicente en la app, como
-- cualquier persona (código por correo, contraseña, edad, términos). Así la
-- contraseña nunca pasa por aquí ni por el repositorio, y la cuenta queda con
-- la aceptación de los términos registrada.
--
-- Lo que sí crea:
--   * dos compañeros de mentira (`revision.companero1/2@futfinder.cl`), sin
--     contraseña que sirva: nadie puede entrar con ellos;
--   * una amistad aceptada con el primero y otra pendiente del segundo;
--   * un club donde la cuenta de revisión es administradora y los dos son
--     integrantes, con mensajes en su chat, y otro club de Camila del que
--     no es parte (para poder probar «Reportar club»);
--   * un partido que organiza el primer compañero, con la cuenta inscrita y
--     mensajes en el chat del partido;
--   * un partido que organiza la cuenta de revisión, con un compañero inscrito;
--   * una conversación directa con el primer compañero.
--
-- Cuándo se corre: DESPUÉS de la limpieza de producción
-- (`scripts/limpieza-prelanzamiento/`), que borra partidos, clubes y mensajes.
-- Si la cuenta se registra antes de la limpieza, su correo va en la lista de
-- cuentas que se salvan. Ver el README de esta carpeta.
--
-- Va sin `begin`/`commit`, como la limpieza: el ensayo es
-- `begin;` + este archivo + `rollback;`, y la corrida de verdad con `commit;`.
-- Se niega a correr dos veces (si el club ya existe, aborta).

do $$
declare
    -- PASO 0: el correo con que se registró la cuenta de revisión.
    v_correo text := 'CAMBIAR@ejemplo.cl';

    v_rev uuid;
    v_c1 uuid;
    v_c2 uuid;
    v_club uuid;
    v_club2 uuid;
    v_p1 uuid;
    v_p2 uuid;
    v_factores int;
    v_msg record;
    v_id uuid;
    -- Ñuñoa, Santiago (cerca del Estadio Nacional).
    v_lat numeric := -33.4569;
    v_lng numeric := -70.5976;
begin
    if v_correo = 'CAMBIAR@ejemplo.cl' then
        raise exception 'Falta el correo de la cuenta de revisión (paso 0).';
    end if;

    select id into v_rev from auth.users where lower(email) = lower(v_correo);
    if v_rev is null then
        raise exception 'No existe ninguna cuenta con el correo %. Regístrala primero en la app.', v_correo;
    end if;

    -- Quien revisa no tiene el teléfono de nadie: con dos pasos no entra.
    select count(*) into v_factores from auth.mfa_factors
     where user_id = v_rev and status = 'verified';
    if v_factores > 0 then
        raise exception 'La cuenta % tiene la verificación en dos pasos activada; quítala antes.', v_correo;
    end if;

    if not exists (select 1 from public.profiles where id = v_rev and coalesce(onboarding_completed, false)) then
        raise exception 'La cuenta % no terminó el registro en la app (falta el onboarding).', v_correo;
    end if;

    if exists (select 1 from public.clubs where slug in ('futbol-de-los-jueves-revision', 'atletico-providencia-revision')) then
        raise exception 'La semilla ya se corrió: el club de revisión existe.';
    end if;

    if exists (select 1 from public.profiles where lower(username) in ('matias_rojas', 'camila_soto')) then
        raise exception 'Ya hay una cuenta llamada matias_rojas o camila_soto: cambia los nombres de los compañeros.';
    end if;

    -- Con el teléfono obligatorio, organizar o inscribirse lo exige; la
    -- semilla no inventa teléfonos.
    if public.flag_activo('telefono_obligatorio') then
        raise exception 'telefono_obligatorio está encendido: la semilla no puede inscribir a nadie.';
    end if;

    -- Los compañeros. `encrypted_password` no es un hash válido: no se puede
    -- entrar con ellos de ninguna forma.
    v_c1 := gen_random_uuid();
    v_c2 := gen_random_uuid();
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) values
        ('00000000-0000-0000-0000-000000000000', v_c1, 'authenticated', 'authenticated',
         'revision.companero1@futfinder.cl', 'sin-acceso', now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', '', '', '', ''),
        ('00000000-0000-0000-0000-000000000000', v_c2, 'authenticated', 'authenticated',
         'revision.companero2@futfinder.cl', 'sin-acceso', now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');

    insert into public.profiles (id, username, posicion_preferida, region, comuna, bio, onboarding_completed)
    values
        (v_c1, 'matias_rojas', array['medio'], 'Región Metropolitana', 'Ñuñoa',
         'Juego los jueves en la noche. Busco partidos de fútbol 7.', true),
        (v_c2, 'camila_soto', array['delantero'], 'Región Metropolitana', 'Providencia',
         'Fútbol 5 y 7, nivel intermedio.', true)
    on conflict (id) do update set
        username = excluded.username,
        posicion_preferida = excluded.posicion_preferida,
        region = excluded.region,
        comuna = excluded.comuna,
        bio = excluded.bio,
        onboarding_completed = true;

    -- Amistades: una aceptada (aparece en Chat → Amigos) y una pendiente
    -- (aparece como solicitud por responder).
    insert into public.friendships (requester_id, addressee_id, status, responded_at)
    values (v_c1, v_rev, 'accepted', now()),
           (v_c2, v_rev, 'pending', null);

    -- El club. La cuenta de revisión lo administra, así ve todas las opciones.
    insert into public.clubs (nombre, slug, descripcion, region, comuna, created_by, modalidad)
    values ('Fútbol de los Jueves', 'futbol-de-los-jueves-revision',
            'Grupo de amigos que juega fútbol 7 todas las semanas en Ñuñoa.',
            'Región Metropolitana', 'Ñuñoa', v_rev, 'futbol7')
    returning id into v_club;

    insert into public.club_members (club_id, user_id, rol)
    values (v_club, v_rev, 'admin'), (v_club, v_c1, 'capitan'), (v_club, v_c2, 'jugador')
    on conflict do nothing;

    -- Un segundo club, de Camila, del que la cuenta NO es integrante: la
    -- bandera de «Reportar club» sólo aparece a quien no es del club, y
    -- quien revisa tiene que poder probarla (guía 1.2).
    insert into public.clubs (nombre, slug, descripcion, region, comuna, created_by, modalidad)
    values ('Atlético Providencia', 'atletico-providencia-revision',
            'Club de fútbol 7 que busca rivales los fines de semana.',
            'Región Metropolitana', 'Providencia', v_c2, 'futbol7')
    returning id into v_club2;

    insert into public.club_members (club_id, user_id, rol)
    values (v_club2, v_c2, 'admin')
    on conflict do nothing;

    -- Partido 1: lo organiza Matías, la cuenta de revisión está inscrita.
    -- A tres semanas, para que siga vigente mientras dura la revisión.
    insert into public.matches (
        id_organizador, titulo, region, comuna, cancha_nombre, direccion,
        latitud, longitud, hora, duracion_min, cupos_totales, cupos_disponibles,
        precio_cuota, nivel, modalidad, aprobacion, descripcion
    ) values (
        v_c1, 'Fútbol 7 entre amigos', 'Región Metropolitana', 'Ñuñoa',
        'Cancha Estadio Nacional', 'Av. Grecia 2001, Ñuñoa',
        v_lat, v_lng, (date_trunc('day', now() at time zone 'America/Santiago') + interval '21 days 21 hours') at time zone 'America/Santiago', 60, 14, 12,
        3000, 'intermedio', 'futbol7', 'inmediata',
        'Partido amistoso. Traer polera clara y oscura.'
    ) returning id into v_p1;

    insert into public.attendees (id_partido, id_jugador, estado, origen)
    values (v_p1, v_rev, 'inscrito', 'orden_llegada');

    -- Partido 2: lo organiza la cuenta de revisión, Camila inscrita.
    insert into public.matches (
        id_organizador, titulo, region, comuna, cancha_nombre, direccion,
        latitud, longitud, hora, duracion_min, cupos_totales, cupos_disponibles,
        precio_cuota, nivel, modalidad, aprobacion, descripcion
    ) values (
        v_rev, 'Fútbol 5 abierto', 'Región Metropolitana', 'Providencia',
        'Canchas Parque Bustamante', 'Av. Bustamante 50, Providencia',
        -33.4440, -70.6290, (date_trunc('day', now() at time zone 'America/Santiago') + interval '24 days 11 hours') at time zone 'America/Santiago', 60, 10, 8,
        0, 'recreativo', 'futbol5', 'inmediata',
        'Partido abierto para quien quiera sumarse.'
    ) returning id into v_p2;

    insert into public.attendees (id_partido, id_jugador, estado, origen)
    values (v_p2, v_c2, 'inscrito', 'orden_llegada');

    -- Mensajes. `messages_force_server_fields` les pone a todos la misma
    -- hora (la de la transacción), y entonces el chat no sabe cuál es el
    -- último. Después de insertar cada uno se le corre la hora hacia atrás.
    -- Esa corrección la bloquea `messages_block_content_edits`, así que va
    -- con los disparadores apagados SÓLO para ese update (`set local`, se
    -- vuelve a encender en la línea siguiente).
    for v_msg in
        select * from (values
            (v_c1,  v_rev, null::uuid, null::uuid, 'Hola, ¿te sumas al fútbol 7 que armé?', 180),
            (v_rev, v_c1,  null, null, '¡Sí! Ya me inscribí.', 175),
            (v_c1,  v_rev, null, null, 'Buena. Nos vemos en la cancha.', 170),
            (v_rev, null,  v_club, null, 'Bienvenidos al club. Jugamos los jueves a las 21:00.', 120),
            (v_c1,  null,  v_club, null, 'Yo llevo los petos.', 90),
            (v_c2,  null,  v_club, null, 'Cuenten conmigo.', 60),
            (v_c1,  null,  null, v_p1, 'Lleguen 10 minutos antes para armar los equipos.', 30),
            (v_rev, null,  null, v_p1, 'Perfecto, ahí estaré.', 20)
        ) as t(autor, para, club, partido, texto, minutos)
    loop
        insert into public.messages (sender_id, receiver_id, club_id, match_id, content)
        values (v_msg.autor, v_msg.para, v_msg.club, v_msg.partido, v_msg.texto)
        returning id into v_id;

        set local session_replication_role = replica;
        update public.messages
           set created_at = now() - make_interval(mins => v_msg.minutos)
         where id = v_id;
        set local session_replication_role = origin;
    end loop;

    raise notice 'Semilla lista: cuenta %, club %, partidos % y %.', v_correo, v_club, v_p1, v_p2;
end $$;
