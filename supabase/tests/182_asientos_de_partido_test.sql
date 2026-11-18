-- Arnés de la migración 182 (asientos de partido).
-- Crea sólo datos ficticios y termina en ROLLBACK. Si la 182 no está
-- aplicada, correr en una sola transacción: begin; <migración>; <este cuerpo>.
-- Las puertas se llaman como `authenticated`, cambiando de usuario con el
-- claim del JWT; `postgres` sólo prepara los datos y mueve la bandera.
begin;

create temp table asi_fx (
    org uuid, amigo uuid, extra uuid, publico uuid, ajeno uuid,
    partido uuid, chico uuid, token uuid
) on commit drop;
grant select, update on asi_fx to authenticated;

create or replace function pg_temp.soy(p uuid) returns void language plpgsql as $$
begin
    perform set_config('request.jwt.claim.sub', p::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;
grant execute on function pg_temp.soy(uuid) to authenticated;

create or replace function pg_temp.partido(p_titulo text, p_total int, p_token uuid default gen_random_uuid())
returns jsonb language sql as $$
    select jsonb_build_object(
        'titulo', p_titulo, 'region', 'Región Metropolitana de Santiago', 'comuna', 'Ñuñoa',
        'cancha_nombre', 'Cancha ficticia ' || p_token, 'latitud', -33.4569, 'longitud', -70.6107,
        'hora', now() + interval '20 days', 'duracion_min', 60, 'jugadores_total', p_total,
        'client_token', p_token);
$$;

grant execute on function pg_temp.partido(text, int, uuid) to authenticated;

do $$
declare f record;
begin
    insert into asi_fx (org, amigo, extra, publico, ajeno)
    values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid())
    returning * into f;

    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
        confirmation_token, email_change, email_change_token_new, recovery_token
    ) select '00000000-0000-0000-0000-000000000000', u, 'authenticated', 'authenticated',
        'asiento-' || u || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
      from unnest(array[f.org, f.amigo, f.extra, f.publico, f.ajeno]) u;

    insert into public.friendships (requester_id, addressee_id, status)
    values (f.org, f.amigo, 'accepted');
end $$;

-- ── Como usuarios de la app ──────────────────────────────────────
set local role authenticated;
do $$
declare
    f record; r jsonb; m record; n int; v_tok uuid := gen_random_uuid(); v_id uuid; v_asiento uuid;
    v_trust_antes int; v_trust_despues int;
begin
    select * into strict f from asi_fx;

    -- 1. El ejemplo del encargo: 14 jugadores, 10 confirmados → 10/14.
    perform pg_temp.soy(f.org);
    r := public.publicar_partido_con_asientos(
        pg_temp.partido('Arnés 182: catorce', 14, v_tok),
        jsonb_build_array(
            jsonb_build_object('tipo', 'amigo', 'user_id', f.amigo),
            jsonb_build_object('tipo', 'nombre', 'nombre', '  Johan  '),
            jsonb_build_object('tipo', 'nombre', 'nombre', 'Mario')));
    v_id := (r->'match'->>'id')::uuid;
    update asi_fx set partido = v_id;
    -- Desde la 187 no se publica con reservados: se reservan ya publicado,
    -- desde «Gestionar».
    perform public.asiento_agregar(v_id, 'reservado', null, 6);
    select * into strict m from public.matches where id = v_id;
    if m.cupos_totales <> 13 or m.cupos_disponibles <> 4 or m.estado <> 'abierto' then
        raise exception 'FALLÓ 1: esperaba 13 plazas y 4 libres, hay %/% (%)', m.cupos_disponibles, m.cupos_totales, m.estado;
    end if;
    if (m.cupos_totales + 1 - m.cupos_disponibles) <> 10 then raise exception 'FALLÓ 1b: el contador no da 10/14'; end if;
    select count(*) into n from public.match_asientos where id_partido = v_id and tipo = 'nombre' and nombre = 'Johan';
    if n <> 1 then raise exception 'FALLÓ 1c: el nombre no quedó limpio'; end if;
    select count(*) into n from public.attendees where id_partido = v_id and id_jugador = f.amigo and estado = 'inscrito' and origen = 'asiento_asignado';
    if n <> 1 then raise exception 'FALLÓ 1d: el amigo no quedó sentado'; end if;

    -- 2. Publicar dos veces con el mismo token devuelve el mismo partido.
    r := public.publicar_partido_con_asientos(pg_temp.partido('Arnés 182: catorce', 14, v_tok), '[]'::jsonb);
    if (r->'match'->>'id')::uuid <> v_id or not (r->>'duplicate')::boolean then raise exception 'FALLÓ 2: el token no es idempotente'; end if;

    -- 3. El total tiene que ser mayor que lo ocupado: 3 jugadores con 2 asientos no se publica.
    begin
        perform public.publicar_partido_con_asientos(pg_temp.partido('Arnés 182: sin libres', 3),
            jsonb_build_array(jsonb_build_object('tipo', 'nombre', 'nombre', 'Ana'),
                              jsonb_build_object('tipo', 'nombre', 'nombre', 'Beto')));
        raise exception 'FALLÓ 3: se publicó un partido sin asientos libres';
    exception when raise_exception then
        if sqlerrm not like 'ASIENTO_SIN_LIBRES%' then raise; end if;
    end;
    select count(*) into n from public.matches where titulo = 'Arnés 182: sin libres';
    if n <> 0 then raise exception 'FALLÓ 3b: el partido rechazado quedó creado'; end if;

    -- 4. Sólo amigos, y un perfil no ocupa dos asientos.
    begin
        perform public.asiento_asignar_amigo(v_id, f.ajeno);
        raise exception 'FALLÓ 4: se sentó a alguien que no es amigo';
    exception when raise_exception then
        if sqlerrm not like 'ASIENTO_NO_ES_AMIGO%' then raise; end if;
    end;
    begin
        perform public.asiento_asignar_amigo(v_id, f.amigo);
        raise exception 'FALLÓ 4b: el mismo perfil ocupó dos asientos';
    exception when raise_exception then
        if sqlerrm not like 'ASIENTO_YA_EN_PARTIDO%' then raise; end if;
    end;

    -- 5. Nadie más que el organizador arma asientos, ni escribe la tabla a mano.
    perform pg_temp.soy(f.ajeno);
    begin
        perform public.asiento_agregar(v_id, 'reservado');
        raise exception 'FALLÓ 5: un tercero reservó un asiento';
    exception when raise_exception then
        if sqlerrm not like 'ASIENTO_SOLO_ORGANIZADOR%' then raise; end if;
    end;
    begin
        perform public.asientos_link(v_id);
        raise exception 'FALLÓ 5b: un tercero obtuvo el link';
    exception when raise_exception then
        if sqlerrm not like 'ASIENTO_SOLO_ORGANIZADOR%' then raise; end if;
    end;
    begin
        insert into public.match_asientos (id_partido, tipo) values (v_id, 'reservado');
        raise exception 'FALLÓ 5c: se escribió match_asientos a mano';
    exception when insufficient_privilege then null;
    end;
    begin
        perform 1 from public.match_invitaciones;
        raise exception 'FALLÓ 5d: el cliente lee los tokens';
    exception when insufficient_privilege then null;
    end;
    select count(*) into n from public.match_asientos where id_partido = v_id;
    if n <> 8 then raise exception 'FALLÓ 5e: quien ve el partido debería ver sus 8 asientos, ve %', n; end if;

    -- 6. El link toma una reserva y no toca los libres.
    perform pg_temp.soy(f.org);
    r := public.asientos_link(v_id);
    update asi_fx set token = (r->>'token')::uuid;
    perform pg_temp.soy(f.extra);
    r := public.tomar_asiento_reservado(v_id, gen_random_uuid());
    if (r->>'ok')::boolean or r->>'reason' <> 'LINK_INVALIDO' then raise exception 'FALLÓ 6: un token inventado sirvió: %', r; end if;
    r := public.tomar_asiento_reservado(v_id, (select token from asi_fx));
    if not (r->>'ok')::boolean then raise exception 'FALLÓ 6b: no tomó la reserva: %', r; end if;
    select * into strict m from public.matches where id = v_id;
    select count(*) into n from public.match_asientos where id_partido = v_id and tipo = 'reservado';
    if n <> 5 or m.cupos_disponibles <> 4 then raise exception 'FALLÓ 6c: quedan % reservas y % libres', n, m.cupos_disponibles; end if;
    r := public.tomar_asiento_reservado(v_id, (select token from asi_fx));
    if not coalesce((r->>'ya_estaba')::boolean, false) then raise exception 'FALLÓ 6d: tomó dos asientos'; end if;
    select count(*) into n from public.match_asientos where id_partido = v_id and tipo = 'reservado';
    if n <> 5 then raise exception 'FALLÓ 6e: la segunda llamada gastó otra reserva'; end if;

    -- 7. Sin reservas el link no entra, aunque queden cupos libres.
    perform pg_temp.soy(f.org);
    r := public.publicar_partido_con_asientos(pg_temp.partido('Arnés 182: chico', 4), '[]'::jsonb);
    update asi_fx set chico = (r->'match'->>'id')::uuid;
    perform public.asiento_agregar((select chico from asi_fx), 'reservado');
    r := public.asientos_link((select chico from asi_fx));
    v_tok := (r->>'token')::uuid;
    select id into strict v_asiento from public.match_asientos where id_partido = (select chico from asi_fx);
    perform public.asiento_liberar(v_asiento);
    select * into strict m from public.matches where id = (select chico from asi_fx);
    if m.cupos_disponibles <> 3 then raise exception 'FALLÓ 7: liberar no devolvió el cupo al público (%)', m.cupos_disponibles; end if;
    perform pg_temp.soy(f.publico);
    r := public.tomar_asiento_reservado(m.id, v_tok);
    if (r->>'ok')::boolean or r->>'reason' <> 'SIN_RESERVAS' then raise exception 'FALLÓ 7b: el link entró a un cupo libre: %', r; end if;
    select count(*) into n from public.attendees where id_partido = m.id and id_jugador = f.publico;
    if n <> 0 then raise exception 'FALLÓ 7c: quedó inscrito sin reserva'; end if;

    -- 8. Un cupo libre se toma por la puerta de siempre.
    r := public.join_match(v_id)::jsonb;
    select * into strict m from public.matches where id = v_id;
    if m.cupos_disponibles <> 3 then raise exception 'FALLÓ 8: unirse no descontó un libre (% · %)', m.cupos_disponibles, r; end if;

    -- 9. El amigo asignado se baja sin costo y el asiento queda libre.
    perform pg_temp.soy(f.amigo);
    select trust_score into v_trust_antes from public.profiles where id = f.amigo;
    r := public.truescore_costo_salida(v_id);
    if (r->>'ok')::boolean and (r->>'puntos')::int <> 0 then raise exception 'FALLÓ 9: el costo anunciado no es 0: %', r; end if;
    r := public.leave_match_penalized(v_id);
    if not (r->>'ok')::boolean or (r->>'penalty')::int <> 0 then raise exception 'FALLÓ 9b: salir costó puntos: %', r; end if;
    select trust_score into v_trust_despues from public.profiles where id = f.amigo;
    if v_trust_antes is distinct from v_trust_despues then raise exception 'FALLÓ 9c: el puntaje cambió'; end if;
    select * into strict m from public.matches where id = v_id;
    if m.cupos_disponibles <> 4 then raise exception 'FALLÓ 9d: el asiento no volvió al público'; end if;

    -- 10. Reemplazar un nombre por la cuenta del amigo, y llenar el partido.
    perform pg_temp.soy(f.org);
    select id into strict v_asiento from public.match_asientos where id_partido = v_id and nombre = 'Johan';
    perform public.asiento_asignar_amigo(v_id, f.amigo, v_asiento);
    select * into strict m from public.matches where id = v_id;
    select count(*) into n from public.match_asientos where id_partido = v_id and tipo = 'nombre';
    if n <> 1 or m.cupos_disponibles <> 4 then raise exception 'FALLÓ 10: el reemplazo movió los libres (% nombres, % libres)', n, m.cupos_disponibles; end if;
    perform public.asiento_agregar(v_id, 'reservado', null, 4);
    select * into strict m from public.matches where id = v_id;
    if m.cupos_disponibles <> 0 or m.estado <> 'lleno' then raise exception 'FALLÓ 10b: no quedó completo (% · %)', m.cupos_disponibles, m.estado; end if;
    begin
        perform public.asiento_agregar(v_id, 'reservado');
        raise exception 'FALLÓ 10c: se reservó sin cupos libres';
    exception when raise_exception then
        if sqlerrm not like 'ASIENTO_SIN_LIBRES%' then raise; end if;
    end;
    -- Bajar el total por debajo de lo ocupado lo sigue frenando la guarda.
    begin
        update public.matches set cupos_totales = 5 where id = v_id;
        raise exception 'FALLÓ 10d: se achicó el partido por debajo de sus asientos';
    exception when raise_exception then
        if sqlerrm not like 'CUPOS_MENOR_QUE_CONFIRMADOS%' then raise; end if;
    end;
end $$;
reset role;

-- ── La bandera se apaga sola por fecha ───────────────────────────
update public.feature_flags set termina_at = now() - interval '1 minute' where nombre = 'asientos_por_nombre';

set local role authenticated;
do $$
declare f record; r jsonb; v_asiento uuid;
begin
    select * into strict f from asi_fx;
    perform pg_temp.soy(f.org);
    r := public.partidos_ajustes();
    if (r->>'asientos_por_nombre')::boolean then raise exception 'FALLÓ 11: la bandera vencida sigue activa'; end if;
    begin
        perform public.asiento_agregar(f.chico, 'nombre', 'Joaquín');
        raise exception 'FALLÓ 11b: se escribió un nombre con la bandera vencida';
    exception when raise_exception then
        if sqlerrm not like 'ASIENTO_NOMBRES_APAGADO%' then raise; end if;
    end;
    -- Un nombre que ya estaba se puede pasar a reservado o liberar.
    select id into strict v_asiento from public.match_asientos where id_partido = f.partido and tipo = 'nombre';
    perform public.asiento_cambiar(v_asiento, 'reservado');
    perform public.asiento_liberar(v_asiento);
end $$;
reset role;

-- ── Privilegios y limpieza ───────────────────────────────────────
do $$
declare f record; n int; v text;
begin
    select * into strict f from asi_fx;

    foreach v in array array[
        'asientos_armar(uuid, jsonb)', 'publicar_partido_con_asientos(jsonb, jsonb)',
        'asiento_asignar_amigo(uuid, uuid, uuid)', 'asiento_agregar(uuid, text, text, integer)',
        'asiento_cambiar(uuid, text, text)', 'asiento_liberar(uuid)', 'asiento_quitar_amigo(uuid, uuid)',
        'asientos_link(uuid)', 'tomar_asiento_reservado(uuid, uuid)', 'partidos_ajustes()',
        'limpiar_asientos_vencidos()', '_asiento_partido(uuid)', '_asiento_libres(uuid)',
        '_asiento_recontar(uuid)', '_asiento_nombre_limpio(text)', '_asiento_sentar_amigo(matches, uuid)'
    ] loop
        if has_function_privilege('anon', ('public.' || v)::regprocedure, 'execute') then
            raise exception 'FALLÓ 12: anon ejecuta %', v;
        end if;
        if (v like '\_%' or v like 'limpiar%')
           and has_function_privilege('authenticated', ('public.' || v)::regprocedure, 'execute') then
            raise exception 'FALLÓ 12b: authenticated ejecuta el ayudante %', v;
        end if;
    end loop;
    if has_table_privilege('anon', 'public.match_asientos', 'select') then raise exception 'FALLÓ 12c: anon lee los asientos'; end if;

    -- 13. Cancelado el partido, sus asientos y su link se van; la nómina queda.
    select count(*) into n from public.match_asientos where id_partido = f.partido;
    if n = 0 then raise exception 'FALLÓ 13: el caso quedaría vacío, no hay asientos que limpiar'; end if;
    update public.matches set estado = 'cancelado' where id = f.partido;
    perform public.limpiar_asientos_vencidos();
    select count(*) into n from public.match_asientos where id_partido = f.partido;
    if n <> 0 then raise exception 'FALLÓ 13b: quedaron % asientos de un partido cancelado', n; end if;
    select count(*) into n from public.match_invitaciones where id_partido = f.partido;
    if n <> 0 then raise exception 'FALLÓ 13c: quedó el link'; end if;
    select count(*) into n from public.attendees where id_partido = f.partido;
    if n < 3 then raise exception 'FALLÓ 13d: se borró nómina con cuenta (%)', n; end if;
end $$;

select 'OK 182: 13 casos' as resultado;
rollback;
