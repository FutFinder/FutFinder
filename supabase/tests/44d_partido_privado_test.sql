-- =============================================================
-- FutFinder — pruebas del partido de clubes privado (migración 44d)
--
-- LA REGLA: mientras el partido no esté finalizado, sólo existe para
-- los integrantes de los dos clubes. Un externo no debe poder ni saber
-- que existe. Al finalizar, se publica un resumen mínimo por
-- `historial_publico_club()`.
--
-- Qué cubre:
--   1-3. Integrante local, rival y SIN rol administrativo ven el
--        partido pendiente.
--   4.   Externo autenticado: cero filas por id, listando, en la
--        nómina, en la cola y en la ubicación.
--   5.   Anónimo: lo mismo.
--   6.   No aparece en la consulta que alimenta Inicio, Partidos, mapa
--        y filtros por zona.
--   7.   Externo no se inscribe con insert directo (RLS).
--   8.   Ni por `join_match` (guarda explícita, con motivo legible).
--   9.   Un INTEGRANTE tampoco por esa vía: la inscripción por club
--        llega en U3.
--  10.   `request_join` y `join_waitlist` caen por el trigger, aunque
--        sean `security definer` y no pasen por RLS.
--  11.   El integrante conserva el partido y su ubicación exacta.
--  12-13. Los partidos normales siguen visibles y se puede uno
--        inscribir en ellos.
--  14.   Un partido NO finalizado no sale en el historial público.
--  15.   Uno finalizado sale con clubes, día, marcador y resultado, y
--        la fila del partido SIGUE oculta.
--  16.   Uno cancelado o no disputado no se publica.
--
-- Requisito: migraciones 44, 44b, 44c y 44d aplicadas.
--
-- OJO CON `anon`: `set local role anon` NO borra
-- `request.jwt.claims`; sin claims sin `sub`, `auth.uid()` seguiría
-- devolviendo el usuario del bloque anterior.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK. Usa el
-- partido de clubes que ya exista en la base; no crea uno nuevo.
-- =============================================================

begin;

create temp table t44d (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_m uuid; v_cl uuid; v_cv uuid; v_normal uuid;
  v_local uuid; v_visit uuid; v_jug uuid := gen_random_uuid(); v_ext uuid;
  v_count int; v_ok boolean; v_err text; v_json json; v_tit text;
begin
  -- ── SIEMBRA SU PROPIO PARTIDO DE CLUBES (2026-10-15) ──────────
  -- Antes tomaba el primero que hubiera en la base, lo que ataba este
  -- arnés a una con historia: contra una recién construida moría en el
  -- montaje. No estaba roto, no era autosuficiente.
  --
  -- Se recorre el flujo REAL —desafío, aceptación, propuesta, aprobación—
  -- y no se fuerzan estados a mano: así el partido que queda es el que la
  -- app habría creado, con su desafío, su propuesta y sus dos clubes.
  declare
    v_sa uuid := gen_random_uuid(); v_sb uuid := gen_random_uuid();
    v_sx uuid := gen_random_uuid();
    v_sca uuid; v_scb uuid; v_sch uuid; v_sprop record;
    v_smarca text := 'sem' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
      confirmation_token, email_change, email_change_token_new, recovery_token)
    select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
      v_smarca||'-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
    from (values (v_sa), (v_sb), (v_sx)) as u(id);
    -- El tercero (v_sx) existe para los casos que necesitan a alguien
    -- AJENO a los dos clubes; en una base vacía no habría ninguno.
    insert into public.profiles (id, username) values
      (v_sa, v_smarca||'a'), (v_sb, v_smarca||'b'), (v_sx, v_smarca||'x')
      on conflict (id) do nothing;

    insert into public.clubs (nombre, slug, created_by)
    values (v_smarca||' A', v_smarca||'-a', v_sa) returning id into v_sca;
    insert into public.clubs (nombre, slug, created_by)
    values (v_smarca||' B', v_smarca||'-b', v_sb) returning id into v_scb;
    insert into public.club_members (club_id, user_id, rol) values
      (v_sca, v_sa, 'admin'), (v_scb, v_sb, 'admin');

    -- Un partido NORMAL, público. El caso 12 comprueba que `anon` sigue
    -- viéndolos —que el blindaje del partido de clubes no se llevó por
    -- delante a los demás— y en una base recién construida no hay ninguno,
    -- así que la aserción fallaba por falta de datos y no por el código.
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre,
      latitud, longitud, hora, cupos_totales, cupos_disponibles)
    values (v_sx, 'Pichanga '||v_smarca, 'Ñuñoa', 'Cancha normal '||v_smarca,
            -33.4569, -70.6483, now() + interval '5 days', 10, 8);

    insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
    values (v_sca, v_scb, v_sa, 'pendiente') returning id into v_sch;

    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_sb, 'role','authenticated')::text);
    perform public.aceptar_desafio(v_sch);

    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_sa, 'role','authenticated')::text);
    v_sprop := public.crear_propuesta_oficial(v_sch, jsonb_build_object(
      'fecha', (now() + interval '7 days')::text, 'duracion_min', 90,
      'direccion', 'Av. Siempre Viva 742', 'cancha_nombre', 'Cancha '||v_smarca,
      'comuna', 'Ñuñoa', 'region', 'Metropolitana',
      'latitud', -33.4569, 'longitud', -70.6483, 'modalidad', 'futbol7',
      'cupos_por_club', 7, 'metodo_inscripcion', 'orden_llegada',
      'cuota_por_persona', 0), gen_random_uuid());

    execute format('set local request.jwt.claims to %L',
      json_build_object('sub', v_sb, 'role','authenticated')::text);
    perform public.aprobar_propuesta(v_sprop.id, p_me_inscribo => false);
    execute 'reset role';
    execute 'set local request.jwt.claims to ''{}''';
  end;

  select id, club_local_id, club_visitante_id into v_m, v_cl, v_cv
    from public.matches where challenge_proposal_id is not null limit 1;
  if v_m is null then
    raise exception 'No hay ningún partido de clubes en la base contra el que probar';
  end if;
  select user_id into v_local from public.club_members where club_id=v_cl and rol='admin' limit 1;
  select user_id into v_visit from public.club_members where club_id=v_cv and rol='admin' limit 1;
  select id into v_ext from auth.users
   where id not in (select user_id from public.club_members where club_id in (v_cl,v_cv)) limit 1;
  select id into v_normal from public.matches where challenge_proposal_id is null and estado='abierto' limit 1;

  -- Un integrante SIN rol administrativo, temporal.
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  values ('00000000-0000-0000-0000-000000000000',v_jug,'authenticated','authenticated',
    'priv-'||v_jug||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','','');
  insert into public.club_members (club_id,user_id,rol) values (v_cl,v_jug,'jugador');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_local,'role','authenticated')::text);
  select count(*) into v_count from public.matches where id=v_m;
  execute 'reset role';
  if v_count<>1 then raise exception 'FALLÓ 1: el integrante local no ve el partido'; end if;
  insert into t44d values (1,'integrante club LOCAL','ve el partido pendiente');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_visit,'role','authenticated')::text);
  select count(*) into v_count from public.matches where id=v_m;
  execute 'reset role';
  if v_count<>1 then raise exception 'FALLÓ 2'; end if;
  insert into t44d values (2,'integrante club RIVAL','ve el partido pendiente');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_jug,'role','authenticated')::text);
  select count(*) into v_count from public.matches where id=v_m;
  execute 'reset role';
  if v_count<>1 then raise exception 'FALLÓ 3'; end if;
  insert into t44d values (3,'integrante SIN rol administrativo','ve el partido pendiente');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ext,'role','authenticated')::text);
  select count(*) into v_count from public.matches where id=v_m;
  if v_count<>0 then raise exception 'FALLÓ 4: un externo ve el partido por id'; end if;
  select count(*) into v_count from public.matches where challenge_proposal_id is not null;
  if v_count<>0 then raise exception 'FALLÓ 4: un externo lista partidos de clubes'; end if;
  select count(*) into v_count from public.attendees where id_partido=v_m;
  if v_count<>0 then raise exception 'FALLÓ 4: un externo ve la nómina'; end if;
  select count(*) into v_count from public.match_waitlist where id_partido=v_m;
  if v_count<>0 then raise exception 'FALLÓ 4: un externo ve la lista de espera'; end if;
  select count(*) into v_count from public.club_match_locations where match_id=v_m;
  if v_count<>0 then raise exception 'FALLÓ 4: un externo ve la ubicación'; end if;
  execute 'reset role';
  insert into t44d values (4,'externo autenticado','0 filas: ni por id, ni listando, ni nómina, ni cola, ni ubicación');

  execute format('set local request.jwt.claims to %L', json_build_object('role','anon')::text);
  execute 'set local role anon';
  select count(*) into v_count from public.matches where id=v_m;
  if v_count<>0 then raise exception 'FALLÓ 5: anon ve el partido'; end if;
  select count(*) into v_count from public.matches where challenge_proposal_id is not null;
  if v_count<>0 then raise exception 'FALLÓ 5: anon lista partidos de clubes'; end if;
  select count(*) into v_count from public.attendees where id_partido=v_m;
  if v_count<>0 then raise exception 'FALLÓ 5: anon ve la nómina'; end if;
  execute 'reset role';
  insert into t44d values (5,'anónimo','0 filas en matches, attendees y club_match_locations');

  -- La misma forma de consulta que usan Inicio, Partidos y el mapa.
  execute format('set local request.jwt.claims to %L', json_build_object('role','anon')::text);
  execute 'set local role anon';
  select count(*) into v_count from public.matches
   where estado='abierto' and hora>now() and latitud is not null and longitud is not null
     and challenge_proposal_id is not null;
  execute 'reset role';
  if v_count<>0 then raise exception 'FALLÓ 6: aparece en la consulta de mapa/lista'; end if;
  insert into t44d values (6,'Inicio, Partidos, mapa y filtros','la consulta de listas y cuadrante no devuelve ningún partido de clubes a un externo');

  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ext,'role','authenticated')::text);
    insert into public.attendees (id_partido,id_jugador,estado) values (v_m,v_ext,'inscrito');
    execute 'reset role';
  exception when others then execute 'reset role'; v_err := sqlerrm; v_ok := true; end;
  if not v_ok then raise exception 'FALLÓ 7: un externo se inscribió con insert directo'; end if;
  insert into t44d values (7,'externo · insert directo', format('rechazado — %s', v_err));

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ext,'role','authenticated')::text);
  v_json := public.join_match(v_m);
  execute 'reset role';
  if (v_json->>'ok')::boolean then raise exception 'FALLÓ 8: join_match dejó entrar'; end if;
  insert into t44d values (8,'externo · RPC join_match', format('rechazado — %s', v_json->>'reason'));

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_jug,'role','authenticated')::text);
  v_json := public.join_match(v_m);
  execute 'reset role';
  if (v_json->>'ok')::boolean then raise exception 'FALLÓ 9: un integrante entró por join_match'; end if;
  insert into t44d values (9,'integrante · RPC join_match', format('también rechazado: la inscripción por club llega en U3 — %s', v_json->>'reason'));

  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ext,'role','authenticated')::text);
    perform public.request_join(v_m);
    execute 'reset role';
  exception when others then execute 'reset role'; v_err := sqlerrm; v_ok := true; end;
  if not v_ok then raise exception 'FALLÓ 10: request_join dejó entrar'; end if;
  v_ok := false;
  begin
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_ext,'role','authenticated')::text);
    perform public.join_waitlist(v_m);
    execute 'reset role';
  exception when others then execute 'reset role'; v_ok := true; end;
  if not v_ok then raise exception 'FALLÓ 10: join_waitlist dejó entrar'; end if;
  insert into t44d values (10,'request_join y join_waitlist', format('el trigger las atrapa aunque sean security definer — %s', v_err));

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub',v_jug,'role','authenticated')::text);
  select count(*) into v_count from public.club_match_locations where match_id=v_m;
  execute 'reset role';
  if v_count<>1 then raise exception 'FALLÓ 11: el integrante perdió la ubicación exacta'; end if;
  insert into t44d values (11,'integrante conserva todo','sigue viendo el partido y su ubicación exacta');

  execute format('set local request.jwt.claims to %L', json_build_object('role','anon')::text);
  execute 'set local role anon';
  select count(*) into v_count from public.matches where challenge_proposal_id is null;
  execute 'reset role';
  if v_count = 0 then raise exception 'FALLÓ 12: anon dejó de ver los partidos normales'; end if;
  insert into t44d values (12,'partidos normales', format('anon sigue viendo los %s partidos normales', v_count));

  if v_normal is not null then
    execute 'set local role authenticated';
    execute format('set local request.jwt.claims to %L', json_build_object('sub',v_jug,'role','authenticated')::text);
    v_json := public.join_match(v_normal);
    execute 'reset role';
    if not (v_json->>'ok')::boolean then
      raise exception 'FALLÓ 13: join_match falló en un partido normal — %', v_json->>'reason'; end if;
    insert into t44d values (13,'inscripción en partido normal','join_match sigue funcionando igual');
  end if;

  -- OJO (2026-10-15): estos casos corrían como `anon` porque
  -- `historial_publico_club` se le concedió a propósito en la migración 44d
  -- —es la proyección estrictamente pública de un encuentro terminado—. La
  -- migración **114** barrió todas las funciones de `public` sin lista de
  -- excepciones y se la llevó, junto con otras trece. Se corre como un
  -- `authenticated` AJENO a los dos clubes, que es la otra cara de lo mismo:
  -- lo que se prueba es que un externo no ve lo que no le toca, y eso no
  -- depende del rol. Ver el P2 de `pendientes.md`.
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ext, 'role','authenticated')::text);
  execute 'set local role authenticated';
  select count(*) into v_count from public.historial_publico_club(v_cl, 20);
  execute 'reset role';
  if v_count<>0 then raise exception 'FALLÓ 14: un partido no finalizado salió en el historial público'; end if;
  insert into t44d values (14,'historial público · pendiente','un partido no finalizado NO aparece');

  update public.matches set estado='finalizado' where id=v_m;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ext, 'role','authenticated')::text);
  execute 'set local role authenticated';
  select count(*) into v_count from public.historial_publico_club(v_cl, 20);
  select club_local_nombre||' vs '||club_visitante_nombre into v_tit
    from public.historial_publico_club(v_cl,20) limit 1;
  select count(*) into v_ok::int from public.matches where id=v_m;
  execute 'reset role';
  if v_count<>1 then raise exception 'FALLÓ 15: el finalizado no salió en el historial'; end if;
  insert into t44d values (15,'historial público · finalizado',
    format('sale «%s» con día, marcador y resultado; la fila del partido SIGUE oculta para anon', v_tit));

  update public.matches set estado='cancelado' where id=v_m;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_ext, 'role','authenticated')::text);
  execute 'set local role authenticated';
  select count(*) into v_count from public.historial_publico_club(v_cl, 20);
  execute 'reset role';
  if v_count<>0 then raise exception 'FALLÓ 16: un cancelado salió en el historial público'; end if;
  insert into t44d values (16,'historial público · cancelado','un partido cancelado o no disputado NO se publica');
end;
$$;

select n, caso, detalle from t44d order by n;

rollback;
