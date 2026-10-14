-- =============================================================
-- FutFinder — pruebas de la migración 156
--
-- Qué cubre:
--   1. CONTROL — una propuesta SIN nivel lo guarda como `null`, **no**
--      como `'recreativo'`. Es la distinción que esta migración existe
--      para hacer: un valor por omisión disfrazado de dato era el fallo
--      original. Si este caso fallara, habríamos repetido el problema.
--   2. ...y el partido que nace de ella conserva `'recreativo'`. Nada
--      cambia hacia atrás para las propuestas viejas.
--   3. Una propuesta CON nivel lo guarda tal cual.
--   4. Y el partido aprobado sale con **ese** nivel, no con el de la
--      tabla. Es el caso por el que existe la migración entera: hasta
--      ahora los nueve partidos de clubes estaban en `recreativo` y
--      ninguno por elección.
--   5. Un nivel inventado se rechaza en la fuente.
--   6. Quien aprueba no puede cambiarlo: `aprobar_propuesta` sigue
--      tomando dos argumentos y ninguno es el nivel. La decisión fue que
--      lo fija quien propone y no se negocia; si alguien le agregara un
--      parámetro, esto lo dice.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

create temp table r(caso text) on commit drop;

do $$
declare
  v_a1 uuid := gen_random_uuid(); v_b1 uuid := gen_random_uuid();
  v_ca uuid; v_cb uuid; v_cc uuid; v_cd uuid; v_ch uuid; v_prop record; v_match record;
  v_marca text := 'm156' || substr(replace(gen_random_uuid()::text,'-',''),1,6);
  v_payload jsonb; v_nivel text; v_pudo boolean;

begin
  -- Dos personas, dos clubes, sin administrador en común (lo exige
  -- `club_challenges_valida_rival`).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
    'm156-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from (values (v_a1), (v_b1)) as u(id);
  insert into public.profiles (id, username) values
    (v_a1, v_marca||'a'), (v_b1, v_marca||'b') on conflict (id) do nothing;

  insert into public.clubs (nombre, slug, created_by)
  values (v_marca||' A', v_marca||'-a', v_a1) returning id into v_ca;
  insert into public.clubs (nombre, slug, created_by)
  values (v_marca||' B', v_marca||'-b', v_b1) returning id into v_cb;
  -- Un SEGUNDO par de clubes, porque dos clubes no pueden tener dos
  -- desafíos en curso a la vez («Ya tienen un desafío en curso con este
  -- club»). El par comparte personas pero no entre sí: A y C los lleva la
  -- misma persona, B y D la otra, y ningún par comparte administrador,
  -- que es lo que exige `club_challenges_valida_rival`.
  insert into public.clubs (nombre, slug, created_by)
  values (v_marca||' C', v_marca||'-c', v_a1) returning id into v_cc;
  insert into public.clubs (nombre, slug, created_by)
  values (v_marca||' D', v_marca||'-d', v_b1) returning id into v_cd;
  insert into public.club_members (club_id, user_id, rol) values
    (v_ca, v_a1, 'admin'), (v_cb, v_b1, 'admin'),
    (v_cc, v_a1, 'admin'), (v_cd, v_b1, 'admin');

  v_payload := jsonb_build_object(
    'fecha', (now() + interval '3 days')::text, 'duracion_min', 90,
    'direccion', 'Av. Siempre Viva 742', 'cancha_nombre', 'Complejo '||v_marca,
    'comuna', 'Ñuñoa', 'region', 'Metropolitana',
    'latitud', -33.4569, 'longitud', -70.6483, 'modalidad', 'futbol7',
    'cupos_por_club', 7, 'metodo_inscripcion', 'orden_llegada',
    'cuota_por_persona', 4000);

  -- ══ Desafío 1: SIN nivel (el comportamiento de siempre) ══════
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_ca, v_cb, v_a1, 'pendiente') returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role','authenticated')::text);
  v_prop := public.crear_propuesta_oficial(v_ch, v_payload, gen_random_uuid());
  execute 'reset role';

  -- ── Caso 1: null, no 'recreativo' ─────────────────────────────
  select nivel into v_nivel from public.club_challenge_proposals where id = v_prop.id;
  if v_nivel is not null then
    raise exception 'CASO 1 FALLA: sin elegir nivel, la propuesta guardó %. '
      'Un valor por omisión disfrazado de dato es justo el fallo original.', v_nivel;
  end if;
  insert into r values ('CASO 1 OK — control: sin elegir, la propuesta guarda null, no «recreativo»');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role','authenticated')::text);
  v_match := public.aprobar_propuesta(v_prop.id, false);
  execute 'reset role';

  -- ── Caso 2: el partido conserva 'recreativo' ──────────────────
  select nivel into v_nivel from public.matches where challenge_proposal_id = v_prop.id;
  if v_nivel is distinct from 'recreativo' then
    raise exception 'CASO 2 FALLA: una propuesta sin nivel debería dar un partido recreativo, dio %', v_nivel;
  end if;
  insert into r values ('CASO 2 OK — y su partido conserva «recreativo»: nada cambia hacia atrás');

  -- ══ Desafío 2: CON nivel competitivo, entre C y D ════════════
  insert into public.club_challenges (club_retador_id, club_retado_id, creado_por, estado)
  values (v_cc, v_cd, v_a1, 'pendiente') returning id into v_ch;

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role','authenticated')::text);
  perform public.aceptar_desafio(v_ch);
  execute 'reset role';

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_a1, 'role','authenticated')::text);
  v_prop := public.crear_propuesta_oficial(
    v_ch, v_payload || jsonb_build_object('nivel','competitivo'), gen_random_uuid());
  execute 'reset role';

  -- ── Caso 3: la propuesta lo guarda ────────────────────────────
  select nivel into v_nivel from public.club_challenge_proposals where id = v_prop.id;
  if v_nivel is distinct from 'competitivo' then
    raise exception 'CASO 3 FALLA: la propuesta guardó % en vez de competitivo', coalesce(v_nivel,'null');
  end if;
  insert into r values ('CASO 3 OK — la propuesta guarda el nivel elegido');

  execute 'set local role authenticated';
  execute format('set local request.jwt.claims to %L',
    json_build_object('sub', v_b1, 'role','authenticated')::text);
  v_match := public.aprobar_propuesta(v_prop.id, false);
  execute 'reset role';

  -- ── Caso 4: EL CASO ───────────────────────────────────────────
  select nivel into v_nivel from public.matches where challenge_proposal_id = v_prop.id;
  if v_nivel is distinct from 'competitivo' then
    raise exception 'CASO 4 FALLA: el partido salió % en vez de competitivo. '
      'Es exactamente el fallo que esta migración viene a cerrar.', coalesce(v_nivel,'null');
  end if;
  insert into r values ('CASO 4 OK — el partido aprobado sale «competitivo», no el valor de la tabla');

  -- ── Caso 5: un nivel inventado no entra ───────────────────────
  begin
    update public.club_challenge_proposals set nivel = 'semiprofesional' where id = v_prop.id;
    v_pudo := true;
  exception when check_violation then v_pudo := false; end;
  if v_pudo then raise exception 'CASO 5 FALLA: se aceptó un nivel inventado'; end if;
  insert into r values ('CASO 5 OK — un nivel inventado se rechaza en la fuente');

  -- ── Caso 6: quien aprueba no lo cambia ────────────────────────
  if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='aprobar_propuesta'
         and pg_get_function_identity_arguments(p.oid) = 'p_proposal_id uuid, p_me_inscribo boolean') <> 1 then
    raise exception 'CASO 6 FALLA: aprobar_propuesta cambió de firma; el nivel podría negociarse '
      'y la decisión fue que lo fija quien propone';
  end if;
  insert into r values ('CASO 6 OK — aprobar_propuesta sigue sin recibir el nivel');

  insert into r values ('=== 156: 6/6, el arnes llego a la ultima linea ===');
end $$;

select * from r;

rollback;
