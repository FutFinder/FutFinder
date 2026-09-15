-- =============================================================
-- FutFinder — pruebas de la migración 105.
--
-- EL CASO QUE IMPORTA: la app promete «se liberó un cupo, tienes 30 min para
-- confirmarlo» y no había nada detrás. Cualquiera podía llevarse ese cupo por
-- delante, el plazo no vencía nunca, si el avisado se iba nadie despertaba al
-- siguiente, y al liberarse dos cupos se avisaba a uno solo.
--
--   P1. Al liberarse un cupo, el primero de la cola recibe turno con plazo.
--   P2. Y solo él: un cupo, un avisado.
--   P3. Un tercero NO puede tomar el cupo reservado.
--   P4. El dueño del turno sí, y al entrar sale de la cola.
--   P5. Salir de la cola con el turno en la mano despierta al siguiente.
--   P6. El plazo vencido pierde el lugar, con aviso, y la cola avanza.
--   P7. Dos cupos de golpe avisan a dos, no a uno ni a tres.
--   P8. Ampliar un partido lleno lo reabre (hallazgo 10).
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r105 (caso text, ok boolean, detalle text);
grant all on r105 to authenticated;

do $$
declare
  v_org uuid := gen_random_uuid();
  v_in1 uuid := gen_random_uuid();
  v_in2 uuid := gen_random_uuid();
  v_c1  uuid := gen_random_uuid();   -- primero de la cola
  v_c2  uuid := gen_random_uuid();
  v_c3  uuid := gen_random_uuid();
  v_ajeno uuid := gen_random_uuid(); -- nunca estuvo en la cola
  v_p uuid; v_res jsonb; v_libres int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r105-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_in1, v_in2, v_c1, v_c2, v_c3, v_ajeno]) u;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r105 la cola', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 day', 2, 2, 'abierto', 90, 'inmediata')
  returning id into v_p;

  set local role authenticated;

  -- Se llena el partido y se forma la cola, en orden.
  perform set_config('request.jwt.claims', json_build_object('sub', v_in1, 'role', 'authenticated')::text, true);
  perform public.join_match(v_p);
  perform set_config('request.jwt.claims', json_build_object('sub', v_in2, 'role', 'authenticated')::text, true);
  perform public.join_match(v_p);
  perform set_config('request.jwt.claims', json_build_object('sub', v_c1, 'role', 'authenticated')::text, true);
  perform public.join_waitlist(v_p);
  perform set_config('request.jwt.claims', json_build_object('sub', v_c2, 'role', 'authenticated')::text, true);
  perform public.join_waitlist(v_p);
  perform set_config('request.jwt.claims', json_build_object('sub', v_c3, 'role', 'authenticated')::text, true);
  perform public.join_waitlist(v_p);

  -- Se sale un inscrito: se libera UN cupo.
  perform set_config('request.jwt.claims', json_build_object('sub', v_in1, 'role', 'authenticated')::text, true);
  perform public.leave_match_penalized(v_p);

  reset role;
  insert into r105 values ('P1 el primero de la cola recibe turno con plazo',
    exists (select 1 from public.match_waitlist
             where id_partido = v_p and id_jugador = v_c1 and confirmar_antes_de > now()),
    coalesce((select 'faltan ' || extract(minute from confirmar_antes_de - now())::int || ' min'
                from public.match_waitlist where id_partido = v_p and id_jugador = v_c1), 'sin turno'));

  insert into r105 values ('P2 un cupo, un avisado',
    (select count(*) from public.match_waitlist where id_partido = v_p and avisado_at is not null) = 1,
    (select count(*)::text from public.match_waitlist where id_partido = v_p and avisado_at is not null));

  insert into r105 values ('P2b con su aviso',
    (select count(*) from public.notifications
      where user_id = v_c1 and type = 'waitlist_turn' and data->>'matchId' = v_p::text) = 1,
    'una notificación');

  -- P3: alguien que pasaba por ahí.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text, true);
  v_res := public.join_match(v_p)::jsonb;
  insert into r105 values ('P3 un tercero no toma el cupo reservado',
    (v_res->>'ok') = 'false', v_res->>'reason');

  -- P4: el dueño del turno.
  perform set_config('request.jwt.claims', json_build_object('sub', v_c1, 'role', 'authenticated')::text, true);
  v_res := public.join_match(v_p)::jsonb;
  insert into r105 values ('P4 el dueño del turno toma su cupo',
    (v_res->>'ok') = 'true', coalesce(v_res->>'reason', 'entró'));

  reset role;
  insert into r105 values ('P4b y sale de la cola al entrar',
    not exists (select 1 from public.match_waitlist where id_partido = v_p and id_jugador = v_c1),
    'fuera de la cola');

  -- P5: se libera otro cupo, le toca al segundo, y el segundo se va.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_in2, 'role', 'authenticated')::text, true);
  perform public.leave_match_penalized(v_p);
  perform set_config('request.jwt.claims', json_build_object('sub', v_c2, 'role', 'authenticated')::text, true);
  perform public.leave_waitlist(v_p);

  reset role;
  insert into r105 values ('P5 salir con el turno despierta al siguiente',
    exists (select 1 from public.match_waitlist
             where id_partido = v_p and id_jugador = v_c3 and confirmar_antes_de > now()),
    'el tercero quedó con turno');

  -- P6: al tercero se le pasa el plazo. Lo vence el barrido, no una pantalla.
  update public.match_waitlist set confirmar_antes_de = now() - interval '1 minute'
   where id_partido = v_p and id_jugador = v_c3;
  perform public.barrer_lista_de_espera();

  insert into r105 values ('P6 el plazo vencido pierde el lugar',
    not exists (select 1 from public.match_waitlist where id_partido = v_p and id_jugador = v_c3),
    'fuera de la cola');
  insert into r105 values ('P6b y se le avisa que se le pasó',
    (select count(*) from public.notifications
      where user_id = v_c3 and type = 'waitlist_turno_vencido') = 1, 'una notificación');

  -- P7 y P8: el partido vuelve a llenarse y se amplía de golpe.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_in1, 'role', 'authenticated')::text, true);
  perform public.join_match(v_p);
  perform set_config('request.jwt.claims', json_build_object('sub', v_c2, 'role', 'authenticated')::text, true);
  perform public.join_waitlist(v_p);
  perform set_config('request.jwt.claims', json_build_object('sub', v_c3, 'role', 'authenticated')::text, true);
  perform public.join_waitlist(v_p);
  perform set_config('request.jwt.claims', json_build_object('sub', v_ajeno, 'role', 'authenticated')::text, true);
  perform public.join_waitlist(v_p);

  reset role;
  update public.matches set cupos_totales = 4 where id = v_p;

  insert into r105 values ('P7 dos cupos de golpe avisan a dos',
    (select count(*) from public.match_waitlist where id_partido = v_p and confirmar_antes_de > now()) = 2,
    (select count(*)::text from public.match_waitlist where id_partido = v_p and confirmar_antes_de > now()));

  select cupos_disponibles into v_libres from public.matches where id = v_p;
  insert into r105 values ('P8 ampliar un partido lleno lo reabre',
    (select estado from public.matches where id = v_p) = 'abierto' and v_libres = 2,
    (select estado || ' con ' || cupos_disponibles || ' libres' from public.matches where id = v_p));
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r105 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r105;

rollback;
