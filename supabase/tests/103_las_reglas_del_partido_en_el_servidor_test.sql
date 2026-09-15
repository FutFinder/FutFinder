-- =============================================================
-- FutFinder — pruebas de la migración 103.
--
-- EL CASO QUE IMPORTA: las reglas del partido vivían en la pantalla. Una
-- llamada directa a la RPC se saltaba la aprobación manual, el rango de
-- edad, el estado del partido al aprobar y la inscripción al confirmar por
-- GPS. Acá se llama a las RPC como las llamaría cualquiera con la clave
-- pública, sin pasar por la interfaz.
--
--   P1. `join_match` no sirve para colarse en un partido de aprobación manual.
--   P2. Ni para entrar fuera del rango de edad.
--   P3. Pero un perfil SIN edad entra: política explícita, no descuido.
--   P4. `request_join` tampoco es la puerta trasera de la edad.
--   P5. No se aprueba a nadie en un partido cancelado.
--   P6. Ni después de la hora de inicio.
--   P7. El GPS no confirma una solicitud pendiente.
--   P8. Ni en un partido cancelado.
--   P9. Red de seguridad: el trigger rechaza la edad en una inserción directa.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r103 (caso text, ok boolean, detalle text);
grant all on r103 to authenticated;

do $$
declare
  v_org    uuid := gen_random_uuid();
  v_joven  uuid := gen_random_uuid();  -- 20 años
  v_viejo  uuid := gen_random_uuid();  -- 45 años
  v_sinedad uuid := gen_random_uuid(); -- sin edad en el perfil
  v_manual uuid; v_edad uuid; v_gps uuid; v_cancelado uuid;
  v_res jsonb;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
         'r103-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_org, v_joven, v_viejo, v_sinedad]) u;

  update public.profiles set edad = 20 where id = v_joven;
  update public.profiles set edad = 45 where id = v_viejo;
  update public.profiles set edad = null where id = v_sinedad;

  -- Cuatro partidos, a horas distintas para que nadie choque consigo mismo.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion, edad_min, edad_max)
  values (v_org, 'r103 manual', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 day', 5, 5, 'abierto', 90, 'manual', null, null)
  returning id into v_manual;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion, edad_min, edad_max)
  values (v_org, 'r103 edad', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '1 day 4 hours', 5, 5, 'abierto', 90, 'inmediata', 18, 35)
  returning id into v_edad;

  -- Este empieza en 10 minutos: dentro de la ventana que acepta el GPS.
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r103 gps', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '10 minutes', 5, 5, 'abierto', 90, 'inmediata')
  returning id into v_gps;

  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud,
      hora, cupos_totales, cupos_disponibles, estado, duracion_min, aprobacion)
  values (v_org, 'r103 cancelado', 'Santiago', 'Cancha', -33.45, -70.66,
      now() + interval '10 minutes', 5, 5, 'abierto', 90, 'manual')
  returning id into v_cancelado;

  set local role authenticated;

  -- P1 y P2: el ingreso inmediato, como lo llamaría cualquiera.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joven, 'role', 'authenticated')::text, true);
  v_res := public.join_match(v_manual)::jsonb;
  insert into r103 values ('P1 join_match no se salta la aprobación manual',
    (v_res->>'ok') = 'false', v_res->>'reason');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_viejo, 'role', 'authenticated')::text, true);
  v_res := public.join_match(v_edad)::jsonb;
  insert into r103 values ('P2 join_match respeta el rango de edad',
    (v_res->>'ok') = 'false', v_res->>'reason');

  -- P3: no poder demostrar que incumple no es lo mismo que incumplir.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sinedad, 'role', 'authenticated')::text, true);
  v_res := public.join_match(v_edad)::jsonb;
  insert into r103 values ('P3 un perfil sin edad entra igual',
    (v_res->>'ok') = 'true', coalesce(v_res->>'reason', 'entró'));

  -- P4: la otra puerta de entrada.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_viejo, 'role', 'authenticated')::text, true);
  v_res := public.request_join(v_edad);
  insert into r103 values ('P4 request_join respeta el rango de edad',
    (v_res->>'ok') = 'false', v_res->>'reason');

  -- P5 y P6: aprobar.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joven, 'role', 'authenticated')::text, true);
  perform public.request_join(v_cancelado);

  reset role;
  update public.matches set estado = 'cancelado' where id = v_cancelado;
  set local role authenticated;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  v_res := public.approve_join(v_cancelado, v_joven);
  insert into r103 values ('P5 no se aprueba en un partido cancelado',
    (v_res->>'ok') = 'false', v_res->>'reason');

  reset role;
  update public.matches set estado = 'abierto', hora = now() - interval '5 minutes'
   where id = v_cancelado;
  set local role authenticated;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_org, 'role', 'authenticated')::text, true);
  v_res := public.approve_join(v_cancelado, v_joven);
  insert into r103 values ('P6 ni después de la hora de inicio',
    (v_res->>'ok') = 'false', v_res->>'reason');

  -- P7: el GPS con una solicitud pendiente. Se inserta como pendiente a
  -- mano porque el partido es de ingreso inmediato: lo que se prueba es la
  -- puerta del GPS, no cómo se llegó a estar pendiente.
  reset role;
  insert into public.attendees (id_partido, id_jugador, estado)
  values (v_gps, v_joven, 'pendiente');
  set local role authenticated;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_joven, 'role', 'authenticated')::text, true);
  v_res := public.confirm_attendance_gps(v_gps, -33.45, -70.66)::jsonb;
  insert into r103 values ('P7 el GPS no confirma una solicitud pendiente',
    (v_res->>'ok') = 'false', v_res->>'reason');

  -- P8: inscrito de verdad, pero el partido se cayó.
  reset role;
  update public.attendees set estado = 'inscrito'
   where id_partido = v_gps and id_jugador = v_joven;
  update public.matches set estado = 'cancelado' where id = v_gps;
  set local role authenticated;

  v_res := public.confirm_attendance_gps(v_gps, -33.45, -70.66)::jsonb;
  insert into r103 values ('P8 ni en un partido cancelado',
    (v_res->>'ok') = 'false', v_res->>'reason');

  -- P9: la red de seguridad, para las RPC que insertan por su cuenta
  -- (`swap_match`, `cancel_match_and_join`).
  reset role;
  begin
    insert into public.attendees (id_partido, id_jugador, estado)
    values (v_edad, v_viejo, 'inscrito');
    insert into r103 values ('P9 el trigger rechaza la edad', false, 'insertó igual');
  exception when others then
    insert into r103 values ('P9 el trigger rechaza la edad',
      sqlerrm like '%EDAD_FUERA_DE_RANGO%', sqlerrm);
  end;
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r103 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r103;

rollback;
