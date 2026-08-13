-- =============================================================
-- FutFinder — pruebas de la reserva voluntaria de los
-- administradores (migración 45, secciones 2, 8, 8b y 9)
--
-- PARTE C · «¿quieres incluirte como jugador?».  Al proponer y al
-- aprobar se pregunta, con «No» por defecto. La intención del proponente
-- viaja en la propuesta y NO consume cupo hasta que el partido se
-- publica; la del aprobador se decide en el momento de aprobar.
--
-- Qué cubre:
--   C01. Proponente Sí / aprobador No.
--   C02. Proponente No / aprobador Sí.
--   C03. Ambos Sí — un cupo de cada club, nunca dos del mismo.
--   C04. Ambos No.
--   C05. La opción predeterminada es No: sin la clave en el payload y
--        llamando `aprobar_propuesta` con UN solo argumento. Esto
--        comprueba de paso que la versión de un argumento se borró: si
--        siguiera existiendo, la llamada resolvería a la vieja.
--   C06. Una propuesta pendiente no consume cupos: antes de aprobar no
--        hay partido ni asistentes, por mucho que se haya pedido cupo.
--   C07. Origen auditable: `reserva_proponente` y `reserva_aprobador` en
--        `attendees`, y el evento `partido_publicado` con quién pidió
--        cupo, quién lo obtuvo y por qué no.
--   C08. Conflicto del proponente: el partido se publica igual, su
--        reserva se omite y se le avisa sólo a él.
--   C09. Conflicto del aprobador: mismo trato que el proponente.
--   C10. Conflicto de los dos: el partido se publica igual y salen dos
--        avisos, uno para cada uno.
--   C11. El proponente dejó el club entre proponer y que le aprobaran:
--        no le corresponde el cupo, y el motivo lo dice.
--   C12. Doble aprobación idempotente: mismo partido, sin duplicar
--        inscripciones ni descontar cupos dos veces.
--   C13. Un fallo inesperado —no un impedimento personal— aborta la
--        publicación entera: ni partido, ni desafío publicado.
--   C14. Las reservas válidas consumen cupos independientes: la del
--        club A no le quita nada al club B.
--   C15. Salir libera el cupo reservado.
--   C16. Publicado el partido, la excepción se cierra: nadie se
--        confirma a sí mismo desde la nómina.
--   C17. Regresión: en un partido NORMAL el organizador sigue exento
--        del choque de horario.
--   C18. Regresión: en un partido NORMAL quien no organiza sigue
--        chocando.
--
-- C09 y C10 fallaban antes de la sección 8c de la migración: en un
-- partido de clubes `matches.id_organizador` es el administrador que
-- aprueba, así que la exención del organizador de
-- `tg_enforce_join_rules` le perdonaba las tres comprobaciones y su
-- reserva entraba siempre. C17 y C18 fijan que ese arreglo no toca a
-- los partidos normales.
--
-- Requisito: migraciones 44 a 44e y 45 aplicadas.
--
-- Cada caso corre dentro de su propio bloque con captura de excepción,
-- así que un fallo no tumba la batería: se anota y el resto sigue.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t45c (n text, resultado text, detalle text) on commit drop;

-- ── Escenario: dos clubes premium, dos administradores cada uno,
--    tres jugadores cada uno, y un desafío en negociación. ──────────
create function pg_temp.escenario(p_cupos integer, p_metodo text)
returns jsonb
language plpgsql
as $fn$
declare
  v_ca uuid := gen_random_uuid(); v_cb uuid := gen_random_uuid();
  v_a1 uuid := gen_random_uuid(); v_a2 uuid := gen_random_uuid();
  v_b1 uuid := gen_random_uuid(); v_b2 uuid := gen_random_uuid();
  v_ja uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  v_jb uuid[] := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  v_ch uuid;
  v_sufijo text := replace(gen_random_uuid()::text, '-', '');
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u3c-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
    from unnest(array[v_a1,v_a2,v_b1,v_b2] || v_ja || v_jb) u;

  update public.profiles set trust_score = 100
   where id = any (array[v_a1,v_a2,v_b1,v_b2] || v_ja || v_jb);

  -- Premium: el plan estándar sólo admite un administrador, y aquí
  -- hacen falta dos por club para probar que sale el correcto.
  insert into public.clubs (id,nombre,slug,created_by,plan,region,comuna,modalidad)
  values (v_ca,'Club A '||v_sufijo,'club-a-'||v_sufijo,v_a1,'premium','Metropolitana','Nunoa','futbol7'),
         (v_cb,'Club B '||v_sufijo,'club-b-'||v_sufijo,v_b1,'premium','Metropolitana','Nunoa','futbol7');

  insert into public.club_members (club_id,user_id,rol) values
    (v_ca,v_a1,'admin'), (v_ca,v_a2,'admin'), (v_cb,v_b1,'admin'), (v_cb,v_b2,'admin');
  insert into public.club_members (club_id,user_id,rol) select v_ca,u,'jugador' from unnest(v_ja) u;
  insert into public.club_members (club_id,user_id,rol) select v_cb,u,'jugador' from unnest(v_jb) u;

  insert into public.club_challenges (club_retador_id,club_retado_id,creado_por,estado,
      modalidad,cupos_por_club,metodo_inscripcion,negociacion_vence_at)
  values (v_ca,v_cb,v_a1,'negociacion','futbol7',p_cupos,p_metodo,now()+interval '72 hours')
  returning id into v_ch;

  return jsonb_build_object('clubA',v_ca,'clubB',v_cb,'a1',v_a1,'a2',v_a2,
    'b1',v_b1,'b2',v_b2,'ja',to_jsonb(v_ja),'jb',to_jsonb(v_jb),'challenge',v_ch);
end;
$fn$;

-- Payload de la propuesta. `p_juega = null` OMITE la clave, que es como
-- comprueba C05 que el valor por defecto es «No».
create function pg_temp.payload(p_fecha timestamptz, p_cupos integer, p_metodo text, p_juega boolean)
returns jsonb
language sql
as $fn$
  select jsonb_build_object(
    'fecha', p_fecha, 'duracion_min', 90,
    'direccion','Av. Siempre Viva 742','cancha_nombre','Cancha Central',
    'comuna','Nunoa','region','Metropolitana',
    'latitud', -33.4569, 'longitud', -70.6483,
    'modalidad','futbol7','cupos_por_club',p_cupos,
    'metodo_inscripcion',p_metodo,'cuota_por_persona',3000)
  || case when p_juega is null then '{}'::jsonb
          else jsonb_build_object('proponente_juega', p_juega) end;
$fn$;

-- Crea la propuesta como administrador del club retador y devuelve su id.
create function pg_temp.proponer(p_esc jsonb, p_fecha timestamptz, p_cupos integer,
                                 p_metodo text, p_juega boolean)
returns uuid
language plpgsql
as $fn$
declare v_id uuid;
begin
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', p_esc->>'a1', 'role','authenticated')::text);
  select id into v_id from public.crear_propuesta_oficial(
    (p_esc->>'challenge')::uuid, pg_temp.payload(p_fecha,p_cupos,p_metodo,p_juega), null);
  execute 'reset role';
  return v_id;
end;
$fn$;

-- Un partido normal, abierto, con `p_user` inscrito a la hora `p_hora`:
-- así se fabrica el choque de horario que `tg_enforce_join_rules` levanta.
create function pg_temp.partido_que_choca(p_user uuid, p_hora timestamptz)
returns uuid
language plpgsql
as $fn$
declare v_id uuid;
begin
  insert into public.matches (id_organizador,titulo,comuna,region,cancha_nombre,latitud,longitud,
      hora,duracion_min,cupos_totales,cupos_disponibles,precio_cuota,modalidad,aprobacion,
      min_trust_score,estado,ubicacion_aproximada)
  values (p_user,'Partido que choca','Nunoa','Metropolitana','Otra cancha',-33.40,-70.55,
      p_hora,90,10,10,0,'futbol7','inmediata',0,'abierto',false)
  returning id into v_id;
  return v_id;
end;
$fn$;

do $$
declare
  esc jsonb; v_prop uuid; v_match public.matches; v_fecha timestamptz;
  v_c integer; v_d integer; v_ev jsonb; v_org text; v_j json; v_ok boolean;
  v_m2 public.matches; v_avisos integer; v_ja uuid[]; v_jb uuid[];
  v_msg text; v_hubo boolean; i integer; v_u1 uuid; v_u2 uuid;
begin

-- ══ C01: proponente Sí / aprobador No ═════════════════════════════
begin
  v_fecha := now() + interval '10 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, false);
  execute 'reset role';
  select count(*) into v_c from public.attendees where id_partido = v_match.id;
  if v_c <> 1 then raise exception 'esperaba 1 inscrito y hay %', v_c; end if;
  select origen into v_org from public.attendees where id_partido=v_match.id and id_jugador=(esc->>'a1')::uuid;
  if v_org <> 'reserva_proponente' then raise exception 'origen del proponente = %', coalesce(v_org,'ninguno'); end if;
  if v_match.cupos_disponibles <> 7 then raise exception 'cupos_disponibles = % (esperaba 7 de 8)', v_match.cupos_disponibles; end if;
  if public.cupos_ocupados_club(v_match.id,(esc->>'clubA')::uuid) <> 1
     or public.cupos_ocupados_club(v_match.id,(esc->>'clubB')::uuid) <> 0 then
    raise exception 'conteo por club incorrecto';
  end if;
  insert into t45c values ('C01','OK','solo el proponente queda inscrito, con origen reserva_proponente y un cupo del club A');
exception when others then insert into t45c values ('C01','FALLÓ',sqlerrm);
end;

-- ══ C02: proponente No / aprobador Sí ═════════════════════════════
begin
  v_fecha := now() + interval '11 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', false);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, true);
  execute 'reset role';
  select count(*) into v_c from public.attendees where id_partido = v_match.id;
  if v_c <> 1 then raise exception 'esperaba 1 inscrito y hay %', v_c; end if;
  select origen into v_org from public.attendees where id_partido=v_match.id and id_jugador=(esc->>'b1')::uuid;
  if v_org <> 'reserva_aprobador' then raise exception 'origen del aprobador = %', coalesce(v_org,'ninguno'); end if;
  if public.cupos_ocupados_club(v_match.id,(esc->>'clubB')::uuid) <> 1
     or public.cupos_ocupados_club(v_match.id,(esc->>'clubA')::uuid) <> 0 then
    raise exception 'conteo por club incorrecto';
  end if;
  insert into t45c values ('C02','OK','solo el aprobador queda inscrito, con origen reserva_aprobador y un cupo del club B');
exception when others then insert into t45c values ('C02','FALLÓ',sqlerrm);
end;

-- ══ C03: ambos Sí ═════════════════════════════════════════════════
begin
  v_fecha := now() + interval '12 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, true);
  execute 'reset role';
  select count(*) into v_c from public.attendees where id_partido = v_match.id;
  if v_c <> 2 then raise exception 'esperaba 2 inscritos y hay %', v_c; end if;
  if public.cupos_ocupados_club(v_match.id,(esc->>'clubA')::uuid) <> 1
     or public.cupos_ocupados_club(v_match.id,(esc->>'clubB')::uuid) <> 1 then
    raise exception 'los dos cupos no salieron uno de cada club';
  end if;
  if v_match.cupos_disponibles <> 6 then raise exception 'cupos_disponibles = % (esperaba 6 de 8)', v_match.cupos_disponibles; end if;
  insert into t45c values ('C03','OK','dos inscritos, un cupo de cada club; cupos_disponibles 8 → 6');
exception when others then insert into t45c values ('C03','FALLÓ',sqlerrm);
end;

-- ══ C04: ambos No ═════════════════════════════════════════════════
begin
  v_fecha := now() + interval '13 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', false);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, false);
  execute 'reset role';
  select count(*) into v_c from public.attendees where id_partido = v_match.id;
  if v_c <> 0 then raise exception 'esperaba 0 inscritos y hay %', v_c; end if;
  if v_match.cupos_disponibles <> 8 then raise exception 'cupos_disponibles = %', v_match.cupos_disponibles; end if;
  select count(*) into v_avisos from public.notifications
   where type='club_match_reserva_omitida' and data->>'matchId' = v_match.id::text;
  if v_avisos <> 0 then raise exception 'salieron % avisos de reserva omitida sin que nadie pidiera cupo', v_avisos; end if;
  insert into t45c values ('C04','OK','nadie se inscribe, el partido nace con los 8 cupos y sin avisos de reserva omitida');
exception when others then insert into t45c values ('C04','FALLÓ',sqlerrm);
end;

-- ══ C05: la opción predeterminada es No ═══════════════════════════
begin
  v_fecha := now() + interval '14 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  -- Sin la clave `proponente_juega` en el payload.
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', null);
  if (select proponente_juega from public.club_challenge_proposals where id=v_prop) then
    raise exception 'proponente_juega quedó en true sin que nadie lo pidiera';
  end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  -- Un solo argumento: si la versión vieja de un parámetro siguiera
  -- existiendo, esta llamada resolvería a ella.
  select * into v_match from public.aprobar_propuesta(v_prop);
  execute 'reset role';
  select count(*) into v_c from public.attendees where id_partido = v_match.id;
  if v_c <> 0 then raise exception 'esperaba 0 inscritos y hay %', v_c; end if;
  select count(*) into v_d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='aprobar_propuesta';
  if v_d <> 1 then raise exception 'hay % versiones de aprobar_propuesta; la de un argumento debía borrarse', v_d; end if;
  insert into t45c values ('C05','OK','sin la clave en el payload y con un solo argumento, nadie se inscribe; queda una sola versión de aprobar_propuesta');
exception when others then insert into t45c values ('C05','FALLÓ',sqlerrm);
end;

-- ══ C06: la propuesta pendiente no consume cupos ══════════════════
begin
  v_fecha := now() + interval '15 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  if exists (select 1 from public.matches where challenge_proposal_id = v_prop) then
    raise exception 'la propuesta pendiente ya creó el partido';
  end if;
  select count(*) into v_c from public.attendees a
    join public.matches m on m.id=a.id_partido where m.challenge_id=(esc->>'challenge')::uuid;
  if v_c <> 0 then raise exception 'la propuesta pendiente ya reservó % cupos', v_c; end if;
  if (select estado from public.club_challenges where id=(esc->>'challenge')::uuid) <> 'esperando_aprobacion' then
    raise exception 'el desafío no quedó esperando aprobación';
  end if;
  insert into t45c values ('C06','OK','con proponente_juega=true y la propuesta pendiente: ni partido ni asistentes; el cupo se materializa al publicar');
exception when others then insert into t45c values ('C06','FALLÓ',sqlerrm);
end;

-- ══ C07: origen auditable ═════════════════════════════════════════
begin
  v_fecha := now() + interval '16 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, true);
  execute 'reset role';
  select payload into v_ev from public.club_challenge_events
   where challenge_id=(esc->>'challenge')::uuid and tipo='partido_publicado';
  if v_ev is null then raise exception 'no quedó evento partido_publicado'; end if;
  if not (v_ev->>'proponente_juega')::boolean or not (v_ev->>'proponente_inscrito')::boolean
     or not (v_ev->>'aprobador_juega')::boolean or not (v_ev->>'aprobador_inscrito')::boolean then
    raise exception 'el evento no registró las dos reservas: %', v_ev::text;
  end if;
  if v_ev->>'proponente_motivo' is not null or v_ev->>'aprobador_motivo' is not null then
    raise exception 'hay motivo de omisión cuando las dos reservas se aplicaron';
  end if;
  select string_agg(origen||'='||id_jugador::text, ' ' order by origen) into v_org
    from public.attendees where id_partido=v_match.id;
  if v_org not like '%reserva_aprobador%' or v_org not like '%reserva_proponente%' then
    raise exception 'los origen no quedaron auditables: %', v_org;
  end if;
  insert into t45c values ('C07','OK','attendees.origen distingue reserva_proponente de reserva_aprobador, y el evento partido_publicado registra quién pidió cupo y si lo obtuvo');
exception when others then insert into t45c values ('C07','FALLÓ',sqlerrm);
end;

-- ══ C08: conflicto del proponente ═════════════════════════════════
begin
  v_fecha := now() + interval '17 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  perform pg_temp.partido_que_choca((esc->>'a1')::uuid, v_fecha);
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, false);
  execute 'reset role';
  if v_match.id is null then raise exception 'el partido no se publicó'; end if;
  if exists (select 1 from public.attendees where id_partido=v_match.id and id_jugador=(esc->>'a1')::uuid) then
    raise exception 'el proponente quedó inscrito pese al choque de horario';
  end if;
  if v_match.cupos_disponibles <> 8 then raise exception 'se descontó un cupo que no se usó: %', v_match.cupos_disponibles; end if;
  select payload into v_ev from public.club_challenge_events
   where challenge_id=(esc->>'challenge')::uuid and tipo='partido_publicado';
  if (v_ev->>'proponente_inscrito')::boolean or v_ev->>'proponente_motivo' is null then
    raise exception 'el evento no registró la omisión: %', v_ev::text;
  end if;
  select count(*) into v_avisos from public.notifications
   where type='club_match_reserva_omitida' and user_id=(esc->>'a1')::uuid and data->>'matchId'=v_match.id::text;
  if v_avisos <> 1 then raise exception 'avisos de reserva omitida al proponente: %', v_avisos; end if;
  select count(*) into v_c from public.notifications
   where type='club_match_reserva_omitida' and data->>'matchId'=v_match.id::text;
  if v_c <> 1 then raise exception 'el aviso llegó a % personas; debía llegar solo al proponente', v_c; end if;
  insert into t45c values ('C08','OK',
    format('el partido se publica igual, la reserva se omite (%s) y el aviso llega solo al proponente', v_ev->>'proponente_motivo'));
exception when others then insert into t45c values ('C08','FALLÓ',sqlerrm);
end;

-- ══ C09: conflicto del aprobador ══════════════════════════════════
begin
  v_fecha := now() + interval '18 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  perform pg_temp.partido_que_choca((esc->>'b1')::uuid, v_fecha);
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', false);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, true);
  execute 'reset role';
  if v_match.id is null then raise exception 'el partido no se publicó'; end if;
  if exists (select 1 from public.attendees where id_partido=v_match.id and id_jugador=(esc->>'b1')::uuid) then
    raise exception 'el aprobador quedó inscrito pese al choque de horario (cupos_disponibles=%)', v_match.cupos_disponibles;
  end if;
  if v_match.cupos_disponibles <> 8 then raise exception 'se descontó un cupo que no se usó: %', v_match.cupos_disponibles; end if;
  select payload into v_ev from public.club_challenge_events
   where challenge_id=(esc->>'challenge')::uuid and tipo='partido_publicado';
  if (v_ev->>'aprobador_inscrito')::boolean or v_ev->>'aprobador_motivo' is null then
    raise exception 'el evento no registró la omisión del aprobador: %', v_ev::text;
  end if;
  select count(*) into v_avisos from public.notifications
   where type='club_match_reserva_omitida' and user_id=(esc->>'b1')::uuid and data->>'matchId'=v_match.id::text;
  if v_avisos <> 1 then raise exception 'avisos de reserva omitida al aprobador: %', v_avisos; end if;
  insert into t45c values ('C09','OK',
    format('el aprobador recibe el mismo trato que el proponente: reserva omitida (%s), partido publicado', v_ev->>'aprobador_motivo'));
exception when others then insert into t45c values ('C09','FALLÓ',sqlerrm);
end;

-- ══ C10: conflicto de los dos ═════════════════════════════════════
begin
  v_fecha := now() + interval '19 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  perform pg_temp.partido_que_choca((esc->>'a1')::uuid, v_fecha);
  perform pg_temp.partido_que_choca((esc->>'b1')::uuid, v_fecha);
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, true);
  execute 'reset role';
  select count(*) into v_c from public.attendees where id_partido=v_match.id;
  if v_c <> 0 then raise exception 'esperaba 0 inscritos y hay %', v_c; end if;
  if v_match.cupos_disponibles <> 8 then raise exception 'cupos_disponibles = %', v_match.cupos_disponibles; end if;
  select count(*) into v_avisos from public.notifications
   where type='club_match_reserva_omitida' and data->>'matchId'=v_match.id::text;
  if v_avisos <> 2 then raise exception 'esperaba 2 avisos de reserva omitida y hay %', v_avisos; end if;
  insert into t45c values ('C10','OK','los dos se omiten, el partido se publica entero y sale un aviso para cada uno');
exception when others then insert into t45c values ('C10','FALLÓ',sqlerrm);
end;

-- ══ C11: el proponente dejó el club ═══════════════════════════════
begin
  v_fecha := now() + interval '20 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  -- Se va del club DESPUÉS de proponer. Queda el otro administrador,
  -- así que el club no se borra solo.
  delete from public.club_members
   where club_id=(esc->>'clubA')::uuid and user_id=(esc->>'a1')::uuid;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, false);
  execute 'reset role';
  if exists (select 1 from public.attendees where id_partido=v_match.id and id_jugador=(esc->>'a1')::uuid) then
    raise exception 'se le dio cupo a quien ya no pertenece al club';
  end if;
  select payload into v_ev from public.club_challenge_events
   where challenge_id=(esc->>'challenge')::uuid and tipo='partido_publicado';
  if v_ev->>'proponente_motivo' <> 'ya no pertenece al club que propuso' then
    raise exception 'motivo registrado: %', coalesce(v_ev->>'proponente_motivo','ninguno');
  end if;
  insert into t45c values ('C11','OK','quien dejó el club entre proponer y aprobar no recibe cupo, y el motivo queda escrito');
exception when others then insert into t45c values ('C11','FALLÓ',sqlerrm);
end;

-- ══ C12: doble aprobación idempotente ═════════════════════════════
begin
  v_fecha := now() + interval '21 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, true);
  select * into v_m2 from public.aprobar_propuesta(v_prop, true);
  execute 'reset role';
  if v_match.id <> v_m2.id then raise exception 'la segunda aprobación creó otro partido'; end if;
  select count(*) into v_c from public.matches where challenge_proposal_id = v_prop;
  if v_c <> 1 then raise exception 'hay % partidos para la misma propuesta', v_c; end if;
  select count(*) into v_c from public.attendees where id_partido=v_match.id;
  if v_c <> 2 then raise exception 'la segunda aprobación dejó % inscritos', v_c; end if;
  if v_m2.cupos_disponibles <> 6 then raise exception 'cupos descontados dos veces: %', v_m2.cupos_disponibles; end if;
  select count(*) into v_c from public.club_challenge_events
   where challenge_id=(esc->>'challenge')::uuid and tipo='partido_publicado';
  if v_c <> 1 then raise exception 'se registraron % eventos de publicación', v_c; end if;
  insert into t45c values ('C12','OK','volver a aprobar devuelve el mismo partido, sin duplicar inscripciones, cupos ni eventos');
exception when others then insert into t45c values ('C12','FALLÓ',sqlerrm);
end;

-- ══ C13: un fallo inesperado aborta la publicación entera ═════════
begin
  v_fecha := now() + interval '22 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);

  -- Un fallo que NO es un impedimento personal. El nombre empieza por
  -- `zzz` para que dispare al final, con `origen` ya puesto.
  execute $ddl$
    create or replace function public.zzz_falla_de_prueba() returns trigger
    language plpgsql as $t$
    begin
      if new.origen = 'reserva_proponente' then
        raise exception 'ERROR_INESPERADO_DE_PRUEBA';
      end if;
      return new;
    end $t$;
  $ddl$;
  execute 'create trigger zzz_falla_de_prueba before insert on public.attendees
             for each row execute function public.zzz_falla_de_prueba()';

  v_hubo := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
    perform public.aprobar_propuesta(v_prop, false);
    execute 'reset role';
  exception when others then
    v_hubo := true; v_msg := sqlerrm;
  end;
  execute 'reset role';
  execute 'drop trigger zzz_falla_de_prueba on public.attendees';

  if not v_hubo then raise exception 'el fallo inesperado se tragó en silencio'; end if;
  if v_msg not like '%ERROR_INESPERADO_DE_PRUEBA%' then
    raise exception 'se relanzó otro error: %', v_msg;
  end if;
  if exists (select 1 from public.matches where challenge_proposal_id = v_prop) then
    raise exception 'quedó un partido publicado a medias';
  end if;
  if (select estado from public.club_challenges where id=(esc->>'challenge')::uuid) <> 'esperando_aprobacion' then
    raise exception 'el desafío cambió de estado pese al fallo';
  end if;
  if (select estado from public.club_challenge_proposals where id=v_prop) <> 'pendiente' then
    raise exception 'la propuesta quedó marcada aprobada sin partido';
  end if;
  insert into t45c values ('C13','OK','un error que no es impedimento personal se relanza y deshace todo: ni partido, ni desafío publicado, ni propuesta aprobada');
exception when others then
  begin execute 'drop trigger if exists zzz_falla_de_prueba on public.attendees'; exception when others then null; end;
  insert into t45c values ('C13','FALLÓ',sqlerrm);
end;

-- ══ C14: las reservas consumen cupos independientes ═══════════════
begin
  v_fecha := now() + interval '23 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', true);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, true);
  execute 'reset role';
  select array(select jsonb_array_elements_text(esc->'ja'))::uuid[] into v_ja;
  select array(select jsonb_array_elements_text(esc->'jb'))::uuid[] into v_jb;
  -- Con 1 reservado, entran los 3 jugadores de cada club y ni uno más.
  for i in 1..3 loop
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ja[i],'role','authenticated')::text);
    v_j := public.join_club_match(v_match.id);
    execute 'reset role';
    if not (v_j->>'ok')::boolean then raise exception 'jugador A%: %', i, v_j->>'reason'; end if;
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_jb[i],'role','authenticated')::text);
    v_j := public.join_club_match(v_match.id);
    execute 'reset role';
    if not (v_j->>'ok')::boolean then raise exception 'jugador B%: %', i, v_j->>'reason'; end if;
  end loop;
  if public.cupos_ocupados_club(v_match.id,(esc->>'clubA')::uuid) <> 4
     or public.cupos_ocupados_club(v_match.id,(esc->>'clubB')::uuid) <> 4 then
    raise exception 'los clubes no llegaron a 4 y 4';
  end if;
  -- El segundo administrador de cada club ya no cabe.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'a2','role','authenticated')::text);
  v_j := public.join_club_match(v_match.id);
  execute 'reset role';
  if (v_j->>'ok')::boolean then raise exception 'entró un noveno jugador al club A'; end if;
  insert into t45c values ('C14','OK','la reserva ocupa 1 de los 4 de SU club; cada club llega a 4/4 por separado y el quinto se rechaza');
exception when others then insert into t45c values ('C14','FALLÓ',sqlerrm);
end;

-- ══ C15: salir libera el cupo reservado ═══════════════════════════
begin
  v_fecha := now() + interval '24 days';
  esc := pg_temp.escenario(4,'orden_llegada');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'orden_llegada', false);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, true);
  v_j := public.leave_club_match(v_match.id);
  execute 'reset role';
  if not (v_j->>'liberoCupo')::boolean then raise exception 'salir no liberó el cupo'; end if;
  if public.cupos_ocupados_club(v_match.id,(esc->>'clubB')::uuid) <> 0 then
    raise exception 'el club B sigue ocupando un cupo';
  end if;
  select cupos_disponibles into v_c from public.matches where id=v_match.id;
  if v_c <> 8 then raise exception 'cupos_disponibles quedó en %', v_c; end if;
  insert into t45c values ('C15','OK','el aprobador reservado se da de baja y el cupo vuelve a su club (8 de 8)');
exception when others then insert into t45c values ('C15','FALLÓ',sqlerrm);
end;

-- ══ C16: publicado, nadie se autoaprueba ══════════════════════════
begin
  v_fecha := now() + interval '25 days';
  esc := pg_temp.escenario(4,'seleccion_admin');
  v_prop := pg_temp.proponer(esc, v_fecha, 4, 'seleccion_admin', false);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b1','role','authenticated')::text);
  select * into v_match from public.aprobar_propuesta(v_prop, false);
  -- El administrador se postula como cualquiera: queda pendiente.
  v_j := public.join_club_match(v_match.id);
  if v_j->>'estado' <> 'pendiente' then
    raise exception 'el administrador entró directo con estado %', v_j->>'estado';
  end if;
  -- Y no puede confirmarse solo.
  v_j := public.confirmar_nomina_club(v_match.id, (esc->>'b1')::uuid, true);
  execute 'reset role';
  if (v_j->>'ok')::boolean then raise exception 'el administrador se autoconfirmó'; end if;
  -- El otro administrador de su club sí puede.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',esc->>'b2','role','authenticated')::text);
  v_j := public.confirmar_nomina_club(v_match.id, (esc->>'b1')::uuid, true);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'el otro administrador no pudo confirmar: %', v_j->>'reason'; end if;
  select origen into v_org from public.attendees where id_partido=v_match.id and id_jugador=(esc->>'b1')::uuid;
  if v_org <> 'postulacion_aprobada' then raise exception 'origen tras confirmar = %', v_org; end if;
  insert into t45c values ('C16','OK','publicado el partido la excepción se cierra: el administrador postula, no se confirma solo, y lo confirma el otro administrador de su club');
exception when others then insert into t45c values ('C16','FALLÓ',sqlerrm);
end;

-- ══ C17 y C18: regresión de la sección 8c ═════════════════════════
-- La 45 le quita a `tg_enforce_join_rules` la exención del organizador
-- SÓLO en los partidos de clubes, porque allí `id_organizador` es el
-- administrador que aprueba y no un organizador de verdad. En los
-- partidos normales no cambia nada, y eso es lo que fijan estos dos.
begin
  v_fecha := now() + interval '30 days';
  v_u1 := gen_random_uuid();
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  values ('00000000-0000-0000-0000-000000000000',v_u1,'authenticated','authenticated',
    'u3e-'||v_u1||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','','');
  update public.profiles set trust_score = 100 where id = v_u1;
  -- Dos partidos normales suyos, a la misma hora. El organizador entra
  -- en los dos porque sigue exento.
  perform pg_temp.partido_que_choca(v_u1, v_fecha);
  perform pg_temp.partido_que_choca(v_u1, v_fecha);
  select count(*) into v_c from public.attendees a join public.matches m on m.id = a.id_partido
   where a.id_jugador = v_u1 and m.hora = v_fecha;
  if v_c <> 2 then raise exception 'el organizador quedó en % de sus 2 partidos solapados', v_c; end if;
  insert into t45c values ('C17','OK','regresión: en un partido NORMAL el organizador sigue exento del choque de horario');
exception when others then insert into t45c values ('C17','FALLÓ',sqlerrm);
end;

begin
  v_fecha := now() + interval '31 days';
  v_u1 := gen_random_uuid(); v_u2 := gen_random_uuid();
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u3f-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
    from unnest(array[v_u1,v_u2]) u;
  update public.profiles set trust_score = 100 where id in (v_u1,v_u2);
  perform pg_temp.partido_que_choca(v_u1, v_fecha);
  perform pg_temp.partido_que_choca(v_u2, v_fecha);
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_u1,'role','authenticated')::text);
  v_ok := false;
  begin
    perform public.join_match((select id from public.matches where id_organizador=v_u2 and hora=v_fecha));
  exception when others then
    if sqlerrm like 'CHOQUE_HORARIO%' then v_ok := true; else raise; end if;
  end;
  execute 'reset role';
  if not v_ok then raise exception 'un jugador que no organiza se coló en dos partidos solapados'; end if;
  insert into t45c values ('C18','OK','regresión: en un partido NORMAL quien no organiza sigue chocando de horario');
exception when others then insert into t45c values ('C18','FALLÓ',sqlerrm);
end;

end;
$$;

-- La grilla del Dashboard virtualiza filas y puede ocultar los últimos
-- resultados. Convierte cualquier caso FALLÓ en fallo de la consulta para
-- que una ejecución verde sea concluyente aun sin desplazarse por la tabla.
do $$
declare v_fallos text;
begin
  select string_agg(n || ': ' || detalle, ' | ' order by n)
    into v_fallos
    from t45c
   where resultado <> 'OK';
  if v_fallos is not null then
    raise exception 'BATERÍA 45c CON FALLOS — %', v_fallos;
  end if;
end;
$$;

select n, resultado, detalle from t45c order by n;

rollback;
