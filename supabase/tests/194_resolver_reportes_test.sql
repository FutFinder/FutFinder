-- =============================================================
-- FutFinder — pruebas de la migración 194 (resolver reportes).
--
--   A  Sólo modera quien está en el padrón.
--   B  La cola trae a quién se reportó, la descripción y los previos.
--   C  quitar_contenido borra la foto del club reportada y avisa.
--   D  suspender: la persona no puede escribir ni publicar (mensaje con la
--      fecha), sí puede reportar, y los otros reportes sobre ella se cierran.
--   E  descartar no avisa; un reporte ya resuelto no se resuelve de nuevo.
--   F  Ningún cliente lee la tabla de suspensiones.
--
-- Corre entero dentro de la transacción y termina en ROLLBACK.
-- =============================================================

begin;

create temp table r194 (caso text, ok boolean, detalle text);
grant all on r194 to authenticated, anon;

create or replace function pg_temp.como(p_uid uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  execute 'set local role authenticated';
  begin
    execute p_sql into v; execute 'reset role'; v := 'ok:' || coalesce(v, '');
  exception when others then execute 'reset role'; v := 'err:' || sqlstate || ' ' || sqlerrm;
  end;
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

do $$
declare
  u_mod uuid := gen_random_uuid(); u_malo uuid := gen_random_uuid();
  u_rep1 uuid := gen_random_uuid(); u_rep2 uuid := gen_random_uuid();
  v_club uuid; v_foto uuid; v_partido uuid; rep_foto uuid; rep_p1 uuid; rep_p2 uuid; rep_desc uuid;
  r text; j jsonb;
begin
  update public.feature_flags set activo = false where nombre in ('telefono_obligatorio', 'mfa_obligatoria_staff');
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, email_change, email_change_token_new, recovery_token)
  select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated', 'r194-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
    from unnest(array[u_mod, u_malo, u_rep1, u_rep2]) u;
  insert into public.profiles (id, username) select u, 'r194' || substr(replace(u::text, '-', ''), 1, 10)
    from unnest(array[u_mod, u_malo, u_rep1, u_rep2]) u on conflict (id) do nothing;
  insert into public.moderadores (user_id) values (u_mod);

  insert into public.clubs (nombre, slug, created_by) values ('Club r194', 'r194-' || substr(u_malo::text, 1, 8), u_malo) returning id into v_club;
  insert into public.club_members (club_id, user_id, rol) values (v_club, u_malo, 'admin'), (v_club, u_rep1, 'jugador');
  insert into public.club_photos (club_id, photo_url, uploaded_by) values (v_club, 'https://x/r194.jpg', u_malo) returning id into v_foto;
  insert into public.matches (id_organizador, titulo, comuna, cancha_nombre, latitud, longitud, hora, cupos_totales, cupos_disponibles)
  values (u_rep1, 'r194', 'Ñuñoa', 'Cancha', -33.45, -70.6, now() + interval '3 days', 10, 9) returning id into v_partido;
  insert into public.attendees (id_partido, id_jugador, estado) values (v_partido, u_malo, 'inscrito');

  insert into public.user_reports (reporter_id, reported_id, motivo, elemento) values (u_rep1, u_malo, 'foto_inapropiada', 'foto_club:' || v_foto) returning id into rep_foto;
  insert into public.user_reports (reporter_id, reported_id, motivo, descripcion) values (u_rep1, u_malo, 'contenido_ofensivo', 'insulta en el chat') returning id into rep_p1;
  insert into public.user_reports (reporter_id, reported_id, motivo) values (u_rep2, u_malo, 'conducta_antideportiva') returning id into rep_p2;
  insert into public.user_reports (reporter_id, reported_id, motivo) values (u_rep2, u_rep1, 'spam') returning id into rep_desc;

  -- ── A ──
  r := pg_temp.como(u_rep1, format($q$select public.moderacion_resolver_reporte(%L, 'descartar')::text$q$, rep_p1));
  insert into r194 values ('A1 quien no modera no resuelve', r like 'err:42501%', r);

  -- ── B ──
  r := pg_temp.como(u_mod, 'select public.moderacion_cola()::text');
  j := case when r like 'ok:%' then substr(r, 4)::jsonb else null end;
  insert into r194 select 'B1 la cola trae a quién, la descripción y los previos',
    exists (select 1 from jsonb_array_elements(j->'reportes_sin_mirar') e
             where e->>'id' = rep_p1::text and e->>'descripcion' = 'insulta en el chat'
               and e->>'reportado_id' = u_malo::text and (e->>'reportes_previos')::int = 2),
    left(coalesce(r, ''), 300);

  -- ── C ──
  r := pg_temp.como(u_mod, format($q$select public.moderacion_resolver_reporte(%L, 'quitar_contenido', null, 'foto ofensiva')::text$q$, rep_foto));
  insert into r194 select 'C1 quitar contenido borra la foto del club y avisa',
    r like '%"ok" : true%' and not exists (select 1 from public.club_photos where id = v_foto)
      and exists (select 1 from public.notifications where user_id = u_malo and type = 'moderacion' and title = 'Quitamos contenido tuyo')
      and (select decision from public.user_reports where id = rep_foto) = 'quitar_contenido', r;

  -- ── D ──
  r := pg_temp.como(u_mod, format($q$select public.moderacion_resolver_reporte(%L, 'suspender', 7, 'insultos')::text$q$, rep_p1));
  insert into r194 select 'D1 suspender cierra también el otro reporte sobre la persona',
    r like '%"reportes_cerrados" : 2%'
      and (select reviewed_at is not null from public.user_reports where id = rep_p2), r;
  r := pg_temp.como(u_malo, format($q$insert into public.messages (sender_id, match_id, content) values (%L, %L, 'hola') returning 1$q$, u_malo, v_partido));
  insert into r194 values ('D2 la persona suspendida no escribe, y el mensaje dice hasta cuándo', r like 'err:P0001%suspendida hasta el%', r);
  r := pg_temp.como(u_malo, format($q$insert into public.club_photos (club_id, photo_url, uploaded_by) values (%L, 'https://x/r194b.jpg', %L) returning 1$q$, v_club, u_malo));
  insert into r194 values ('D3 ni sube fotos', r like 'err:P0001%suspendida%', r);
  r := pg_temp.como(u_malo, format($q$insert into public.user_reports (reporter_id, reported_id, motivo) values (%L, %L, 'spam') returning 1$q$, u_malo, u_rep2));
  insert into r194 values ('D4 reportar sigue permitido', r like 'ok:%', r);
  r := pg_temp.como(u_rep1, format($q$insert into public.messages (sender_id, match_id, content) values (%L, %L, 'r194') returning 1$q$, u_rep1, v_partido));
  insert into r194 values ('D5 control: quien no está suspendido escribe', r like 'ok:%', r);

  -- ── E ──
  r := pg_temp.como(u_mod, format($q$select public.moderacion_resolver_reporte(%L, 'descartar')::text$q$, rep_desc));
  insert into r194 select 'E1 descartar no avisa',
    r like '%"ok" : true%' and (select estado from public.user_reports where id = rep_desc) = 'descartado'
      and not exists (select 1 from public.notifications where user_id = u_rep1 and type = 'moderacion'), r;
  r := pg_temp.como(u_mod, format($q$select public.moderacion_resolver_reporte(%L, 'advertir')::text$q$, rep_desc));
  insert into r194 values ('E2 un reporte resuelto no se resuelve de nuevo', r like '%ya se resolvió%', r);
  r := pg_temp.como(u_mod, format($q$select public.moderacion_resolver_reporte(%L, 'suspender', 0)::text$q$, rep_p2));
  insert into r194 values ('E3 los días de suspensión se validan', r like '%1 a 365%', r);

  -- ── F ──
  insert into r194 select 'F1 ningún cliente lee las suspensiones',
    not has_table_privilege('authenticated', 'public.moderacion_suspensiones', 'select')
      and not has_table_privilege('anon', 'public.moderacion_suspensiones', 'select'), '';
end $$;

select caso, ok, detalle from r194 order by caso;

rollback;
