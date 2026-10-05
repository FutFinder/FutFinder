-- =============================================================
-- FutFinder — pruebas de la migración 153
--
-- Qué cubre:
--   1. CONTROL: la cancha existe y su nombre CALZA con el texto buscado
--      —una consulta directa sobre `canchas` la encuentra—, así que lo
--      único que la mantiene fuera de `search_canchas` es el umbral y no
--      un filtro de texto que no acierta. Sin este caso, un 0 en el 2
--      podría significar «la búsqueda no encuentra nada» en vez de «el
--      umbral funciona».
--      (El control de ANTES/DESPUÉS se hizo en el ensayo revertido, con
--      la función vieja todavía en pie: devolvía 1. Queda anotado en la
--      cabecera de la migración.)
--   2. Una cancha que usó UNA sola persona no se sugiere.
--   3. Con un SEGUNDO organizador distinto, sí se sugiere.
--   4. El MISMO organizador publicando otra vez no la asciende: el
--      umbral cuenta personas, no usos. Es la diferencia que `usos_count`
--      no sabía hacer —en producción, `tangus` tiene 2 usos y 1 persona—.
--   5. La fila de `canchas` se crea desde el PRIMER uso. El umbral está
--      en `search_canchas`, no en la RLS: si la fila no naciera, nunca
--      podría llegar a su segundo organizador.
--   6. `cancha_usos` no la puede leer ni escribir `authenticated`, ni
--      leer `anon`. Publicaría dónde juega cada persona.
--   7. Un partido de propuesta de club no registra cancha ni uso: la
--      ubicación de un desafío no es pública, y eso no cambió.
--   8. Borrar una cancha se lleva sus usos (cascada), así que la limpieza
--      a mano del directorio no deja huérfanos en la tabla nueva.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- New query → Run. Todo corre dentro de una transacción que termina en
-- ROLLBACK, así que no queda nada guardado.
-- =============================================================

begin;

do $$
declare
  v_u1 uuid := gen_random_uuid(); v_u2 uuid := gen_random_uuid();
  v_marca text := 'm153' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_cancha text; v_n integer; v_cid uuid;
  v_c1 uuid := gen_random_uuid(); v_c2 uuid := gen_random_uuid();
  v_des uuid := gen_random_uuid(); v_prop uuid := gen_random_uuid();
begin
  v_cancha := 'Cancha ' || v_marca;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change,
    email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_u1, 'authenticated', 'authenticated',
    'm153a-' || v_u1 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''),
         ('00000000-0000-0000-0000-000000000000', v_u2, 'authenticated', 'authenticated',
    'm153b-' || v_u2 || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', '');
  insert into public.profiles (id, username) values (v_u1, v_marca || 'a'), (v_u2, v_marca || 'b')
    on conflict (id) do update set username = excluded.username;

  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles)
    values (gen_random_uuid(), v_u1, v_marca, 'Ñuñoa', v_cancha, -33.4569, -70.6483,
            now() + interval '2 days', 10, 8);

  select c.id into v_cid from public.canchas c where c.nombre = v_cancha;

  -- ── Caso 5: la fila nace al primer uso ────────────────────────
  if v_cid is null then
    raise exception 'CASO 5 FALLA: la cancha no se registró; sin fila nunca podría llegar a su 2.º uso';
  end if;
  select count(*) into v_n from public.cancha_usos u where u.cancha_id = v_cid;
  if v_n <> 1 then raise exception 'CASO 5 FALLA: se esperaba 1 uso anotado, hay %', v_n; end if;
  raise notice 'CASO 5 OK — la fila nace al primer uso, con su organizador anotado';

  -- ── Caso 1: control, el texto SÍ calza ────────────────────────
  select count(*) into v_n from public.canchas c
   where c.nombre_norm like '%' || public.norm_text(v_marca) || '%';
  if v_n <> 1 then
    raise exception 'CASO 1 FALLA: el control no encuentra la cancha por texto (devolvió %). '
      'Entonces un 0 en el caso 2 no probaría nada sobre el umbral.', v_n;
  end if;
  raise notice 'CASO 1 OK — control: el nombre calza, así que lo único que puede ocultarla es el umbral';

  -- ── Caso 2: con una sola persona, no se sugiere ───────────────
  select count(*) into v_n from public.search_canchas(v_marca, 5);
  if v_n <> 0 then
    raise exception 'CASO 2 FALLA: una cancha de UNA sola persona sigue sugiriéndose (devolvió %)', v_n;
  end if;
  raise notice 'CASO 2 OK — con una sola persona, el directorio no la ofrece';

  -- ── Caso 4: el MISMO organizador otra vez no asciende ─────────
  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles)
    values (gen_random_uuid(), v_u1, v_marca, 'Ñuñoa', v_cancha, -33.4569, -70.6483,
            now() + interval '3 days', 10, 8);
  select count(*) into v_n from public.search_canchas(v_marca, 5);
  if v_n <> 0 then
    raise exception 'CASO 4 FALLA: la misma persona publicando dos veces ascendió la cancha';
  end if;
  select c.usos_count into v_n from public.canchas c where c.id = v_cid;
  if v_n <> 2 then
    raise exception 'CASO 4 FALLA: `usos_count` dejó de contar usos (es %, esperaba 2)', v_n;
  end if;
  raise notice 'CASO 4 OK — dos usos de la misma persona: usos_count sube a 2 y el umbral no cede';

  -- ── Caso 3: un segundo organizador distinto sí ────────────────
  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles)
    values (gen_random_uuid(), v_u2, v_marca, 'Ñuñoa', v_cancha, -33.4569, -70.6483,
            now() + interval '4 days', 10, 8);
  select count(*) into v_n from public.search_canchas(v_marca, 5);
  if v_n <> 1 then
    raise exception 'CASO 3 FALLA: con dos organizadores distintos la cancha no se sugiere (devolvió %)', v_n;
  end if;
  raise notice 'CASO 3 OK — con dos personas distintas, el directorio la ofrece';

  -- ── Caso 6: cancha_usos no es del cliente ─────────────────────
  if has_table_privilege('authenticated', 'public.cancha_usos', 'select')
     or has_table_privilege('authenticated', 'public.cancha_usos', 'insert')
     or has_table_privilege('anon', 'public.cancha_usos', 'select') then
    raise exception 'CASO 6 FALLA: cancha_usos es legible o escribible desde el cliente';
  end if;
  raise notice 'CASO 6 OK — cancha_usos no la toca ni authenticated ni anon';

  -- ── Caso 7: la propuesta de club no registra nada ─────────────
  -- `matches.challenge_proposal_id` tiene FK, así que la propuesta tiene
  -- que existir de verdad: club retador, club retado y desafío. Un uuid
  -- inventado se cae en la FK y el caso nunca llega a probar el guardia.
  insert into public.clubs (id, nombre, slug, created_by) values
    (v_c1, v_marca || ' A', v_marca || '-a', v_u1),
    (v_c2, v_marca || ' B', v_marca || '-b', v_u1);
  insert into public.club_challenges (id, club_retador_id, club_retado_id, creado_por, estado)
    values (v_des, v_c1, v_c2, v_u1, 'negociacion');
  insert into public.club_challenge_proposals (id, challenge_id, club_proponente_id, fecha,
    duracion_min, direccion, cancha_nombre, comuna, region, modalidad, cupos_por_club,
    metodo_inscripcion, latitud, longitud)
    values (v_prop, v_des, v_c1, now() + interval '5 days', 60, 'Calle', 'Prop ' || v_marca,
            'Ñuñoa', 'Metropolitana', 'futbol7', 7, 'orden_llegada', -33.45, -70.64);

  insert into public.matches (id, id_organizador, titulo, comuna, cancha_nombre,
    latitud, longitud, hora, cupos_totales, cupos_disponibles, challenge_proposal_id)
    values (gen_random_uuid(), v_u1, v_marca, 'Ñuñoa', 'Prop ' || v_marca, -33.45, -70.64,
            now() + interval '5 days', 10, 8, v_prop);
  select count(*) into v_n from public.canchas c where c.nombre = 'Prop ' || v_marca;
  if v_n <> 0 then
    raise exception 'CASO 7 FALLA: un partido de propuesta de club registró su cancha';
  end if;
  raise notice 'CASO 7 OK — la cancha de un desafío sigue fuera del directorio';

  -- ── Caso 8: borrar la cancha se lleva sus usos ────────────────
  delete from public.canchas where id = v_cid;
  select count(*) into v_n from public.cancha_usos u where u.cancha_id = v_cid;
  if v_n <> 0 then
    raise exception 'CASO 8 FALLA: quedaron % usos huérfanos tras borrar la cancha', v_n;
  end if;
  raise notice 'CASO 8 OK — la cascada deja la tabla nueva sin huérfanos';

  raise notice '=== 153: 8/8 ===';
end $$;

rollback;
