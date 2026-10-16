-- =============================================================
-- FutFinder — pruebas de la migración 162.
--
-- QUÉ SE PRUEBA (y, en los casos que se puede, QUE EL AGUJERO EXISTÍA):
--   C1. `matches.duracion_min` fuera de 10-300 se rechaza; 90 se acepta.
--       Control: sin la restricción, un partido de 5000 minutos entra.
--   C2. `matches.min_trust_score` fuera de 0-100 se rechaza; 0 se acepta.
--   C3. `profiles.estado` sólo admite 'activo' y 'suspendido'.
--   C4. `idx_profiles_username` existe.
--   C5. `idx_matches_con_reserva` NO existe, y el único que sí —
--       `matches_reserva_uidx`— sigue impidiendo dos partidos sobre la
--       misma reserva. Que sobre un índice no se prueba contándolo: se
--       prueba comprobando que lo que protegía lo sigue protegiendo otro.
--   C6. EL CASO QUE IMPORTA: un club que NO fue reportado no puede pedir
--       una revisión apoyándose en el informe de incomparecencia del OTRO.
--       Control: con el cuerpo viejo —sin `club_reportado_id = v_club`—
--       sí puede, y el expediente queda a nombre del club equivocado.
--   C7. Los dos textos del aviso de respuesta a un desafío son los que la
--       gente recibe hoy.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r162 (caso text, ok boolean, detalle text);
grant all on r162 to authenticated;

do $$
declare
  v_a uuid := gen_random_uuid();   -- admin del club reportante
  v_b uuid := gen_random_uuid();   -- admin del club reportado
  v_club_a uuid; v_club_b uuid; v_ch uuid; v_m uuid; v_res uuid;
  v_j json; v_err text; v_n int; v_def text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r162-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_a, v_b]) u;

  -- ── C1: la duración ────────────────────────────────────────────
  begin
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
        hora, cupos_totales, cupos_disponibles, duracion_min)
    values (v_a, 'r162 larguísimo', 'Santiago', 'Cancha', -33.45, -70.66,
        now() + interval '2 days', 10, 10, 5000);
    v_err := 'NO lo rechazó';
  exception when check_violation then v_err := 'rechazado'; end;
  insert into r162 values ('C1 un partido de 5000 minutos se rechaza', v_err = 'rechazado', v_err);

  begin
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
        hora, cupos_totales, cupos_disponibles, duracion_min)
    values (v_a, 'r162 cortísimo', 'Santiago', 'Cancha', -33.45, -70.66,
        now() + interval '2 days', 10, 10, 5);
    v_err := 'NO lo rechazó';
  exception when check_violation then v_err := 'rechazado'; end;
  insert into r162 values ('C1 y uno de 5 minutos también', v_err = 'rechazado', v_err);

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, duracion_min)
  values (v_a, 'r162 normal', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '2 days', 10, 10, 90)
  returning id into v_m;
  insert into r162 values ('C1 y uno de 90 sí entra', v_m is not null, coalesce(v_m::text, 'null'));

  -- El control, que es lo que convierte esto en una prueba: sin la
  -- restricción, los 5000 minutos entran. Se quita y se repone acá dentro,
  -- y la transacción lo revierte igual.
  alter table public.matches drop constraint matches_duracion_min_check;
  begin
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
        hora, cupos_totales, cupos_disponibles, duracion_min)
    values (v_a, 'r162 control', 'Santiago', 'Cancha', -33.45, -70.66,
        now() + interval '2 days', 10, 10, 5000);
    v_err := 'entró';
  exception when others then v_err := sqlerrm; end;
  insert into r162 values ('C1 CONTROL: sin la restricción el agujero estaba', v_err = 'entró', v_err);
  delete from public.matches where titulo = 'r162 control';
  alter table public.matches
    add constraint matches_duracion_min_check check (duracion_min >= 10 and duracion_min <= 300);

  -- ── C2: el trust score mínimo ──────────────────────────────────
  begin
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
        hora, cupos_totales, cupos_disponibles, min_trust_score)
    values (v_a, 'r162 negativo', 'Santiago', 'Cancha', -33.45, -70.66,
        now() + interval '2 days', 10, 10, -3);
    v_err := 'NO lo rechazó';
  exception when check_violation then v_err := 'rechazado'; end;
  insert into r162 values ('C2 min_trust_score -3 se rechaza', v_err = 'rechazado', v_err);

  begin
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
        hora, cupos_totales, cupos_disponibles, min_trust_score)
    values (v_a, 'r162 ciento uno', 'Santiago', 'Cancha', -33.45, -70.66,
        now() + interval '2 days', 10, 10, 101);
    v_err := 'NO lo rechazó';
  exception when check_violation then v_err := 'rechazado'; end;
  insert into r162 values ('C2 y 101 también', v_err = 'rechazado', v_err);

  -- ── C3: el estado del perfil ───────────────────────────────────
  begin
    update public.profiles set estado = 'cualquier_cosa' where id = v_a;
    v_err := 'NO lo rechazó';
  exception when check_violation then v_err := 'rechazado'; end;
  insert into r162 values ('C3 un estado inventado se rechaza', v_err = 'rechazado', v_err);

  update public.profiles set estado = 'suspendido' where id = v_a;
  update public.profiles set estado = 'activo' where id = v_a;
  insert into r162 values ('C3 y los dos de verdad se aceptan', true, 'activo y suspendido');

  -- ── C4 y C5: los índices ───────────────────────────────────────
  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'idx_profiles_username';
  insert into r162 values ('C4 idx_profiles_username existe', v_n = 1, v_n::text);

  select count(*) into v_n from pg_indexes
   where schemaname = 'public' and indexname = 'idx_matches_con_reserva';
  insert into r162 values ('C5 idx_matches_con_reserva ya no está', v_n = 0, v_n::text);

  -- Y lo que ese índice acompañaba lo sigue cuidando el único: dos
  -- partidos sobre la misma reserva se rechazan.
  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
  values (gen_random_uuid(), 'Recinto 162', 'Ñuñoa', -33.45, -70.60, true);
  insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
    precio_total, precio_cancha, modalidad, medio_pago, estado)
  select k.id, v_a, current_date + 3, time '10:00', time '11:00', 20000, 20000, 'completa', 'balance', 'armando'
    from public.canchas_reservables k limit 1
  returning id into v_res;
  if v_res is null then
    insert into public.canchas_reservables (complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
    select id, 'Cancha 162', 'futbol_7', 20000, 60, true from public.complejos where nombre = 'Recinto 162';
    insert into public.reservas (cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
      precio_total, precio_cancha, modalidad, medio_pago, estado)
    select k.id, v_a, current_date + 3, time '10:00', time '11:00', 20000, 20000, 'completa', 'balance', 'armando'
      from public.canchas_reservables k
      join public.complejos c on c.id = k.complejo_id
     where c.nombre = 'Recinto 162'
    returning id into v_res;
  end if;
  update public.matches set reserva_id = v_res where id = v_m;
  begin
    insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
        hora, cupos_totales, cupos_disponibles, reserva_id)
    values (v_a, 'r162 misma reserva', 'Santiago', 'Cancha', -33.45, -70.66,
        now() + interval '3 days', 10, 10, v_res);
    v_err := 'NO lo rechazó';
  exception when unique_violation then v_err := 'rechazado'; end;
  insert into r162 values ('C5 y la reserva sigue siendo de un solo partido', v_err = 'rechazado', v_err);

  -- ── C6: el informe del otro club no es el tuyo ─────────────────
  insert into public.clubs (nombre, slug, created_by)
  values ('Club A 162 ' || left(v_a::text, 8), 'club-a-162-' || left(v_a::text, 8), v_a)
  returning id into v_club_a;
  insert into public.clubs (nombre, slug, created_by)
  values ('Club B 162 ' || left(v_b::text, 8), 'club-b-162-' || left(v_b::text, 8), v_b)
  returning id into v_club_b;
  -- La nómina, no `created_by`: la función mira `club_members.rol = 'admin'`
  -- y sin esto el caso habría pasado por «no eres administrador», que es
  -- el rechazo equivocado. Lo delató el control.
  insert into public.club_members (club_id, user_id, rol) values (v_club_a, v_a, 'admin');
  insert into public.club_members (club_id, user_id, rol) values (v_club_b, v_b, 'admin');
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_club_a, v_club_b, v_a, 'aceptado')
  returning id into v_ch;

  -- A reporta a B. El encuentro NO está cancelado y B no tiene sanción:
  -- para B no hay nada que revisar.
  insert into public.club_match_noshow_reports
    (challenge_id, club_reportante_id, club_reportado_id, motivo, reportado_por)
  values (v_ch, v_club_a, v_club_b, 'No llegaron', v_a);

  -- Quien pide la revisión es A, que NO fue reportado.
  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch, 'Quiero que miren esto');
  execute 'reset role';
  insert into r162 values ('C6 el club NO reportado no se cuelga del informe ajeno',
    (v_j->>'ok') = 'false', v_j::text);

  select count(*) into v_n from public.club_sanction_reviews where challenge_id = v_ch;
  insert into r162 values ('C6 y no nació ninguna revisión', v_n = 0, v_n::text);

  -- CONTROL: con el cuerpo viejo —el del archivo 47c, sin el filtro— sí
  -- se cuelga. Se degrada la función acá dentro y la transacción lo revierte.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'solicitar_revision_sancion';
  v_def := replace(v_def,
    'from public.club_match_noshow_reports where challenge_id = v_row.id and club_reportado_id = v_club;',
    'from public.club_match_noshow_reports where challenge_id = v_row.id;');
  execute v_def;

  set local role authenticated;
  execute format('set local request.jwt.claims to %L',
                 json_build_object('sub', v_a, 'role', 'authenticated')::text);
  v_j := public.solicitar_revision_sancion(v_ch, 'Quiero que miren esto');
  execute 'reset role';
  insert into r162 values ('C6 CONTROL: con el cuerpo viejo sí se colgaba',
    (v_j->>'ok') = 'true', v_j::text);

  -- ── C7: los textos del aviso ───────────────────────────────────
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'notify_club_challenge_responded';
  insert into r162 values ('C7 el aviso de aceptación dice lo que la gente recibe hoy',
    position('Coordinen los detalles por el chat.' in v_def) > 0
      and position('Coordinen los detalles del partido' in v_def) = 0,
    'aceptado');
  insert into r162 values ('C7 y el de rechazo también',
    position('Puedes desafiar a otros equipos.' in v_def) > 0
      and position('desde tu club' in v_def) = 0,
    'rechazado');
end $$;

reset role;

select caso, case when ok then 'PASA' else 'FALLA' end as resultado, detalle
  from r162 order by caso;

do $$
declare v_malos integer; v_f record;
begin
  for v_f in select * from r162 where not ok order by caso loop
    raise warning 'FALLÓ (%): %', v_f.caso, v_f.detalle;
  end loop;
  select count(*) into v_malos from r162 where not ok;
  if v_malos > 0 then raise exception '% caso(s) de la migración 162 fallaron', v_malos; end if;
  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 162 PASARON ===';
end $$;

rollback;
