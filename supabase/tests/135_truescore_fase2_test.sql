-- =============================================================
-- FutFinder — pruebas de la migración 135 (TrueScore, fase 2).
--
-- Tests obligatorios de `docs/truescore-spec.md` §6 que son de la fase 2:
-- 4 (reincidencia de plantones), 7 (tercera tardanza) y 11 (reclamo
-- aceptado que rehace puntaje, racha y reincidencia). Además: la ventana
-- parte de cero al activar la fase 2, los límites del reclamo, el bono al
-- organizador y la prioridad en la lista de espera.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r135 (caso text, ok boolean, detalle text);
grant all on r135 to authenticated;

create function pg_temp.usuario() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r135-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  return u;
end $$;
create function pg_temp.partido(p_org uuid, p_hora timestamptz, p_cupos int default 5) returns uuid language plpgsql as $$
declare m uuid;
begin
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (p_org, 'r135', 'Santiago', 'Cancha', -33.45, -70.66, now() + interval '90 days', p_cupos, p_cupos, 'abierto', 90, 'inmediata') returning id into m;
  update public.matches set hora = p_hora where id = m;
  return m;
end $$;
create function pg_temp.inscribir(p_match uuid, p_user uuid) returns void language sql as $$
  insert into public.attendees (id_partido, id_jugador, estado) values (p_match, p_user, 'inscrito');
$$;
create function pg_temp.ev(p_user uuid, p_tipo text) returns int language plpgsql as $$
begin
  return (public.truescore_registrar(p_user, null, p_tipo, 'r135:' || gen_random_uuid(), 'prueba')->>'puntaje')::int;
end $$;
create function pg_temp.ts(p_user uuid) returns int language sql as $$ select trust_score from public.profiles where id = p_user; $$;
create function pg_temp.racha(p_user uuid) returns int language sql as $$ select truescore_racha from public.profiles where id = p_user; $$;
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_res jsonb; v_n int; v_txt text; v_ok boolean; v_seq int[]; v_rec bigint;
  A uuid; T7 uuid; Z uuid; X uuid; Y uuid; Y2 uuid; OX uuid; FUERA uuid; V uuid;
  W2 uuid; W3 uuid; OW uuid; Q2 uuid; Q3 uuid; Q4 uuid; OQ uuid; OB uuid; B1j uuid; B2j uuid;
  P1 uuid; LA uuid; LB uuid; OL uuid;
  mx uuid; mw uuid; mq uuid; mb uuid; mb2 uuid; ml uuid;
begin
  perform public.truescore_activar_fase1();
  v_res := public.truescore_activar_fase2();
  insert into r135 values ('C00 la fase 2 se activa sobre la fase 1', (v_res->>'ok') = 'true', v_res::text);

  A := pg_temp.usuario(); T7 := pg_temp.usuario(); Z := pg_temp.usuario(); X := pg_temp.usuario();
  Y := pg_temp.usuario(); Y2 := pg_temp.usuario(); OX := pg_temp.usuario(); FUERA := pg_temp.usuario();
  V := pg_temp.usuario(); W2 := pg_temp.usuario(); W3 := pg_temp.usuario(); OW := pg_temp.usuario();
  Q2 := pg_temp.usuario(); Q3 := pg_temp.usuario(); Q4 := pg_temp.usuario(); OQ := pg_temp.usuario();
  OB := pg_temp.usuario(); B1j := pg_temp.usuario(); B2j := pg_temp.usuario();
  P1 := pg_temp.usuario(); LA := pg_temp.usuario(); LB := pg_temp.usuario(); OL := pg_temp.usuario();

  -- ── Test 4: «asiste 4, falta 1» tres veces ──────────────────
  v_seq := array[
    pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'planton'),
    pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'planton'),
    pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'planton')];
  insert into r135 values ('T04 ciclo 1 llega a 100 y el plantón deja 65; ciclo 2 a 100 y −53 deja 47; ciclo 3 a 83 y −70 deja 13',
    v_seq = array[81, 89, 99, 100, 65, 71, 79, 89, 100, 47, 53, 61, 71, 83, 13], v_seq::text);

  -- ── Test 7: tercera tardanza en 10 partidos ─────────────────
  v_seq := array[pg_temp.ev(T7, 'tarde'), pg_temp.ev(T7, 'asistio'), pg_temp.ev(T7, 'tarde'),
                 pg_temp.ev(T7, 'asistio'), pg_temp.ev(T7, 'tarde')];
  insert into r135 values ('T07 la tercera tardanza en 10 partidos vale −15 (71 → 56)',
    v_seq = array[67, 73, 65, 71, 56], v_seq::text);

  -- ── Al activar la fase 2 se parte de cero ───────────────────
  update public.feature_flags set activo = false where nombre = 'truescore_fase2';
  v_n := pg_temp.ev(Z, 'planton');
  update public.feature_flags set activo = true where nombre = 'truescore_fase2';
  v_seq := array[v_n, pg_temp.ev(Z, 'planton')];
  insert into r135 values ('C01 un plantón de antes de la fase 2 no cuenta: el primero después vale −35 (40 → 5)',
    v_seq = array[40, 5], v_seq::text);

  -- ── Test 11: reclamo aceptado ───────────────────────────────
  perform pg_temp.ev(X, 'asistio'); perform pg_temp.ev(X, 'asistio');          -- 89, racha 2
  mx := pg_temp.partido(OX, now() - interval '150 minutes');                    -- terminó hace 1 h
  perform pg_temp.inscribir(mx, X); perform pg_temp.inscribir(mx, Y); perform pg_temp.inscribir(mx, Y2);
  perform pg_temp.como(OX); set local role authenticated;
  v_res := public.save_match_attendance(mx, jsonb_build_object(X, 'no_fue', Y, 'asistio', Y2, 'asistio'));
  reset role;
  insert into r135 values ('C02 confirmar antes de 12 h le da +5 al organizador (75 → 80)',
    (v_res->>'bono')::int = 5 and pg_temp.ts(OX) = 80, v_res::text);
  insert into r135 values ('T11 previa: el plantón deja a X en 54', pg_temp.ts(X) = 54, pg_temp.ts(X)::text);
  v_seq := array[pg_temp.ev(X, 'asistio'), pg_temp.ev(X, 'planton'), pg_temp.ev(X, 'asistio')];
  insert into r135 values ('T11 previa: después asiste (60), vuelve a faltar con reincidencia (−53 → 7) y asiste (13)',
    v_seq = array[60, 7, 13], v_seq::text);

  perform pg_temp.como(X); set local role authenticated;
  v_res := public.truescore_reclamar(mx);
  reset role;
  v_rec := (v_res->>'reclamo_id')::bigint;
  insert into r135 values ('C03 el jugador marcado reclama dentro de 48 h', (v_res->>'ok') = 'true', v_res::text);

  perform pg_temp.como(X); set local role authenticated;
  v_res := public.truescore_confirmar_reclamo(v_rec);
  reset role;
  insert into r135 values ('C03 no puede confirmar su propio reclamo', (v_res->>'ok') = 'false', v_res::text);
  perform pg_temp.como(OX); set local role authenticated;
  v_res := public.truescore_confirmar_reclamo(v_rec);
  reset role;
  insert into r135 values ('C03 el organizador tampoco', (v_res->>'ok') = 'false', v_res::text);
  perform pg_temp.como(FUERA); set local role authenticated;
  v_res := public.truescore_confirmar_reclamo(v_rec);
  reset role;
  insert into r135 values ('C03 ni alguien que no jugó ese partido', (v_res->>'ok') = 'false', v_res::text);

  perform pg_temp.como(Y); set local role authenticated;
  v_res := public.truescore_confirmar_reclamo(v_rec);
  reset role;
  insert into r135 values ('C03 una confirmación no alcanza: el puntaje no cambia',
    (v_res->>'aceptado') = 'false' and pg_temp.ts(X) = 13, v_res::text);
  perform pg_temp.como(Y); set local role authenticated;
  v_res := public.truescore_confirmar_reclamo(v_rec);
  reset role;
  insert into r135 values ('C03 el mismo compañero no confirma dos veces', (v_res->>'already') = 'true', v_res::text);

  perform pg_temp.como(Y2); set local role authenticated;
  v_res := public.truescore_confirmar_reclamo(v_rec);
  reset role;
  insert into r135 values ('T11 con 2 compañeros se acepta', (v_res->>'aceptado') = 'true', v_res::text);
  insert into r135 values ('T11 el plantón pasa a asistencia y se rehace todo: 13 → 71, racha 1',
    pg_temp.ts(X) = 71 and pg_temp.racha(X) = 1, pg_temp.ts(X) || ' racha ' || pg_temp.racha(X));
  select (public.truescore_recalcular(X)->>'coincide')::boolean into v_ok;
  insert into r135 values ('T11 recalcular desde cero da lo mismo', v_ok, public.truescore_recalcular(X)::text);
  select puntos_aplicados into v_n from public.truescore_eventos
   where user_id = X and match_id = mx and tipo = 'planton';
  insert into r135 values ('T11 el evento original no se editó (sigue −35)', v_n = -35, v_n::text);
  select puntos_aplicados into v_n from public.truescore_eventos where user_id = X and tipo = 'reversion';
  insert into r135 values ('T11 la reversión lleva el cambio completo (+58)', v_n = 58, v_n::text);
  insert into r135 values ('T11 el organizador pierde 20 (80 → 60)', pg_temp.ts(OX) = 60, pg_temp.ts(OX)::text);
  select estado || ':' || asistencia into v_txt from public.attendees where id_partido = mx and id_jugador = X;
  insert into r135 values ('T11 la nómina queda con «Asistió»', v_txt = 'confirmado_gps:asistio', v_txt);
  perform pg_temp.como(X); set local role authenticated;
  v_res := public.truescore_reclamar(mx);
  reset role;
  insert into r135 values ('C03 una marca corregida no se reclama de nuevo', (v_res->>'ok') = 'false', v_res::text);
  v_n := pg_temp.ev(X, 'planton');
  insert into r135 values ('T11 la reincidencia posterior usa el historial corregido (1 plantón previo: −53 → 18)',
    v_n = 18, v_n::text);

  -- ── Límites del reclamo ─────────────────────────────────────
  insert into public.truescore_eventos (user_id, match_id, tipo, puntos_nominales, puntos_aplicados, puntaje_antes,
      puntaje_despues, racha_antes, racha_despues, motivo, detalle, clave, created_at)
  values (V, mx, 'planton', -35, 0, 75, 75, 0, 0, 'prueba', '{"fase2": true}', 'asistencia:r135-viejo', now() - interval '49 hours');
  perform pg_temp.como(V); set local role authenticated;
  v_res := public.truescore_reclamar(mx);
  reset role;
  insert into r135 values ('C04 pasadas 48 h desde la marca no se reclama', (v_res->>'ok') = 'false' and v_res->>'reason' like '%48%', v_res::text);

  mw := pg_temp.partido(OW, now() - interval '5 hours');
  perform pg_temp.inscribir(mw, W2); perform pg_temp.inscribir(mw, W3);
  perform pg_temp.como(OW); set local role authenticated;
  v_res := public.save_match_attendance(mw, jsonb_build_object(W2, 'tarde', W3, 'asistio'));
  reset role;
  perform pg_temp.como(W2); set local role authenticated;
  v_res := public.truescore_reclamar(mw);
  reset role;
  insert into r135 values ('C04 sin 2 compañeros que asistieran no se puede reclamar', (v_res->>'ok') = 'false', v_res::text);

  mq := pg_temp.partido(OQ, now() - interval '7 hours');
  perform pg_temp.inscribir(mq, Q2); perform pg_temp.inscribir(mq, Q3); perform pg_temp.inscribir(mq, Q4);
  perform pg_temp.como(OQ); set local role authenticated;
  v_res := public.save_match_attendance(mq, jsonb_build_object(Q2, 'tarde', Q3, 'asistio', Q4, 'tarde'));
  reset role;
  perform pg_temp.como(Q2); set local role authenticated;
  v_res := public.truescore_reclamar(mq);
  reset role;
  v_rec := (v_res->>'reclamo_id')::bigint;
  insert into r135 values ('C04 una tardanza también se puede reclamar', (v_res->>'ok') = 'true', v_res::text);
  update public.truescore_reclamos set vence_at = now() - interval '1 minute' where id = v_rec;
  v_n := public.truescore_cerrar_reclamos_vencidos();
  select estado into v_txt from public.truescore_reclamos where id = v_rec;
  insert into r135 values ('C04 el reclamo sin confirmar a tiempo se cierra como vencido', v_txt = 'vencido', v_txt);
  perform pg_temp.como(Q3); set local role authenticated;
  v_res := public.truescore_confirmar_reclamo(v_rec);
  reset role;
  insert into r135 values ('C04 y ya no se puede confirmar', (v_res->>'ok') = 'false', v_res::text);
  insert into r135 values ('C04 la marca se mantiene (75 − 8 = 67)', pg_temp.ts(Q2) = 67, pg_temp.ts(Q2)::text);

  -- ── Bono: +2 entre 12 y 24 h, nada si nadie asistió ─────────
  mb := pg_temp.partido(OB, now() - interval '14 hours 30 minutes');   -- terminó hace 13 h
  perform pg_temp.inscribir(mb, B1j);
  perform pg_temp.como(OB); set local role authenticated;
  v_res := public.save_match_attendance(mb, jsonb_build_object(B1j, 'asistio'));
  reset role;
  insert into r135 values ('C05 confirmar entre 12 y 24 h da +2 (75 → 77)', pg_temp.ts(OB) = 77, v_res::text);
  mb2 := pg_temp.partido(OB, now() - interval '3 hours');
  perform pg_temp.inscribir(mb2, B2j);
  perform pg_temp.como(OB); set local role authenticated;
  v_res := public.save_match_attendance(mb2, jsonb_build_object(B2j, 'no_fue'));
  reset role;
  insert into r135 values ('C05 si nadie asistió no hay bono', pg_temp.ts(OB) = 77 and (v_res->>'bono')::int = 0, v_res::text);

  -- ── Prioridad en la lista de espera ─────────────────────────
  perform pg_temp.ev(LB, 'asistio'); perform pg_temp.ev(LB, 'asistio'); perform pg_temp.ev(LB, 'asistio');   -- 99
  ml := pg_temp.partido(OL, now() + interval '4 days', 1);
  perform pg_temp.inscribir(ml, P1);
  -- Inscribir a mano no descuenta el cupo (eso lo hace la RPC): se deja
  -- lleno igual que en la 122, para que la salida de verdad libere uno.
  update public.matches set cupos_disponibles = 0 where id = ml;
  insert into public.match_waitlist (id_partido, id_jugador, created_at) values (ml, LA, now() - interval '2 hours');
  insert into public.match_waitlist (id_partido, id_jugador, created_at) values (ml, LB, now() - interval '1 hour');
  select string_agg(case l.id_jugador when LA then 'LA' when LB then 'LB' end || ':' || l.posicion || ':' || l.prioridad, ',' order by l.posicion)
    into v_txt from public.lista_de_espera(ml) l;
  insert into r135 values ('C06 «Muy confiable» va primero aunque llegó después', v_txt = 'LB:1:true,LA:2:false', v_txt);
  perform pg_temp.como(P1); set local role authenticated;
  v_res := public.leave_match_penalized(ml);
  reset role;
  select string_agg(case id_jugador when LA then 'LA' when LB then 'LB' end || ':' || (confirmar_antes_de is not null), ',' order by created_at)
    into v_txt from public.match_waitlist where id_partido = ml;
  insert into r135 values ('C06 al liberarse el cupo el turno es para él', v_txt = 'LA:false,LB:true', v_txt);
  update public.feature_flags set activo = false where nombre = 'truescore_fase2';
  select string_agg(case l.id_jugador when LA then 'LA' when LB then 'LB' end, ',' order by l.posicion)
    into v_txt from public.lista_de_espera(ml) l;
  insert into r135 values ('C06 sin fase 2 manda el orden de llegada', v_txt = 'LA,LB', v_txt);
  update public.feature_flags set activo = true where nombre = 'truescore_fase2';

  -- ── Recalcular y permisos ───────────────────────────────────
  select count(*) into v_n from unnest(array[A, T7, Z, X, Y, Y2, OX, W2, W3, OW, Q2, Q3, Q4, OQ, OB, B1j, B2j, LB, P1]) as uu(id)
   where not (public.truescore_recalcular(uu.id)->>'coincide')::boolean;
  insert into r135 values ('C07 recalcular desde cero coincide con el caché para todos', v_n = 0, v_n || ' no coinciden');

  select count(*) into v_n from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and (pr.proname like 'truescore%' or pr.proname = 'lista_de_espera')
     and has_function_privilege('anon', pr.oid, 'execute');
  insert into r135 values ('C08 anon no ejecuta ninguna función de TrueScore', v_n = 0, v_n::text);
  select string_agg(pr.proname, ',') into v_txt from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public'
     and pr.proname in ('truescore_aplicar_reclamo', 'truescore_repasar', 'truescore_ventana', 'truescore_calcular',
                        'truescore_cerrar_reclamos_vencidos', 'truescore_activar_fase2', 'truescore_registrar')
     and has_function_privilege('authenticated', pr.oid, 'execute');
  insert into r135 values ('C08 authenticated no llega a las funciones internas', v_txt is null, coalesce(v_txt, 'ninguna'));
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r135 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle from r135 where not ok;
    raise exception 'FALLARON % casos de la 135: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r135 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r135;

rollback;
