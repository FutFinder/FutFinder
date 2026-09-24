-- =============================================================
-- FutFinder — pruebas de la migración 134 (TrueScore, fase 1).
--
-- Cubre los tests obligatorios de `docs/truescore-spec.md` §6 que son de la
-- fase 1 —1, 2, 3, 5, 6, 8, 9, 10, 12 y 14— y las decisiones aprobadas:
-- cancelación del organizador con 12 h de corte, expulsión sin puntos y sin
-- vuelta, columnas protegidas, GPS sin puntos, sin suspensión automática,
-- mínimo del organizador vigente, teléfono detrás de su flag, y la rama
-- vieja intacta con el flag apagado.
--
-- Los tests 4, 7 y 11 (reincidencia y reclamos) son de la fase 2 y el 13
-- (fair play) de la fase 3: se escriben con su fase.
--
-- LAS SECUENCIAS DE PUNTAJE (tests 1, 2, 3, 8) pasan por
-- `truescore_registrar`, la única puerta de escritura. Las salidas, la
-- cancelación, la asistencia y el job pasan por sus RPC de verdad, con el
-- usuario autenticado que corresponde. `now()` es fijo dentro de la
-- transacción, así que «5 h antes» son exactamente 5 h y el redondeo se
-- prueba sin ruido del reloj.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK. Si algún caso
-- falla, el bloque final lanza una excepción con la lista.
-- =============================================================

begin;

create temp table r134 (caso text, ok boolean, detalle text);
grant all on r134 to authenticated;

-- Ayudantes (sólo se llaman como postgres).
create function pg_temp.usuario() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
    'r134-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  return u;
end $$;

create function pg_temp.partido(p_org uuid, p_hora timestamptz, p_min_trust int default 0)
returns uuid language plpgsql as $$
declare m uuid;
begin
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion, min_trust_score)
  values (p_org, 'r134', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '90 days', 5, 5, 'abierto', 90, 'inmediata', p_min_trust)
  returning id into m;
  -- La hora se mueve después: `trg_match_future_only` no deja nacer en el pasado.
  update public.matches set hora = p_hora where id = m;
  return m;
end $$;

create function pg_temp.inscribir(p_match uuid, p_user uuid) returns void language sql as $$
  insert into public.attendees (id_partido, id_jugador, estado) values (p_match, p_user, 'inscrito');
$$;

create function pg_temp.ev(p_user uuid, p_tipo text, p_horas numeric default null)
returns int language plpgsql as $$
begin
  return (public.truescore_registrar(p_user, null, p_tipo, 'r134:' || gen_random_uuid(),
          'prueba', p_horas)->>'puntaje')::int;
end $$;

create function pg_temp.ts(p_user uuid) returns int language sql as $$
  select trust_score from public.profiles where id = p_user;
$$;

create function pg_temp.racha(p_user uuid) returns int language sql as $$
  select truescore_racha from public.profiles where id = p_user;
$$;

create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_pre int; v_n int; v_ok boolean; v_txt text; v_res jsonb; v_gps json; v_err text;
  v_seq int[];
  A uuid; B uuid; C uuid; C2 uuid; D uuid; E uuid; F uuid; G uuid; H uuid; I uuid;
  J uuid; K uuid; L uuid; N uuid; P uuid; Q uuid; R uuid; S uuid; T uuid;
  U uuid; V uuid; W uuid; X uuid;
  O uuid; O2 uuid; O3 uuid; O4 uuid; O5 uuid; O6 uuid; O7 uuid;
  m1 uuid; m2 uuid; m3 uuid; m4 uuid; m5 uuid; m6 uuid; m7 uuid; m8 uuid; m9 uuid;
  m10 uuid; m11 uuid; m12 uuid; m13 uuid; m14 uuid; m15 uuid; m16 uuid; m17 uuid;
  m18 uuid; m19 uuid; m20 uuid; m21 uuid; m22 uuid; m23 uuid;
begin
  -- ── Activación ───────────────────────────────────────────────
  select count(*) into v_pre from public.profiles;
  v_res := public.truescore_activar_fase1();
  select count(*) into v_n from public.profiles where trust_score <> 75;
  insert into r134 values ('C00 activar deja a TODOS los perfiles existentes en 75',
    v_n = 0 and (v_res->>'perfiles')::int = v_pre, v_res::text || ' distintos de 75: ' || v_n);
  select count(*) into v_n from public.truescore_eventos where tipo = 'inicio';
  insert into r134 values ('C00 cada perfil tiene su evento inicio', v_n = v_pre, v_n || '/' || v_pre);
  v_res := public.truescore_activar_fase1();
  select count(*) into v_n from public.truescore_eventos where tipo = 'inicio';
  insert into r134 values ('C00 activar dos veces no duplica el inicio', v_n = v_pre, v_n::text);

  -- El job de 24 h sólo barre plazos vencidos DESPUÉS de activar. Se corre
  -- la fecha 3 h atrás para poder probarlo con un partido de ayer.
  update public.feature_flags set activado_at = now() - interval '3 hours'
   where nombre = 'truescore_fase1';

  A := pg_temp.usuario(); B := pg_temp.usuario(); C := pg_temp.usuario(); C2 := pg_temp.usuario();
  D := pg_temp.usuario(); E := pg_temp.usuario(); F := pg_temp.usuario(); G := pg_temp.usuario();
  H := pg_temp.usuario(); I := pg_temp.usuario(); J := pg_temp.usuario(); K := pg_temp.usuario();
  L := pg_temp.usuario(); N := pg_temp.usuario(); P := pg_temp.usuario();
  Q := pg_temp.usuario(); R := pg_temp.usuario(); S := pg_temp.usuario(); T := pg_temp.usuario();
  U := pg_temp.usuario(); V := pg_temp.usuario(); W := pg_temp.usuario(); X := pg_temp.usuario();
  O := pg_temp.usuario(); O2 := pg_temp.usuario(); O3 := pg_temp.usuario(); O4 := pg_temp.usuario();
  O5 := pg_temp.usuario(); O6 := pg_temp.usuario(); O7 := pg_temp.usuario();

  insert into r134 values ('C00 una cuenta nueva parte en 75 y racha 0',
    pg_temp.ts(A) = 75 and pg_temp.racha(A) = 0, pg_temp.ts(A) || '/' || pg_temp.racha(A));

  -- ── Interpolación de la salida (§1.2) ────────────────────────
  select array_agg(public.truescore_penalizacion_salida(tt.horas) order by tt.orden)
    into v_seq
    from unnest(array[5, 3, 8, 36, 0, 2, 4, 6, 12, 24, 48, 100]::numeric[])
         with ordinality as tt(horas, orden);
  insert into r134 values ('C01 5h=13 3h=19 8h=9 36h=3 y los puntos de la tabla',
    v_seq = array[13, 19, 9, 3, 28, 23, 15, 10, 7, 4, 1, 1], v_seq::text);

  -- ── Test 1: nuevo asiste 4 seguidos ──────────────────────────
  v_seq := array[pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio'),
                 pg_temp.ev(A, 'asistio'), pg_temp.ev(A, 'asistio')];
  insert into r134 values ('T01 75 -> 81 -> 89 -> 99 -> 100', v_seq = array[81, 89, 99, 100], v_seq::text);

  -- ── Test 8: en 100 una asistencia deja 100 ───────────────────
  v_n := pg_temp.ev(A, 'asistio');
  select puntos_aplicados into v_pre from public.truescore_eventos where user_id = A order by id desc limit 1;
  insert into r134 values ('T08 en 100 asistir deja 100 (aplicado 0, racha 5)',
    v_n = 100 and v_pre = 0 and pg_temp.racha(A) = 5, v_n || ' aplicado ' || v_pre || ' racha ' || pg_temp.racha(A));

  -- ── Test 2 y 3 ───────────────────────────────────────────────
  v_n := pg_temp.ev(B, 'planton');
  insert into r134 values ('T02 nuevo no asiste sin avisar: 75 -> 40', v_n = 40, v_n::text);
  v_seq := array[pg_temp.ev(B, 'asistio'), pg_temp.ev(B, 'asistio'),
                 pg_temp.ev(B, 'asistio'), pg_temp.ev(B, 'asistio')];
  insert into r134 values ('T03 desde 40, 4 seguidos: 46 -> 54 -> 64 -> 76',
    v_seq = array[46, 54, 64, 76], v_seq::text);

  -- ── Test 5: salidas por la RPC ───────────────────────────────
  m1 := pg_temp.partido(O, now() + interval '5 hours');  perform pg_temp.inscribir(m1, C);
  m2 := pg_temp.partido(O, now() + interval '2 hours');  perform pg_temp.inscribir(m2, C2);

  perform pg_temp.como(C); set local role authenticated;
  v_res := public.leave_match_penalized(m1);
  reset role;
  insert into r134 values ('T05 salida a las 5 h: -13 (75 -> 62)',
    (v_res->>'penalty')::int = 13 and pg_temp.ts(C) = 62, v_res::text);

  perform pg_temp.como(C2); set local role authenticated;
  v_res := public.leave_match_penalized(m2);
  reset role;
  insert into r134 values ('T05 salida a las 2 h: -23 (75 -> 52)',
    (v_res->>'penalty')::int = 23 and pg_temp.ts(C2) = 52, v_res::text);

  perform pg_temp.ev(D, 'asistio'); perform pg_temp.ev(D, 'asistio');   -- 89, racha 2
  m3 := pg_temp.partido(O, now() + interval '48 hours'); perform pg_temp.inscribir(m3, D);
  perform pg_temp.como(D); set local role authenticated;
  v_res := public.leave_match_penalized(m3);
  reset role;
  insert into r134 values ('T05 salida a las 48 h: -1 y la racha se mantiene (89 -> 88, racha 2)',
    (v_res->>'penalty')::int = 1 and pg_temp.ts(D) = 88 and pg_temp.racha(D) = 2,
    v_res::text || ' racha ' || pg_temp.racha(D));
  v_n := pg_temp.ev(D, 'asistio');
  insert into r134 values ('T05 y la siguiente asistencia es la tercera: +10 (98)', v_n = 98, v_n::text);

  perform pg_temp.como(D); set local role authenticated;
  v_res := public.leave_match_penalized(m3);
  reset role;
  insert into r134 values ('T14 salirse dos veces del mismo partido no vuelve a cobrar',
    (v_res->>'ok') = 'false' and pg_temp.ts(D) = 98, v_res::text);

  -- ── Test 6: salida a las 12 h rompe la racha ─────────────────
  perform pg_temp.ev(E, 'asistio'); perform pg_temp.ev(E, 'asistio');   -- 89, racha 2
  m4 := pg_temp.partido(O, now() + interval '12 hours'); perform pg_temp.inscribir(m4, E);
  perform pg_temp.como(E); set local role authenticated;
  v_res := public.leave_match_penalized(m4);
  reset role;
  insert into r134 values ('T06 salida a las 12 h: -7 y racha 0 (89 -> 82)',
    pg_temp.ts(E) = 82 and pg_temp.racha(E) = 0, v_res::text || ' racha ' || pg_temp.racha(E));
  v_n := pg_temp.ev(E, 'asistio');
  insert into r134 values ('T06 el siguiente asistido vale +6 (88)', v_n = 88, v_n::text);

  -- ── Test 12: entró desde la lista de espera y se sale 2 h antes ──
  m5 := pg_temp.partido(O, now() + interval '2 hours');
  insert into public.match_waitlist (id_partido, id_jugador, created_at)
  values (m5, I, now() - interval '8 hours');
  perform pg_temp.inscribir(m5, I);   -- el trigger 105 lo saca de la cola al entrar
  perform pg_temp.como(I); set local role authenticated;
  v_res := public.leave_match_penalized(m5);
  reset role;
  insert into r134 values ('T12 desde la lista de espera, salida a las 2 h: -23 igual que cualquiera',
    (v_res->>'penalty')::int = 23 and pg_temp.ts(I) = 52, v_res::text);

  -- ── Test 9 y cancelación del organizador ─────────────────────
  perform pg_temp.ev(F, 'asistio'); perform pg_temp.ev(F, 'asistio');   -- 89, racha 2
  m6 := pg_temp.partido(O2, now() + interval '30 hours'); perform pg_temp.inscribir(m6, F);
  perform pg_temp.como(O2); set local role authenticated;
  v_res := public.cancel_match(m6, 'otro');
  reset role;
  insert into r134 values ('T09 el organizador cancela: el jugador queda igual y su racha intacta',
    pg_temp.ts(F) = 89 and pg_temp.racha(F) = 2, pg_temp.ts(F) || ' racha ' || pg_temp.racha(F));
  select count(*) into v_n from public.truescore_eventos where user_id = F and match_id = m6 and tipo = 'neutro';
  insert into r134 values ('T09 y le queda un evento neutro en el historial', v_n = 1, v_n::text);
  insert into r134 values ('C02 cancelar con 12 h o más no le cuesta nada al organizador (30 h)',
    (v_res->>'penalty')::int = 0 and pg_temp.ts(O2) = 75, v_res::text);

  m7 := pg_temp.partido(O2, now() + interval '5 hours'); perform pg_temp.inscribir(m7, G);
  perform pg_temp.como(O2); set local role authenticated;
  v_res := public.cancel_match(m7);   -- sin tipo: 'otro', como la app instalada
  reset role;
  insert into r134 values ('C02 cancelar con menos de 12 h y más de 2 h: -15 (75 -> 60)',
    (v_res->>'penalty')::int = 15 and pg_temp.ts(O2) = 60, v_res::text);
  perform pg_temp.como(O2); set local role authenticated;
  v_res := public.cancel_match(m7);
  reset role;
  insert into r134 values ('C02 cancelar dos veces no vuelve a cobrar',
    (v_res->>'already') = 'true' and pg_temp.ts(O2) = 60, v_res::text);

  m8 := pg_temp.partido(O2, now() + interval '1 hour');
  perform pg_temp.como(O2); set local role authenticated;
  v_res := public.cancel_match(m8, 'otro');
  reset role;
  insert into r134 values ('C02 cancelar con 2 h o menos: -25 (60 -> 35)',
    (v_res->>'penalty')::int = 25 and pg_temp.ts(O2) = 35, v_res::text);

  m9 := pg_temp.partido(O2, now() + interval '1 hour');
  perform pg_temp.como(O2); set local role authenticated;
  v_res := public.cancel_match(m9, 'lluvia');
  reset role;
  insert into r134 values ('C02 por lluvia es neutro también para el organizador',
    (v_res->>'penalty')::int = 0 and pg_temp.ts(O2) = 35, v_res::text);
  select tipo_cancelacion into v_txt from public.matches where id = m9;
  insert into r134 values ('C02 el tipo de cancelación queda guardado', v_txt = 'lluvia', v_txt);

  -- ── Asistencia: tres estados, toda la nómina, una sola vez ───
  m10 := pg_temp.partido(O4, now() - interval '150 minutes');   -- terminó hace 1 h
  perform pg_temp.inscribir(m10, J); perform pg_temp.inscribir(m10, K); perform pg_temp.inscribir(m10, L);

  perform pg_temp.como(O4); set local role authenticated;
  v_res := public.save_match_attendance(m10, jsonb_build_object(J, 'asistio'));
  reset role;
  insert into r134 values ('C03 confirmar a medias se rechaza y no mueve a nadie',
    (v_res->>'ok') = 'false' and (v_res->>'faltan')::int = 2 and pg_temp.ts(J) = 75, v_res::text);

  perform pg_temp.como(O4); set local role authenticated;
  v_res := public.save_match_attendance(m10,
    jsonb_build_object(J, 'asistio', K, 'tarde', L, 'ausente'));
  reset role;
  insert into r134 values ('C03 asistió +6, llegó tarde -8, no fue -35 (81/67/40)',
    pg_temp.ts(J) = 81 and pg_temp.ts(K) = 67 and pg_temp.ts(L) = 40,
    v_res::text || ' ' || pg_temp.ts(J) || '/' || pg_temp.ts(K) || '/' || pg_temp.ts(L));
  select string_agg(estado || ':' || coalesce(asistencia, '-'), ',' order by estado, asistencia)
    into v_txt from public.attendees where id_partido = m10 and id_jugador in (J, K, L);
  insert into r134 values ('C03 la nómina queda con su marca (y «ausente» de la app vieja vale no_fue)',
    v_txt = 'confirmado_gps:asistio,confirmado_gps:tarde,no_asistio:no_fue', v_txt);
  select (asistencia_confirmada_at is not null and estado = 'finalizado') into v_ok
    from public.matches where id = m10;
  insert into r134 values ('C03 el partido queda confirmado y finalizado', v_ok, v_ok::text);

  perform pg_temp.como(O4); set local role authenticated;
  v_res := public.save_match_attendance(m10,
    jsonb_build_object(J, 'asistio', K, 'asistio', L, 'asistio'));
  reset role;
  select count(*) into v_n from public.truescore_eventos where match_id = m10;
  insert into r134 values ('T14 confirmar dos veces aplica los puntos una sola vez',
    (v_res->>'already') = 'true' and v_n = 3
      and pg_temp.ts(J) = 81 and pg_temp.ts(K) = 67 and pg_temp.ts(L) = 40,
    v_res::text || ' eventos ' || v_n);

  m11 := pg_temp.partido(O4, now() - interval '26 hours 30 minutes');   -- terminó hace 25 h
  perform pg_temp.inscribir(m11, N);
  perform pg_temp.como(O4); set local role authenticated;
  v_res := public.save_match_attendance(m11, jsonb_build_object(N, 'presente'));
  reset role;
  insert into r134 values ('C04 pasadas 24 h desde el fin ya no se confirma',
    (v_res->>'ok') = 'false' and pg_temp.ts(N) = 75, v_res::text);

  -- ── Test 10: el organizador no confirma en 24 h ──────────────
  m12 := pg_temp.partido(O3, now() - interval '26 hours');   -- plazo vencido hace 30 min
  perform pg_temp.inscribir(m12, H);
  v_n := public.truescore_cerrar_sin_confirmar();
  insert into r134 values ('T10 jugadores sin cambios y organizador -10',
    pg_temp.ts(H) = 75 and pg_temp.ts(O3) = 65, pg_temp.ts(H) || ' / ' || pg_temp.ts(O3));
  select asistencia_vencida_at is not null into v_ok from public.matches where id = m12;
  insert into r134 values ('T10 el partido queda marcado como vencido', v_ok, v_ok::text);
  v_n := public.truescore_cerrar_sin_confirmar();
  insert into r134 values ('T14 correr el job otra vez no vuelve a cobrar', pg_temp.ts(O3) = 65, pg_temp.ts(O3)::text);
  select count(*) into v_n from public.truescore_eventos where match_id = m11 and user_id = N and tipo = 'neutro';
  insert into r134 values ('C04 el partido que nadie confirmó también quedó neutro', v_n = 1, v_n::text);
  perform pg_temp.como(O3); set local role authenticated;
  v_res := public.save_match_attendance(m12, jsonb_build_object(H, 'asistio'));
  reset role;
  insert into r134 values ('T10 y después ya no se puede confirmar',
    (v_res->>'ok') = 'false' and pg_temp.ts(H) = 75, v_res::text);

  -- ── Expulsión ────────────────────────────────────────────────
  m13 := pg_temp.partido(O5, now() + interval '3 days'); perform pg_temp.inscribir(m13, P);
  perform pg_temp.como(P); set local role authenticated;
  v_res := public.expulsar_jugador(m13, O5);
  reset role;
  insert into r134 values ('C05 un jugador no puede expulsar', (v_res->>'ok') = 'false', v_res::text);

  perform pg_temp.como(O5); set local role authenticated;
  v_res := public.expulsar_jugador(m13, P);
  reset role;
  select count(*) into v_n from public.attendees where id_partido = m13 and id_jugador = P;
  insert into r134 values ('C05 expulsar saca al jugador sin restarle puntos',
    (v_res->>'ok') = 'true' and v_n = 0 and pg_temp.ts(P) = 75, v_res::text);
  select cupos_disponibles into v_n from public.matches where id = m13;
  insert into r134 values ('C05 y el cupo vuelve', v_n = 5, v_n::text);

  begin
    perform pg_temp.como(P); set local role authenticated;
    v_res := public.join_match(m13);
    reset role;
    v_err := coalesce(v_res::text, 'sin respuesta');
  exception when others then
    reset role;
    v_err := sqlerrm;
  end;
  insert into r134 values ('C05 el expulsado no puede volver a entrar',
    v_err like '%EXPULSADO%', v_err);

  begin
    perform pg_temp.como(P); set local role authenticated;
    v_res := public.join_waitlist(m13);
    reset role;
    v_err := coalesce(v_res::text, 'sin respuesta');
  exception when others then
    reset role;
    v_err := sqlerrm;
  end;
  insert into r134 values ('C05 ni a la lista de espera', v_err like '%EXPULSADO%', v_err);

  -- ── Columnas protegidas ──────────────────────────────────────
  perform pg_temp.inscribir(m13, R);
  foreach v_txt in array array['asistencia_confirmada_at', 'estado', 'borrar', 'tipo_cancelacion'] loop
    begin
      perform pg_temp.como(O5); set local role authenticated;
      if v_txt = 'asistencia_confirmada_at' then
        update public.matches set asistencia_confirmada_at = now() where id = m13;
      elsif v_txt = 'estado' then
        update public.matches set estado = 'cancelado' where id = m13;
      elsif v_txt = 'tipo_cancelacion' then
        update public.matches set tipo_cancelacion = 'lluvia' where id = m13;
      else
        delete from public.matches where id = m13;
      end if;
      reset role;
      v_err := 'lo dejó pasar';
    exception when others then
      reset role;
      v_err := sqlerrm;
    end;
    insert into r134 values ('C06 el organizador no escapa a mano: ' || v_txt,
      v_err like '%COLUMNA_PROTEGIDA%' or v_err like '%CANCELAR_CON_RPC%', v_err);
  end loop;

  -- ── GPS ya no da puntos ──────────────────────────────────────
  m14 := pg_temp.partido(O6, now() - interval '10 minutes'); perform pg_temp.inscribir(m14, Q);
  perform pg_temp.como(Q); set local role authenticated;
  v_gps := public.confirm_attendance_gps(m14, -33.45, -70.66);
  reset role;
  insert into r134 values ('C07 confirmar por GPS no mueve el TrueScore',
    (v_gps->>'ok') = 'true' and (v_gps->>'trust_delta')::int = 0 and pg_temp.ts(Q) = 75, v_gps::text);

  -- ── Sin suspensión automática; el mínimo del organizador sigue ──
  v_seq := array[pg_temp.ev(S, 'planton'), pg_temp.ev(S, 'planton'), pg_temp.ev(S, 'planton')];
  select estado into v_txt from public.profiles where id = S;
  insert into r134 values ('C08 llegar a 0 no suspende la cuenta (40, 5, 0)',
    v_seq = array[40, 5, 0] and v_txt = 'activo', v_seq::text || ' ' || v_txt);

  m15 := pg_temp.partido(O, now() + interval '9 days', 80);
  begin
    perform pg_temp.inscribir(m15, S);
    v_err := 'lo dejó pasar';
  exception when others then
    v_err := sqlerrm;
  end;
  insert into r134 values ('C08 el mínimo que pone el organizador se sigue exigiendo',
    v_err like '%TRUST_BAJO%', v_err);

  -- ── Costo previo que muestra la pantalla ─────────────────────
  m16 := pg_temp.partido(O7, now() + interval '5 hours'); perform pg_temp.inscribir(m16, T);
  perform pg_temp.como(T); set local role authenticated;
  v_res := public.truescore_costo_salida(m16);
  reset role;
  insert into r134 values ('C09 el costo previo de salir a las 5 h es 13',
    (v_res->>'puntos')::int = 13 and (v_res->>'rol') = 'jugador', v_res::text);
  perform pg_temp.como(O7); set local role authenticated;
  v_res := public.truescore_costo_salida(m16);
  reset role;
  insert into r134 values ('C09 y el de cancelar para el organizador es 15',
    (v_res->>'puntos')::int = 15 and (v_res->>'rol') = 'organizador', v_res::text);

  -- ── Cancelar para cambiarse y cambiarse de partido ───────────
  m17 := pg_temp.partido(O7, now() + interval '6 hours'); perform pg_temp.inscribir(m17, V);
  m18 := pg_temp.partido(O, now() + interval '20 days');
  perform pg_temp.como(O7); set local role authenticated;
  v_res := public.cancel_match_and_join(m17, m18);
  reset role;
  insert into r134 values ('C10 cancelar para cambiarse sigue la misma regla: -15 a las 6 h',
    (v_res->>'penalty')::int = 15 and pg_temp.ts(O7) = 60 and pg_temp.ts(V) = 75, v_res::text);

  m19 := pg_temp.partido(O, now() + interval '36 hours'); perform pg_temp.inscribir(m19, W);
  m20 := pg_temp.partido(O, now() + interval '25 days');
  perform pg_temp.como(W); set local role authenticated;
  v_res := public.swap_match(m19, m20);
  reset role;
  insert into r134 values ('C10 cambiarse de partido a las 36 h cuesta 3 (tabla interpolada)',
    (v_res->>'penalty')::int = 3 and pg_temp.ts(W) = 72, v_res::text);

  -- ── Teléfono detrás de su flag ───────────────────────────────
  m21 := pg_temp.partido(O, now() + interval '11 days');
  update public.feature_flags set activo = true where nombre = 'telefono_obligatorio';
  begin
    perform pg_temp.inscribir(m21, U);
    v_err := 'lo dejó pasar';
  exception when others then
    v_err := sqlerrm;
  end;
  insert into r134 values ('C11 con telefono_obligatorio, sin teléfono no se inscribe',
    v_err like '%TELEFONO_NO_VERIFICADO%', v_err);
  begin
    perform pg_temp.partido(O, now() + interval '12 days');
    v_err := 'lo dejó pasar';
  exception when others then
    v_err := sqlerrm;
  end;
  insert into r134 values ('C11 ni publica un partido',
    v_err like '%TELEFONO_NO_VERIFICADO%', v_err);
  update public.feature_flags set activo = false where nombre = 'telefono_obligatorio';
  perform pg_temp.inscribir(m21, U);
  select count(*) into v_n from public.attendees where id_partido = m21 and id_jugador = U;
  insert into r134 values ('C11 con el flag apagado entra normal', v_n = 1, v_n::text);

  -- ── El registro es inmutable y recalculable ──────────────────
  begin
    update public.truescore_eventos set motivo = 'x' where user_id = A;
    v_err := 'lo dejó pasar';
  exception when others then v_err := sqlerrm; end;
  insert into r134 values ('C12 un evento no se edita', v_err like '%TRUESCORE_INMUTABLE%', v_err);
  begin
    delete from public.truescore_eventos where user_id = A;
    v_err := 'lo dejó pasar';
  exception when others then v_err := sqlerrm; end;
  insert into r134 values ('C12 un evento no se borra', v_err like '%TRUESCORE_INMUTABLE%', v_err);

  select count(*) into v_n
    from unnest(array[A, B, C, C2, D, E, F, G, H, I, J, K, L, N, P, Q, S, T, V, W, O2, O3, O7]) as uu(id)
   where not (public.truescore_recalcular(uu.id)->>'coincide')::boolean;
  insert into r134 values ('C12 recalcular desde cero da el mismo puntaje y racha que el caché',
    v_n = 0, v_n || ' no coinciden');

  -- ── Permisos ─────────────────────────────────────────────────
  select count(*) into v_n
    from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public'
     and (pr.proname like 'truescore%' or pr.proname in ('flag_activo', 'expulsar_jugador',
          'telefono_verificado', 'mi_telefono_verificado', 'cancel_match'))
     and has_function_privilege('anon', pr.oid, 'execute');
  insert into r134 values ('C13 anon no ejecuta ninguna función nueva', v_n = 0, v_n::text);

  select string_agg(pr.proname, ',' order by pr.proname) into v_txt
    from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public'
     and pr.proname in ('truescore_registrar', 'truescore_iniciar', 'truescore_recalcular',
          'truescore_activar_fase1', 'truescore_cerrar_sin_confirmar', 'truescore_calcular',
          'truescore_registrar_cancelacion', 'truescore_guardar_asistencia', 'truescore_cfg',
          'telefono_verificado')
     and has_function_privilege('authenticated', pr.oid, 'execute');
  insert into r134 values ('C13 authenticated no llega a las funciones internas', v_txt is null, coalesce(v_txt, 'ninguna'));

  perform pg_temp.como(J); set local role authenticated;
  select count(*) filter (where user_id = J), count(*) filter (where user_id <> J)
    into v_pre, v_n from public.truescore_eventos;
  v_res := public.truescore_ajustes();
  reset role;
  insert into r134 values ('C13 cada uno lee sólo sus eventos', v_pre > 0 and v_n = 0, v_pre || ' propios, ' || v_n || ' ajenos');
  insert into r134 values ('C13 la app lee flags y niveles',
    (v_res->>'fase1') = 'true' and jsonb_array_length(v_res->'niveles') = 4, v_res::text);

  -- ── Con el flag apagado, todo como antes ─────────────────────
  update public.feature_flags set activo = false where nombre = 'truescore_fase1';
  m22 := pg_temp.partido(O, now() + interval '5 hours'); perform pg_temp.inscribir(m22, X);
  perform pg_temp.como(X); set local role authenticated;
  v_res := public.leave_match_penalized(m22);
  reset role;
  select count(*) into v_n from public.truescore_eventos where user_id = X and tipo <> 'inicio';
  insert into r134 values ('C14 flag apagado: la salida vuelve a cobrar 3 y no escribe eventos',
    (v_res->>'penalty')::int = 3 and pg_temp.ts(X) = 72 and v_n = 0, v_res::text);

  m23 := pg_temp.partido(O, now() + interval '5 hours');
  perform pg_temp.como(O); set local role authenticated;
  v_res := public.cancel_match(m23);
  reset role;
  insert into r134 values ('C14 flag apagado: cancelar vuelve a cobrar 15',
    (v_res->>'penalty')::int = 15, v_res::text);
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r134 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle
      from r134 where not ok;
    raise exception 'FALLARON % casos de la 134: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r134 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r134;

rollback;
