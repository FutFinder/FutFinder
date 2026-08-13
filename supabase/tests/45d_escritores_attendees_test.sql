-- =============================================================
-- FutFinder — regresión de escritores heredados de `attendees`
-- (migraciones 44e y 45)
--
-- Las partes 44e, 45 y 45b cubren los escritores de inscripción,
-- postulación, aprobación, intercambio, salida normal y reservas de
-- clubes. Esta parte D ejercita los cinco escritores restantes que
-- aparecen en el catálogo de producción:
--
--   D1. `confirm_attendance_gps` actualiza el estado y conserva origen.
--   D2. `save_match_attendance` actualiza el estado y conserva origen.
--   D3. `leave_match_penalized` borra la fila y devuelve el cupo.
--   D4. `reject_join` borra la postulación sin consumir/devolver cupo.
--   D5. `delete_my_account` elimina las filas del usuario.
--
-- Requisito: migraciones 44 a 44e y 45 aplicadas.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t45d (n text, caso text, detalle text) on commit drop;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_gps uuid := gen_random_uuid();
  v_save uuid := gen_random_uuid();
  v_leave uuid := gen_random_uuid();
  v_reject uuid := gen_random_uuid();
  v_delete uuid := gen_random_uuid();
  v_m_gps uuid; v_m_save uuid; v_m_leave uuid; v_m_reject uuid; v_m_delete uuid;
  v_j jsonb; v_js json; v_origen text; v_estado text;
  v_cupos integer; v_count integer;
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u3d-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
    from unnest(array[v_org,v_gps,v_save,v_leave,v_reject,v_delete]) u;

  update public.profiles set trust_score=100
   where id in (v_org,v_gps,v_save,v_leave,v_reject,v_delete);

  insert into public.matches (id_organizador,titulo,comuna,region,cancha_nombre,
      latitud,longitud,hora,duracion_min,cupos_totales,cupos_disponibles,
      precio_cuota,aprobacion,min_trust_score,estado)
  values
    (v_org,'D1 GPS','Ñuñoa','Metropolitana','Cancha D1',-33.45,-70.60,
      now()+interval '10 minutes',90,10,10,0,'inmediata',0,'abierto'),
    (v_org,'D2 asistencia','Ñuñoa','Metropolitana','Cancha D2',-33.46,-70.61,
      now()+interval '4 days',90,10,10,0,'inmediata',0,'abierto'),
    (v_org,'D3 salida penalizada','Ñuñoa','Metropolitana','Cancha D3',-33.47,-70.62,
      now()+interval '6 days',90,10,10,0,'inmediata',0,'abierto'),
    (v_org,'D4 rechazo','Ñuñoa','Metropolitana','Cancha D4',-33.48,-70.63,
      now()+interval '8 days',90,10,10,0,'manual',0,'abierto'),
    (v_org,'D5 borrar cuenta','Ñuñoa','Metropolitana','Cancha D5',-33.49,-70.64,
      now()+interval '10 days',90,10,10,0,'inmediata',0,'abierto');

  select id into v_m_gps from public.matches where id_organizador=v_org and titulo='D1 GPS';
  select id into v_m_save from public.matches where id_organizador=v_org and titulo='D2 asistencia';
  select id into v_m_leave from public.matches where id_organizador=v_org and titulo='D3 salida penalizada';
  select id into v_m_reject from public.matches where id_organizador=v_org and titulo='D4 rechazo';
  select id into v_m_delete from public.matches where id_organizador=v_org and titulo='D5 borrar cuenta';

  -- D1 · confirmación GPS.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_gps,'role','authenticated')::text);
  v_js := public.join_match(v_m_gps);
  if not (v_js->>'ok')::boolean then raise exception 'FALLÓ D1 (inscripción) — %', v_js->>'reason'; end if;
  v_js := public.confirm_attendance_gps(v_m_gps, -33.45, -70.60);
  execute 'reset role';
  if not (v_js->>'ok')::boolean then raise exception 'FALLÓ D1 (GPS) — %', v_js->>'reason'; end if;
  select estado, origen into v_estado, v_origen from public.attendees
   where id_partido=v_m_gps and id_jugador=v_gps;
  if v_estado <> 'confirmado_gps' or v_origen <> 'orden_llegada' then
    raise exception 'FALLÓ D1: estado=% origen=%', v_estado, v_origen;
  end if;
  insert into t45d values ('D1','confirm_attendance_gps',
    'actualiza a confirmado_gps y conserva origen=orden_llegada');

  -- D2 · asistencia registrada por el organizador tras el partido.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_save,'role','authenticated')::text);
  v_js := public.join_match(v_m_save);
  execute 'reset role';
  if not (v_js->>'ok')::boolean then raise exception 'FALLÓ D2 (inscripción) — %', v_js->>'reason'; end if;
  update public.matches set hora=now()-interval '100 minutes' where id=v_m_save;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_org,'role','authenticated')::text);
  v_j := public.save_match_attendance(v_m_save, jsonb_build_object(v_save::text,'presente'));
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ D2 (guardar) — %', v_j->>'reason'; end if;
  select estado, origen into v_estado, v_origen from public.attendees
   where id_partido=v_m_save and id_jugador=v_save;
  if v_estado <> 'confirmado_gps' or v_origen <> 'orden_llegada' then
    raise exception 'FALLÓ D2: estado=% origen=%', v_estado, v_origen;
  end if;
  insert into t45d values ('D2','save_match_attendance',
    'marca presente y conserva origen=orden_llegada');

  -- D3 · salida penalizada.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_leave,'role','authenticated')::text);
  v_js := public.join_match(v_m_leave);
  if not (v_js->>'ok')::boolean then raise exception 'FALLÓ D3 (inscripción) — %', v_js->>'reason'; end if;
  select cupos_disponibles into v_cupos from public.matches where id=v_m_leave;
  v_j := public.leave_match_penalized(v_m_leave);
  execute 'reset role';
  if not (v_j->>'ok')::boolean or not (v_j->>'freed')::boolean then
    raise exception 'FALLÓ D3 (salida) — %', v_j->>'reason';
  end if;
  select count(*) into v_count from public.attendees where id_partido=v_m_leave and id_jugador=v_leave;
  if v_count <> 0 then raise exception 'FALLÓ D3: la fila sigue presente'; end if;
  if (select cupos_disponibles from public.matches where id=v_m_leave) <> v_cupos+1 then
    raise exception 'FALLÓ D3: no devolvió el cupo';
  end if;
  insert into t45d values ('D3','leave_match_penalized',
    'borra la inscripción y devuelve exactamente un cupo');

  -- D4 · rechazo de postulación normal.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_reject,'role','authenticated')::text);
  v_js := public.request_join(v_m_reject);
  execute 'reset role';
  if not (v_js->>'ok')::boolean then raise exception 'FALLÓ D4 (postulación) — %', v_js->>'reason'; end if;
  select cupos_disponibles into v_cupos from public.matches where id=v_m_reject;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_org,'role','authenticated')::text);
  v_j := public.reject_join(v_m_reject,v_reject);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ D4 (rechazo) — %', v_j->>'reason'; end if;
  select count(*) into v_count from public.attendees where id_partido=v_m_reject and id_jugador=v_reject;
  if v_count <> 0 then raise exception 'FALLÓ D4: la postulación sigue presente'; end if;
  if (select cupos_disponibles from public.matches where id=v_m_reject) <> v_cupos then
    raise exception 'FALLÓ D4: cambió cupos al rechazar una postulación';
  end if;
  insert into t45d values ('D4','reject_join',
    'borra la postulación y no altera cupos');

  -- D5 · borrado de cuenta del fixture.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_delete,'role','authenticated')::text);
  v_js := public.join_match(v_m_delete);
  if not (v_js->>'ok')::boolean then raise exception 'FALLÓ D5 (inscripción) — %', v_js->>'reason'; end if;
  perform public.delete_my_account();
  execute 'reset role';
  if exists (select 1 from public.attendees where id_jugador=v_delete)
     or exists (select 1 from auth.users where id=v_delete) then
    raise exception 'FALLÓ D5: quedaron la cuenta o sus asistentes';
  end if;
  insert into t45d values ('D5','delete_my_account',
    'elimina la cuenta de prueba y todas sus filas de attendees');
end;
$$;

select n, caso, detalle from t45d order by n;

rollback;
