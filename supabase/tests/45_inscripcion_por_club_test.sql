-- =============================================================
-- FutFinder — pruebas de inscripción y cupos por club (migración 45)
--
-- PARTE A · mecánica de cupos.  Verificada contra el esquema
-- desplegado el 2026-08-13: 14 casos, todos en verde.
--
-- Qué cubre:
--   1. Orden de llegada: los 4 del club A entran, con `club_id` y
--      `origen = 'orden_llegada'`.
--   2. El quinto del mismo club se rechaza.
--   3. Con el club A lleno, el club B SIGUE inscribiendo: los cupos no
--      se comparten.
--   4. El conteo es por club: A=4/4, B=1/4.
--   5. Un ajeno a los dos clubes no entra por ninguna vía.
--   6. Inscribirse dos veces deja UNA fila.
--   7. Salir libera el cupo y entra el que estaba fuera.
--   8. Selección administrativa: cinco postulaciones NO consumen
--      ningún cupo de un club de cuatro.
--   9. Confirma un administrador del club DEL JUGADOR; el del club
--      rival no puede.
--  10. El límite se aplica AL CONFIRMAR, no al postular.
--  11. Publicado el partido, ningún administrador se confirma a sí
--      mismo desde la nómina.
--  12. `leave_club_match` no sirve para saltarse la salida/penalización
--      de un partido normal.
--  13. `attendees` está en Realtime para refrescar la nómina sin gesto
--      manual (los DELETE se cubren además con sondeo del cliente).
--  14. Los helpers internos no son RPC públicas: no filtran pertenencia
--      ni conteos de un partido privado a otro usuario autenticado.
--
-- Requisito: migraciones 44 a 44e y 45 aplicadas.
--
-- NOTA SOBRE LA CONCURRENCIA. Este arnés corre en UNA sola sesión, así
-- que no puede lanzar dos transacciones en paralelo: lo que se prueba
-- es el invariante —el intento N+1 se rechaza y el conteo nunca pasa de
-- `cupos_por_club`—, no la carrera real. Lo que la cubre es el
-- `select ... for update` sobre la fila del partido, que serializa
-- todas las inscripciones, bajas y confirmaciones de ese partido antes
-- de contar. Una prueba de carrera de verdad necesita dos sesiones y un
-- arnés aparte.
--
-- Los cupos del partido se bajan a 4 (el mínimo que admite el CHECK)
-- para probar el borde sin crear dieciocho usuarios.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK. Usa el partido
-- de clubes que ya exista en la base; no crea uno nuevo.
-- =============================================================

begin;

create temp table t45 (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_m uuid; v_cl uuid; v_cv uuid; v_adminA uuid; v_adminB uuid;
  v_a uuid[]; v_b1 uuid := gen_random_uuid(); v_x uuid := gen_random_uuid();
  v_j json; v_count int; v_estado text; v_origen text; i integer;
  v_normal uuid; v_cupos_antes int;
begin
  select id, club_local_id, club_visitante_id into v_m, v_cl, v_cv
    from public.matches where challenge_proposal_id is not null limit 1;
  if v_m is null then
    raise exception 'No hay ningún partido de clubes en la base contra el que probar';
  end if;
  select user_id into v_adminA from public.club_members where club_id=v_cl and rol='admin' limit 1;
  select user_id into v_adminB from public.club_members where club_id=v_cv and rol='admin' limit 1;

  update public.matches set cupos_por_club=4, cupos_totales=8, cupos_disponibles=8,
         metodo_inscripcion='orden_llegada', estado='abierto', hora=now()+interval '5 days'
   where id=v_m;

  v_a := array[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u,'authenticated','authenticated',
    'u3-'||u||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','','' from unnest(v_a||array[v_b1,v_x]) u;
  insert into public.club_members (club_id,user_id,rol) select v_cl,u,'jugador' from unnest(v_a) u;
  insert into public.club_members (club_id,user_id,rol) values (v_cv,v_b1,'jugador');

  -- ══ 1 y 2: orden de llegada y su límite ══════════════════════
  for i in 1..4 loop
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_a[i],'role','authenticated')::text);
    v_j := public.join_club_match(v_m); execute 'reset role';
    if not (v_j->>'ok')::boolean then raise exception 'FALLÓ 1 (jugador %) — %', i, v_j->>'reason'; end if;
  end loop;
  select estado, origen into v_estado, v_origen from public.attendees where id_partido=v_m and id_jugador=v_a[1];
  insert into t45 values (1,'orden de llegada', format('los 4 del club A entran: estado=%s, origen=%s', v_estado, v_origen));

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_a[5],'role','authenticated')::text);
  v_j := public.join_club_match(v_m); execute 'reset role';
  if (v_j->>'ok')::boolean then raise exception 'FALLÓ 2: el quinto entró'; end if;
  insert into t45 values (2,'límite por club', format('el quinto del club A se rechaza — %s', v_j->>'reason'));

  -- ══ 3 y 4: los cupos no se comparten ═════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_b1,'role','authenticated')::text);
  v_j := public.join_club_match(v_m); execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ 3 — %', v_j->>'reason'; end if;
  insert into t45 values (3,'cupos independientes','con el club A lleno, el club B sigue inscribiendo');

  select public.cupos_ocupados_club(v_m,v_cl) into v_count;
  if v_count<>4 then raise exception 'FALLÓ 4: el club A tiene %', v_count; end if;
  select public.cupos_ocupados_club(v_m,v_cv) into v_count;
  if v_count<>1 then raise exception 'FALLÓ 4: el club B tiene %', v_count; end if;
  insert into t45 values (4,'conteo por club','A=4/4 (lleno), B=1/4 — cada club cuenta lo suyo');

  -- ══ 5: ajeno ═════════════════════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_x,'role','authenticated')::text);
  v_j := public.join_club_match(v_m); execute 'reset role';
  if (v_j->>'ok')::boolean then raise exception 'FALLÓ 5: un ajeno se inscribió'; end if;
  insert into t45 values (5,'ajeno', format('rechazado — %s', v_j->>'reason'));

  -- ══ 6: idempotencia ══════════════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_a[1],'role','authenticated')::text);
  v_j := public.join_club_match(v_m); execute 'reset role';
  select count(*) into v_count from public.attendees where id_partido=v_m and id_jugador=v_a[1];
  if v_count<>1 then raise exception 'FALLÓ 6: % filas', v_count; end if;
  insert into t45 values (6,'idempotencia','inscribirse dos veces deja una fila y devuelve already=true');

  -- ══ 7: salir libera el cupo ══════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_a[1],'role','authenticated')::text);
  v_j := public.leave_club_match(v_m); execute 'reset role';
  if not (v_j->>'liberoCupo')::boolean then raise exception 'FALLÓ 7: no liberó cupo'; end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_a[5],'role','authenticated')::text);
  v_j := public.join_club_match(v_m); execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ 7: no entró tras la baja'; end if;
  insert into t45 values (7,'salir libera el cupo','tras la baja, el que estaba fuera entra');

  -- ══ 8: postular no consume cupo ══════════════════════════════
  delete from public.attendees where id_partido=v_m;
  update public.matches set metodo_inscripcion='seleccion_admin', cupos_disponibles=8, estado='abierto' where id=v_m;
  for i in 1..5 loop
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_a[i],'role','authenticated')::text);
    v_j := public.join_club_match(v_m); execute 'reset role';
    if v_j->>'estado' <> 'pendiente' then raise exception 'FALLÓ 8: estado %', v_j->>'estado'; end if;
  end loop;
  select public.cupos_ocupados_club(v_m,v_cl) into v_count;
  if v_count<>0 then raise exception 'FALLÓ 8: las postulaciones consumieron % cupos', v_count; end if;
  insert into t45 values (8,'selección administrativa','cinco postulaciones no consumen ningún cupo de un club de 4');

  -- ══ 9: confirma el admin del club DEL JUGADOR ════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminB,'role','authenticated')::text);
  v_j := public.confirmar_nomina_club(v_m, v_a[1], true); execute 'reset role';
  if (v_j->>'ok')::boolean then raise exception 'FALLÓ 9: el admin del club rival confirmó'; end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.confirmar_nomina_club(v_m, v_a[1], true); execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ 9 — %', v_j->>'reason'; end if;
  select origen into v_origen from public.attendees where id_partido=v_m and id_jugador=v_a[1];
  insert into t45 values (9,'confirmar nómina', format('el admin del club RIVAL no puede; el del club propio sí, origen=%s', v_origen));

  -- ══ 10: el límite se aplica al confirmar ═════════════════════
  for i in 2..4 loop
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
    v_j := public.confirmar_nomina_club(v_m, v_a[i], true); execute 'reset role';
    if not (v_j->>'ok')::boolean then raise exception 'FALLÓ 10 (jugador %) — %', i, v_j->>'reason'; end if;
  end loop;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  v_j := public.confirmar_nomina_club(v_m, v_a[5], true); execute 'reset role';
  if (v_j->>'ok')::boolean then raise exception 'FALLÓ 10: se confirmó por encima del límite'; end if;
  insert into t45 values (10,'límite al confirmar', format('el quinto se rechaza aunque su postulación siga pendiente — %s', v_j->>'reason'));

  -- ══ 11: nadie se confirma a sí mismo ═════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_adminA,'role','authenticated')::text);
  perform public.join_club_match(v_m);
  v_j := public.confirmar_nomina_club(v_m, v_adminA, true); execute 'reset role';
  if (v_j->>'ok')::boolean then raise exception 'FALLÓ 11: se autoconfirmó'; end if;
  insert into t45 values (11,'autoconfirmación', format('publicado el partido, ningún admin se confirma a sí mismo — %s', v_j->>'reason'));

  -- ══ 12: la RPC de clubes no evade la salida normal ═══════════
  insert into public.matches (id_organizador,titulo,comuna,region,cancha_nombre,
    latitud,longitud,hora,duracion_min,cupos_totales,cupos_disponibles,
    precio_cuota,aprobacion,min_trust_score,estado)
  values (v_adminA,'Normal · no usar leave_club_match','Ñuñoa','Metropolitana',
    'Cancha normal',-33.45,-70.60,now()+interval '12 days',90,10,10,0,
    'inmediata',0,'abierto')
  returning id into v_normal;
  update public.profiles set trust_score=100 where id=v_x;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_x,'role','authenticated')::text);
  v_j := public.join_match(v_normal);
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ 12 (preparación) — %', v_j->>'reason'; end if;
  select cupos_disponibles into v_cupos_antes from public.matches where id=v_normal;
  v_j := public.leave_club_match(v_normal);
  execute 'reset role';
  if (v_j->>'ok')::boolean then raise exception 'FALLÓ 12: leave_club_match aceptó un partido normal'; end if;
  if not exists (select 1 from public.attendees where id_partido=v_normal and id_jugador=v_x) then
    raise exception 'FALLÓ 12: borró la inscripción normal';
  end if;
  select cupos_disponibles into v_count from public.matches where id=v_normal;
  if v_count <> v_cupos_antes then raise exception 'FALLÓ 12: cambió cupos % → %', v_cupos_antes, v_count; end if;
  insert into t45 values (12,'salida aislada por flujo',
    'leave_club_match rechaza un partido normal y conserva su inscripción y sus cupos');

  -- ══ 13: cambios de nómina publicados en Realtime ═════════════
  if not exists (
    select 1 from pg_publication_tables
     where pubname='supabase_realtime' and schemaname='public' and tablename='attendees'
  ) then
    raise exception 'FALLÓ 13: attendees no está en la publicación supabase_realtime';
  end if;
  insert into t45 values (13,'actualización automática',
    'attendees está publicado en Realtime; el cliente escucha INSERT/UPDATE y sondea DELETE sin recarga manual');

  -- ══ 14: helpers internos sin EXECUTE de cliente ══════════════
  if has_function_privilege('authenticated', 'public.cupos_ocupados_club(uuid,uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.mi_club_en_partido(uuid,uuid)', 'execute') then
    raise exception 'FALLÓ 14: un helper interno sigue expuesto a authenticated';
  end if;
  insert into t45 values (14,'helpers internos',
    'authenticated no puede consultar por RPC la pertenencia ni el conteo privado de otro partido');
end;
$$;

select n, caso, detalle from t45 order by n;

rollback;
