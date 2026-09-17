-- =============================================================
-- FutFinder — pruebas de la migración 114.
--
--   Lo que ya no se puede
--   C1. anon no ejecuta NINGUNA función de `public`.
--   C2. anon no dispara `send_match_reminders` — la que manda push.
--   C3. `authenticated` tampoco dispara las siete del cron.
--   C4. Un intento real como anon falla por PERMISO, no porque la
--       función se defienda sola. La diferencia es todo el punto: una
--       función que se defiende sola deja de defenderse el día que
--       alguien le quite la guarda sin darse cuenta.
--
--   Lo que sigue igual
--   R1. `authenticated` conserva las RPC que la app sí llama.
--   R2. El cron sigue pudiendo ejecutar las suyas: las corre `postgres`,
--       que es el dueño.
--   R3. `service_role` intacto.
--   R4. Los siete trabajos de `cron.job` siguen activos.
--
-- Se ejecuta entero dentro de begin/rollback: no deja nada.
-- =============================================================

begin;
create temp table r114 (caso text, ok boolean, detalle text);
grant all on r114 to anon, authenticated;

do $$
declare
  v_n int;
  v_faltan text;
  v_cron text[] := array['send_match_reminders', 'send_rating_reminders',
    'reactivate_suspended', 'check_push_receipts', 'procesar_vencimientos_desafios',
    'vencer_reservas_pasadas', 'barrer_lista_de_espera'];
  -- Las RPC que la app llama de verdad (grep `.rpc(` sobre src/).
  v_app text[] := array[
    'aceptar_desafio','aceptar_respuesta_desafio_abierto',
    'admin_actualizar_bloqueo','admin_actualizar_cancha',
    'admin_actualizar_cobro','admin_actualizar_complejo',
    'admin_actualizar_foto_cancha','admin_actualizar_servicios',
    'admin_agenda_complejo','admin_agregar_admin',
    'admin_agregar_foto_complejo','admin_calendario_cancha',
    'admin_cancelar_reserva','admin_canchas_complejo','admin_crear_bloqueo',
    'admin_crear_cancha','admin_crear_cobro','admin_eliminar_bloqueo',
    'admin_eliminar_cobro','admin_eliminar_horario_regla',
    'admin_eliminar_tarifa','admin_mis_complejos','admin_permisos_admin',
    'admin_publicar_complejo','admin_quitar_admin',
    'admin_quitar_foto_complejo','admin_quitar_foto_galeria',
    'admin_reserva_detalle','admin_reservas_proximas',
    'admin_solicitar_revision_complejo','admin_upsert_horario_regla',
    'admin_upsert_tarifa','approve_join','aprobar_propuesta',
    'autorizar_cobro_reserva','bloquear_usuario','buscar_complejos',
    'calcular_comision','cancel_join_request','cancel_match',
    'cancel_match_and_join','cancelar_reserva','cancha_del_partido',
    'comision_params','confirm_attendance_gps','confirmar_nomina_club',
    'confirmar_reserva','count_pending_friend_requests',
    'count_reports_against','crear_mi_recinto','crear_propuesta_oficial',
    'crear_reserva','crear_solicitud_recinto','delete_my_account',
    'desbloquear_usuario','detalle_reserva','expirar_desafios_abiertos',
    'expire_old_challenges','get_chat_unread_counts',
    'get_chat_unread_total','get_disponibilidad_cancha','get_mi_balance',
    'get_my_threads','get_schedule_conflict','invitar_participante_reserva',
    'join_club_match','join_match','join_waitlist','leave_club_match',
    'leave_match','leave_match_penalized','leave_waitlist','mark_chat_read',
    'mark_thread_as_read','mis_reservas','quitar_participante_reserva',
    'recalcular_cuota_reserva','rechazar_invitacion_reserva',
    'rechazar_propuesta','recordar_pago_reserva','refrescar_desafio',
    'reject_join','request_join','reservar_cancha_del_partido',
    'responder_cancelacion_desafio','responder_prorroga',
    'save_match_attendance','search_canchas','set_apodo_club','swap_match',
    'transfer_club_admin'
  ];
begin
  -- ── C1 ───────────────────────────────────────────────────────
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE');
  insert into r114 values ('C1 anon no ejecuta ninguna funcion de public', v_n = 0, v_n || ' funcion(es)');

  -- ── C2 y C3: las del cron, para los dos roles ────────────────
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(v_cron)
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  insert into r114 values ('C2 anon no dispara las tareas del cron (las que mandan push)',
    v_n = 0, v_n || ' funcion(es)');

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(v_cron)
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  insert into r114 values ('C3 authenticated tampoco dispara las del cron',
    v_n = 0, v_n || ' funcion(es)');

  -- ── C4: el intento real, y por qué motivo falla ──────────────
  set local role anon;
  set local request.jwt.claims to '{}';
  begin
    perform public.send_match_reminders();
    insert into r114 values ('C4 anon no ejecuta send_match_reminders', false, 'LA EJECUTO');
  exception when insufficient_privilege then
    insert into r114 values ('C4 anon no ejecuta send_match_reminders', true, 'permiso: ' || sqlerrm);
  when others then
    insert into r114 values ('C4 anon no ejecuta send_match_reminders', false,
      'fallo por otra razon, el permiso sigue ahi: ' || sqlerrm);
  end;
  reset role; set local request.jwt.claims to '{}';

  -- ── R1: la app conserva lo suyo ──────────────────────────────
  -- No una muestra: LA LISTA ENTERA de RPC que el cliente llama, sacada
  -- de `grep .rpc(` sobre `src/`. Es la prueba que convierte «no debería
  -- romper nada» en «no rompe nada», y la que habría cazado el descuido
  -- si alguna de las revocadas resultara estar en uso.
  select string_agg(distinct nombre, ', ') into v_faltan
    from unnest(v_app) as nombre
   where not exists (
     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = nombre
        and has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  insert into r114 values ('R1 la app conserva TODAS las RPC que llama',
    v_faltan is null,
    coalesce('faltan: ' || v_faltan, 'las ' || array_length(v_app, 1) || ' siguen accesibles'));

  -- ── R2: el dueño sigue pudiendo, que es quien corre el cron ──
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any(v_cron)
     and has_function_privilege('postgres', p.oid, 'EXECUTE');
  insert into r114 values ('R2 postgres (el cron) sigue ejecutando las suyas', v_n = 7, v_n || ' de 7');

  -- ── R3 ───────────────────────────────────────────────────────
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('service_role', p.oid, 'EXECUTE');
  insert into r114 values ('R3 service_role intacto', v_n > 150, v_n || ' funcion(es)');

  -- ── R4 ───────────────────────────────────────────────────────
  select count(*) into v_n from cron.job where active;
  insert into r114 values ('R4 los trabajos del cron siguen activos', v_n = 7, v_n || ' trabajo(s)');
end $$;

reset role;
set local request.jwt.claims to '{}';
select caso, case when ok then 'OK' else 'FALLA' end as res, detalle from r114 order by caso;
select count(*) filter (where ok) || '/' || count(*) as total from r114;

rollback;
