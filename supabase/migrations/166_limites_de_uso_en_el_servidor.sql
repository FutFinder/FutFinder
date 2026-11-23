-- 166. Límites de uso en el servidor.
--
-- Revisión «¿qué endpoints no tienen límite de tasa?» (2026-11-05).
--
-- QUÉ HABÍA. Nada. Ni una cuenta nueva, que es gratis y no pide más que un
-- correo, tenía tope para: mandar solicitudes de amistad (cada una dispara un
-- aviso y un push a otra persona), reportar usuarios, abrir tickets de
-- soporte, escribir mensajes, pedir ingreso a clubes, mandar solicitudes de
-- recinto (cada una manda un correo al equipo), reservar canchas (cada
-- reserva retiene la hora), iniciar pagos, o recorrer `buscar_jugadores` para
-- raspar todos los perfiles visibles. Y `registrar_telefono` contesta «ese
-- número ya está registrado»: con 9 dígitos y sin tope es un oráculo para
-- saber qué celulares tienen cuenta.
--
-- CÓMO SE LIMITA. Todo en la base, porque es lo único que ve TODAS las
-- puertas a la vez: la API de tablas, las RPC y las Edge Functions (que
-- llaman a la base con el token de quien las usa). Un contador por
-- (persona, cubo, ventana fija) en `rate_limit_hits`; si se pasa del tope la
-- sentencia falla con un mensaje en español y la transacción entera se
-- revierte, contador incluido.
--
--   · Sobre las tablas donde nace cada cosa: un BEFORE INSERT que mira a
--     `auth.uid()` (no `current_user`: las RPC `security definer` siguen
--     teniendo la sesión de quien las llama, y ahí es donde se crean
--     reservas, pagos y solicitudes de ingreso). Sin sesión —el cron, el
--     servicio, un script— no se limita nada.
--   · Sobre las funciones que contestan sin escribir (`buscar_jugadores`,
--     `registrar_telefono`): la primera línea del cuerpo llama a
--     `_exigir_limite`. Se inyecta sobre el cuerpo VIVO en vez de copiarlo,
--     para no reescribir dos funciones grandes y arriesgar un error donde no
--     lo había. Quien las vuelva a redefinir con `create or replace` se
--     lleva el límite: lo vigila el arnés de esta migración.
--
-- LOS TOPES SON GENEROSOS A PROPÓSITO. Están pensados para que una persona
-- normal no los toque nunca (un jugador no manda 30 solicitudes de amistad
-- en una hora) y para que un script no pueda hacer daño. Ventana FIJA, no
-- deslizante: en el borde se puede llegar a 2 × el tope; es el precio de un
-- solo upsert por intento, y no cambia el orden de magnitud.
--
--   cubo                     tope   ventana
--   friendships              30     1 h      solicitudes de amistad
--   user_reports             10     1 h      reportes de usuarios
--   support_tickets          10     1 h      tickets de soporte
--   messages                 60     1 min    mensajes (1 por segundo, sostenido)
--   club_join_requests       30     1 h      solicitudes e invitaciones a clubes
--   solicitudes_recinto       5     24 h     recintos nuevos que pide sumar
--   solicitudes_recinto_edit 10     1 h      correcciones de esa solicitud
--   reservas                 15     1 h      reservas nuevas
--   pagos                    20     1 h      intentos de pago
--   matches                  15     1 h      partidos publicados
--   fairplay_reportes        30     1 h      reportes de fair play
--   buscar_jugadores         60     5 min    búsquedas de jugadores
--   registrar_telefono       10     1 h      intentos de registrar un celular
--   reporte_correo            5     1 h      correos de «reportar un problema»
--
-- LO QUE NO CUBRE, Y POR QUÉ:
--   · Los endpoints de Supabase Auth (login, OTP, registro, recuperar
--     contraseña): sus límites viven en el panel (Authentication → Rate
--     Limits), no en SQL. Ver `docs/memoria/arquitectura/seguridad-y-privacidad.md`.
--   · `flow-confirmacion` (webhook público de Flow): limitarlo por IP podría
--     tirar a la basura la confirmación de un pago de verdad si Flow
--     reintenta; la función ya no le cree al POST y consulta a Flow con una
--     consulta firmada, así que el costo de abusarla es una consulta a Flow.
--     Riesgo aceptado.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/166_limites_de_uso_en_el_servidor_test.sql

-- ── 1. El contador ───────────────────────────────────────────────
create table if not exists public.rate_limit_hits (
  clave   text        not null,
  cubo    text        not null,
  ventana timestamptz not null,
  n       integer     not null default 0,
  primary key (clave, cubo, ventana)
);

alter table public.rate_limit_hits enable row level security;
-- Sin políticas y sin privilegios: ni la app lee ni escribe contadores.
revoke all on public.rate_limit_hits from public, anon, authenticated;

comment on table public.rate_limit_hits is
  'Contadores de uso por persona y cubo, en ventanas fijas (migracion 166). Se limpian solos cada noche.';

-- ── 2. La cuenta ─────────────────────────────────────────────────
-- Devuelve true si todavía cabe. Cuenta el intento aunque sea el que pasa
-- del tope: dentro de una transacción que falla, todo se revierte igual.
create or replace function public._limite_de_uso(
  p_clave text, p_cubo text, p_max integer, p_ventana_s integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ventana timestamptz;
  v_n integer;
begin
  v_ventana := to_timestamp(floor(extract(epoch from now()) / p_ventana_s) * p_ventana_s);
  insert into public.rate_limit_hits as h (clave, cubo, ventana, n)
  values (p_clave, p_cubo, v_ventana, 1)
  on conflict (clave, cubo, ventana) do update set n = h.n + 1
  returning h.n into v_n;
  return v_n <= p_max;
end;
$$;

revoke all on function public._limite_de_uso(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public._limite_de_uso(text, text, integer, integer) to service_role;

-- ── 3. La puerta que usan las funciones ──────────────────────────
create or replace function public._exigir_limite(p_cubo text, p_max integer, p_ventana_s integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  -- Sin sesión no hay a quién limitarle nada (cron, servicio, scripts).
  if v_uid is null then
    return;
  end if;
  if not public._limite_de_uso(v_uid::text, p_cubo, p_max, p_ventana_s) then
    raise exception 'Hiciste demasiadas solicitudes seguidas. Espera un momento e inténtalo de nuevo.'
      using errcode = 'P0001', detail = 'RATE_LIMIT', hint = p_cubo;
  end if;
end;
$$;

revoke all on function public._exigir_limite(text, integer, integer) from public, anon, authenticated;

-- ── 4. La puerta que usan las tablas ─────────────────────────────
create or replace function public.tg_limite_de_uso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public._exigir_limite(tg_argv[0], tg_argv[1]::integer, tg_argv[2]::integer);
  return new;
end;
$$;

revoke all on function public.tg_limite_de_uso() from public, anon, authenticated;

-- Instala (o reinstala) el límite de INSERT de una tabla.
create or replace function pg_temp.limite_en_tabla(
  p_tabla regclass, p_cubo text, p_max integer, p_ventana_s integer, p_evento text default 'insert'
) returns void language plpgsql as $$
declare v_nombre text := 'trg_limite_de_uso_' || case when p_evento = 'update' then 'edicion' else 'alta' end;
begin
  execute format('drop trigger if exists %I on %s', v_nombre, p_tabla);
  execute format(
    'create trigger %I before %s on %s for each row execute function public.tg_limite_de_uso(%L, %L, %L)',
    v_nombre, p_evento, p_tabla, p_cubo, p_max, p_ventana_s);
end $$;

select pg_temp.limite_en_tabla('public.friendships',         'friendships',        30, 3600);
select pg_temp.limite_en_tabla('public.user_reports',        'user_reports',       10, 3600);
select pg_temp.limite_en_tabla('public.support_tickets',     'support_tickets',    10, 3600);
select pg_temp.limite_en_tabla('public.messages',            'messages',           60, 60);
select pg_temp.limite_en_tabla('public.club_join_requests',  'club_join_requests', 30, 3600);
select pg_temp.limite_en_tabla('public.solicitudes_recinto', 'solicitudes_recinto', 5, 86400);
select pg_temp.limite_en_tabla('public.solicitudes_recinto', 'solicitudes_recinto_edit', 10, 3600, 'update');
select pg_temp.limite_en_tabla('public.reservas',            'reservas',           15, 3600);
select pg_temp.limite_en_tabla('public.pagos',               'pagos',              20, 3600);
select pg_temp.limite_en_tabla('public.matches',             'matches',            15, 3600);
select pg_temp.limite_en_tabla('public.fairplay_reportes',   'fairplay_reportes',  30, 3600);

-- ── 5. Las funciones que contestan sin escribir ──────────────────
-- Inyecta `perform public._exigir_limite(...)` como PRIMERA sentencia del
-- cuerpo vivo. Si no encuentra el `begin` de entrada, falla: mejor una
-- migración que se detiene que un límite que no está.
create or replace function pg_temp.limite_en_funcion(
  p_firma regprocedure, p_cubo text, p_max integer, p_ventana_s integer
) returns void language plpgsql as $$
declare
  v_def text := pg_get_functiondef(p_firma);
  v_nuevo text;
begin
  if v_def like '%_exigir_limite(%' then
    return; -- ya está puesto
  end if;
  v_nuevo := regexp_replace(
    v_def, E'(\\nbegin\\n)',
    format(E'\\1  perform public._exigir_limite(%L, %s, %s);\n', p_cubo, p_max, p_ventana_s),
    'i');
  if v_nuevo = v_def then
    raise exception 'No encontré el begin de % para inyectar el límite', p_firma;
  end if;
  execute v_nuevo;
end $$;

select pg_temp.limite_en_funcion(
  'public.buscar_jugadores(text,text,text,text,text,integer,integer,integer)'::regprocedure,
  'buscar_jugadores', 60, 300);
select pg_temp.limite_en_funcion('public.registrar_telefono(text)'::regprocedure,
  'registrar_telefono', 10, 3600);

-- ── 6. La puerta del correo de «reportar un problema» ────────────
-- La Edge Function `reportar-problema` manda un correo al equipo CADA VEZ
-- que la llaman con el id de un ticket, y el ticket ya guardado vuelve a
-- servir: repetir la llamada repetía el correo. Antes de mandarlo pregunta
-- acá; si no cabe, el ticket queda guardado y el correo no sale.
create or replace function public.limite_correo_de_reporte()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;
  return public._limite_de_uso(v_uid::text, 'reporte_correo', 5, 3600);
end;
$$;

revoke all on function public.limite_correo_de_reporte() from public, anon;
grant execute on function public.limite_correo_de_reporte() to authenticated;

-- ── 7. Limpieza ──────────────────────────────────────────────────
create or replace function public.limpiar_rate_limit()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  delete from public.rate_limit_hits where ventana < now() - interval '2 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.limpiar_rate_limit() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'futfinder-limpiar-rate-limit';
    perform cron.schedule('futfinder-limpiar-rate-limit', '15 3 * * *', 'select public.limpiar_rate_limit();');
  end if;
end $$;
