-- =============================================================
-- FutFinder — pruebas de la migración 138 (teléfono sin verificar).
--
-- Con `telefono_obligatorio` y sin `telefono_verificacion_sms`: sin número
-- no se inscribe ni publica; con un celular registrado, sí; el número es
-- único entre cuentas y se valida el formato. Con la verificación activa,
-- un número sin verificar ya no alcanza.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r138 (caso text, ok boolean, detalle text);
grant all on r138 to authenticated;

create function pg_temp.usuario() returns uuid language plpgsql as $$
declare u uuid := gen_random_uuid();
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r138-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  return u;
end $$;
create function pg_temp.partido(p_org uuid, p_hora timestamptz) returns uuid language plpgsql as $$
declare m uuid;
begin
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (p_org, 'r138', 'Santiago', 'Cancha', -33.45, -70.66, p_hora, 5, 5, 'abierto', 90, 'inmediata') returning id into m;
  return m;
end $$;
create function pg_temp.como(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
end $$;

do $$
declare
  v_res jsonb; v_err text; v_n int; m1 uuid; m2 uuid;
  O uuid; J uuid; K uuid;
begin
  O := pg_temp.usuario(); J := pg_temp.usuario(); K := pg_temp.usuario();
  -- El organizador del primer partido tiene número (lo registra antes de
  -- prender el flag, para poder publicar).
  perform pg_temp.como(O); set local role authenticated;
  v_res := public.registrar_telefono('+56 9 1111 0001');
  reset role;
  insert into r138 values ('C01 se registra un celular con espacios y +56', (v_res->>'ok') = 'true', v_res::text);

  update public.feature_flags set activo = true where nombre = 'telefono_obligatorio';
  update public.feature_flags set activo = false where nombre = 'telefono_verificacion_sms';

  m1 := pg_temp.partido(O, now() + interval '3 days');
  insert into r138 values ('C02 con número registrado se publica sin verificar', m1 is not null, coalesce(m1::text, 'null'));

  begin
    perform pg_temp.partido(J, now() + interval '4 days');
    v_err := 'lo dejó pasar';
  exception when others then v_err := sqlerrm; end;
  insert into r138 values ('C03 sin número no se publica', v_err like '%TELEFONO_NO_VERIFICADO%', v_err);

  begin
    perform pg_temp.como(J); set local role authenticated;
    v_res := public.join_match(m1);
    reset role;
    v_err := coalesce(v_res::text, 'sin respuesta');
  exception when others then reset role; v_err := sqlerrm; end;
  insert into r138 values ('C03 sin número no se inscribe', v_err like '%TELEFONO_NO_VERIFICADO%', v_err);

  perform pg_temp.como(J); set local role authenticated;
  v_res := public.registrar_telefono('812345678');
  reset role;
  insert into r138 values ('C04 un número que no es celular chileno se rechaza', (v_res->>'ok') = 'false', v_res::text);
  perform pg_temp.como(J); set local role authenticated;
  v_res := public.registrar_telefono('911110001');
  reset role;
  insert into r138 values ('C04 el número de otra cuenta se rechaza', (v_res->>'ok') = 'false', v_res::text);
  perform pg_temp.como(J); set local role authenticated;
  v_res := public.registrar_telefono('56911110002');
  v_res := public.mi_telefono();
  reset role;
  insert into r138 values ('C05 mi teléfono se ve enmascarado y cumple sin verificar',
    (v_res->>'mascara') = '+56 9 •••• 0002' and (v_res->>'cumple') = 'true' and (v_res->>'verificado') = 'false', v_res::text);

  perform pg_temp.como(J); set local role authenticated;
  v_res := public.join_match(m1);
  reset role;
  select count(*) into v_n from public.attendees where id_partido = m1 and id_jugador = J;
  insert into r138 values ('C05 con número registrado se inscribe', v_n = 1, v_res::text);

  -- Con la verificación por SMS activa, un número sin verificar ya no basta.
  update public.feature_flags set activo = true where nombre = 'telefono_verificacion_sms';
  perform pg_temp.como(K); set local role authenticated;
  perform public.registrar_telefono('911110003');
  reset role;
  begin
    perform pg_temp.como(K); set local role authenticated;
    v_res := public.join_match(m1);
    reset role;
    v_err := coalesce(v_res::text, 'sin respuesta');
  exception when others then reset role; v_err := sqlerrm; end;
  insert into r138 values ('C06 con verificación SMS, sin verificar no se inscribe', v_err like '%TELEFONO_NO_VERIFICADO%', v_err);
  update public.perfil_telefonos set verificado_at = now() where user_id = K;
  perform pg_temp.como(K); set local role authenticated;
  v_res := public.join_match(m1);
  reset role;
  select count(*) into v_n from public.attendees where id_partido = m1 and id_jugador = K;
  insert into r138 values ('C06 verificado, sí', v_n = 1, v_res::text);

  perform pg_temp.como(K); set local role authenticated;
  perform public.registrar_telefono('911110004');
  v_res := public.mi_telefono();
  reset role;
  insert into r138 values ('C07 cambiar de número pierde la verificación', (v_res->>'verificado') = 'false', v_res::text);

  select count(*) into v_n from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
   where ns.nspname = 'public' and pr.proname in ('registrar_telefono', 'mi_telefono', 'telefono_cumple')
     and has_function_privilege('anon', pr.oid, 'execute');
  insert into r138 values ('C08 anon no ejecuta nada', v_n = 0, v_n::text);
  insert into r138 values ('C08 la app no llega a telefono_cumple',
    not has_function_privilege('authenticated', 'public.telefono_cumple(uuid)', 'execute'), 'ok');
  perform pg_temp.como(K); set local role authenticated;
  begin
    select count(*) into v_n from public.perfil_telefonos;
    v_err := 'leyó ' || v_n;
  exception when others then v_err := sqlerrm; end;
  reset role;
  insert into r138 values ('C08 la tabla de teléfonos no se lee directo', v_err like '%permission denied%', v_err);
end $$;

reset role;

do $$
declare v_malos int; v_detalle text;
begin
  select count(*) into v_malos from r138 where not ok;
  if v_malos > 0 then
    select string_agg(caso || ' -> ' || coalesce(detalle, ''), E'\n') into v_detalle from r138 where not ok;
    raise exception 'FALLARON % casos de la 138: %', v_malos, v_detalle;
  end if;
end $$;

select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r138 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r138;

rollback;
