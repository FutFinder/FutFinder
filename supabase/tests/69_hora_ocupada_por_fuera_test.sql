-- =============================================================
-- FutFinder — pruebas de la migración 69 (hora ocupada por fuera).
--
-- QUÉ SE PRUEBA:
--   1. Un bloqueo sin tipo queda como 'cerrado' (mantención).
--   2. Un arriendo por fuera guarda nombre y teléfono, normalizado.
--   3. Un teléfono que no es móvil chileno se rechaza en vez de
--      guardarse mal y descubrirse el día que haya que llamar.
--   4. Un contacto en una mantención se descarta sin reventar: es más
--      amable que rechazar el bloqueo por un campo que la pantalla no
--      debería haber mandado.
--   5. Pasar de 'externo' a 'cerrado' LIMPIA el contacto — no hay a quién
--      llamar por una mantención, y dejarlo sería un dato personal sin
--      motivo.
--   6. Volver a 'externo' y corregir el teléfono.
--   7. La agenda trae `tipo` y contacto de cada bloqueo.
--   8. PARA EL JUGADOR LOS DOS SON IDÉNTICOS: los dos bloquean igual y no
--      se filtra el tipo.
--
-- Requiere las migraciones 54 a 69 aplicadas.
-- Cómo correr: pégalo en Supabase → SQL Editor → Run. Termina en ROLLBACK.
-- =============================================================

begin;

do $$
declare
  v_dueno uuid := gen_random_uuid(); v_cpl uuid := gen_random_uuid();
  v_cancha uuid := gen_random_uuid(); v_b1 uuid; v_b2 uuid; v_b3 uuid;
  v_manana date := (now() at time zone 'America/Santiago')::date + 12;
  v_j json; v_txt text; v_rech boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_dueno,'authenticated','authenticated',
    'r69-'||v_dueno||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','','');
  insert into public.complejos (id, nombre, comuna, latitud, longitud, publicado)
  values (v_cpl,'Externo 69','Maipú',-33.53,-70.76,true);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_cpl,'Cancha 1','futbol_7',28000,60,true);
  insert into public.cancha_horario_reglas (cancha_id, dia_semana, hora_apertura, hora_cierre)
  select v_cancha, d, time '11:00', time '22:00' from generate_series(0,6) d;
  insert into public.complejo_admins (complejo_id, user_id, rol) values (v_cpl, v_dueno,'dueño');

  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_dueno,'role','authenticated')::text);

  v_b1 := public.admin_crear_bloqueo(v_cancha, v_manana, time '12:00', time '14:00','Riego del pasto');
  if (select tipo from public.cancha_bloqueos where id = v_b1) <> 'cerrado' then
    raise exception 'FALLÓ (caso 1): el default debería ser cerrado'; end if;
  raise notice 'OK (caso 1)';

  v_b2 := public.admin_crear_bloqueo(v_cancha, v_manana, time '16:00', time '17:00',
            'Arriendo al Club Los Halcones','externo','Club Los Halcones','9 3344 1122');
  if not exists (select 1 from public.cancha_bloqueos where id = v_b2
      and tipo = 'externo' and contacto_telefono = '+56933441122'
      and contacto_nombre = 'Club Los Halcones') then
    raise exception 'FALLÓ (caso 2): %',
      (select row_to_json(b)::text from public.cancha_bloqueos b where b.id = v_b2); end if;
  raise notice 'OK (caso 2)';

  begin
    perform public.admin_crear_bloqueo(v_cancha, v_manana, time '18:00', time '19:00',
              'Otro','externo','Alguien','221234567');
    v_rech := false;
  exception when others then v_rech := true; end;
  if not v_rech then raise exception 'FALLÓ (caso 3): aceptó un fijo'; end if;
  raise notice 'OK (caso 3)';

  v_b3 := public.admin_crear_bloqueo(v_cancha, v_manana, time '19:00', time '20:00',
            'Mantención','cerrado','No debería guardarse','987654321');
  if (select contacto_nombre from public.cancha_bloqueos where id = v_b3) is not null then
    raise exception 'FALLÓ (caso 4): guardó contacto en una mantención'; end if;
  raise notice 'OK (caso 4)';

  perform public.admin_actualizar_bloqueo(v_b2, null, null, null, null, 'cerrado');
  if (select contacto_nombre from public.cancha_bloqueos where id = v_b2) is not null
     or (select contacto_telefono from public.cancha_bloqueos where id = v_b2) is not null then
    raise exception 'FALLÓ (caso 5): el contacto quedó colgando tras pasar a cerrado'; end if;
  raise notice 'OK (caso 5)';

  perform public.admin_actualizar_bloqueo(v_b2, null, null, null, null, 'externo',
                                          'Club Los Halcones','+56 9 5555 6666');
  if (select contacto_telefono from public.cancha_bloqueos where id = v_b2) <> '+56955556666' then
    raise exception 'FALLÓ (caso 6): no se corrigió el teléfono'; end if;
  raise notice 'OK (caso 6)';

  v_j := public.admin_agenda_complejo(v_cpl, v_manana);
  select b->>'contacto_telefono' into v_txt from json_array_elements(v_j->'bloqueos') b
   where b->>'id' = v_b2::text;
  if v_txt <> '+56955556666' then
    raise exception 'FALLÓ (caso 7): la agenda no trae el contacto: %', v_txt; end if;
  select b->>'tipo' into v_txt from json_array_elements(v_j->'bloqueos') b where b->>'id' = v_b1::text;
  if v_txt <> 'cerrado' then raise exception 'FALLÓ (caso 7): falta el tipo'; end if;
  raise notice 'OK (caso 7)';

  execute format('set local role anon');
  v_j := public.get_disponibilidad_cancha(v_cancha, v_manana);
  if (select count(*) from json_array_elements(v_j->'slots') s
       where s->>'hora_inicio' in ('12:00','16:00') and (s->>'disponible')::boolean) <> 0 then
    raise exception 'FALLÓ (caso 8): los dos tipos deben bloquear igual'; end if;
  if (select count(*) from json_array_elements(v_j->'slots') s
       where s->>'hora_inicio' = '16:00' and s::text like '%externo%') <> 0 then
    raise exception 'FALLÓ (caso 8): el jugador no debe enterarse del tipo';  end if;
  execute 'reset role';
  raise notice 'OK (caso 8): para el jugador una mantención y un arriendo por fuera son lo mismo';

  raise notice '=== TODOS LOS CASOS DE LA MIGRACIÓN 69 PASARON ===';
end $$;

rollback;
