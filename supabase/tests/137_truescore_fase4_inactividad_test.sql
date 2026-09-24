-- =============================================================
-- FutFinder — pruebas de la migración 137 (TrueScore fase 4: inactividad).
--
-- Seis meses no se pueden esperar: se escriben en el registro partidos de
-- hace 7 meses y se deja el caché en lo que dice el registro con
-- `truescore_recalcular(usuario, true)`. Desde ahí todo es real.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r137 (caso text, ok boolean, detalle text);

create function pg_temp.usuario() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r137-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  return u;
end $$;
-- Un partido viejo escrito en el registro, y el caché rehecho desde él.
create function pg_temp.viejo(p_user uuid, p_tipo text, p_hace interval) returns void language plpgsql as $$
begin
  insert into public.truescore_eventos (user_id, tipo, puntos_nominales, puntos_aplicados, puntaje_antes,
      puntaje_despues, racha_antes, racha_despues, motivo, detalle, clave, created_at)
  values (p_user, p_tipo, 0, 0, 0, 0, 0, 0, 'prueba', '{}', 'r137:' || gen_random_uuid(), now() - p_hace);
  perform public.truescore_recalcular(p_user, true);
end $$;
create function pg_temp.ts(p_user uuid) returns int language sql as $$ select trust_score from public.profiles where id = p_user; $$;
create function pg_temp.racha(p_user uuid) returns int language sql as $$ select truescore_racha from public.profiles where id = p_user; $$;

do $$
declare
  v_res jsonb; v_n int; v_ok boolean; v_seq int[];
  A uuid; B uuid; D uuid; N uuid;
begin
  perform public.truescore_activar_fase1();
  v_res := public.truescore_activar_fase4();
  insert into r137 values ('C00 la fase 4 se activa sobre la fase 1', (v_res->>'ok') = 'true', v_res::text);

  -- ── La regla pura ────────────────────────────────────────────
  select array_agg(c.puntaje order by x.o) into v_seq
    from unnest(array[81, 40, 66, 64, 65, 100, 0]) with ordinality as x(p, o)
    cross join lateral public.truescore_calcular('inactividad', x.p, 3) c;
  insert into r137 values ('C01 se acerca a 65 de a 2 sin pasarse (81→79, 40→42, 66→65, 64→65, 65→65, 100→98, 0→2)',
    v_seq = array[79, 42, 65, 65, 65, 98, 2], v_seq::text);
  select c.racha into v_n from public.truescore_calcular('inactividad', 81, 3) c;
  insert into r137 values ('C01 no toca la racha', v_n = 3, v_n::text);

  A := pg_temp.usuario(); B := pg_temp.usuario(); D := pg_temp.usuario(); N := pg_temp.usuario();

  perform pg_temp.viejo(A, 'asistio', interval '7 months');                       -- 81, racha 1
  perform pg_temp.viejo(B, 'planton', interval '8 months');                       -- 40
  perform pg_temp.viejo(D, 'asistio', interval '7 months');
  perform public.truescore_registrar(D, null, 'asistio', 'r137:reciente', 'prueba');   -- juega hoy: 89
  insert into r137 values ('C02 previa: A 81, B 40, D 89', pg_temp.ts(A) = 81 and pg_temp.ts(B) = 40 and pg_temp.ts(D) = 89,
    pg_temp.ts(A) || '/' || pg_temp.ts(B) || '/' || pg_temp.ts(D));

  v_n := public.truescore_inactividad();
  insert into r137 values ('C03 7 meses sin jugar: 81 baja a 79', pg_temp.ts(A) = 79, pg_temp.ts(A)::text);
  insert into r137 values ('C03 8 meses sin jugar: 40 sube a 42', pg_temp.ts(B) = 42, pg_temp.ts(B)::text);
  insert into r137 values ('C03 la racha no cambia', pg_temp.racha(A) = 1, pg_temp.racha(A)::text);
  insert into r137 values ('C04 quien jugó hace poco no se mueve', pg_temp.ts(D) = 89, pg_temp.ts(D)::text);
  select count(*) into v_n from public.truescore_eventos where user_id = N and tipo = 'inactividad';
  insert into r137 values ('C04 una cuenta nueva tampoco (cuenta desde su inicio)', v_n = 0, v_n::text);

  v_n := public.truescore_inactividad();
  insert into r137 values ('C05 correr el job dos veces en el mismo mes mueve una sola vez',
    pg_temp.ts(A) = 79 and pg_temp.ts(B) = 42, pg_temp.ts(A) || '/' || pg_temp.ts(B));

  select count(*) into v_n from unnest(array[A, B, D]) as uu(id)
   where not (public.truescore_recalcular(uu.id)->>'coincide')::boolean;
  insert into r137 values ('C06 recalcular desde cero coincide', v_n = 0, v_n || ' no coinciden');

  select count(*) into v_n from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public'
     and pr.proname in ('truescore_inactividad', 'truescore_activar_fase4', 'truescore_ultima_actividad')
     and (has_function_privilege('anon', pr.oid, 'execute') or has_function_privilege('authenticated', pr.oid, 'execute'));
  insert into r137 values ('C07 nadie de la app ejecuta el job ni la activación', v_n = 0, v_n::text);

  -- Las cuentas reales acaban de recibir su inicio: nadie lleva 6 meses.
  select count(*) into v_n from public.profiles where trust_score <> 75 and id not in (A, B, D, N);
  insert into r137 values ('C09 las cuentas reales no se movieron', v_n = 0, v_n::text);

  update public.feature_flags set activo = false where nombre = 'truescore_fase4';
  insert into r137 values ('C08 con el flag apagado el job no hace nada', public.truescore_inactividad() = 0, 'ok');
end $$;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r137 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle from r137 where not ok;
    raise exception 'FALLARON % casos de la 137: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r137 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r137;

rollback;
