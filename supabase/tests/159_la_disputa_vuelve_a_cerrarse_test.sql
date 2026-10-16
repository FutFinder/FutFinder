-- =============================================================
-- FutFinder — pruebas de la migración 159
--
-- Qué cubre, y todo midiendo CONDUCTA, no el texto de la función:
--   1. CONTROL — con el desafío en `esperando_resultado`, proponer un
--      resultado SIGUE funcionando. Sin este caso, un rechazo en el 2 no
--      distinguiría «se cerró la disputa» de «se rompió proponer».
--   2. Con el desafío en `resultado_en_disputa`, el club que propuso NO
--      puede proponer otro.
--   3. Y el club contrario TAMPOCO. La disputa no la reabre ninguna de
--      las dos partes: ése es el sentido de la regla.
--   4. La moderación SÍ la reabre (`moderacion_reabrir_resultado`, de la
--      151), y después de eso vuelve a poder proponerse. Es la salida que
--      la regla deja abierta; sin ella, un encuentro en disputa quedaría
--      trabado para siempre.
--
-- EL CONTROL DE ANTES se midió en el ensayo revertido, con la guarda laxa
-- todavía puesta: `proponer_resultado` devolvía `ok:true` estando en
-- disputa. Después de aplicar la migración ya no se puede reproducir.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

create temp table r159(caso text) on commit drop;

do $$
declare
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid();
  v_ca uuid; v_cb uuid; v_ch uuid; v_prop record; v_m uuid; v_j json;
  v_marca text := 'm159' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
    v_marca||'-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from (values (v_a), (v_b)) as u(id);
  insert into public.profiles (id, username) values (v_a, v_marca||'a'), (v_b, v_marca||'b')
    on conflict (id) do nothing;

  insert into public.clubs (nombre, slug, created_by) values (v_marca||' A', v_marca||'-a', v_a) returning id into v_ca;
  insert into public.clubs (nombre, slug, created_by) values (v_marca||' B', v_marca||'-b', v_b) returning id into v_cb;
  insert into public.club_members (club_id, user_id, rol) values (v_ca, v_a, 'admin'), (v_cb, v_b, 'admin');

  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_ca, v_cb, v_a, 'pendiente') returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  v_prop := public.crear_propuesta_oficial(v_ch, jsonb_build_object(
    'fecha', (now() + interval '6 days')::text, 'duracion_min', 90,
    'direccion', 'Calle', 'cancha_nombre', 'Cancha '||v_marca, 'comuna', 'Ñuñoa',
    'region', 'Metropolitana', 'latitud', -33.4569, 'longitud', -70.6483,
    'modalidad', 'futbol7', 'cupos_por_club', 7, 'metodo_inscripcion', 'orden_llegada',
    'cuota_por_persona', 0), gen_random_uuid());
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  perform public.aprobar_propuesta(v_prop.id, p_me_inscribo => false);
  execute 'reset role';

  select id into v_m from public.matches where challenge_proposal_id = v_prop.id;
  -- El encuentro se juega: el desafío pasa a esperar su resultado.
  update public.matches set estado = 'finalizado', hora = now() - interval '2 hours' where id = v_m;
  update public.club_challenges set estado = 'esperando_resultado' where id = v_ch;

  -- ── Caso 1: control, el camino normal funciona ────────────────
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch, 3, 1, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not true then
    raise exception 'CASO 1 FALLA: esperando_resultado ya no admite una propuesta — %', v_j;
  end if;
  insert into r159 values ('CASO 1 OK — control: en esperando_resultado sí se propone');

  -- El contrario lo rechaza: el desafío queda en disputa.
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  perform public.confirmar_resultado((v_j->>'resultId')::uuid, false);
  execute 'reset role';
  if (select estado from public.club_challenges where id = v_ch) <> 'resultado_en_disputa' then
    raise exception 'SETUP: el desafío no quedó en disputa, está en %',
      (select estado from public.club_challenges where id = v_ch);
  end if;

  -- ── Caso 2: el que propuso no puede volver a proponer ─────────
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch, 2, 2, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false then
    raise exception 'CASO 2 FALLA: en disputa, el club proponente empujó otro marcador — %', v_j;
  end if;
  insert into r159 values ('CASO 2 OK — en disputa, el proponente no propone de nuevo');

  -- ── Caso 3: el contrario tampoco ──────────────────────────────
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_b, 'role','authenticated')::text);
  v_j := public.proponer_resultado(v_ch, 0, 5, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not false then
    raise exception 'CASO 3 FALLA: en disputa, el club contrario empujó su marcador — %', v_j;
  end if;
  insert into r159 values ('CASO 3 OK — y el contrario tampoco: la disputa no la reabre ninguna parte');

  -- ── Caso 4: la moderación sí, y después se puede proponer ─────
  insert into public.moderadores (user_id, nota) values (v_a, 'arnés 159')
    on conflict (user_id) do nothing;
  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_a, 'role','authenticated')::text);
  v_j := public.moderacion_reabrir_resultado(v_ch, 'se revisó el acta');
  if (v_j->>'ok')::boolean is not true then
    raise exception 'CASO 4 FALLA: la moderación no pudo reabrir — %', v_j;
  end if;
  v_j := public.proponer_resultado(v_ch, 2, 2, null);
  execute 'reset role';
  if (v_j->>'ok')::boolean is not true then
    raise exception 'CASO 4 FALLA: reabierto, sigue sin poder proponerse — %', v_j;
  end if;
  insert into r159 values ('CASO 4 OK — la moderación reabre y entonces sí se propone: no queda trabado');

  insert into r159 values ('=== 159: 4/4, el arnes llego a la ultima linea ===');
end $$;

select * from r159;

rollback;
