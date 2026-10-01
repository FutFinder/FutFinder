-- =============================================================
-- FutFinder — pruebas de la migración 145
--
-- Qué cubre:
--   1. `matches` rechaza el par (0, 0). Antes lo aceptaba: el control
--      negativo del ensayo lo dejó por escrito —«ACEPTADO (el agujero
--      existe)»— antes de poner la restricción.
--   2. Y sigue aceptando una cancha real de Santiago (-33,4569 /
--      -70,6483). Una guarda que además rompe lo que debía funcionar no
--      es una corrección.
--   3. Un punto con UN SOLO cero se acepta. La marca de «no se eligió
--      cancha» es el PAR, no un cero suelto: (0, -70,64) está en el mar
--      frente a Ecuador, pero no es el valor que produce `Number(null)`
--      en los dos campos a la vez. Rechazarlo sería inventar una regla
--      que el cliente no tiene.
--   4. `club_challenge_proposals` lo rechaza en la fuente, así que una
--      propuesta en (0,0) no llega a existir y `aprobar_propuesta` nunca
--      la ve.
--   5. `club_match_changes` lo rechaza con la cancha anidada en el jsonb.
--   6. Y acepta un cambio con una cancha real.
--   7. Y un cambio que sólo mueve la hora, sin cancha: el jsonb sin
--      `cancha` no puede quedar bloqueado por esto.
--   8. Con las coordenadas en TEXTO la restricción deja pasar, a
--      propósito: de eso se encarga la validación de tipo de
--      `cambio_partido_revisa_campos`. Una restricción que intentara
--      castear basura fallaría con un error de casteo, que es peor.
--
-- OJO al escribir casos acá: `club_match_changes_pendiente_uidx`
-- (migración 46) sólo admite UN cambio pendiente por partido, así que
-- entre caso y caso hay que borrar el anterior. Costó un rojo.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

do $$
declare
  v_u uuid := gen_random_uuid(); v_m uuid := gen_random_uuid();
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid(); v_des uuid := gen_random_uuid();
  v_marca text := 'm145' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_pudo boolean; v_err text;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_u, 'authenticated', 'authenticated',
    'm145-' || v_u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  insert into public.profiles (id, username) values (v_u, v_marca || 'u')
    on conflict (id) do update set username = excluded.username;

  -- ── Caso 1: matches rechaza el par ────────────────────────────
  begin
    insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
      latitud, longitud, hora, cupos_totales, cupos_disponibles)
      values (v_m, v_u, 'cero', 'Comuna', 'Cancha', 0, 0, now() + interval '2 days', 10, 8);
    v_pudo := true;
  exception when check_violation then v_pudo := false; end;
  if v_pudo then raise exception 'CASO 1 FALLA: matches aceptó la cancha en (0,0)'; end if;

  -- ── Caso 2: y acepta una cancha real ──────────────────────────
  begin
    insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
      latitud, longitud, hora, cupos_totales, cupos_disponibles)
      values (v_m, v_u, v_marca, 'Ñuñoa', 'Cancha', -33.4569, -70.6483, now() + interval '2 days', 10, 8);
    v_pudo := true;
  exception when others then v_pudo := false; v_err := sqlstate || ' ' || left(sqlerrm, 60); end;
  if not v_pudo then raise exception 'CASO 2 FALLA: se rechazó una cancha real de Santiago (%)', v_err; end if;

  -- ── Caso 3: un solo cero no es la marca ───────────────────────
  begin
    insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
      latitud, longitud, hora, cupos_totales, cupos_disponibles)
      values (gen_random_uuid(), v_u, 'un cero', 'Comuna', 'Cancha', 0, -70.6483,
              now() + interval '2 days', 10, 8);
    v_pudo := true;
  exception when check_violation then v_pudo := false; end;
  if not v_pudo then raise exception 'CASO 3 FALLA: se rechazó un punto con UN solo cero'; end if;

  -- ── Caso 4: la propuesta, cortada en la fuente ────────────────
  insert into public.clubs (id, nombre, slug, created_by) values
    (v_c1, v_marca || ' A', v_marca || '-a', v_u),
    (v_c2, v_marca || ' B', v_marca || '-b', v_u);
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
    values (v_des, v_c1, v_c2, v_u, 'negociacion');
  begin
    insert into public.club_challenge_proposals (challenge_id, club_proponente_id, fecha, duracion_min,
      direccion, cancha_nombre, comuna, region, modalidad, cupos_por_club, metodo_inscripcion, latitud, longitud)
      values (v_des, v_c1, now() + interval '3 days', 60, 'Calle', 'Cancha', 'Comuna', 'Region',
              'futbol7', 7, 'orden_llegada', 0, 0);
    v_pudo := true;
  exception when check_violation then v_pudo := false; end;
  if v_pudo then raise exception 'CASO 4 FALLA: la propuesta oficial aceptó (0,0)'; end if;

  -- ── Caso 5: el cambio negociado, con la cancha en el jsonb ────
  begin
    insert into public.club_match_changes (match_id, challenge_id, club_proponente_id, propuesto_por, campos)
      values (v_m, v_des, v_c1, v_u,
        jsonb_build_object('cancha', jsonb_build_object('latitud', 0, 'longitud', 0, 'cancha_nombre', 'x')));
    v_pudo := true;
  exception when check_violation then v_pudo := false;
            when others then v_pudo := null; v_err := sqlstate; end;
  if v_pudo is not false then
    raise exception 'CASO 5 FALLA: el cambio aceptó la cancha en (0,0) (%)', coalesce(v_err, 'aceptado');
  end if;

  -- ── Caso 6: y acepta una cancha real ──────────────────────────
  begin
    insert into public.club_match_changes (match_id, challenge_id, club_proponente_id, propuesto_por, campos)
      values (v_m, v_des, v_c1, v_u,
        jsonb_build_object('cancha', jsonb_build_object('latitud', -33.4569, 'longitud', -70.6483, 'cancha_nombre', 'x')));
    v_pudo := true;
  exception when others then v_pudo := false; v_err := sqlstate || ' ' || left(sqlerrm, 60); end;
  if not v_pudo then raise exception 'CASO 6 FALLA: se rechazó un cambio con cancha real (%)', v_err; end if;
  delete from public.club_match_changes where match_id = v_m;   -- el índice único de la 46

  -- ── Caso 7: un cambio sin cancha no puede quedar bloqueado ────
  begin
    insert into public.club_match_changes (match_id, challenge_id, club_proponente_id, propuesto_por, campos)
      values (v_m, v_des, v_c1, v_u, jsonb_build_object('hora', (now() + interval '5 days')::text));
    v_pudo := true;
  exception when others then v_pudo := false; v_err := sqlstate || ' ' || left(sqlerrm, 60); end;
  if not v_pudo then raise exception 'CASO 7 FALLA: un cambio de sólo hora quedó bloqueado (%)', v_err; end if;
  delete from public.club_match_changes where match_id = v_m;

  -- ── Caso 8: coordenadas en texto, a propósito, pasan ──────────
  begin
    insert into public.club_match_changes (match_id, challenge_id, club_proponente_id, propuesto_por, campos)
      values (v_m, v_des, v_c1, v_u,
        jsonb_build_object('cancha', jsonb_build_object('latitud', '0', 'longitud', '0')));
    v_pudo := true;
  exception when check_violation then v_pudo := false;
            when others then v_pudo := null; end;
  if v_pudo is false then
    raise exception 'CASO 8 FALLA: la restricción intentó juzgar coordenadas en texto; eso lo valida la función';
  end if;

  raise notice 'MIGRACIÓN 145: 8/8 casos OK';
end $$;

rollback;
