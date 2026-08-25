-- =============================================================
-- FutFinder — pruebas de la migración 58 (revoca EXECUTE de `anon` en
-- las RPC del vertical de Reservas que son solo para autenticados).
--
-- QUÉ SE PRUEBA:
--   1-12. Cada una de las 12 RPC afectadas ya no es ejecutable por el
--         rol `anon` (insufficient_privilege al nivel de Postgres, no
--         un rechazo de negocio dentro de la función).
--   13. `get_disponibilidad_cancha` (migración 54) SIGUE siendo
--       ejecutable por `anon` a propósito — no la toca esta migración.
--   14. `authenticated` sigue pudiendo ejecutar las RPC normalmente
--       (la migración no le tocó el grant que ya tenía).
--
-- Requiere las migraciones 54 a 58 aplicadas, o corridas dentro de la
-- misma transacción que este arnés, en orden.
--
-- Cómo correr: pega este archivo completo en Supabase → SQL Editor →
-- Run. Todo corre en una transacción que termina en ROLLBACK. Si un
-- caso falla, la ejecución se corta con RAISE EXCEPTION indicando cuál.
-- =============================================================

begin;

do $$
declare
  v_user     uuid := gen_random_uuid();
  v_complejo uuid := gen_random_uuid();
  v_cancha   uuid := gen_random_uuid();
  v_rechazado boolean;
  v_j         json;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, email_change, email_change_token_new, recovery_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'r58-' || v_user || '@futfinder.test', 'x', now(), now(), now(), '{}', '{}', '', '', '', ''
  );
  insert into public.complejos (id, nombre, comuna, latitud, longitud)
  values (v_complejo, 'Complejo Prueba 58', 'Ñuñoa', -33.45, -70.60);
  insert into public.canchas_reservables (id, complejo_id, nombre, tipo, precio_hora, duracion_slot_min, activa)
  values (v_cancha, v_complejo, 'Cancha 1', 'futbol_7', 20000, 60, true);

  -- ── anon: cada RPC afectada debe rechazarse a nivel de PRIVILEGIO,
  -- no de negocio (insufficient_privilege, 42501) ────────────────────
  execute format('set local role anon');

  begin
    perform public.crear_reserva(v_cancha, current_date + 30, time '10:00', 'completa');
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 1): anon no debería poder ejecutar crear_reserva';
  end if;
  raise notice 'OK (caso 1): crear_reserva bloqueada para anon';

  begin
    perform public.invitar_participante_reserva(gen_random_uuid(), gen_random_uuid(), 'jugador');
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 2): anon no debería poder ejecutar invitar_participante_reserva';
  end if;
  raise notice 'OK (caso 2): invitar_participante_reserva bloqueada para anon';

  begin
    perform public.rechazar_invitacion_reserva(gen_random_uuid());
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 3): anon no debería poder ejecutar rechazar_invitacion_reserva';
  end if;
  raise notice 'OK (caso 3): rechazar_invitacion_reserva bloqueada para anon';

  begin
    perform public.autorizar_cobro_reserva(gen_random_uuid(), 1000);
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 4): anon no debería poder ejecutar autorizar_cobro_reserva';
  end if;
  raise notice 'OK (caso 4): autorizar_cobro_reserva bloqueada para anon';

  begin
    perform public.confirmar_reserva(gen_random_uuid());
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 5): anon no debería poder ejecutar confirmar_reserva';
  end if;
  raise notice 'OK (caso 5): confirmar_reserva bloqueada para anon';

  begin
    perform public.recalcular_cuota_reserva(gen_random_uuid(), 3);
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 6): anon no debería poder ejecutar recalcular_cuota_reserva';
  end if;
  raise notice 'OK (caso 6): recalcular_cuota_reserva bloqueada para anon';

  begin
    perform public.cancelar_reserva(gen_random_uuid());
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 7): anon no debería poder ejecutar cancelar_reserva';
  end if;
  raise notice 'OK (caso 7): cancelar_reserva bloqueada para anon';

  begin
    perform public.responder_cancelacion_desafio(gen_random_uuid(), true);
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 8): anon no debería poder ejecutar responder_cancelacion_desafio';
  end if;
  raise notice 'OK (caso 8): responder_cancelacion_desafio bloqueada para anon';

  begin
    perform public.cargar_balance(2000, 'tarjeta');
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 9): anon no debería poder ejecutar cargar_balance';
  end if;
  raise notice 'OK (caso 9): cargar_balance bloqueada para anon';

  begin
    perform public.get_mi_balance();
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 10): anon no debería poder ejecutar get_mi_balance';
  end if;
  raise notice 'OK (caso 10): get_mi_balance bloqueada para anon';

  begin
    perform public.es_participante_de_reserva(gen_random_uuid(), gen_random_uuid());
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 11): anon no debería poder ejecutar es_participante_de_reserva';
  end if;
  raise notice 'OK (caso 11): es_participante_de_reserva bloqueada para anon';

  begin
    perform public.es_organizador_de_reserva(gen_random_uuid(), gen_random_uuid());
    v_rechazado := false;
  exception when insufficient_privilege then
    v_rechazado := true;
  end;
  if not v_rechazado then
    raise exception 'FALLÓ (caso 12): anon no debería poder ejecutar es_organizador_de_reserva';
  end if;
  raise notice 'OK (caso 12): es_organizador_de_reserva bloqueada para anon';

  -- ── get_disponibilidad_cancha sigue siendo pública a propósito ────
  v_j := public.get_disponibilidad_cancha(v_cancha, current_date + 30);
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 13): get_disponibilidad_cancha debería seguir siendo ejecutable por anon, respondió %', v_j;
  end if;
  raise notice 'OK (caso 13): get_disponibilidad_cancha sigue pública para anon';

  -- ── authenticated no perdió su acceso ──────────────────────────────
  execute format('set local role authenticated');
  execute format('set local request.jwt.claims to %L', json_build_object('sub', v_user, 'role', 'authenticated')::text);
  v_j := public.get_mi_balance();
  if (v_j->>'ok')::boolean is not true then
    raise exception 'FALLÓ (caso 14): authenticated debería seguir pudiendo ejecutar get_mi_balance, respondió %', v_j;
  end if;
  raise notice 'OK (caso 14): authenticated conserva su acceso a las RPC';

  raise notice 'TODAS LAS PRUEBAS DE REVOKE ANON (MIGRACIÓN 58) PASARON';
end $$;

rollback;
