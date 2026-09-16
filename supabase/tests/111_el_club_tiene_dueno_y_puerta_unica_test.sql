-- =============================================================
-- FutFinder — pruebas de la migración 111.
--
-- Los seis agujeros que cierra, y —tanto o más importante— las ocho
-- cosas que TENÍAN que seguir funcionando. Un permiso se aprieta en
-- treinta segundos; lo que cuesta es apretarlo sin romper el camino
-- normal, y eso es lo que prueban las R.
--
--   Lo que ya no se puede
--   C1. El fundador expulsado no vuelve solo, y menos de admin.
--   C2. Un admin no reescribe el `user_id` de una fila de nómina.
--   C3. El único admin no se sale dejando el club huérfano.
--   C4. Un extraño no borra un club vacío.
--   C5. El fundador expulsado no borra el club entero.
--   C6. Salirse de un partido de clubes por la puerta normal no cobra
--       puntos: manda a la nómina, que es la puerta.
--
--   Lo que sigue igual
--   R1. Crear un club y quedar de admin.
--   R2. El creador deshace su club recién creado mientras no tenga a
--       nadie — es el rollback a mano de `createClub`.
--   R3. Un admin cambia el rol de un miembro.
--   R4. Un admin saca a un miembro.
--   R5. El último miembro se sale y el club se borra solo.
--   R6. Borrar un club CON nómina no se bloquea a sí mismo: el trigger
--       del admin tiene que dejar pasar el cascade.
--   R7. Salirse de un partido NORMAL sigue costando 3.
--   R8. Entrar a un club por solicitud aprobada sigue funcionando.
--
-- R6 y R8 son las que casi se rompen: el trigger nuevo se dispara en
-- cada baja, también en las que vienen de borrar el club, y la política
-- de inserción nueva habría bloqueado la entrada por solicitud si
-- `handle_club_request_approved` no fuera SECURITY DEFINER.
--
-- Requiere las migraciones hasta la 111 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
--
-- OJO: C6 usa un partido entre clubes REAL de la base. Cambia
-- `v_club_real` por uno vigente si el de referencia ya no existe; si no,
-- ese caso sale FALLA por falta de datos, no por un fallo del servidor.
-- =============================================================

begin;
create temp table r111 (caso text, ok boolean, detalle text);
grant all on r111 to authenticated;

do $$
declare
  v_fund uuid := gen_random_uuid(); v_jug uuid := gen_random_uuid();
  v_extr uuid := gen_random_uuid(); v_org uuid := gen_random_uuid();
  v_p1 uuid := gen_random_uuid(); v_p2 uuid := gen_random_uuid(); v_p3 uuid := gen_random_uuid();
  v_a uuid; v_b uuid; v_c uuid; v_e uuid; v_partido uuid; v_req uuid;
  v_n int; v_res jsonb; v_antes int; v_despues int;
  v_club_real uuid := '7b67f0d9-5c79-4c6a-979f-eaa521234f9f';
  v_socio uuid := '6494036a-9ab2-443e-8963-f216fc315074';
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r111-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_fund, v_jug, v_extr, v_org, v_p1, v_p2, v_p3]) u;

  -- Club A: el fundador cede la administración y se va del club.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_fund, 'role','authenticated')::text);
  insert into public.clubs (nombre, slug, created_by)
  values ('R111 A', 'r111-a-'||substr(v_fund::text,1,8), v_fund) returning id into v_a;
  insert into public.club_members (club_id, user_id, rol) values (v_a, v_fund, 'admin');

  reset role; set local request.jwt.claims to '{}';
  -- Premium para que el límite de 1 admin del plan estándar no enturbie
  -- C1: lo que se prueba ahí es el permiso, no el límite del plan.
  update public.clubs set plan = 'premium' where id = v_a;
  update public.club_members set rol = 'jugador' where club_id = v_a and user_id = v_fund;
  insert into public.club_members (club_id, user_id, rol) values (v_a, v_jug, 'admin');
  delete from public.club_members where club_id = v_a and user_id = v_fund;
  insert into public.club_members (club_id, user_id, rol) values (v_a, v_p1, 'jugador');

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_fund, 'role','authenticated')::text);
  begin
    insert into public.club_members (club_id, user_id, rol) values (v_a, v_fund, 'admin');
    insert into r111 values ('C1 el fundador expulsado ya no vuelve solo', false, 'SE REINSERTO');
  exception when others then
    insert into r111 values ('C1 el fundador expulsado ya no vuelve solo', true, sqlerrm);
  end;

  delete from public.clubs where id = v_a;
  get diagnostics v_n = row_count;
  insert into r111 values ('C5 el fundador expulsado ya no borra el club', v_n = 0, v_n::text || ' fila(s)');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_jug, 'role','authenticated')::text);
  begin
    update public.club_members set user_id = v_extr where club_id = v_a and user_id = v_p1;
    insert into r111 values ('C2 un admin ya no reescribe user_id', false, 'LO CAMBIO');
  exception when others then
    insert into r111 values ('C2 un admin ya no reescribe user_id', true, sqlerrm);
  end;

  begin
    delete from public.club_members where club_id = v_a and user_id = v_jug;
    insert into r111 values ('C3 el unico admin ya no deja el club huerfano', false, 'SE SALIO');
  exception when others then
    insert into r111 values ('C3 el unico admin ya no deja el club huerfano', true, sqlerrm);
  end;

  update public.club_members set rol = 'capitan' where club_id = v_a and user_id = v_p1;
  get diagnostics v_n = row_count;
  insert into r111 values ('R3 un admin sigue pudiendo cambiar el rol de un miembro', v_n = 1, v_n::text || ' fila(s)');

  delete from public.club_members where club_id = v_a and user_id = v_p1;
  get diagnostics v_n = row_count;
  insert into r111 values ('R4 un admin sigue pudiendo sacar a un miembro', v_n = 1, v_n::text || ' fila(s)');

  delete from public.club_members where club_id = v_a and user_id = v_jug;
  get diagnostics v_n = row_count;
  insert into r111 values ('R5 el ultimo miembro se sale y el club se borra solo',
    v_n = 1 and not exists (select 1 from public.clubs where id = v_a),
    v_n::text || ' fila(s); el club existe: ' || exists(select 1 from public.clubs where id = v_a)::text);

  -- Club B: vacío, para separar «borra un extraño» de «deshace su creador».
  reset role; set local request.jwt.claims to '{}';
  insert into public.clubs (nombre, slug, created_by)
  values ('R111 B', 'r111-b-'||substr(v_org::text,1,8), v_org) returning id into v_b;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_extr, 'role','authenticated')::text);
  delete from public.clubs where id = v_b;
  get diagnostics v_n = row_count;
  insert into r111 values ('C4 un extrano ya no borra un club vacio', v_n = 0, v_n::text || ' fila(s)');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role','authenticated')::text);
  delete from public.clubs where id = v_b;
  get diagnostics v_n = row_count;
  insert into r111 values ('R2 el creador si deshace su club recien creado sin nadie', v_n = 1, v_n::text || ' fila(s)');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_extr, 'role','authenticated')::text);
  insert into public.clubs (nombre, slug, created_by)
  values ('R111 C', 'r111-c-'||substr(v_extr::text,1,8), v_extr) returning id into v_c;
  insert into public.club_members (club_id, user_id, rol) values (v_c, v_extr, 'admin');
  insert into r111 values ('R1 crear un club y quedar de admin sigue funcionando',
    exists (select 1 from public.club_members where club_id = v_c and user_id = v_extr and rol='admin'), 'ok');

  reset role; set local request.jwt.claims to '{}';
  insert into public.club_members (club_id, user_id, rol) values (v_c, v_p2, 'jugador');
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_extr, 'role','authenticated')::text);
  begin
    delete from public.clubs where id = v_c;
    get diagnostics v_n = row_count;
    insert into r111 values ('R6 borrar un club CON nomina no se bloquea a si mismo', v_n = 1, v_n::text || ' fila(s)');
  exception when others then
    insert into r111 values ('R6 borrar un club CON nomina no se bloquea a si mismo', false, sqlerrm);
  end;

  reset role; set local request.jwt.claims to '{}';
  insert into public.clubs (nombre, slug, created_by)
  values ('R111 E', 'r111-e-'||substr(v_org::text,1,8), v_org) returning id into v_e;
  insert into public.club_members (club_id, user_id, rol) values (v_e, v_org, 'admin');
  insert into public.club_join_requests (club_id, user_id, tipo, status)
  values (v_e, v_p3, 'solicitud', 'pending') returning id into v_req;
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_org, 'role','authenticated')::text);
  update public.club_join_requests set status = 'approved' where id = v_req;
  insert into r111 values ('R8 entrar a un club por solicitud aprobada sigue funcionando',
    exists (select 1 from public.club_members where club_id = v_e and user_id = v_p3), 'ok');

  reset role; set local request.jwt.claims to '{}';
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, precio_cuota, estado, duracion_min, aprobacion, min_trust_score)
  values (v_org, 'R111 normal', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '3 days', 10, 9, 0, 'abierto', 60, 'inmediata', 0) returning id into v_partido;
  insert into public.attendees (id_partido, id_jugador, estado) values (v_partido, v_p1, 'inscrito');
  select trust_score into v_antes from public.profiles where id = v_p1;
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_p1, 'role','authenticated')::text);
  v_res := public.leave_match_penalized(v_partido);
  reset role; set local request.jwt.claims to '{}';
  select trust_score into v_despues from public.profiles where id = v_p1;
  insert into r111 values ('R7 salirse de un partido NORMAL sigue costando 3',
    (v_res->>'ok')::boolean and (v_res->>'penalty')::int = 3 and v_despues = v_antes - 3,
    'trust ' || v_antes || ' -> ' || v_despues || ' | ' || v_res::text);

  select trust_score into v_antes from public.profiles where id = v_socio;
  set local role authenticated;
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_socio, 'role','authenticated')::text);
  v_res := public.leave_match_penalized(v_club_real);
  reset role; set local request.jwt.claims to '{}';
  select trust_score into v_despues from public.profiles where id = v_socio;
  insert into r111 values ('C6 salirse de un partido de clubes por la puerta normal ya no cobra',
    (v_res->>'ok')::boolean is false and v_despues = v_antes
      and exists (select 1 from public.attendees where id_partido = v_club_real and id_jugador = v_socio),
    'trust ' || v_antes || ' -> ' || v_despues || ' | ' || v_res::text);
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r111 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r111;

rollback;
