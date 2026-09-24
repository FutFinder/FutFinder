-- =============================================================
-- FutFinder — pruebas de la migración 136 (TrueScore fase 3: fair play).
--
-- Test obligatorio 13 de `docs/truescore-spec.md` §6 (un reporte de quien
-- tiene TrueScore 70 no cuenta) y el resto de §3: +1 sin reportes válidos,
-- −15 con 3 o más, nada con 1 o 2, agresión confirmada por el organizador
-- (−40 y revisión), un reporte por persona y partido, plazo de 48 h, y que
-- el cierre no cobre dos veces.
--
-- EL PASO DEL TIEMPO: los partidos se juegan hace pocas horas para poder
-- confirmar la asistencia y reportar dentro de plazo, y después se corren
-- 48 h hacia atrás para que el job cierre su plazo de reportes.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r136 (caso text, ok boolean, detalle text);
grant all on r136 to authenticated;

create function pg_temp.usuario() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r136-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  return u;
end $$;
create function pg_temp.partido(p_org uuid, p_hora timestamptz) returns uuid language plpgsql as $$
declare m uuid;
begin
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (p_org, 'r136', 'Santiago', 'Cancha', -33.45, -70.66, now() + interval '90 days', 8, 8, 'abierto', 90, 'inmediata') returning id into m;
  update public.matches set hora = p_hora where id = m;
  return m;
end $$;
create function pg_temp.inscribir(p_match uuid, p_user uuid) returns void language sql as $$
  insert into public.attendees (id_partido, id_jugador, estado) values (p_match, p_user, 'inscrito');
$$;
create function pg_temp.fp(p_user uuid) returns int language sql as $$ select fairplay_score from public.profiles where id = p_user; $$;
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_res jsonb; v_n int; v_txt text; v_ok boolean; v_rep bigint; v_err text;
  O uuid; P uuid; R1 uuid; R2 uuid; R3 uuid; R5 uuid; Q uuid; FUERA uuid;
  ma uuid; mb uuid; mc uuid; md uuid; mf uuid;
begin
  perform public.truescore_activar_fase1();
  v_res := public.truescore_activar_fase3();
  insert into r136 values ('C00 la fase 3 se activa sobre la fase 1', (v_res->>'ok') = 'true', v_res::text);
  update public.feature_flags set activado_at = now() - interval '10 days' where nombre = 'truescore_fase3';

  O := pg_temp.usuario(); P := pg_temp.usuario(); R1 := pg_temp.usuario(); R2 := pg_temp.usuario();
  R3 := pg_temp.usuario(); R5 := pg_temp.usuario(); Q := pg_temp.usuario(); FUERA := pg_temp.usuario();
  insert into r136 values ('C00 el fair play parte en 100', pg_temp.fp(P) = 100, pg_temp.fp(P)::text);

  ma := pg_temp.partido(O, now() - interval '3 hours');
  mb := pg_temp.partido(O, now() - interval '6 hours');
  mc := pg_temp.partido(O, now() - interval '9 hours');
  md := pg_temp.partido(O, now() - interval '12 hours');
  mf := pg_temp.partido(O, now() + interval '5 days');
  perform pg_temp.inscribir(ma, P); perform pg_temp.inscribir(ma, R1); perform pg_temp.inscribir(ma, R2);
  perform pg_temp.inscribir(mb, P); perform pg_temp.inscribir(mb, R1); perform pg_temp.inscribir(mb, R3); perform pg_temp.inscribir(mb, R5);
  perform pg_temp.inscribir(mc, P); perform pg_temp.inscribir(mc, Q);
  perform pg_temp.inscribir(md, P); perform pg_temp.inscribir(md, R1); perform pg_temp.inscribir(md, R2);
  perform pg_temp.inscribir(mf, P); perform pg_temp.inscribir(mf, R1);

  perform pg_temp.como(O); set local role authenticated;
  perform public.save_match_attendance(ma, jsonb_build_object(P, 'asistio', R1, 'asistio', R2, 'asistio'));
  perform public.save_match_attendance(mb, jsonb_build_object(P, 'asistio', R1, 'asistio', R3, 'asistio', R5, 'no_fue'));
  perform public.save_match_attendance(mc, jsonb_build_object(P, 'asistio', Q, 'asistio'));
  perform public.save_match_attendance(md, jsonb_build_object(P, 'asistio', R1, 'asistio', R2, 'asistio'));
  reset role;

  -- R3 con TrueScore 70 (test 13); R5 con TrueScore alto pero no jugó.
  update public.profiles set trust_score = 70 where id = R3;
  update public.profiles set trust_score = 90 where id = R5;

  -- ── Reportes del partido A: 3 válidos, uno del organizador ──
  perform pg_temp.como(R1); set local role authenticated;
  v_res := public.fairplay_reportar(ma, P, 'juego_brusco');
  reset role;
  insert into r136 values ('C01 un jugador reporta a un compañero', (v_res->>'ok') = 'true', v_res::text);
  perform pg_temp.como(R1); set local role authenticated;
  v_res := public.fairplay_reportar(ma, P, 'antideportivo');
  reset role;
  insert into r136 values ('C01 sólo una vez a la misma persona por partido', (v_res->>'ok') = 'false', v_res::text);
  perform pg_temp.como(R2); set local role authenticated;
  v_res := public.fairplay_reportar(ma, P, 'antideportivo');
  reset role;
  perform pg_temp.como(O); set local role authenticated;
  v_res := public.fairplay_reportar(ma, P, 'juego_brusco', 'Entró fuerte toda la tarde');
  reset role;
  insert into r136 values ('C01 el organizador también puede reportar', (v_res->>'ok') = 'true', v_res::text);

  perform pg_temp.como(P); set local role authenticated;
  v_res := public.fairplay_reportar(ma, P, 'juego_brusco');
  reset role;
  insert into r136 values ('C01 nadie se reporta a sí mismo', (v_res->>'ok') = 'false', v_res::text);
  perform pg_temp.como(FUERA); set local role authenticated;
  v_res := public.fairplay_reportar(ma, P, 'juego_brusco');
  reset role;
  insert into r136 values ('C01 quien no estaba en el partido no reporta', (v_res->>'ok') = 'false', v_res::text);
  perform pg_temp.como(R1); set local role authenticated;
  v_res := public.fairplay_reportar(mf, P, 'juego_brusco');
  reset role;
  insert into r136 values ('C01 no se reporta antes de que termine el partido', (v_res->>'ok') = 'false', v_res::text);

  -- ── Partido B: un válido, uno de TrueScore 70, uno de quien no jugó ──
  perform pg_temp.como(R1); set local role authenticated;
  perform public.fairplay_reportar(mb, P, 'juego_brusco');
  reset role;
  perform pg_temp.como(R3); set local role authenticated;
  v_res := public.fairplay_reportar(mb, P, 'antideportivo');
  reset role;
  v_rep := (v_res->>'reporte_id')::bigint;
  insert into r136 values ('T13 el reporte de un jugador con TrueScore 70 no cuenta',
    (v_res->>'ok') = 'true' and not public.fairplay_reporte_valido(v_rep), v_res::text);
  perform pg_temp.como(R5); set local role authenticated;
  v_res := public.fairplay_reportar(mb, P, 'antideportivo');
  reset role;
  insert into r136 values ('C02 tampoco cuenta el de quien no jugó (aunque tenga 90)',
    not public.fairplay_reporte_valido((v_res->>'reporte_id')::bigint), v_res::text);

  -- ── Partido D: agresión física ──
  perform pg_temp.como(R1); set local role authenticated;
  v_res := public.fairplay_reportar(md, P, 'agresion_fisica');
  reset role;
  v_rep := (v_res->>'reporte_id')::bigint;
  perform pg_temp.como(R2); set local role authenticated;
  v_res := public.fairplay_confirmar_agresion(v_rep);
  reset role;
  insert into r136 values ('C03 sólo el organizador confirma una agresión', (v_res->>'ok') = 'false' and pg_temp.fp(P) = 100, v_res::text);
  perform pg_temp.como(O); set local role authenticated;
  select count(*) into v_n from public.fairplay_agresiones_del_partido(md);
  v_res := public.fairplay_confirmar_agresion(v_rep);
  reset role;
  insert into r136 values ('C03 el organizador ve la agresión reportada', v_n = 1, v_n::text);
  select fairplay_revision into v_ok from public.profiles where id = P;
  insert into r136 values ('C03 confirmada: −40 (100 → 60) y la cuenta queda en revisión',
    pg_temp.fp(P) = 60 and v_ok, v_res::text || ' revisión ' || v_ok);
  perform pg_temp.como(O); set local role authenticated;
  v_res := public.fairplay_confirmar_agresion(v_rep);
  reset role;
  insert into r136 values ('C03 confirmar dos veces no resta dos veces', (v_res->>'already') = 'true' and pg_temp.fp(P) = 60, v_res::text);
  select count(*) into v_n from public.fairplay_revisiones where user_id = P and estado = 'pendiente';
  insert into r136 values ('C03 hay una revisión pendiente', v_n = 1, v_n::text);

  -- ── El organizador no escapa escribiendo la columna ──
  begin
    perform pg_temp.como(O); set local role authenticated;
    update public.matches set fairplay_cerrado_at = now() where id = ma;
    reset role;
    v_err := 'lo dejó pasar';
  exception when others then reset role; v_err := sqlerrm; end;
  insert into r136 values ('C04 el cierre del fair play no se escribe a mano', v_err like '%COLUMNA_PROTEGIDA%', v_err);

  -- ── Pasan las 48 h: cierre ──
  update public.matches set hora = hora - interval '48 hours' where id in (ma, mb, mc, md);
  v_n := public.fairplay_cerrar_partidos();
  insert into r136 values ('C05 A: 3 reportes válidos restan 15 (60 → 45); B: 1 válido no resta; C: limpio suma 1 (46); D: 1 válido, nada',
    pg_temp.fp(P) = 46, pg_temp.fp(P)::text);
  -- Por tipo y no por id: el job recorre los partidos por su uuid.
  select string_agg(tipo || ':' || puntos_aplicados, ',' order by tipo) into v_txt from public.fairplay_eventos where user_id = P;
  insert into r136 values ('C05 el registro dice exactamente eso', v_txt = 'agresion:-40,partido_limpio:1,reportes:-15', v_txt);
  insert into r136 values ('C05 en 100, un partido limpio deja 100', pg_temp.fp(Q) = 100, pg_temp.fp(Q)::text);
  select count(*) into v_n from public.fairplay_eventos where user_id = R5;
  insert into r136 values ('C05 quien no jugó no recibe el +1', v_n = 0, v_n::text);

  v_n := public.fairplay_cerrar_partidos();
  insert into r136 values ('C05 correr el cierre otra vez no cobra dos veces', pg_temp.fp(P) = 46, pg_temp.fp(P)::text);
  perform pg_temp.como(R2); set local role authenticated;
  v_res := public.fairplay_reportar(mb, P, 'juego_brusco');
  reset role;
  insert into r136 values ('C05 pasadas las 48 h no se reporta', (v_res->>'ok') = 'false', v_res::text);

  select (public.fairplay_recalcular(P)->>'coincide')::boolean into v_ok;
  insert into r136 values ('C06 recalcular el fair play desde cero da lo mismo', v_ok, public.fairplay_recalcular(P)::text);

  select id into v_rep from public.fairplay_revisiones where user_id = P and estado = 'pendiente';
  v_res := public.fairplay_resolver_revision(v_rep, 'Revisado');
  select fairplay_revision into v_ok from public.profiles where id = P;
  insert into r136 values ('C07 resolver la revisión quita la marca', (v_res->>'ok') = 'true' and not v_ok, v_res::text);

  -- ── Permisos y flag ──
  select count(*) into v_n from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and (pr.proname like 'fairplay%' or pr.proname = 'truescore_activar_fase3')
     and has_function_privilege('anon', pr.oid, 'execute');
  insert into r136 values ('C08 anon no ejecuta nada de fair play', v_n = 0, v_n::text);
  select string_agg(pr.proname, ',') into v_txt from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public'
     and pr.proname in ('fairplay_registrar', 'fairplay_calcular', 'fairplay_recalcular', 'fairplay_cerrar_partidos',
                        'fairplay_resolver_revision', 'fairplay_jugo', 'fairplay_reporte_valido', 'truescore_activar_fase3')
     and has_function_privilege('authenticated', pr.oid, 'execute');
  insert into r136 values ('C08 authenticated no llega a las funciones internas', v_txt is null, coalesce(v_txt, 'ninguna'));

  update public.feature_flags set activo = false where nombre = 'truescore_fase3';
  perform pg_temp.como(R2); set local role authenticated;
  v_res := public.fairplay_reportar(md, P, 'juego_brusco');
  reset role;
  insert into r136 values ('C09 con el flag apagado no hay reportes', (v_res->>'ok') = 'false', v_res::text);
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r136 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle from r136 where not ok;
    raise exception 'FALLARON % casos de la 136: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r136 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r136;

rollback;
