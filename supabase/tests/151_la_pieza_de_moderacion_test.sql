-- =============================================================
-- FutFinder — pruebas de la migración 151
--
-- Lo que esta migración promete no es que algo funcione, sino que **nada
-- cambie hasta que alguien decida quién modera**. Por eso el arnés mide
-- las dos mitades.
--
-- CON EL PADRÓN VACÍO (casos 1 a 3): nadie modera, la cola está cerrada,
-- reabrir está cerrado, y el desafío en disputa no se mueve ni un poco.
--
-- CON ALGUIEN NOMBRADO (4 a 7): esa persona modera, ve las tres colas con
-- datos reales, reabre un resultado en disputa y deja su evento en el
-- hilo.
--
-- Y LOS DOS BORDES (8 y 9): nombrar a uno NO abre la puerta a los demás,
-- y no se reabre lo que no está en disputa.
--
-- OJO AL MEDIR EL EVENTO. El conteo de `club_challenge_events` va SIN el
-- lente de `authenticated`: su política exige `chat_puede_ver_desafio()`
-- y quien modera no pertenece a ninguno de los dos clubes. Medirlo con la
-- sesión puesta da 0 y parece que el evento no se creó. Costó un rojo, y
-- es la misma lección que dejó la migración 127.
--
-- ESO MISMO ES UN DATO PARA LA PANTALLA FUTURA: quien modera no ve el
-- hilo del desafío que modera. No es un defecto; es el precio de no ser
-- parte. Por eso `club_sanction_reviews.contexto` guarda el expediente
-- copiado al pedir la revisión.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Termina en ROLLBACK y no deja nada — incluido el
-- moderador de prueba, que NO queda nombrado.
-- =============================================================

begin;

do $$
declare
  v_u uuid := gen_random_uuid(); v_mod uuid := gen_random_uuid();
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid(); v_des uuid := gen_random_uuid();
  v_marca text := 'm151' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_pudo boolean; v_r json; v_j jsonb; v_est text; v_n int;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
    'm151-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[v_u, v_mod]) u;
  insert into public.profiles (id, username) values (v_u, v_marca || 'u'), (v_mod, v_marca || 'm')
    on conflict (id) do update set username = excluded.username;
  insert into public.clubs (id, nombre, slug, created_by) values
    (v_c1, v_marca || ' A', v_marca || '-a', v_u),
    (v_c2, v_marca || ' B', v_marca || '-b', v_u);
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
    values (v_des, v_c1, v_c2, v_u, 'resultado_en_disputa');

  -- ── Casos 1 a 3: con el padrón vacío, nada ────────────────────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);

  if public.es_moderador() then raise exception 'CASO 1 FALLA: con el padrón vacío alguien modera'; end if;

  begin perform public.moderacion_cola(); v_pudo := true;
  exception when insufficient_privilege then v_pudo := false; end;
  if v_pudo then raise exception 'CASO 2 FALLA: la cola se abrió sin padrón'; end if;

  begin perform public.moderacion_reabrir_resultado(v_des); v_pudo := true;
  exception when insufficient_privilege then v_pudo := false; end;
  if v_pudo then raise exception 'CASO 3 FALLA: se reabrió sin ser moderador'; end if;

  reset role;
  select estado into v_est from public.club_challenges where id = v_des;
  if v_est <> 'resultado_en_disputa' then
    raise exception 'CASO 3 FALLA: el desafío se movió a % sin que nadie moderara', v_est;
  end if;

  -- ── Casos 4 a 7: con alguien nombrado ─────────────────────────
  insert into public.moderadores (user_id, nota) values (v_mod, 'prueba del arnés');
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_mod, 'role', 'authenticated')::text, true);

  if not public.es_moderador() then raise exception 'CASO 4 FALLA: el nombrado no modera'; end if;

  select public.moderacion_cola() into v_j;
  if jsonb_array_length(v_j -> 'resultados_en_disputa') < 1 then
    raise exception 'CASO 5 FALLA: la cola no trae el resultado en disputa (%)', v_j;
  end if;

  select public.moderacion_reabrir_resultado(v_des, 'se reabre') into v_r;
  if (v_r ->> 'ok')::boolean is not true then raise exception 'CASO 6 FALLA: no reabrió (%)', v_r; end if;

  -- Caso 9 antes de soltar la sesión: no se reabre dos veces.
  select public.moderacion_reabrir_resultado(v_des) into v_r;
  if (v_r ->> 'ok')::boolean is not false then
    raise exception 'CASO 9 FALLA: reabrió uno que ya no estaba en disputa (%)', v_r;
  end if;

  reset role;
  select estado into v_est from public.club_challenges where id = v_des;
  if v_est <> 'esperando_resultado' then raise exception 'CASO 6 FALLA: estado %', v_est; end if;

  -- Sin el lente de `authenticated`: ver la nota de arriba.
  select count(*) into v_n from public.club_challenge_events
   where challenge_id = v_des and tipo = 'resultado_reabierto';
  if v_n <> 1 then raise exception 'CASO 7 FALLA: no dejó su evento en el hilo (%)', v_n; end if;

  -- ── Caso 8: nombrar a uno no abre la puerta a los demás ───────
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  if public.es_moderador() then
    raise exception 'CASO 8 FALLA: nombrar a uno le abrió la puerta a otro';
  end if;
  reset role;

  raise notice 'MIGRACIÓN 151: 9/9 casos OK (el padrón queda vacío: el rollback se lleva al moderador de prueba)';
end $$;

rollback;
