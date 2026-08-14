-- =============================================================
-- FutFinder — pruebas de los cambios negociados del partido
-- (migración 46).
--
-- QUÉ SE PRUEBA. Publicado el partido, ninguno de los dos clubes
-- puede editarlo por su cuenta: pide un cambio y el club contrario lo
-- acepta o lo rechaza. Mientras la solicitud está pendiente el partido
-- NO SE MUEVE, y ésa es la propiedad central de este arnés: casi cada
-- caso vuelve a comprobar que la hora, la cancha y la cuota vigentes
-- siguen donde estaban.
--
-- LAS CUATRO REGLAS Y DÓNDE SE COMPRUEBAN:
--
--   · El plazo de 2 horas lo calcula PostgreSQL con `now()`, nunca el
--     teléfono (casos 1, 16 y 17).
--   · Responde un administrador DEL CLUB CONTRARIO (casos 5 a 8).
--   · Quien propone no acepta su propia solicitud, ni siquiera siendo
--     el único administrador de su club (caso 5); y ningún OTRO
--     administrador de su club puede aceptar por él (caso 6). Son dos
--     reglas distintas: sin la segunda, un club con dos
--     administradores se aprobaría los cambios solo.
--   · Rechazar no toca nada (caso 9); aceptar aplica y avisa
--     (casos 10 a 15).
--
-- Requisito: migraciones 44 a 44e, 45 y 46 aplicadas.
--
-- NOTA SOBRE LA CONCURRENCIA. Este arnés corre en UNA sola sesión, así
-- que no puede lanzar dos transacciones en paralelo: lo que prueba es
-- el invariante —nunca hay dos solicitudes pendientes sobre el mismo
-- partido, y una solicitud ya respondida no se responde otra vez—, no
-- la carrera real. Lo que la cubre es el índice único parcial
-- `club_match_changes_pendiente_uidx`, que es una restricción de la
-- base y no un `if`, más el `select ... for update` sobre la fila del
-- partido y el `update ... where estado = 'pendiente'`, que serializa
-- las respuestas. Una prueba de carrera de verdad necesita dos sesiones
-- y un arnés aparte, como el que se hizo para U3.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK. Usa el
-- partido de clubes que ya exista en la base y lo devuelve intacto. El
-- único partido que CREA es el normal de control del caso 20, y también
-- desaparece con el `rollback`.
-- =============================================================

begin;

create temp table t46 (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_m        uuid;                    -- el partido de clubes
  v_ch       uuid;                    -- su desafío
  v_cA       uuid;                    -- club que propone (local)
  v_cB       uuid;                    -- club que responde (visitante)
  v_adminA   uuid;                    -- administrador del club que propone
  v_adminA2  uuid := gen_random_uuid();  -- SEGUNDO administrador del mismo club
  v_adminB   uuid;                    -- administrador del club contrario
  v_jugB     uuid := gen_random_uuid();  -- integrante sin rol del club contrario
  v_ajeno    uuid := gen_random_uuid();  -- no pertenece a ninguno de los dos
  v_inscrito uuid := gen_random_uuid();  -- jugador inscrito: recibe el aviso
  v_normal   uuid;                    -- un partido normal, de control
  v_hora0    timestamptz;             -- la hora vigente del partido
  v_nueva    timestamptz;
  v_token    uuid := gen_random_uuid();
  v_token2   uuid := gen_random_uuid();   -- el de la doble pulsación del caso 18
  v_j        json;
  v_cambio   uuid;
  v_cambio2  uuid;
  v_count    int;
  v_estado   text;
  v_texto    text;
  v_num      numeric;
  v_texto2   text;
  v_payload  jsonb;
begin
  -- ── el partido con el que se trabaja ──────────────────────────
  select m.id, m.challenge_id, m.club_local_id, m.club_visitante_id
    into v_m, v_ch, v_cA, v_cB
    from public.matches m
    join public.club_challenges c on c.id = m.challenge_id
   where m.challenge_proposal_id is not null
   order by m.created_at desc
   limit 1;
  if v_m is null then
    raise exception 'No hay ningún partido de clubes en la base contra el que probar';
  end if;

  select user_id into v_adminA from public.club_members where club_id = v_cA and rol = 'admin' limit 1;
  select user_id into v_adminB from public.club_members where club_id = v_cB and rol = 'admin' limit 1;
  if v_adminA is null or v_adminB is null then
    raise exception 'Alguno de los dos clubes no tiene administrador: este arnés no puede probar la autorización';
  end if;

  -- La regla estricta (43d) exige que quien responde NO pertenezca al
  -- club proponente en ningún rol. Si los administradores reales
  -- compartieran club, el arnés mediría otra cosa y hay que saberlo.
  if exists (select 1 from public.club_members where user_id = v_adminB and club_id = v_cA)
     or exists (select 1 from public.club_members where user_id = v_adminA and club_id = v_cB) then
    raise exception 'Los administradores de los dos clubes comparten membresía: este arnés necesita clubes separados';
  end if;

  -- Estado de partida conocido, siempre dentro de la transacción.
  v_hora0 := date_trunc('hour', now()) + interval '5 days';
  update public.matches
     set estado = 'abierto', hora = v_hora0, precio_cuota = 5000,
         cancha_nombre = 'Cancha Uno', comuna = 'Providencia',
         region = 'Región Metropolitana de Santiago',
         direccion = null, latitud = -33.4200000, longitud = -70.6100000,
         ubicacion_aproximada = true
   where id = v_m;
  update public.club_challenges set estado = 'publicado' where id = v_ch;

  insert into public.club_match_locations (match_id, direccion, latitud, longitud)
  values (v_m, 'Av. Providencia 100', -33.4212345, -70.6112345)
  on conflict (match_id) do update
     set direccion = excluded.direccion, latitud = excluded.latitud, longitud = excluded.longitud;

  -- ── gente de prueba ───────────────────────────────────────────
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u46-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from unnest(array[v_adminA2, v_jugB, v_ajeno, v_inscrito]) u;

  -- Un segundo administrador en el club que propone. El plan estándar
  -- admite uno solo —y 15 integrantes—, así que los dos clubes suben a
  -- premium DENTRO de la transacción: el arnés no puede fallar porque el
  -- club de prueba esté cerca de su tope.
  update public.clubs set plan = 'premium' where id in (v_cA, v_cB);
  insert into public.club_members (club_id, user_id, rol) values (v_cA, v_adminA2, 'admin');
  insert into public.club_members (club_id, user_id, rol) values (v_cB, v_jugB, 'jugador');
  insert into public.club_members (club_id, user_id, rol) values (v_cA, v_inscrito, 'jugador');

  insert into public.attendees (id_partido, id_jugador, estado, club_id, origen)
  values (v_m, v_inscrito, 'inscrito', v_cA, 'orden_llegada');

  delete from public.notifications where data ->> 'matchId' = v_m::text;

  -- ══ CASO 1: fuera de plazo, no se pide nada ══════════════════
  -- El partido empieza en una hora. Quedan menos de dos, así que ya no
  -- se negocia: a esa altura la gente va en camino.
  update public.matches set hora = now() + interval '1 hour' where id = v_m;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('hora', (now() + interval '2 days')::text), null::uuid);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 1): se aceptó un cambio a una hora del partido';
  end if;
  select count(*) into v_count from public.club_match_changes where match_id = v_m;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 1): quedaron % solicitudes pese al rechazo', v_count;
  end if;
  insert into t46 values (1,'plazo de 2 h al proponer',
    format('a 1 h del partido no se piden cambios y no queda fila — «%s»', v_j->>'reason'));

  -- ══ CASO 2: proponer NO mueve el partido ═════════════════════
  -- Las dos líneas de arriba movieron la hora a mano y eso ya disparó
  -- `notify_match_updated`, que es un aviso legítimo del arnés y no del
  -- código que se prueba. Se limpia acá para que el conteo de abajo mida
  -- lo que dice medir.
  update public.matches set hora = v_hora0 where id = v_m;
  delete from public.notifications where data ->> 'matchId' = v_m::text;
  v_nueva := v_hora0 + interval '2 hours';
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('hora', v_nueva::text), v_token);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 2): no se pudo proponer — %', v_j->>'reason';
  end if;
  v_cambio := (v_j->>'changeId')::uuid;

  select estado into v_estado from public.club_match_changes where id = v_cambio;
  if v_estado <> 'pendiente' then
    raise exception 'FALLÓ (caso 2): la solicitud nace en «%» y debería nacer pendiente', v_estado;
  end if;
  if (select hora from public.matches where id = v_m) <> v_hora0 then
    raise exception 'FALLÓ (caso 2): proponer YA cambió la hora del partido';
  end if;
  select count(*) into v_count from public.notifications
   where type = 'match_updated' and data ->> 'matchId' = v_m::text;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 2): proponer avisó a los inscritos de un cambio que no ocurrió';
  end if;
  insert into t46 values (2,'proponer no aplica',
    'la solicitud queda pendiente, la hora vigente no se mueve y nadie recibe aviso de cambio');

  -- ══ CASO 3: el evento del chat lleva el antes y el después ═══
  select payload into v_payload from public.club_challenge_events
   where challenge_id = v_ch and tipo = 'cambio_propuesto'
   order by created_at desc limit 1;
  if v_payload is null then
    raise exception 'FALLÓ (caso 3): no se registró el evento «cambio_propuesto» en el chat';
  end if;
  if (v_payload -> 'cambios' -> 0 ->> 'campo') <> 'hora'
     or (v_payload -> 'cambios' -> 0 ->> 'antes')::timestamptz <> v_hora0
     or (v_payload -> 'cambios' -> 0 ->> 'despues')::timestamptz <> v_nueva then
    raise exception 'FALLÓ (caso 3): el evento no trae campo/antes/después — %', v_payload;
  end if;
  if coalesce(v_payload ->> 'club_proponente_nombre', '') = '' then
    raise exception 'FALLÓ (caso 3): el evento no dice qué club propone — %', v_payload;
  end if;
  -- El actor: `actor_id` para auditar y `actor_username` para leer. Los dos
  -- los pone el SERVIDOR desde `profiles`; si vinieran del cliente, quien
  -- pide el cambio podría firmarlo con el nombre de otro.
  if (v_payload ->> 'actor_id')::uuid <> v_adminA then
    raise exception 'FALLÓ (caso 3): el evento no conserva el actor — %', v_payload;
  end if;
  select username into v_texto from public.profiles where id = v_adminA;
  if v_texto is not null and coalesce(v_payload ->> 'actor_username', '') <> v_texto then
    raise exception 'FALLÓ (caso 3): el `actor_username` («%») no es el de `profiles` («%»)',
      v_payload ->> 'actor_username', v_texto;
  end if;
  insert into t46 values (3,'evento del chat',
    format('«%s» (@%s) propone cambiar la hora, con el valor anterior, el propuesto y el actor en el payload',
           v_payload ->> 'club_proponente_nombre', coalesce(v_payload ->> 'actor_username', '?')));

  -- ══ CASO 4: el aviso va al club que tiene que responder ══════
  select count(*) into v_count from public.notifications
   where type = 'club_match_change' and user_id = v_adminB and data ->> 'matchId' = v_m::text;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 4): el administrador contrario recibió % avisos', v_count;
  end if;
  select count(*) into v_count from public.notifications
   where type = 'club_match_change' and user_id in (v_adminA, v_adminA2);
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 4): el club que propone se avisó a sí mismo (% avisos)', v_count;
  end if;
  insert into t46 values (4,'a quién se avisa',
    'el aviso llega a los administradores del club contrario y no al que pidió el cambio');

  -- ══ CASO 5: quien propone no acepta lo suyo ══════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 5): el proponente aceptó su propia solicitud';
  end if;
  insert into t46 values (5,'nadie se acepta a sí mismo', format('rechazado — %s', v_j->>'reason'));

  -- ══ CASO 6: ni otro administrador de su club ═════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA2,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 6): un segundo administrador del club proponente aceptó el cambio';
  end if;
  insert into t46 values (6,'el club proponente no responde',
    format('el otro administrador del mismo club tampoco puede — %s', v_j->>'reason'));

  -- ══ CASO 7: un integrante sin rol del club contrario ═════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_jugB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 7): un jugador sin rol aceptó el cambio';
  end if;
  insert into t46 values (7,'hace falta ser administrador', format('rechazado — %s', v_j->>'reason'));

  -- ══ CASO 8: un ajeno no responde ni ve la solicitud ══════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ajeno,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio, true);
  select count(*) into v_count from public.club_match_changes;
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 8): un ajeno a los dos clubes aceptó el cambio';
  end if;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 8): un ajeno LEE % solicitud(es) de un partido privado', v_count;
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_jugB,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_changes where match_id = v_m;
  execute 'reset role';
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 8): un integrante de los clubes ve % solicitudes y debería ver 1', v_count;
  end if;
  insert into t46 values (8,'privacidad de la solicitud',
    'el ajeno no responde y no lee ninguna fila; el integrante de los clubes sí la lee');

  -- ══ CASO 9: rechazar conserva los valores ════════════════════
  -- Con motivo: es opcional, pero cuando se escribe tiene que llegar entero
  -- a la fila, al evento del chat y al aviso del club que pidió el cambio.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio, false, '  ese día no tenemos arquero  ');
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 9): el administrador contrario no pudo rechazar — %', v_j->>'reason';
  end if;
  if (select hora from public.matches where id = v_m) <> v_hora0 then
    raise exception 'FALLÓ (caso 9): rechazar movió la hora del partido';
  end if;
  select estado into v_estado from public.club_match_changes where id = v_cambio;
  if v_estado <> 'rechazado' then
    raise exception 'FALLÓ (caso 9): la solicitud quedó en «%»', v_estado;
  end if;
  select count(*) into v_count from public.notifications
   where type = 'match_updated' and data ->> 'matchId' = v_m::text;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9): rechazar avisó a % inscrito(s) de un cambio que no hubo', v_count;
  end if;
  select count(*) into v_count from public.club_challenge_events
   where challenge_id = v_ch and tipo = 'cambio_respondido' and (payload ->> 'aceptado')::boolean = false;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 9): el rechazo dejó % eventos en el chat', v_count;
  end if;
  select count(*), max(body) into v_count, v_texto from public.notifications
   where type = 'club_match_change_responded' and user_id = v_adminA;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 9): quien propuso recibió % avisos de la respuesta', v_count;
  end if;

  -- El motivo llega recortado a la fila, al evento y al aviso.
  select motivo into v_texto2 from public.club_match_changes where id = v_cambio;
  if v_texto2 <> 'ese día no tenemos arquero' then
    raise exception 'FALLÓ (caso 9): el motivo quedó como «%» (¿sin recortar?)', v_texto2;
  end if;
  select payload into v_payload from public.club_challenge_events
   where challenge_id = v_ch and tipo = 'cambio_respondido' order by created_at desc limit 1;
  if (v_payload ->> 'motivo') <> 'ese día no tenemos arquero'
     or (v_payload ->> 'actor_id')::uuid <> v_adminB then
    raise exception 'FALLÓ (caso 9): el evento del rechazo no trae motivo y actor — %', v_payload;
  end if;
  if v_texto not like '%no tenemos arquero%' then
    raise exception 'FALLÓ (caso 9): el aviso al proponente no incluye el motivo — «%»', v_texto;
  end if;
  insert into t46 values (9,'rechazar no toca nada',
    'la hora sigue igual, la solicitud queda rechazada con su motivo recortado en fila, evento y aviso, y cero avisos de cambio a los inscritos');

  -- ══ CASO 10: aceptar aplica el cambio ════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('hora', v_nueva::text), null::uuid);
  execute 'reset role';
  v_cambio2 := (v_j->>'changeId')::uuid;
  if v_cambio2 is null then
    raise exception 'FALLÓ (caso 10): no se pudo volver a proponer tras el rechazo — %', v_j->>'reason';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio2, true);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 10): el administrador contrario no pudo aceptar — %', v_j->>'reason';
  end if;
  if (select hora from public.matches where id = v_m) <> v_nueva then
    raise exception 'FALLÓ (caso 10): aceptar no aplicó la hora nueva';
  end if;
  select estado into v_estado from public.club_match_changes where id = v_cambio2;
  if v_estado <> 'aceptado' then
    raise exception 'FALLÓ (caso 10): la solicitud aceptada quedó en «%»', v_estado;
  end if;
  insert into t46 values (10,'aceptar aplica','el partido queda con la hora nueva y la solicitud aceptada');

  -- ══ CASO 11: los inscritos se enteran ════════════════════════
  select count(*), max(body) into v_count, v_texto from public.notifications
   where type = 'match_updated' and data ->> 'matchId' = v_m::text and user_id = v_inscrito;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 11): el inscrito recibió % avisos del cambio aplicado', v_count;
  end if;
  if v_texto not like '%la fecha y hora%' then
    raise exception 'FALLÓ (caso 11): el aviso no dice qué cambió — «%»', v_texto;
  end if;
  insert into t46 values (11,'aviso a los inscritos', format('«%s»', v_texto));

  -- ══ CASO 12: quien propuso recibe la respuesta ═══════════════
  select count(*) into v_count from public.notifications
   where type = 'club_match_change_responded' and user_id = v_adminA
     and data ->> 'changeId' = v_cambio2::text;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 12): el proponente recibió % avisos de la aceptación', v_count;
  end if;
  insert into t46 values (12,'aviso al proponente','el club que pidió el cambio se entera de que fue aceptado');

  -- ══ CASO 13: la cancha, con la ubicación separada ════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cancha', jsonb_build_object(
      'cancha_nombre','Cancha Dos','direccion','Av. Nueva 456','comuna','Ñuñoa',
      'region','Región Metropolitana de Santiago','latitud',-33.4567890,'longitud',-70.6098765)), null::uuid);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 13): no se pudo proponer la cancha — %', v_j->>'reason';
  end if;
  v_cambio2 := (v_j->>'changeId')::uuid;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio2, true);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 13): no se pudo aceptar la cancha — %', v_j->>'reason';
  end if;

  select cancha_nombre into v_texto from public.matches where id = v_m;
  if v_texto <> 'Cancha Dos' then
    raise exception 'FALLÓ (caso 13): la cancha quedó en «%»', v_texto;
  end if;
  if (select comuna from public.matches where id = v_m) <> 'Ñuñoa' then
    raise exception 'FALLÓ (caso 13): la comuna no se actualizó';
  end if;
  if (select direccion from public.matches where id = v_m) is not null then
    raise exception 'FALLÓ (caso 13): la calle exacta volvió a `matches`, que es la tabla que la 44b vació';
  end if;
  select latitud into v_num from public.matches where id = v_m;
  if v_num <> public.aproximar_grado(-33.4567890) then
    raise exception 'FALLÓ (caso 13): `matches` guardó % en vez del punto aproximado', v_num;
  end if;
  if not (select ubicacion_aproximada from public.matches where id = v_m) then
    raise exception 'FALLÓ (caso 13): el partido dejó de estar marcado como aproximado';
  end if;
  select direccion, latitud into v_texto, v_num from public.club_match_locations where match_id = v_m;
  if v_texto <> 'Av. Nueva 456' or v_num <> -33.4567890 then
    raise exception 'FALLÓ (caso 13): la ubicación exacta no se actualizó — «%», %', v_texto, v_num;
  end if;
  insert into t46 values (13,'cambio de cancha',
    '`matches` recibe el punto aproximado y la calle sigue nula; la exacta se actualiza en `club_match_locations`');

  -- ══ CASO 14: la cuota ════════════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cuota', 8000), null::uuid);
  execute 'reset role';
  v_cambio2 := (v_j->>'changeId')::uuid;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio2, true);
  execute 'reset role';
  if (select precio_cuota from public.matches where id = v_m) <> 8000 then
    raise exception 'FALLÓ (caso 14): la cuota no se aplicó';
  end if;
  insert into t46 values (14,'cambio de cuota','la cuota acordada queda aplicada en el partido');

  -- ══ CASO 15: una sola solicitud pendiente por partido ════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cuota', 9000), null::uuid);
  v_cambio2 := (v_j->>'changeId')::uuid;
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cuota', 10000), null::uuid);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 15): se abrió una segunda solicitud con una pendiente';
  end if;
  insert into t46 values (15,'una pendiente a la vez',
    format('con una solicitud abierta no se abre otra — %s', v_j->>'reason'));

  -- ══ CASO 16: no se propone una hora dentro de las 2 h ════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio2, false);   -- se libera la pendiente
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('hora', (now() + interval '1 hour')::text), null::uuid);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 16): se propuso mover el partido a una hora de ahora';
  end if;
  insert into t46 values (16,'la hora propuesta también respeta el plazo',
    format('no se puede mover el partido a menos de 2 h — %s', v_j->>'reason'));

  -- ══ CASO 17: el plazo se vuelve a mirar AL RESPONDER ═════════
  -- Se propone con tiempo de sobra y el partido se acerca mientras la
  -- solicitud está pendiente. Aceptar a esa altura sería cambiarle el
  -- partido a gente que ya salió de su casa.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cuota', 12000), null::uuid);
  execute 'reset role';
  v_cambio2 := (v_j->>'changeId')::uuid;
  if v_cambio2 is null then
    raise exception 'FALLÓ (caso 17): no se pudo proponer con plazo — %', v_j->>'reason';
  end if;

  update public.matches set hora = now() + interval '30 minutes' where id = v_m;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio2, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 17): se aceptó un cambio a 30 minutos del partido';
  end if;
  if (select precio_cuota from public.matches where id = v_m) <> 8000 then
    raise exception 'FALLÓ (caso 17): la cuota cambió pese al rechazo';
  end if;
  select estado into v_estado from public.club_match_changes where id = v_cambio2;
  if v_estado <> 'caducado' then
    raise exception 'FALLÓ (caso 17): la solicitud fuera de plazo quedó en «%» y debería caducar', v_estado;
  end if;
  insert into t46 values (17,'plazo de 2 h al responder',
    'la solicitud pendiente caduca al entrar en las 2 h y aceptar ya no aplica nada');

  update public.matches set hora = v_nueva where id = v_m;

  -- ══ CASO 18: idempotencia por `client_token` ═════════════════
  -- Token NUEVO a propósito: `v_token` es el del caso 2 y su solicitud
  -- sigue en la tabla, así que reusarlo mediría el reencuentro con una
  -- fila vieja en vez de la doble pulsación de ahora.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cuota', 15000), v_token2);
  v_cambio2 := (v_j->>'changeId')::uuid;
  if v_cambio2 is null then
    raise exception 'FALLÓ (caso 18): la primera pulsación no dejó solicitud — %', v_j->>'reason';
  end if;
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cuota', 15000), v_token2);
  execute 'reset role';
  if (v_j->>'changeId')::uuid <> v_cambio2 then
    raise exception 'FALLÓ (caso 18): el mismo token abrió dos solicitudes distintas';
  end if;
  select count(*) into v_count from public.club_match_changes where client_token = v_token2;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 18): el mismo token dejó % filas', v_count;
  end if;
  insert into t46 values (18,'doble pulsación','el mismo `client_token` devuelve la solicitud que ya existe, no crea otra');

  -- ══ CASO 19: sólo se negocian los campos previstos ═══════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido(v_cambio2, false);
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cupos_por_club', 5), null::uuid);
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 19): se aceptó negociar los cupos, que cambian la nómina ya inscrita';
  end if;
  v_j := public.proponer_cambio_partido(v_m, '{}'::jsonb, null::uuid);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 19): se aceptó una solicitud sin ningún campo';
  end if;
  insert into t46 values (19,'campos negociables',
    'los cupos no se negocian acá y una solicitud vacía se rechaza');

  -- ══ CASO 20: un partido normal no entra por esta puerta ══════
  -- El partido de control se CREA acá en vez de buscar uno existente: si la
  -- base no tuviera ninguno futuro, el caso se saltaría en silencio y esta
  -- comprobación —que la 46 no toca los partidos normales— dejaría de
  -- correr justo el día en que hiciera falta.
  insert into public.matches (id_organizador, titulo, comuna, region, cancha_nombre, direccion,
    latitud, longitud, hora, duracion_min, cupos_totales, cupos_disponibles, precio_cuota)
  values (v_ajeno, 'Partido normal de control 46', 'Providencia',
    'Región Metropolitana de Santiago', 'Cancha de control', 'Av. Providencia 200',
    -33.4300000, -70.6200000, now() + interval '5 days', 90, 10, 9, 3000)
  returning id into v_normal;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_normal, jsonb_build_object('cuota', 1000), null::uuid);
  execute 'reset role';
  if (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 20): se abrió una negociación sobre un partido normal';
  end if;

  -- Y el partido normal sigue editándose como siempre, con el aviso de
  -- siempre: la 46 le cambió el TEXTO y el destinatario a
  -- `notify_match_updated` SÓLO en la rama de los partidos de clubes, y esto
  -- es lo que lo demuestra.
  insert into public.attendees (id_partido, id_jugador, estado) values (v_normal, v_jugB, 'inscrito');
  delete from public.notifications where data ->> 'matchId' = v_normal::text;
  update public.matches set precio_cuota = 4000 where id = v_normal;

  select count(*), max(body) into v_count, v_texto from public.notifications
   where type = 'match_updated' and data ->> 'matchId' = v_normal::text and user_id = v_jugB;
  if v_count <> 1 or v_texto not like 'El organizador cambió%' then
    raise exception 'FALLÓ (caso 20): el aviso del partido normal cambió — % aviso(s), «%»', v_count, v_texto;
  end if;
  select count(*) into v_count from public.notifications
   where type = 'match_updated' and data ->> 'matchId' = v_normal::text and user_id = v_ajeno;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 20): el organizador de un partido normal recibió su propio aviso';
  end if;
  insert into t46 values (20,'sólo partidos de clubes',
    format('la negociación se rechaza en un partido normal —%s— y ese partido se sigue editando igual que siempre',
           v_j->>'reason'));

  -- ══ CASO 21: la tabla no se escribe desde el cliente ═════════
  if has_table_privilege('authenticated','public.club_match_changes','INSERT')
     or has_table_privilege('authenticated','public.club_match_changes','UPDATE')
     or has_table_privilege('authenticated','public.club_match_changes','DELETE')
     or has_table_privilege('anon','public.club_match_changes','SELECT') then
    raise exception 'FALLÓ (caso 21): `club_match_changes` acepta escritura directa o lectura anónima';
  end if;
  if has_function_privilege('public','public.proponer_cambio_partido(uuid, jsonb, uuid)','EXECUTE')
     or has_function_privilege('anon','public.proponer_cambio_partido(uuid, jsonb, uuid)','EXECUTE')
     or has_function_privilege('public','public.responder_cambio_partido(uuid, boolean, text)','EXECUTE')
     or has_function_privilege('anon','public.responder_cambio_partido(uuid, boolean, text)','EXECUTE') then
    raise exception 'FALLÓ (caso 21): las RPC de cambios quedaron ejecutables por `public` o `anon`';
  end if;
  -- La versión de dos argumentos no puede sobrevivir: con el motivo por
  -- defecto, `responder_cambio_partido(id, true)` sería ambigua y PostgREST
  -- no sabría cuál llamar.
  if to_regprocedure('public.responder_cambio_partido(uuid, boolean)') is not null then
    raise exception 'FALLÓ (caso 21): quedó viva la versión de 2 argumentos y la llamada es ambigua';
  end if;
  insert into t46 values (21,'ACL',
    'sin escritura directa ni lectura anónima sobre la tabla, las dos RPC revocadas de `public` y `anon`, y sin la firma vieja de 2 argumentos');

  -- ══ CASO 22: el motivo del rechazo es opcional ═══════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cuota', 7500), null::uuid);
  execute 'reset role';
  v_cambio2 := (v_j->>'changeId')::uuid;
  if v_cambio2 is null then
    raise exception 'FALLÓ (caso 22): no se pudo proponer — %', v_j->>'reason';
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  -- Sin tercer argumento, y con espacios en blanco: las dos formas tienen que
  -- dar lo mismo, un rechazo SIN motivo. Un motivo de puros espacios se
  -- leería en el chat como una explicación que nadie dio.
  v_j := public.responder_cambio_partido(v_cambio2, false);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then
    raise exception 'FALLÓ (caso 22): no se pudo rechazar sin motivo — %', v_j->>'reason';
  end if;
  select motivo into v_texto2 from public.club_match_changes where id = v_cambio2;
  if v_texto2 is not null then
    raise exception 'FALLÓ (caso 22): un rechazo sin motivo guardó «%»', v_texto2;
  end if;
  select payload into v_payload from public.club_challenge_events
   where challenge_id = v_ch and tipo = 'cambio_respondido' order by created_at desc limit 1;
  if v_payload ->> 'motivo' is not null then
    raise exception 'FALLÓ (caso 22): el evento inventó un motivo — %', v_payload;
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.proponer_cambio_partido(v_m, jsonb_build_object('cuota', 7600), null::uuid);
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.responder_cambio_partido((v_j->>'changeId')::uuid, false, '    ');
  execute 'reset role';
  select motivo into v_texto2 from public.club_match_changes where id = (v_j->>'changeId')::uuid;
  if v_texto2 is not null then
    raise exception 'FALLÓ (caso 22): un motivo de puros espacios se guardó como «%»', v_texto2;
  end if;
  if (select precio_cuota from public.matches where id = v_m) <> 8000 then
    raise exception 'FALLÓ (caso 22): alguno de los dos rechazos cambió la cuota';
  end if;
  insert into t46 values (22,'el motivo es opcional',
    'rechazar sin motivo y con puros espacios deja `motivo` en NULL, no inventa nada en el evento y no toca el partido');
end;
$$;

select n, caso, detalle from t46 order by n;

rollback;
