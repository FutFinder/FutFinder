-- =============================================================
-- FutFinder — pruebas de compatibilidad de `attendees.origen`
-- (migración 45, sección 1 y 1b)
--
-- PARTE B · el arreglo de compatibilidad.  La 45 pone `origen` NOT NULL
-- con CHECK, y ninguna de las cinco vías heredadas lo escribe. Sin el
-- trigger `attendees_completa_origen`, crear un partido normal falla.
-- Esto comprueba que el trigger tapa el hueco SIN cambiarle el
-- comportamiento a nadie.
--
-- Qué cubre:
--   B1. Las filas anteriores a la migración quedan `legado`, todas, y no
--       se les inventa procedencia.
--   B2. ORDEN DE DISPARO REAL: `aa_attendees_completa_origen` es el
--       primero de los BEFORE INSERT de `attendees`, medido contra el
--       catálogo y no supuesto. PostgreSQL los dispara por nombre.
--   B3. `add_organizer_as_attendee` → `organizador`.
--   B4. `join_match` → `orden_llegada`.
--   B5. `request_join` → `postulacion`.
--   B6. `swap_match` a un partido de aprobación inmediata →
--       `orden_llegada`, y la fila del partido viejo desaparece.
--   B7. `swap_match` a un partido de aprobación manual → `postulacion`.
--       Las dos ramas, porque el trigger decide por `estado`.
--   B8. `cancel_match_and_join` → `orden_llegada`.
--   B9. El `origen` explícito NUNCA se pisa: es lo que ponen las RPC de
--       clubes (`reserva_proponente`, `reserva_aprobador`).
--  B10. El CHECK rechaza texto arbitrario.
--  B11. No queda ninguna fila sin `origen`.
--  B12. `authenticated` no escribe `origen` por su cuenta: desde la 44e
--       `attendees` no tiene políticas de escritura ni privilegio.
--  B13. El partido normal sigue funcionando de punta a punta:
--       `request_join` → `approve_join` → `leave_match`, con los cupos
--       cuadrando y sin que `origen` estorbe.
--
-- Requisito: migraciones 44 a 44e y 45 aplicadas.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t45b (n text, caso text, detalle text) on commit drop;

-- ── B1. Las filas previas quedan `legado` ───────────────────────
-- Se mide contra las filas que YA existían, sin depender de un número
-- escrito a mano.
do $$
declare v_total int; v_legado int; v_otros text;
begin
  select count(*), count(*) filter (where origen = 'legado')
    into v_total, v_legado
    from public.attendees;
  if v_total <> v_legado then
    select string_agg(distinct origen, ', ') into v_otros
      from public.attendees where origen is distinct from 'legado';
    raise exception 'FALLÓ B1: de % filas previas, % no son legado (%)',
      v_total, v_total - v_legado, coalesce(v_otros, 'null');
  end if;
  insert into t45b values ('B1','filas previas',
    format('las %s filas anteriores a la migración quedaron en legado, sin inventarles procedencia', v_total));
end;
$$;

-- ── B2. Orden de disparo real de los BEFORE INSERT ──────────────
-- No se supone: se lee del catálogo. Si algún día entra un trigger que
-- ordene antes, esta prueba lo caza.
do $$
declare v_primero text; v_lista text;
begin
  select tgname into v_primero
    from pg_trigger
   where tgrelid = 'public.attendees'::regclass
     and not tgisinternal
     and tgtype & 2 = 2 and tgtype & 4 = 4
   order by tgname
   limit 1;

  select string_agg(t.tgname || '(' || p.proname || ')', ' → ' order by t.tgname)
    into v_lista
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where t.tgrelid = 'public.attendees'::regclass
     and not t.tgisinternal
     and t.tgtype & 2 = 2 and t.tgtype & 4 = 4;

  if v_primero <> 'aa_attendees_completa_origen' then
    raise exception 'FALLÓ B2: el primer BEFORE INSERT es %, no aa_attendees_completa_origen. Orden: %',
      v_primero, v_lista;
  end if;
  insert into t45b values ('B2','orden de disparo', v_lista);
end;
$$;

-- ── B3 a B13 ────────────────────────────────────────────────────
do $$
declare
  v_org1 uuid := gen_random_uuid();  -- organizador de P1 (inmediata)
  v_org2 uuid := gen_random_uuid();  -- organizador de P2 (manual)
  v_org3 uuid := gen_random_uuid();  -- organizador de P3 (inmediata)
  v_org5 uuid := gen_random_uuid();  -- organizador de P5 (manual)
  v_j1   uuid := gen_random_uuid();  -- join_match  → swap a inmediata
  v_j2   uuid := gen_random_uuid();  -- request_join → approve_join
  v_j3   uuid := gen_random_uuid();  -- join_match  → swap a manual
  v_j4   uuid := gen_random_uuid();  -- organizador de P4 → cancel_and_join
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid; v_p5 uuid;
  v_j jsonb; v_js json; v_origen text; v_estado text; v_count int;
  v_cupos int; v_ok boolean;
begin
  -- Usuarios. `on_auth_user_created` les crea el perfil.
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u3b-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
    from unnest(array[v_org1,v_org2,v_org3,v_org5,v_j1,v_j2,v_j3,v_j4]) u;

  -- Trust Score alto: aquí no se prueba esa regla y no debe estorbar.
  update public.profiles set trust_score = 100
   where id in (v_org1,v_org2,v_org3,v_org5,v_j1,v_j2,v_j3,v_j4);

  -- Partidos NORMALES (sin challenge_proposal_id), separados en el
  -- tiempo para que `tg_enforce_join_rules` no vea choque de horario.
  insert into public.matches (id_organizador,titulo,comuna,region,cancha_nombre,latitud,longitud,
      hora,duracion_min,cupos_totales,cupos_disponibles,precio_cuota,modalidad,aprobacion,
      min_trust_score,estado,ubicacion_aproximada)
  values
    (v_org1,'P1 inmediata','Ñuñoa','Metropolitana','Cancha 1',-33.45,-70.60,now()+interval '3 days',90,10,10,0,'futbol7','inmediata',0,'abierto',false),
    (v_org2,'P2 manual','Ñuñoa','Metropolitana','Cancha 2',-33.46,-70.61,now()+interval '4 days',90,10,10,0,'futbol7','manual',0,'abierto',false),
    (v_org3,'P3 inmediata','Ñuñoa','Metropolitana','Cancha 3',-33.47,-70.62,now()+interval '5 days',90,10,10,0,'futbol7','inmediata',0,'abierto',false),
    (v_j4  ,'P4 inmediata','Ñuñoa','Metropolitana','Cancha 4',-33.48,-70.63,now()+interval '6 days',90,10,10,0,'futbol7','inmediata',0,'abierto',false),
    (v_org5,'P5 manual','Ñuñoa','Metropolitana','Cancha 5',-33.49,-70.64,now()+interval '7 days',90,10,10,0,'futbol7','manual',0,'abierto',false);

  select id into v_p1 from public.matches where id_organizador=v_org1 and titulo='P1 inmediata';
  select id into v_p2 from public.matches where id_organizador=v_org2 and titulo='P2 manual';
  select id into v_p3 from public.matches where id_organizador=v_org3 and titulo='P3 inmediata';
  select id into v_p4 from public.matches where id_organizador=v_j4   and titulo='P4 inmediata';
  select id into v_p5 from public.matches where id_organizador=v_org5 and titulo='P5 manual';

  -- ══ B3: add_organizer_as_attendee ════════════════════════════
  -- Que los cinco partidos se hayan creado ya es media prueba: con
  -- `origen` NOT NULL y sin el trigger, este insert habría reventado.
  select count(*) into v_count from public.attendees
   where id_partido in (v_p1,v_p2,v_p3,v_p4,v_p5) and origen = 'organizador';
  if v_count <> 5 then
    raise exception 'FALLÓ B3: % de 5 organizadores con origen=organizador', v_count;
  end if;
  select origen, estado into v_origen, v_estado from public.attendees
   where id_partido=v_p1 and id_jugador=v_org1;
  insert into t45b values ('B3','add_organizer_as_attendee',
    format('los 5 organizadores entran con origen=%s, estado=%s — crear un partido normal no falla', v_origen, v_estado));

  -- ══ B4: join_match → orden_llegada ═══════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  v_js := public.join_match(v_p1);
  execute 'reset role';
  if not (v_js->>'ok')::boolean then raise exception 'FALLÓ B4 — %', v_js->>'reason'; end if;
  select origen, estado into v_origen, v_estado from public.attendees where id_partido=v_p1 and id_jugador=v_j1;
  if v_origen <> 'orden_llegada' or v_estado <> 'inscrito' then
    raise exception 'FALLÓ B4: origen=% estado=%', v_origen, v_estado;
  end if;
  insert into t45b values ('B4','join_match', 'origen=orden_llegada, estado=inscrito');

  -- ══ B5: request_join → postulacion ═══════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j2,'role','authenticated')::text);
  v_j := public.request_join(v_p2);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ B5 — %', v_j->>'reason'; end if;
  select origen, estado into v_origen, v_estado from public.attendees where id_partido=v_p2 and id_jugador=v_j2;
  if v_origen <> 'postulacion' or v_estado <> 'pendiente' then
    raise exception 'FALLÓ B5: origen=% estado=%', v_origen, v_estado;
  end if;
  insert into t45b values ('B5','request_join', 'origen=postulacion, estado=pendiente');

  -- ══ B6: swap_match a inmediata → orden_llegada ═══════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  v_j := public.swap_match(v_p1, v_p3);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ B6 — %', v_j->>'reason'; end if;
  select origen, estado into v_origen, v_estado from public.attendees where id_partido=v_p3 and id_jugador=v_j1;
  if v_origen <> 'orden_llegada' or v_estado <> 'inscrito' then
    raise exception 'FALLÓ B6: origen=% estado=%', v_origen, v_estado;
  end if;
  select count(*) into v_count from public.attendees where id_partido=v_p1 and id_jugador=v_j1;
  if v_count <> 0 then raise exception 'FALLÓ B6: quedó la fila del partido viejo'; end if;
  insert into t45b values ('B6','swap_match (inmediata)', 'origen=orden_llegada en el partido nuevo; la fila vieja se borró');

  -- ══ B7: swap_match a manual → postulacion ════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j3,'role','authenticated')::text);
  v_js := public.join_match(v_p1);
  if not (v_js->>'ok')::boolean then raise exception 'FALLÓ B7 (preparación) — %', v_js->>'reason'; end if;
  v_j := public.swap_match(v_p1, v_p5);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ B7 — %', v_j->>'reason'; end if;
  select origen, estado into v_origen, v_estado from public.attendees where id_partido=v_p5 and id_jugador=v_j3;
  if v_origen <> 'postulacion' or v_estado <> 'pendiente' then
    raise exception 'FALLÓ B7: origen=% estado=%', v_origen, v_estado;
  end if;
  insert into t45b values ('B7','swap_match (manual)', 'origen=postulacion — el trigger distingue por estado, no por la vía');

  -- ══ B8: cancel_match_and_join → orden_llegada ════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j4,'role','authenticated')::text);
  v_j := public.cancel_match_and_join(v_p4, v_p3);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ B8 — %', v_j->>'reason'; end if;
  select origen, estado into v_origen, v_estado from public.attendees where id_partido=v_p3 and id_jugador=v_j4;
  if v_origen <> 'orden_llegada' or v_estado <> 'inscrito' then
    raise exception 'FALLÓ B8: origen=% estado=%', v_origen, v_estado;
  end if;
  insert into t45b values ('B8','cancel_match_and_join', 'origen=orden_llegada en el partido de destino');

  -- ══ B9: el origen explícito no se pisa ═══════════════════════
  -- Es lo que hacen las RPC de clubes al reservar. Aquí se simula el
  -- insert que hace `aprobar_propuesta`, sobre un partido normal para
  -- aislar el trigger de todo lo demás.
  insert into public.attendees (id_partido, id_jugador, estado, origen)
  values (v_p3, v_org1, 'inscrito', 'reserva_proponente');
  select origen into v_origen from public.attendees where id_partido=v_p3 and id_jugador=v_org1;
  if v_origen <> 'reserva_proponente' then
    raise exception 'FALLÓ B9: el trigger pisó el origen explícito y dejó %', v_origen;
  end if;
  insert into public.attendees (id_partido, id_jugador, estado, origen)
  values (v_p3, v_org2, 'inscrito', 'reserva_aprobador');
  select origen into v_origen from public.attendees where id_partido=v_p3 and id_jugador=v_org2;
  if v_origen <> 'reserva_aprobador' then
    raise exception 'FALLÓ B9: reserva_aprobador quedó como %', v_origen;
  end if;
  -- Y el caso que más importa: aunque el jugador SEA el organizador del
  -- partido, el origen explícito manda sobre la deducción. Se borra la
  -- fila que puso `add_organizer_as_attendee` para que el insert pase
  -- otra vez por el trigger de verdad, no por un `on conflict`.
  delete from public.attendees where id_partido=v_p5 and id_jugador=v_org5;
  insert into public.attendees (id_partido, id_jugador, estado, origen)
  values (v_p5, v_org5, 'inscrito', 'reserva_aprobador');
  select origen into v_origen from public.attendees where id_partido=v_p5 and id_jugador=v_org5;
  if v_origen <> 'reserva_aprobador' then
    raise exception 'FALLÓ B9: el organizador con origen explícito quedó como %', v_origen;
  end if;
  insert into t45b values ('B9','origen explícito',
    'reserva_proponente y reserva_aprobador sobreviven al trigger, incluso sobre el organizador');

  -- ══ B10: el CHECK rechaza texto arbitrario ═══════════════════
  v_ok := false;
  begin
    insert into public.attendees (id_partido, id_jugador, estado, origen)
    values (v_p3, v_org5, 'inscrito', 'me_lo_invento');
  exception when check_violation then
    v_ok := true;
  end;
  if not v_ok then raise exception 'FALLÓ B10: el CHECK dejó pasar un origen inventado'; end if;
  insert into t45b values ('B10','CHECK de origen', 'un valor fuera de la lista se rechaza con check_violation');

  -- ══ B11: nadie queda sin origen ══════════════════════════════
  select count(*) into v_count from public.attendees where origen is null;
  if v_count <> 0 then raise exception 'FALLÓ B11: % filas sin origen', v_count; end if;
  insert into t45b values ('B11','NOT NULL', 'ninguna fila quedó sin origen tras ejercitar las cinco vías heredadas');

  -- ══ B12: authenticated no escribe origen ═════════════════════
  v_ok := false;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  begin
    update public.attendees set origen = 'reserva_aprobador'
     where id_partido = v_p3 and id_jugador = v_j1;
    -- Sin privilegio salta excepción; con RLS sin política, el update
    -- no afecta filas. Las dos cosas cuentan como cerrado.
    get diagnostics v_count = row_count;
    if v_count = 0 then v_ok := true; end if;
  exception when insufficient_privilege then
    v_ok := true;
  end;
  execute 'reset role';
  if not v_ok then raise exception 'FALLÓ B12: authenticated cambió el origen por su cuenta'; end if;
  select origen into v_origen from public.attendees where id_partido=v_p3 and id_jugador=v_j1;
  if v_origen <> 'orden_llegada' then
    raise exception 'FALLÓ B12: el origen quedó en % tras el intento directo', v_origen;
  end if;
  insert into t45b values ('B12','no modificable directamente',
    'authenticated no puede escribir origen: la 44e le quitó políticas y privilegio de escritura');

  -- ══ B13: el partido normal sigue funcionando entero ══════════
  select cupos_disponibles into v_cupos from public.matches where id=v_p2;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_org2,'role','authenticated')::text);
  v_j := public.approve_join(v_p2, v_j2);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ B13 (aprobar) — %', v_j->>'reason'; end if;
  select origen, estado into v_origen, v_estado from public.attendees where id_partido=v_p2 and id_jugador=v_j2;
  if v_estado <> 'inscrito' then raise exception 'FALLÓ B13: estado tras aprobar = %', v_estado; end if;
  if v_origen <> 'postulacion' then
    raise exception 'FALLÓ B13: approve_join cambió el origen a % (debe conservar la procedencia)', v_origen;
  end if;
  select cupos_disponibles into v_count from public.matches where id=v_p2;
  if v_count <> v_cupos - 1 then
    raise exception 'FALLÓ B13: cupos % → % al aprobar', v_cupos, v_count;
  end if;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j2,'role','authenticated')::text);
  v_j := public.leave_match(v_p2);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ B13 (salir) — %', v_j->>'reason'; end if;
  select cupos_disponibles into v_count from public.matches where id=v_p2;
  if v_count <> v_cupos then
    raise exception 'FALLÓ B13: al salir los cupos quedaron en % y no en %', v_count, v_cupos;
  end if;
  insert into t45b values ('B13','partido normal completo',
    format('request_join → approve_join → leave_match: cupos %s → %s → %s, y el origen se conserva como postulacion',
           v_cupos, v_cupos-1, v_count));
end;
$$;

select n, caso, detalle from t45b order by n;

rollback;
