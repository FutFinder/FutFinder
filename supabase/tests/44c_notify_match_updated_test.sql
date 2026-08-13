-- =============================================================
-- FutFinder — pruebas de `notify_match_updated()` (migración 44c)
--
-- EL FALLO QUE REPRODUCE. La función acumula los campos que cambiaron
-- en un `text[]` así:
--
--     v_cambios := v_cambios || 'la fecha y hora';
--
-- PostgreSQL tiene dos operadores candidatos, `anyarray || anyelement`
-- y `anyarray || anyarray`, y con un literal sin tipo prefiere el
-- segundo: intenta leer «la fecha y hora» como literal de arreglo y
-- revienta con «malformed array literal». Como el trigger es
-- `AFTER UPDATE` sobre `matches`, el error sube y **la actualización
-- entera falla**.
--
-- Consecuencia comprobada contra el proyecto: cambiar la hora, la
-- cancha, la comuna o la cuota de CUALQUIER partido —normal o de
-- clubes— es imposible hoy. Editar un partido está roto. Sólo se salva
-- cambiar la descripción, porque ninguno de los cuatro campos
-- vigilados se mueve y la función sale antes por su `return`.
--
-- Este archivo corre igual antes y después del arreglo: ANTES falla en
-- el caso 1 con el error de arriba —eso es la reproducción— y DESPUÉS
-- pasa entero.
--
-- Qué cubre:
--   1. Cambiar la FECHA (día) funciona y avisa.
--   2. Cambiar la HORA (misma fecha, otra hora) funciona y avisa.
--   3. Cambiar la CANCHA funciona y avisa.
--   4. Cambiar la COMUNA funciona y avisa.
--   5. Cambiar la CUOTA funciona y avisa.
--   6. Cambiar la DESCRIPCIÓN no genera aviso: no es de los campos
--      vigilados, y avisar por ella sería ruido.
--   7. Cambiar VARIOS campos a la vez genera UN aviso que los enumera.
--   8. El aviso llega a los inscritos y NO al organizador.
--   9. Un partido cancelado no genera aviso de cambio: la cancelación
--      tiene el suyo.
--
-- Requisito: sólo la migración 44c. No depende de la 44b.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor.
-- Todo corre en una transacción que termina en ROLLBACK.
-- =============================================================

begin;

create temp table t44c (n integer, caso text, detalle text) on commit drop;

do $$
declare
  v_org uuid := gen_random_uuid();   -- organizador: no recibe avisos
  v_j1  uuid := gen_random_uuid();   -- inscrito: sí los recibe
  v_m   uuid;
  v_count int;
  v_body  text;
  v_hora  timestamptz;
begin
  insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
    created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,email_change,
    email_change_token_new,recovery_token)
  select '00000000-0000-0000-0000-000000000000',u.id,'authenticated','authenticated',
    'notif-'||u.tag||'-'||u.id||'@futfinder.test','x',now(),now(),now(),'{}','{}','','','',''
  from (values (v_org,'org'),(v_j1,'j1')) as u(id,tag);

  v_hora := date_trunc('hour', now()) + interval '3 days' + interval '20 hours';

  insert into public.matches (id_organizador, titulo, comuna, region, cancha_nombre, direccion,
    latitud, longitud, hora, duracion_min, cupos_totales, cupos_disponibles, precio_cuota)
  values (v_org, 'Partido editable 44c', 'Providencia', 'Región Metropolitana de Santiago',
    'Cancha Uno', 'Av. Providencia 100', -33.4200000, -70.6100000,
    v_hora, 90, 10, 9, 5000)
  returning id into v_m;

  insert into public.attendees (id_partido, id_jugador, estado) values (v_m, v_j1, 'inscrito');

  -- ══ CASO 1: la FECHA ═════════════════════════════════════════
  -- Aquí es donde revienta la versión rota, con «malformed array
  -- literal: "la fecha y hora"».
  update public.matches set hora = v_hora + interval '1 day' where id = v_m;

  select count(*), max(body) into v_count, v_body
    from public.notifications
   where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m and user_id = v_j1;
  if v_count <> 1 then raise exception 'FALLÓ (caso 1): % avisos tras cambiar la fecha', v_count; end if;
  if v_body not like '%la fecha y hora%' then
    raise exception 'FALLÓ (caso 1): el aviso no menciona la fecha — «%»', v_body; end if;
  insert into t44c values (1,'caso 1', format('cambiar la fecha funciona y avisa: «%s»', v_body));

  -- ══ CASO 2: la HORA, mismo día ═══════════════════════════════
  delete from public.notifications where (data ->> 'matchId')::uuid = v_m;
  update public.matches set hora = (v_hora + interval '1 day') + interval '2 hours' where id = v_m;

  select count(*), max(body) into v_count, v_body
    from public.notifications
   where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m and user_id = v_j1;
  if v_count <> 1 then raise exception 'FALLÓ (caso 2): % avisos tras cambiar la hora', v_count; end if;
  insert into t44c values (2,'caso 2', format('cambiar la hora funciona y avisa: «%s»', v_body));

  -- ══ CASO 3: la CANCHA ════════════════════════════════════════
  delete from public.notifications where (data ->> 'matchId')::uuid = v_m;
  update public.matches set cancha_nombre = 'Cancha Dos' where id = v_m;

  select count(*), max(body) into v_count, v_body
    from public.notifications
   where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m and user_id = v_j1;
  if v_count <> 1 or v_body not like '%la cancha%' then
    raise exception 'FALLÓ (caso 3): cambiar la cancha — % avisos, «%»', v_count, v_body; end if;
  insert into t44c values (3,'caso 3', format('cambiar la cancha funciona y avisa: «%s»', v_body));

  -- ══ CASO 4: la COMUNA ════════════════════════════════════════
  delete from public.notifications where (data ->> 'matchId')::uuid = v_m;
  update public.matches set comuna = 'Ñuñoa' where id = v_m;

  select count(*), max(body) into v_count, v_body
    from public.notifications
   where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m and user_id = v_j1;
  if v_count <> 1 or v_body not like '%la comuna%' then
    raise exception 'FALLÓ (caso 4): cambiar la comuna — % avisos, «%»', v_count, v_body; end if;
  insert into t44c values (4,'caso 4', format('cambiar la comuna funciona y avisa: «%s»', v_body));

  -- ══ CASO 5: la CUOTA ═════════════════════════════════════════
  delete from public.notifications where (data ->> 'matchId')::uuid = v_m;
  update public.matches set precio_cuota = 7000 where id = v_m;

  select count(*), max(body) into v_count, v_body
    from public.notifications
   where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m and user_id = v_j1;
  if v_count <> 1 or v_body not like '%la cuota%' then
    raise exception 'FALLÓ (caso 5): cambiar la cuota — % avisos, «%»', v_count, v_body; end if;
  insert into t44c values (5,'caso 5', format('cambiar la cuota funciona y avisa: «%s»', v_body));

  -- ══ CASO 6: la DESCRIPCIÓN no avisa ══════════════════════════
  delete from public.notifications where (data ->> 'matchId')::uuid = v_m;
  update public.matches set descripcion = 'Lleven petos claros' where id = v_m;

  select count(*) into v_count
    from public.notifications where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 6): la descripción generó % aviso(s)', v_count; end if;
  insert into t44c values (6,'caso 6','cambiar la descripción no genera aviso: no es de los campos vigilados');

  -- ══ CASO 7: VARIOS campos a la vez ═══════════════════════════
  delete from public.notifications where (data ->> 'matchId')::uuid = v_m;
  update public.matches
     set hora = v_hora + interval '5 days',
         cancha_nombre = 'Cancha Tres',
         comuna = 'Macul',
         precio_cuota = 9000
   where id = v_m;

  select count(*), max(body) into v_count, v_body
    from public.notifications
   where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m and user_id = v_j1;
  if v_count <> 1 then
    raise exception 'FALLÓ (caso 7): cuatro cambios generaron % avisos, debería ser 1', v_count; end if;
  if v_body not like '%la fecha y hora%' or v_body not like '%la cancha%'
     or v_body not like '%la comuna%' or v_body not like '%la cuota%' then
    raise exception 'FALLÓ (caso 7): el aviso no enumera los cuatro cambios — «%»', v_body; end if;
  insert into t44c values (7,'caso 7', format('cuatro cambios a la vez, UN aviso que los enumera: «%s»', v_body));

  -- ══ CASO 8: quién recibe el aviso ════════════════════════════
  select count(*) into v_count
    from public.notifications
   where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m and user_id = v_org;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 8): el organizador recibió su propio aviso'; end if;
  insert into t44c values (8,'caso 8','el aviso llega a los inscritos y no al organizador, que es quien lo hizo');

  -- ══ CASO 9: un partido cancelado no avisa de cambios ═════════
  delete from public.notifications where (data ->> 'matchId')::uuid = v_m;
  update public.matches set estado = 'cancelado', hora = v_hora + interval '9 days' where id = v_m;

  select count(*) into v_count
    from public.notifications where type = 'match_updated' and (data ->> 'matchId')::uuid = v_m;
  if v_count <> 0 then
    raise exception 'FALLÓ (caso 9): un partido cancelado generó % aviso(s) de cambio', v_count; end if;
  insert into t44c values (9,'caso 9','un partido cancelado no avisa de cambios: la cancelación tiene su propio aviso');
end;
$$;

select n, caso, detalle from t44c order by n;

rollback;
