-- =============================================================
-- FutFinder — pruebas de la ubicación protegida y la aproximada
-- (migración 44b)
--
-- LA IDEA QUE SE ESTÁ PROTEGIENDO: un partido de clubes tiene que
-- poder ENCONTRARSE sin que se sepa DÓNDE ES exactamente. Por eso hay
-- dos ubicaciones y no una:
--
--   · la aproximada, pública, en `matches` (rejilla de 0,01° ≈ 1 km),
--     marcada con `ubicacion_aproximada`;
--   · la exacta, en `club_match_locations`, con RLS para los
--     integrantes de los dos clubes.
--
-- Qué cubre:
--   1. El partido SE DESCUBRE: conserva coordenadas públicas, marcadas,
--      y sin calle.
--   2. La pública NO es la exacta y cae en la rejilla.
--   3. Aparece en la consulta por cuadrante (mapa) y conserva comuna y
--      región para el filtro por zona.
--   4. Integrante del club local: lee la ubicación exacta.
--   5. Integrante del club rival y jugador sin rol: también.
--   6. Externo autenticado: sólo la aproximada, sin calle.
--   7. Anónimo: igual que el externo.
--   8. Ni la exacta ni la aproximada entran en `canchas` ni en
--      `search_canchas()`.
--   9. El GPS usa EXCLUSIVAMENTE la exacta: estar parado en la
--      coordenada pública no confirma asistencia.
--  10. Y falla cerrada si no hay ubicación protegida.
--  11. Nadie puede escribir en `club_match_locations`.
--  12. El partido normal no cambia en nada.
--  13. Los partidos de clubes que ya existían quedan migrados.
--  14. «Próximo partido de tu club» no depende de la ubicación.
--
-- Requisito: migraciones 42, 43, 43b, 43c, 43d, 44 y 44b aplicadas.
--
-- OJO CON `anon`: `set local role anon` NO borra
-- `request.jwt.claims`. Sin unas claims sin `sub`, `auth.uid()` seguiría
-- devolviendo el usuario del bloque anterior.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t44b (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_l1 uuid := gen_random_uuid();   -- admin del club LOCAL (propone)
  v_lj uuid := gen_random_uuid();   -- jugador del club LOCAL, sin rol
  v_r1 uuid := gen_random_uuid();   -- admin del club RIVAL (aprueba)
  v_x  uuid := gen_random_uuid();   -- ajeno a los dos clubes
  v_club_l uuid; v_club_r uuid; v_ch uuid;
  v_prop public.club_challenge_proposals;
  v_match public.matches;
  v_normal uuid;
  v_count int; v_dir text; v_lat numeric; v_lng numeric; v_apx boolean;
  v_ok boolean; v_json json; v_payload jsonb;
  v_cancha text := 'Cancha Protegida 44b';
  LAT_EXACTA constant numeric := -33.4569;
  LNG_EXACTA constant numeric := -70.6019;
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',
    'prot-'||u.tag||'-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from (values (v_l1,'l1'),(v_lj,'lj'),(v_r1,'r1'),(v_x,'x')) as u(id,tag);

  insert into public.clubs (nombre,slug,created_by,plan)
  values ('Club Protegido L','club-protegido-l',v_l1,'premium') returning id into v_club_l;
  insert into public.clubs (nombre,slug,created_by,plan)
  values ('Club Protegido R','club-protegido-r',v_r1,'premium') returning id into v_club_r;
  insert into public.club_members (club_id,user_id,rol) values
    (v_club_l,v_l1,'admin'),(v_club_l,v_lj,'jugador'),(v_club_r,v_r1,'admin');

  insert into public.club_challenges (club_retador_id,club_retado_id,creado_por,estado)
  values (v_club_l,v_club_r,v_l1,'pendiente') returning id into v_ch;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_r1,'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';

  v_payload := jsonb_build_object('fecha',(now()+interval '7 days')::text,'duracion_min',90,
    'direccion','Calle Secreta 1234, Ñuñoa','cancha_nombre',v_cancha,'comuna','Ñuñoa',
    'region','Región Metropolitana de Santiago','latitud',LAT_EXACTA,'longitud',LNG_EXACTA,
    'modalidad','futbol7','cupos_por_club',9,'metodo_inscripcion','orden_llegada','cuota_por_persona',3000);

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_l1,'role','authenticated')::text);
  v_prop := public.crear_propuesta_oficial(v_ch, v_payload, gen_random_uuid());
  execute 'reset role';
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_r1,'role','authenticated')::text);
  v_match := public.aprobar_propuesta(v_prop.id);
  execute 'reset role';

  -- ══ 1: el partido se puede descubrir ═════════════════════════
  if v_match.latitud is null or v_match.longitud is null then
    raise exception 'FALLÓ (1): sin coordenadas públicas no aparece en listas ni mapa'; end if;
  if not v_match.ubicacion_aproximada then raise exception 'FALLÓ (1): sin marca de aproximada'; end if;
  if v_match.direccion is not null then raise exception 'FALLÓ (1): la calle quedó en matches'; end if;
  insert into t44b values (1,'descubrimiento',
    format('aparece con coordenadas públicas (%s, %s), marcado aproximado y sin calle',
           v_match.latitud, v_match.longitud));

  -- ══ 2: la pública NO es la exacta ════════════════════════════
  if v_match.latitud = LAT_EXACTA or v_match.longitud = LNG_EXACTA then
    raise exception 'FALLÓ (2): la coordenada pública es la exacta'; end if;
  if v_match.latitud <> round(LAT_EXACTA,2) or v_match.longitud <> round(LNG_EXACTA,2) then
    raise exception 'FALLÓ (2): no está en la rejilla (%, %)', v_match.latitud, v_match.longitud; end if;
  insert into t44b values (2,'aproximación',
    format('exacta (%s, %s) → pública (%s, %s); desplazamiento ~%s m',
           LAT_EXACTA, LNG_EXACTA, v_match.latitud, v_match.longitud,
           round(public.haversine_meters(LAT_EXACTA,LNG_EXACTA,v_match.latitud,v_match.longitud))));

  -- ══ 3: mapa y filtro por zona ════════════════════════════════
  -- Es la misma forma de la consulta de `listMatchesInBounds`.
  select count(*) into v_count from public.matches
   where id = v_match.id
     and latitud between -33.60 and -33.30 and longitud between -70.80 and -70.50
     and latitud is not null and longitud is not null;
  if v_count <> 1 then raise exception 'FALLÓ (3): no aparece en el cuadrante del mapa'; end if;
  insert into t44b values (3,'mapa y filtro por zona',
    'aparece en la consulta por cuadrante y conserva comuna y región para filtrar');

  -- ══ 4 y 5: los integrantes leen la exacta ════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_l1,'role','authenticated')::text);
  select direccion, latitud, longitud into v_dir, v_lat, v_lng
    from public.club_match_locations where match_id = v_match.id;
  execute 'reset role';
  if v_dir <> 'Calle Secreta 1234, Ñuñoa' or round(v_lat,4) <> LAT_EXACTA then
    raise exception 'FALLÓ (4): el integrante no leyó la exacta'; end if;
  insert into t44b values (4,'integrante (club local)',
    format('lee la exacta: %s (%s, %s)', v_dir, round(v_lat,4), round(v_lng,4)));

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_r1,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_locations where match_id = v_match.id;
  execute 'reset role';
  if v_count <> 1 then raise exception 'FALLÓ (5): el club rival no leyó la exacta'; end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_lj,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_locations where match_id = v_match.id;
  execute 'reset role';
  if v_count <> 1 then raise exception 'FALLÓ (5): el jugador sin rol no leyó la exacta'; end if;
  insert into t44b values (5,'integrante (club rival y jugador sin rol)','los dos leen la exacta');

  -- ══ 6: externo autenticado ═══════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_x,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_locations where match_id = v_match.id;
  select latitud, longitud, direccion, ubicacion_aproximada into v_lat, v_lng, v_dir, v_apx
    from public.matches where id = v_match.id;
  execute 'reset role';
  if v_count <> 0 then raise exception 'FALLÓ (6): un externo leyó la exacta'; end if;
  if v_lat is null then raise exception 'FALLÓ (6): un externo no puede descubrir el partido'; end if;
  if v_dir is not null then raise exception 'FALLÓ (6): un externo obtuvo la calle'; end if;
  if not v_apx then raise exception 'FALLÓ (6): sin marca de aproximada'; end if;
  insert into t44b values (6,'externo autenticado',
    format('ve la aproximada (%s, %s) marcada, sin calle y sin la exacta', v_lat, v_lng));

  -- ══ 7: anónimo ═══════════════════════════════════════════════
  execute format('set local request.jwt.claims to %L', json_build_object('role','anon')::text);
  execute 'set local role anon';
  select count(*) into v_count from public.club_match_locations where match_id = v_match.id;
  select latitud, direccion into v_lat, v_dir from public.matches where id = v_match.id;
  execute 'reset role';
  if v_count <> 0 then raise exception 'FALLÓ (7): anon leyó la exacta'; end if;
  if v_lat is null then raise exception 'FALLÓ (7): anon no puede descubrir el partido'; end if;
  if v_dir is not null then raise exception 'FALLÓ (7): anon obtuvo la calle'; end if;
  insert into t44b values (7,'anónimo',
    'descubre el partido con la aproximada y no obtiene ni calle ni exacta');

  -- ══ 8: canchas y search_canchas ══════════════════════════════
  select count(*) into v_count from public.canchas where nombre = v_cancha;
  if v_count <> 0 then raise exception 'FALLÓ (8): la cancha entró en canchas'; end if;
  execute format('set local request.jwt.claims to %L', json_build_object('role','anon')::text);
  execute 'set local role anon';
  select count(*) into v_count from public.search_canchas('Protegida',10);
  execute 'reset role';
  if v_count <> 0 then raise exception 'FALLÓ (8): search_canchas la devolvió'; end if;
  insert into t44b values (8,'sin fugas por canchas',
    'ni la exacta ni la aproximada entran en canchas ni en search_canchas');

  -- ══ 9: el GPS usa EXCLUSIVAMENTE la exacta ═══════════════════
  -- Parado justo en la coordenada pública, que está a ~400 m de la
  -- cancha real: si el GPS mirara la aproximada, esto confirmaría.
  insert into public.attendees (id_partido,id_jugador,estado) values (v_match.id,v_lj,'inscrito');
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_lj,'role','authenticated')::text);
  v_json := public.confirm_attendance_gps(v_match.id, v_match.latitud, v_match.longitud);
  execute 'reset role';
  if (v_json->>'ok')::boolean then raise exception 'FALLÓ (9): confirmó GPS desde la aproximada'; end if;
  insert into t44b values (9,'GPS sólo con la exacta',
    format('estar en la coordenada pública no confirma: %s m de la cancha real',
           round((v_json->>'distance')::numeric)));

  -- ══ 10: y falla cerrada sin ubicación protegida ══════════════
  delete from public.club_match_locations where match_id = v_match.id;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_lj,'role','authenticated')::text);
  v_json := public.confirm_attendance_gps(v_match.id, LAT_EXACTA, LNG_EXACTA);
  execute 'reset role';
  if (v_json->>'ok')::boolean then raise exception 'FALLÓ (10): confirmó sin ubicación protegida'; end if;
  insert into t44b values (10,'GPS falla cerrada',
    format('sin la protegida no confirma ni estando encima: %s', v_json->>'reason'));

  -- ══ 11: nadie escribe en la tabla protegida ══════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_l1,'role','authenticated')::text);
    insert into public.club_match_locations (match_id,direccion,latitud,longitud)
    values (v_match.id,'inventada',1,1);
    execute 'reset role';
  exception when others then execute 'reset role'; v_ok := true; end;
  if not v_ok then raise exception 'FALLÓ (11): un integrante escribió en la tabla protegida'; end if;
  insert into t44b values (11,'escritura','ni un integrante puede insertar en club_match_locations');

  -- ══ 12: el partido normal no cambia ══════════════════════════
  insert into public.matches (id_organizador,titulo,comuna,region,cancha_nombre,direccion,
    latitud,longitud,hora,cupos_totales,cupos_disponibles)
  values (v_x,'Pichanga normal 44b','Providencia','Región Metropolitana de Santiago',
    'Cancha Normal 44b','Av. Providencia 999',-33.4200000,-70.6100000,
    now()+interval '2 days',10,10) returning id into v_normal;
  execute format('set local request.jwt.claims to %L', json_build_object('role','anon')::text);
  execute 'set local role anon';
  select direccion, latitud, ubicacion_aproximada into v_dir, v_lat, v_apx
    from public.matches where id = v_normal;
  execute 'reset role';
  if v_dir <> 'Av. Providencia 999' or v_lat <> -33.42 or v_apx then
    raise exception 'FALLÓ (12): el partido normal cambió'; end if;
  select count(*) into v_count from public.canchas where nombre = 'Cancha Normal 44b';
  if v_count <> 1 then raise exception 'FALLÓ (12): el partido normal dejó de registrar su cancha'; end if;
  insert into t44b values (12,'partido normal',
    format('intacto: anon lee «%s», coordenadas exactas, ubicacion_aproximada=false y su cancha se registra', v_dir));

  -- ══ 13: datos existentes migrados ════════════════════════════
  select count(*) into v_count from public.matches
   where challenge_proposal_id is not null and (direccion is not null or not ubicacion_aproximada);
  if v_count <> 0 then raise exception 'FALLÓ (13): % partidos de clubes sin migrar', v_count; end if;
  select count(*) into v_count from public.matches where challenge_proposal_id is not null;
  insert into t44b values (13,'datos existentes',
    format('los %s partidos de clubes quedan con calle nula y coordenadas aproximadas marcadas', v_count));

  -- ══ 14: Inicio no depende de la ubicación ════════════════════
  select count(*) into v_count from public.matches
   where challenge_proposal_id is not null and hora > now() and estado <> 'cancelado';
  insert into t44b values (14,'Inicio',
    format('«Próximo partido de tu club» se elige por club y hora, no por ubicación: %s candidato(s)', v_count));
end;
$$;

select n, caso, detalle from t44b order by n;

rollback;
