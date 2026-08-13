-- =============================================================
-- FutFinder — pruebas del cierre del P1 (migración 44e)
--
-- LO QUE SE PROTEGE: que a `attendees` y a `match_waitlist` sólo se
-- pueda escribir desde funciones `security definer`. La 44d cerró esa
-- puerta para los partidos de clubes; la 44e la cierra también para los
-- NORMALES, que era la mitad que quedaba del P1.
--
-- Al quitar además el privilegio de tabla, el intento directo ya no
-- afecta cero filas en silencio: falla con «permission denied». Es
-- mejor así — un fallo silencioso es el que nadie descubre.
--
-- Qué cubre:
--   1. Insert directo en un partido NORMAL: rechazado.
--   2. Delete y update directos: rechazados, y la fila queda intacta
--      (sin esto, un jugador se ascendía solo de 'pendiente' a
--      'inscrito' saltándose al organizador).
--   3. `cancel_join_request()` sustituye al delete que hacía el
--      cliente, y repetirlo no es un error.
--   4. `match_waitlist` igual, y la política residual
--      `waitlist_delete_self_or_host` ya no existe.
--   5. `approve_join` sigue funcionando en un partido normal.
--   6. `approve_join` y `reject_join` rechazan los partidos de clubes:
--      ahí el `id_organizador` es el admin del club RIVAL y dejarle
--      aprobar sería dejarle elegir la nómina del otro club.
--   7. `leave_match` sigue funcionando.
--   8. No queda ninguna política de escritura.
--
-- Requisito: migraciones 44, 44b, 44c, 44d y 44e aplicadas.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t44e (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_org uuid := gen_random_uuid(); v_j1 uuid := gen_random_uuid(); v_j2 uuid := gen_random_uuid();
  v_m uuid; v_mc uuid; v_count int; v_ok boolean; v_err text; v_json jsonb; v_j json;
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',
    'p1-'||u.tag||'-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from (values (v_org,'org'),(v_j1,'j1'),(v_j2,'j2')) as u(id,tag);

  insert into public.matches (id_organizador,titulo,comuna,region,cancha_nombre,direccion,
    latitud,longitud,hora,duracion_min,cupos_totales,cupos_disponibles,precio_cuota,aprobacion)
  values (v_org,'Normal P1','Providencia','Región Metropolitana de Santiago','Cancha P1','Av. P1 1',
    -33.42,-70.61, now()+interval '3 days',90,10,10,0,'manual') returning id into v_m;
  select id into v_mc from public.matches where challenge_proposal_id is not null limit 1;

  -- ══ 1: insert directo en un partido NORMAL ═══════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
    insert into public.attendees (id_partido,id_jugador,estado) values (v_m,v_j1,'inscrito');
    execute 'reset role';
  exception when others then execute 'reset role'; v_err := sqlerrm; v_ok := true; end;
  if not v_ok then raise exception 'FALLÓ 1: insert directo en un partido normal'; end if;
  insert into t44e values (1,'P1 · insert directo en partido NORMAL', format('rechazado — %s', v_err));

  -- ══ 2: delete y update directos ══════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  v_j := public.request_join(v_m)::json;
  execute 'reset role';
  select count(*) into v_count from public.attendees where id_partido=v_m and id_jugador=v_j1 and estado='pendiente';
  if v_count<>1 then raise exception 'FALLÓ 2: request_join no dejó la solicitud'; end if;

  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
    delete from public.attendees where id_partido=v_m and id_jugador=v_j1;
    execute 'reset role';
  exception when others then execute 'reset role'; v_err := sqlerrm; v_ok := true; end;
  if not v_ok then raise exception 'FALLÓ 2: el delete directo funcionó'; end if;

  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
    update public.attendees set estado='inscrito' where id_partido=v_m and id_jugador=v_j1;
    execute 'reset role';
  exception when others then execute 'reset role'; v_ok := true; end;
  if not v_ok then raise exception 'FALLÓ 2: el update directo se aplicó (autoascenso a inscrito)'; end if;
  select count(*) into v_count from public.attendees
   where id_partido=v_m and id_jugador=v_j1 and estado='pendiente';
  if v_count<>1 then raise exception 'FALLÓ 2: la fila cambió'; end if;
  insert into t44e values (2,'P1 · delete y update directos', format('los dos rechazados y la fila intacta — %s', v_err));

  -- ══ 3: cancel_join_request ═══════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  v_j := public.cancel_join_request(v_m);
  execute 'reset role';
  select count(*) into v_count from public.attendees where id_partido=v_m and id_jugador=v_j1;
  if v_count<>0 then raise exception 'FALLÓ 3: no retiró la solicitud'; end if;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  v_j := public.cancel_join_request(v_m);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ 3: repetir dio error'; end if;
  insert into t44e values (3,'cancel_join_request','retira mi solicitud pendiente; repetirlo devuelve ok sin error');

  -- ══ 4: match_waitlist ════════════════════════════════════════
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j2,'role','authenticated')::text);
    insert into public.match_waitlist (id_partido,id_jugador) values (v_m,v_j2);
    execute 'reset role';
  exception when others then execute 'reset role'; v_ok := true; end;
  if not v_ok then raise exception 'FALLÓ 4: insert directo en match_waitlist'; end if;
  insert into t44e values (4,'P1 · match_waitlist','insert directo rechazado; la política residual waitlist_delete_self_or_host ya no existe');

  -- ══ 5: approve_join en un partido normal ═════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  perform public.request_join(v_m);
  execute 'reset role';
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_org,'role','authenticated')::text);
  v_json := public.approve_join(v_m, v_j1);
  execute 'reset role';
  if not (v_json->>'ok')::boolean then raise exception 'FALLÓ 5 — %', v_json->>'reason'; end if;
  select count(*) into v_count from public.attendees where id_partido=v_m and id_jugador=v_j1 and estado='inscrito';
  if v_count<>1 then raise exception 'FALLÓ 5: no quedó inscrito'; end if;
  insert into t44e values (5,'approve_join en partido NORMAL','sigue funcionando, ahora con for update para no sobrevender');

  -- ══ 6: approve_join / reject_join en un partido de clubes ════
  if v_mc is not null then
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_org,'role','authenticated')::text);
    v_json := public.approve_join(v_mc, v_j1);
    if (v_json->>'ok')::boolean then raise exception 'FALLÓ 6: approve_join aceptó un partido de clubes'; end if;
    v_json := public.reject_join(v_mc, v_j1);
    execute 'reset role';
    if (v_json->>'ok')::boolean then raise exception 'FALLÓ 6: reject_join aceptó un partido de clubes'; end if;
    insert into t44e values (6,'approve_join / reject_join en partido de CLUBES', format('ambas rechazadas — %s', v_json->>'reason'));
  end if;

  -- ══ 7: leave_match ═══════════════════════════════════════════
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_j1,'role','authenticated')::text);
  v_j := public.leave_match(v_m);
  execute 'reset role';
  if not (v_j->>'ok')::boolean then raise exception 'FALLÓ 7'; end if;
  select count(*) into v_count from public.attendees where id_partido=v_m and id_jugador=v_j1;
  if v_count<>0 then raise exception 'FALLÓ 7: no salió'; end if;
  insert into t44e values (7,'leave_match','sigue funcionando y devuelve el cupo');

  -- ══ 8: no queda ninguna política de escritura ════════════════
  select count(*) into v_count from pg_policies
   where schemaname='public' and tablename in ('attendees','match_waitlist')
     and cmd in ('INSERT','UPDATE','DELETE');
  if v_count<>0 then raise exception 'FALLÓ 8: quedan % políticas de escritura', v_count; end if;
  insert into t44e values (8,'políticas','0 de escritura en attendees y match_waitlist: sólo entran las RPC security definer');
end;
$$;

select n, caso, detalle from t44e order by n;

rollback;
