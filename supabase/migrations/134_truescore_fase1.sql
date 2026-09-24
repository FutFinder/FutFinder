-- =============================================================
-- 134. TRUESCORE — FASE 1
--
-- Implementa la fase 1 de `docs/truescore-spec.md` (fuente de verdad) con
-- las decisiones que se tomaron al aprobar el plan, anotadas al final de ese
-- documento: un solo puntaje global, todos parten en 75, el organizador
-- conserva su «mínimo de puntaje» por partido, la app no suspende a nadie,
-- la asistencia se confirma una sola vez, los encuentros entre clubes quedan
-- fuera y un expulsado no vuelve a ese partido.
--
-- TODO QUEDA DETRÁS DEL FLAG `truescore_fase1`, que nace APAGADO. Con el
-- flag apagado cada función que se reemplaza acá hace exactamente lo que
-- hacía antes: la rama vieja se copió tal cual del cuerpo desplegado. Se
-- activa con `select public.truescore_activar_fase1();` desde el editor SQL.
--
-- PIEZAS
--   1. `truescore_config`: todos los números en una sola tabla.
--   2. `feature_flags`: un flag por fase y `telefono_obligatorio`.
--   3. `truescore_eventos`: el registro inmutable (ledger). Cada cambio de
--      puntaje es una fila; nada la edita ni la borra. `profiles.trust_score`
--      y `profiles.truescore_racha` son el caché, y `truescore_recalcular()`
--      los rehace desde cero recorriendo los eventos en orden.
--   4. Funciones puras de cálculo y UNA sola puerta de escritura,
--      `truescore_registrar()`, idempotente por `clave`.
--   5. Las RPC que mueven el puntaje, con su rama nueva: salida, cambio de
--      partido, cancelación (con tipo de motivo), asistencia en tres estados
--      con plazo de 24 h, GPS sin puntos, expulsión y el job que deja neutros
--      los partidos que el organizador no confirmó.
--   6. Teléfono verificado: el chequeo existe, pero sólo se exige con
--      `telefono_obligatorio`, que queda apagado hasta configurar el SMS.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. Configuración: todos los números en un solo lugar
-- ─────────────────────────────────────────────────────────────

create table if not exists public.truescore_config (
  clave       text primary key,
  valor       jsonb not null,
  descripcion text not null
);

alter table public.truescore_config enable row level security;
revoke all on public.truescore_config from public, anon, authenticated;

insert into public.truescore_config (clave, valor, descripcion) values
  ('puntaje_inicial',           '75',   'Puntaje con que parte cada cuenta.'),
  ('puntaje_minimo',            '0',    'Piso del puntaje después de cada evento.'),
  ('puntaje_maximo',            '100',  'Tope del puntaje después de cada evento.'),
  ('racha_puntos',              '[6, 8, 10, 12]',
     'Puntos por asistir a tiempo: primero, segundo, tercero y cuarto seguido en adelante.'),
  ('salida_tabla',              '[[0, 28], [2, 23], [4, 15], [6, 10], [12, 7], [24, 4], [48, 1]]',
     'Pares [horas de aviso, penalización]. Entre dos puntos se interpola lineal y se redondea.'),
  ('salida_horas_mantiene_racha','24',  'Una salida con al menos estas horas de aviso no rompe la racha.'),
  ('tarde_minutos',             '10',   'Minutos de atraso desde los que el organizador marca «Llegó tarde».'),
  ('tarde_puntos',              '8',    'Penalización por llegar tarde (sin reincidencia).'),
  ('planton_puntos',            '35',   'Penalización por no asistir sin avisar (sin reincidencia).'),
  ('confirmacion_plazo_horas',  '24',   'Horas desde el fin del partido para que el organizador confirme la asistencia.'),
  ('sin_confirmar_puntos',      '10',   'Penalización al organizador que no confirma la asistencia a tiempo.'),
  ('cancelacion_horas_sin_costo','12',  'Cancelar con al menos estas horas de aviso no le cuesta nada al organizador.'),
  ('cancelacion_horas_corte',   '2',    'Frontera entre la penalización con aviso y la de última hora.'),
  ('cancelacion_puntos_con_aviso','15', 'Cancelar con menos de 12 h y más de 2 h de aviso.'),
  ('cancelacion_puntos_ultima_hora','25','Cancelar con 2 h o menos de aviso.'),
  ('niveles', '[{"desde": 90, "clave": "muy_confiable",  "nombre": "Muy confiable",  "color": "verde"},
                {"desde": 75, "clave": "confiable",      "nombre": "Confiable",      "color": "verde"},
                {"desde": 50, "clave": "en_observacion", "nombre": "En observación", "color": "amarillo"},
                {"desde": 0,  "clave": "poco_confiable", "nombre": "Poco confiable", "color": "rojo"}]',
     'Niveles de mayor a menor; cada uno vale desde su puntaje hacia arriba.')
on conflict (clave) do nothing;

create or replace function public.truescore_cfg(p_clave text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  select valor into v from public.truescore_config where clave = p_clave;
  -- Una clave mal escrita no puede valer 0 en silencio.
  if v is null then
    raise exception 'TRUESCORE_CONFIG_FALTA:%', p_clave;
  end if;
  return v;
end $$;

revoke all on function public.truescore_cfg(text) from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 2. Feature flags
-- ─────────────────────────────────────────────────────────────

create table if not exists public.feature_flags (
  nombre       text primary key,
  activo       boolean not null default false,
  -- La PRIMERA vez que se activó. La fase 2 no recalcula el pasado y el job
  -- de las 24 h no barre partidos cuyo plazo venció antes de esta fecha.
  activado_at  timestamptz,
  descripcion  text not null
);

alter table public.feature_flags enable row level security;
revoke all on public.feature_flags from public, anon, authenticated;

insert into public.feature_flags (nombre, descripcion) values
  ('truescore_fase1', 'TrueScore: asistencia, racha, salidas, tardanzas y plantones simples, confirmación del organizador, colores, expulsión y eventos neutros.'),
  ('truescore_fase2', 'TrueScore: reincidencia, reclamos y prioridad en lista de espera.'),
  ('truescore_fase3', 'TrueScore: fair play.'),
  ('truescore_fase4', 'TrueScore: job de inactividad.'),
  ('telefono_obligatorio', 'Exige teléfono verificado para inscribirse o publicar. Activar sólo con el proveedor de SMS configurado.')
on conflict (nombre) do nothing;

create or replace function public.flag_activo(p_nombre text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select activo from public.feature_flags where nombre = p_nombre), false);
$$;

revoke all on function public.flag_activo(text) from public, anon;
-- `authenticated` sí: `tg_auto_suspend` y la guarda de `matches` corren con
-- el rol de quien edita su perfil o su partido, y preguntan por el flag. Los
-- flags no son secretos: `truescore_ajustes()` los muestra igual.
grant execute on function public.flag_activo(text) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 3. El registro de eventos (ledger) y el caché
-- ─────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists truescore_racha integer not null default 0;

do $$ begin
  alter table public.profiles
    add constraint profiles_truescore_racha_check check (truescore_racha >= 0);
exception when duplicate_object then null; end $$;

create table if not exists public.truescore_eventos (
  id               bigint generated always as identity primary key,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  -- Sin llave foránea a propósito: el historial sobrevive al partido.
  match_id         uuid,
  tipo             text not null check (tipo in (
                     'inicio', 'asistio', 'tarde', 'planton', 'salida', 'neutro',
                     'cancelacion_organizador', 'sin_confirmar_organizador')),
  puntos_nominales integer not null,
  puntos_aplicados integer not null,
  puntaje_antes    integer not null,
  puntaje_despues  integer not null,
  racha_antes      integer not null,
  racha_despues    integer not null,
  -- Horas que faltaban para el inicio: el dato del que sale la penalización
  -- de una salida o de una cancelación, guardado para poder recalcular.
  horas_aviso      numeric,
  motivo           text not null,
  detalle          jsonb not null default '{}'::jsonb,
  -- Idempotencia: el mismo hecho siempre produce la misma clave.
  clave            text not null unique,
  created_at       timestamptz not null default now()
);

create index if not exists truescore_eventos_user_idx on public.truescore_eventos (user_id, id);
create index if not exists truescore_eventos_match_idx on public.truescore_eventos (match_id);

alter table public.truescore_eventos enable row level security;
revoke all on public.truescore_eventos from public, anon, authenticated;
grant select on public.truescore_eventos to authenticated;

drop policy if exists truescore_eventos_select_propio on public.truescore_eventos;
create policy truescore_eventos_select_propio on public.truescore_eventos
  for select to authenticated
  using (user_id = auth.uid());

-- Inmutable: ninguna fila se edita, y sólo desaparece si se borra la cuenta.
create or replace function public.tg_truescore_eventos_inmutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'TRUESCORE_INMUTABLE: los eventos no se editan; una corrección es un evento nuevo';
  end if;
  -- DELETE: sólo el que llega en cascada desde el perfil ya borrado.
  if exists (select 1 from public.profiles where id = old.user_id) then
    raise exception 'TRUESCORE_INMUTABLE: los eventos no se borran';
  end if;
  return old;
end $$;

revoke all on function public.tg_truescore_eventos_inmutable() from public, anon, authenticated;

drop trigger if exists trg_truescore_eventos_inmutable on public.truescore_eventos;
create trigger trg_truescore_eventos_inmutable
  before update or delete on public.truescore_eventos
  for each row execute function public.tg_truescore_eventos_inmutable();


-- ─────────────────────────────────────────────────────────────
-- 4. Cálculo puro
-- ─────────────────────────────────────────────────────────────

-- Penalización (en positivo) por salirse con `p_horas` de aviso. Interpola
-- entre los puntos de `salida_tabla` y redondea el valor absoluto al entero
-- más cercano, 0,5 hacia arriba: `round(numeric)` redondea alejándose del
-- cero, y acá el valor siempre es positivo. Se multiplica antes de dividir
-- para que 8 h dé 9 exacto y no 9,0000001.
create or replace function public.truescore_penalizacion_salida(p_horas numeric)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t jsonb := public.truescore_cfg('salida_tabla');
  n int := jsonb_array_length(t);
  i int;
  h0 numeric; p0 numeric; h1 numeric; p1 numeric;
begin
  if p_horas is null then
    raise exception 'TRUESCORE_HORAS_NULAS';
  end if;
  if p_horas <= (t->0->>0)::numeric then
    return (t->0->>1)::int;
  end if;
  for i in 0 .. n - 2 loop
    h0 := (t->i->>0)::numeric;     p0 := (t->i->>1)::numeric;
    h1 := (t->(i+1)->>0)::numeric; p1 := (t->(i+1)->>1)::numeric;
    if p_horas < h1 then
      return round(p0 + (p1 - p0) * (p_horas - h0) / (h1 - h0))::int;
    end if;
  end loop;
  return (t->(n-1)->>1)::int;
end $$;

-- Penalización (en positivo) del organizador que cancela con `p_horas` de
-- aviso, fuera de lluvia o cierre de cancha (que son neutros).
create or replace function public.truescore_penalizacion_cancelacion(p_horas numeric)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_horas >= (public.truescore_cfg('cancelacion_horas_sin_costo'))::numeric then
    return 0;
  end if;
  if p_horas > (public.truescore_cfg('cancelacion_horas_corte'))::numeric then
    return (public.truescore_cfg('cancelacion_puntos_con_aviso'))::int;
  end if;
  return (public.truescore_cfg('cancelacion_puntos_ultima_hora'))::int;
end $$;

-- Un evento aplicado sobre un estado. No escribe nada: es la regla entera
-- de la fase 1, y la usan por igual la escritura y el recálculo.
create or replace function public.truescore_calcular(
  p_tipo    text,
  p_puntaje integer,
  p_racha   integer,
  p_horas   numeric default null
)
returns table (nominal integer, puntaje integer, racha integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_nom   int := 0;
  v_racha int := coalesce(p_racha, 0);
  v_tabla jsonb;
begin
  if p_tipo = 'inicio' then
    return query select (public.truescore_cfg('puntaje_inicial'))::int,
                        (public.truescore_cfg('puntaje_inicial'))::int, 0;
    return;
  elsif p_tipo = 'asistio' then
    v_tabla := public.truescore_cfg('racha_puntos');
    v_nom   := (v_tabla->>(least(v_racha + 1, jsonb_array_length(v_tabla)) - 1))::int;
    v_racha := v_racha + 1;
  elsif p_tipo = 'tarde' then
    v_nom   := -(public.truescore_cfg('tarde_puntos'))::int;
    v_racha := 0;
  elsif p_tipo = 'planton' then
    v_nom   := -(public.truescore_cfg('planton_puntos'))::int;
    v_racha := 0;
  elsif p_tipo = 'salida' then
    v_nom := -public.truescore_penalizacion_salida(p_horas);
    if p_horas < (public.truescore_cfg('salida_horas_mantiene_racha'))::numeric then
      v_racha := 0;
    end if;
  elsif p_tipo = 'neutro' then
    v_nom := 0;
  elsif p_tipo = 'cancelacion_organizador' then
    -- Los eventos del organizador no tocan su racha de jugador.
    v_nom := -public.truescore_penalizacion_cancelacion(p_horas);
  elsif p_tipo = 'sin_confirmar_organizador' then
    v_nom := -(public.truescore_cfg('sin_confirmar_puntos'))::int;
  else
    raise exception 'TRUESCORE_TIPO_DESCONOCIDO:%', p_tipo;
  end if;

  return query select
    v_nom,
    least((public.truescore_cfg('puntaje_maximo'))::int,
          greatest((public.truescore_cfg('puntaje_minimo'))::int, p_puntaje + v_nom)),
    v_racha;
end $$;

-- Nivel y color de un puntaje, desde la tabla de niveles.
create or replace function public.truescore_nivel(p_puntaje integer)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select n.value
    from jsonb_array_elements(public.truescore_cfg('niveles')) as n(value)
   where coalesce(p_puntaje, 0) >= (n.value->>'desde')::int
   order by (n.value->>'desde')::int desc
   limit 1;
$$;

revoke all on function public.truescore_penalizacion_salida(numeric) from public, anon, authenticated;
revoke all on function public.truescore_penalizacion_cancelacion(numeric) from public, anon, authenticated;
revoke all on function public.truescore_calcular(text, integer, integer, numeric) from public, anon, authenticated;
revoke all on function public.truescore_nivel(integer) from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 5. La única puerta de escritura
-- ─────────────────────────────────────────────────────────────

-- Deja al usuario en el puntaje inicial con su evento «inicio», una sola vez.
create or replace function public.truescore_iniciar(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_antes int; v_racha int; v_ini int;
begin
  if not public.flag_activo('truescore_fase1') then return; end if;
  if exists (select 1 from public.truescore_eventos where clave = 'inicio:' || p_user) then
    return;
  end if;

  select trust_score, truescore_racha into v_antes, v_racha
    from public.profiles where id = p_user for update;
  if not found then return; end if;

  v_ini := (public.truescore_cfg('puntaje_inicial'))::int;

  insert into public.truescore_eventos (user_id, tipo, puntos_nominales, puntos_aplicados,
      puntaje_antes, puntaje_despues, racha_antes, racha_despues, motivo, clave)
  values (p_user, 'inicio', v_ini, v_ini - coalesce(v_antes, 0),
      coalesce(v_antes, 0), v_ini, coalesce(v_racha, 0), 0,
      'Inicio de TrueScore', 'inicio:' || p_user)
  on conflict (clave) do nothing;

  if found then
    update public.profiles set trust_score = v_ini, truescore_racha = 0 where id = p_user;
  end if;
end $$;

-- Aplica UN evento: bloquea el perfil, calcula, guarda el evento y el caché.
-- Si la clave ya existe no hace nada: procesar dos veces el mismo hecho
-- (dos toques, un reintento, el job corriendo de nuevo) no duplica puntos.
create or replace function public.truescore_registrar(
  p_user    uuid,
  p_match   uuid,
  p_tipo    text,
  p_clave   text,
  p_motivo  text,
  p_horas   numeric default null,
  p_detalle jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_antes int; v_racha int; c record; v_id bigint;
begin
  if not public.flag_activo('truescore_fase1') then
    return jsonb_build_object('ok', false, 'reason', 'TrueScore inactivo');
  end if;

  perform public.truescore_iniciar(p_user);

  select trust_score, truescore_racha into v_antes, v_racha
    from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'El perfil no existe');
  end if;

  if exists (select 1 from public.truescore_eventos where clave = p_clave) then
    return jsonb_build_object('ok', true, 'duplicado', true, 'puntos', 0, 'nominal', 0,
                              'puntaje', v_antes, 'racha', v_racha);
  end if;

  select * into c from public.truescore_calcular(p_tipo, v_antes, v_racha, p_horas);

  insert into public.truescore_eventos (user_id, match_id, tipo, puntos_nominales,
      puntos_aplicados, puntaje_antes, puntaje_despues, racha_antes, racha_despues,
      horas_aviso, motivo, detalle, clave)
  values (p_user, p_match, p_tipo, c.nominal, c.puntaje - v_antes, v_antes, c.puntaje,
      v_racha, c.racha, p_horas, p_motivo,
      coalesce(p_detalle, '{}'::jsonb)
        || jsonb_build_object('fase2', public.flag_activo('truescore_fase2')),
      p_clave)
  on conflict (clave) do nothing
  returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', true, 'duplicado', true, 'puntos', 0, 'nominal', 0,
                              'puntaje', v_antes, 'racha', v_racha);
  end if;

  update public.profiles
     set trust_score = c.puntaje, truescore_racha = c.racha
   where id = p_user;

  return jsonb_build_object('ok', true, 'duplicado', false,
    'nominal', c.nominal, 'puntos', c.puntaje - v_antes,
    'puntaje', c.puntaje, 'racha', c.racha);
end $$;

-- Rehace el puntaje y la racha desde cero, recorriendo los eventos en orden
-- con las reglas vigentes. `p_escribir` deja el resultado en el caché.
create or replace function public.truescore_recalcular(p_user uuid, p_escribir boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  e record; c record;
  v_puntaje int; v_racha int := 0; v_n int := 0;
  v_cache int; v_cache_racha int;
begin
  for e in
    select * from public.truescore_eventos where user_id = p_user order by id
  loop
    select * into c from public.truescore_calcular(e.tipo, coalesce(v_puntaje, 0), v_racha, e.horas_aviso);
    v_puntaje := c.puntaje;
    v_racha   := c.racha;
    v_n := v_n + 1;
  end loop;

  select trust_score, truescore_racha into v_cache, v_cache_racha
    from public.profiles where id = p_user;

  if p_escribir and v_n > 0 then
    update public.profiles set trust_score = v_puntaje, truescore_racha = v_racha where id = p_user;
  end if;

  return jsonb_build_object('eventos', v_n, 'puntaje', v_puntaje, 'racha', v_racha,
    'cache_puntaje', v_cache, 'cache_racha', v_cache_racha,
    'coincide', v_n = 0 or (v_puntaje = v_cache and v_racha = v_cache_racha));
end $$;

revoke all on function public.truescore_iniciar(uuid) from public, anon, authenticated;
revoke all on function public.truescore_registrar(uuid, uuid, text, text, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.truescore_recalcular(uuid, boolean) from public, anon, authenticated;

-- Cuentas que nacen con el flag activo parten en 75 con su evento.
create or replace function public.tg_truescore_perfil_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.truescore_iniciar(new.id);
  return null;
end $$;

revoke all on function public.tg_truescore_perfil_nuevo() from public, anon, authenticated;

drop trigger if exists trg_truescore_perfil_nuevo on public.profiles;
create trigger trg_truescore_perfil_nuevo
  after insert on public.profiles
  for each row execute function public.tg_truescore_perfil_nuevo();

-- Activación: prende el flag y deja a todos en 75. Sólo desde el editor SQL.
create or replace function public.truescore_activar_fase1()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_n int := 0;
begin
  update public.feature_flags
     set activo = true, activado_at = coalesce(activado_at, now())
   where nombre = 'truescore_fase1';

  for r in select id from public.profiles order by id loop
    perform public.truescore_iniciar(r.id);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'perfiles', v_n);
end $$;

revoke all on function public.truescore_activar_fase1() from public, anon, authenticated;


-- ─────────────────────────────────────────────────────────────
-- 6. Lo que la app puede leer
-- ─────────────────────────────────────────────────────────────

-- Los flags y los números que la app muestra. El cálculo no viaja: sólo lo
-- necesario para pintar el nivel y redactar los textos.
create or replace function public.truescore_ajustes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'fase1', public.flag_activo('truescore_fase1'),
    'fase2', public.flag_activo('truescore_fase2'),
    'telefono_obligatorio', public.flag_activo('telefono_obligatorio'),
    'niveles', public.truescore_cfg('niveles'),
    'tarde_minutos', public.truescore_cfg('tarde_minutos'),
    'confirmacion_plazo_horas', public.truescore_cfg('confirmacion_plazo_horas'),
    'puntaje_inicial', public.truescore_cfg('puntaje_inicial')
  );
$$;

revoke all on function public.truescore_ajustes() from public, anon;
grant execute on function public.truescore_ajustes() to authenticated;

-- Lo que le costaría a quien llama irse de este partido AHORA: salirse si es
-- jugador, cancelar si es el organizador. La pantalla lo muestra antes de
-- confirmar; la RPC que ejecuta vuelve a calcularlo con su propio reloj.
create or replace function public.truescore_costo_salida(p_match_id uuid, p_tipo_cancelacion text default 'otro')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match record; v_horas numeric; v_pen int; v_racha int;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'No autenticado');
  end if;
  if not public.flag_activo('truescore_fase1') then
    return jsonb_build_object('ok', false, 'reason', 'TrueScore inactivo');
  end if;

  select * into v_match from public.matches where id = p_match_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
  end if;

  v_horas := extract(epoch from (v_match.hora - now())) / 3600.0;

  if v_match.id_organizador = v_uid then
    v_pen := case when coalesce(p_tipo_cancelacion, 'otro') in ('lluvia', 'cierre_cancha') then 0
                  else public.truescore_penalizacion_cancelacion(v_horas) end;
    return jsonb_build_object('ok', true, 'rol', 'organizador', 'horas', round(v_horas, 2),
      'puntos', v_pen, 'rompe_racha', false,
      'horas_sin_costo', public.truescore_cfg('cancelacion_horas_sin_costo'));
  end if;

  select truescore_racha into v_racha from public.profiles where id = v_uid;
  v_pen := public.truescore_penalizacion_salida(greatest(v_horas, 0));
  return jsonb_build_object('ok', true, 'rol', 'jugador', 'horas', round(v_horas, 2),
    'puntos', v_pen,
    'rompe_racha', coalesce(v_racha, 0) > 0
                   and v_horas < (public.truescore_cfg('salida_horas_mantiene_racha'))::numeric);
end $$;

revoke all on function public.truescore_costo_salida(uuid, text) from public, anon;
grant execute on function public.truescore_costo_salida(uuid, text) to authenticated;


-- ─────────────────────────────────────────────────────────────
-- 7. Columnas nuevas del partido y su protección
-- ─────────────────────────────────────────────────────────────

alter table public.matches
  add column if not exists tipo_cancelacion        text,
  add column if not exists asistencia_confirmada_at timestamptz,
  add column if not exists asistencia_vencida_at    timestamptz;

do $$ begin
  alter table public.matches
    add constraint matches_tipo_cancelacion_check
    check (tipo_cancelacion is null or tipo_cancelacion in ('lluvia', 'cierre_cancha', 'otro'));
exception when duplicate_object then null; end $$;

comment on column public.matches.tipo_cancelacion is
  'Por qué se canceló: lluvia o cierre de cancha son neutros para todos; otro puede costarle al organizador.';
comment on column public.matches.asistencia_confirmada_at is
  'Cuándo el organizador confirmó la asistencia (TrueScore). Una sola vez.';
comment on column public.matches.asistencia_vencida_at is
  'Cuándo el job dejó el partido neutro porque el organizador no confirmó a tiempo.';

-- `matches` tiene UPDATE y DELETE directos para el organizador (RLS por
-- dueño). Sin esta guarda, el organizador escaparía de TrueScore escribiendo
-- la columna a mano: marcando el partido como confirmado, poniendo «lluvia»,
-- pasándolo a 'cancelado' sin la RPC o borrándolo con su nómina adentro.
-- `current_user = 'authenticated'` es la petición directa de la app; las RPC
-- corren como su dueño y no pasan por acá.
create or replace function public.tg_matches_truescore_protegido()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user <> 'authenticated' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if public.flag_activo('truescore_fase1')
       and old.challenge_proposal_id is null
       and exists (select 1 from public.attendees a
                    where a.id_partido = old.id
                      and a.id_jugador <> old.id_organizador
                      and a.estado in ('inscrito', 'confirmado_gps')) then
      raise exception 'CANCELAR_CON_RPC';
    end if;
    return old;
  end if;

  if new.tipo_cancelacion is distinct from old.tipo_cancelacion
     or new.asistencia_confirmada_at is distinct from old.asistencia_confirmada_at
     or new.asistencia_vencida_at is distinct from old.asistencia_vencida_at then
    raise exception 'COLUMNA_PROTEGIDA';
  end if;

  if public.flag_activo('truescore_fase1')
     and new.estado = 'cancelado' and old.estado is distinct from 'cancelado' then
    raise exception 'CANCELAR_CON_RPC';
  end if;

  return new;
end $$;

revoke all on function public.tg_matches_truescore_protegido() from public, anon, authenticated;

drop trigger if exists trg_matches_truescore_protegido on public.matches;
create trigger trg_matches_truescore_protegido
  before update or delete on public.matches
  for each row execute function public.tg_matches_truescore_protegido();


-- ─────────────────────────────────────────────────────────────
-- 8. Expulsión
-- ─────────────────────────────────────────────────────────────

create table if not exists public.match_expulsiones (
  match_id      uuid not null references public.matches(id) on delete cascade,
  jugador_id    uuid not null references public.profiles(id) on delete cascade,
  expulsado_por uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (match_id, jugador_id)
);

alter table public.match_expulsiones enable row level security;
revoke all on public.match_expulsiones from public, anon, authenticated;
grant select on public.match_expulsiones to authenticated;

drop policy if exists match_expulsiones_select on public.match_expulsiones;
create policy match_expulsiones_select on public.match_expulsiones
  for select to authenticated
  using (
    jugador_id = auth.uid()
    or exists (select 1 from public.matches m
                where m.id = match_id and m.id_organizador = auth.uid())
  );

create or replace function public.expulsar_jugador(p_match_id uuid, p_jugador uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_match record; v_att record; v_ts jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'reason', 'No autenticado');
  end if;
  if not public.flag_activo('truescore_fase1') then
    return jsonb_build_object('ok', false, 'reason', 'Esta opción todavía no está disponible');
  end if;

  select * into v_match from public.matches where id = p_match_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
  end if;
  if v_match.id_organizador <> v_uid then
    return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede sacar jugadores');
  end if;
  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false, 'reason',
      'Este es un partido entre clubes: la nómina la maneja cada club');
  end if;
  if p_jugador = v_uid then
    return jsonb_build_object('ok', false, 'reason', 'No puedes sacarte a ti mismo');
  end if;
  if v_match.estado in ('cancelado', 'finalizado')
     or v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90)) <= now() then
    return jsonb_build_object('ok', false, 'reason', 'Este partido ya no está en juego');
  end if;

  delete from public.attendees
   where id_partido = p_match_id
     and id_jugador = p_jugador
     and estado in ('inscrito', 'confirmado_gps', 'pendiente')
  returning id, estado into v_att;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'Ese jugador no está en tu partido');
  end if;

  insert into public.match_expulsiones (match_id, jugador_id, expulsado_por)
  values (p_match_id, p_jugador, v_uid)
  on conflict (match_id, jugador_id) do nothing;

  delete from public.match_waitlist where id_partido = p_match_id and id_jugador = p_jugador;

  if v_att.estado in ('inscrito', 'confirmado_gps') then
    update public.matches
       set cupos_disponibles = cupos_disponibles + 1,
           estado = case when estado = 'lleno' then 'abierto' else estado end
     where id = p_match_id;

    -- La expulsión no resta puntos: queda en el historial como neutra.
    v_ts := public.truescore_registrar(p_jugador, p_match_id, 'neutro',
      'expulsion:' || v_att.id, 'El organizador te sacó del partido');
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  values (p_jugador, 'match_attendance', 'Te sacaron del partido',
          format('El organizador de «%s» te sacó del partido. Tu TrueScore no cambia.', v_match.titulo),
          jsonb_build_object('matchId', p_match_id));

  return jsonb_build_object('ok', true, 'freed', v_att.estado in ('inscrito', 'confirmado_gps'));
end $$;

revoke all on function public.expulsar_jugador(uuid, uuid) from public, anon;
grant execute on function public.expulsar_jugador(uuid, uuid) to authenticated;

-- Un expulsado tampoco entra a la cola de ese partido.
create or replace function public.tg_waitlist_no_expulsados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.match_expulsiones
              where match_id = new.id_partido and jugador_id = new.id_jugador) then
    raise exception 'EXPULSADO';
  end if;
  return new;
end $$;

revoke all on function public.tg_waitlist_no_expulsados() from public, anon, authenticated;

drop trigger if exists trg_waitlist_no_expulsados on public.match_waitlist;
create trigger trg_waitlist_no_expulsados
  before insert on public.match_waitlist
  for each row execute function public.tg_waitlist_no_expulsados();


-- ─────────────────────────────────────────────────────────────
-- 9. Teléfono verificado (listo, sin exigir)
-- ─────────────────────────────────────────────────────────────

-- Auth ya garantiza que un número pertenece a una sola cuenta: la columna
-- `auth.users.phone` es única. Acá sólo se pregunta si está confirmado.
create or replace function public.telefono_verificado(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from auth.users u
                  where u.id = p_user
                    and coalesce(u.phone, '') <> ''
                    and u.phone_confirmed_at is not null);
$$;

revoke all on function public.telefono_verificado(uuid) from public, anon, authenticated;

create or replace function public.mi_telefono_verificado()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.telefono_verificado(auth.uid());
$$;

revoke all on function public.mi_telefono_verificado() from public, anon;
grant execute on function public.mi_telefono_verificado() to authenticated;

-- Publicar también lo exige cuando el flag está activo.
create or replace function public.tg_matches_exige_telefono()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.challenge_proposal_id is null
     and public.flag_activo('telefono_obligatorio')
     and not public.telefono_verificado(new.id_organizador) then
    raise exception 'TELEFONO_NO_VERIFICADO';
  end if;
  return new;
end $$;

revoke all on function public.tg_matches_exige_telefono() from public, anon, authenticated;

drop trigger if exists trg_matches_exige_telefono on public.matches;
create trigger trg_matches_exige_telefono
  before insert on public.matches
  for each row execute function public.tg_matches_exige_telefono();


-- ─────────────────────────────────────────────────────────────
-- 10. Reglas de ingreso: expulsados y teléfono
-- ─────────────────────────────────────────────────────────────
-- Cuerpo de la 133 más dos chequeos. El mínimo de puntaje del organizador
-- se conserva (decisión aprobada). La suspensión sigue leyéndose, pero con
-- TrueScore nadie más queda suspendido por puntaje (ver `tg_auto_suspend`).

create or replace function public.tg_enforce_join_rules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_min int; v_org uuid; v_hora timestamptz; v_dur int;
  v_trust int; v_estado text; v_until timestamptz; v_clash int;
  v_es_de_clubes boolean;
  v_edad_min int; v_edad_max int; v_edad int;
  v_libres int; v_turnos_de_otros int;
begin
  if new.estado not in ('inscrito','pendiente') then return new; end if;

  -- Dos partidos tienen bloqueos de fila distintos, pero comparten agenda
  -- cuando intenta entrar el mismo jugador. Esperar ANTES de leer permite
  -- que la consulta de choques vea lo confirmado por la primera transacción.
  -- El namespace de dos enteros no colisiona con locks de bigint de reservas.
  -- Una colisión de hash entre UUID distintos solo los hace esperar.
  perform pg_advisory_xact_lock(107, hashtext(new.id_jugador::text));

  select min_trust_score, id_organizador, hora, duracion_min,
         challenge_proposal_id is not null, edad_min, edad_max, cupos_disponibles
    into v_min, v_org, v_hora, v_dur, v_es_de_clubes, v_edad_min, v_edad_max, v_libres
  from public.matches where id = new.id_partido;

  if v_org = new.id_jugador and not coalesce(v_es_de_clubes, false) then
    return new;
  end if;

  -- 134: el organizador lo sacó, y no vuelve a este partido por ninguna puerta.
  if exists (select 1 from public.match_expulsiones
              where match_id = new.id_partido and jugador_id = new.id_jugador) then
    raise exception 'EXPULSADO';
  end if;

  -- 134: sólo con `telefono_obligatorio` activo.
  if not coalesce(v_es_de_clubes, false)
     and public.flag_activo('telefono_obligatorio')
     and not public.telefono_verificado(new.id_jugador) then
    raise exception 'TELEFONO_NO_VERIFICADO';
  end if;

  select trust_score, estado, suspended_until, edad
    into v_trust, v_estado, v_until, v_edad
  from public.profiles where id = new.id_jugador;

  if v_estado = 'suspendido' and (v_until is null or v_until > now()) then
    raise exception 'SUSPENDIDO';
  end if;
  if coalesce(v_trust,0) < coalesce(v_min,0) then
    raise exception 'TRUST_BAJO:%:%', coalesce(v_trust,0), coalesce(v_min,0);
  end if;
  if public.edad_fuera_de_rango(v_edad, v_edad_min, v_edad_max) then
    raise exception 'EDAD_FUERA_DE_RANGO';
  end if;

  -- Una solicitud pendiente no ocupa cupo, así que no le quita el turno a nadie.
  if new.estado = 'inscrito' and not coalesce(v_es_de_clubes, false) then
    select count(*) into v_turnos_de_otros
      from public.match_waitlist w
     where w.id_partido = new.id_partido
       and w.confirmar_antes_de > now()
       and w.id_jugador <> new.id_jugador;
    if coalesce(v_libres, 0) <= v_turnos_de_otros then
      raise exception 'CUPO_RESERVADO';
    end if;
  end if;

  select 1 into v_clash
  from public.attendees a
  join public.matches m on m.id = a.id_partido
  where a.id_jugador = new.id_jugador
    and a.estado in ('inscrito','confirmado_gps')
    and m.id <> new.id_partido
    and m.estado = any (public.estados_que_ocupan_horario())
    and v_hora < m.hora + make_interval(mins => coalesce(m.duracion_min,90))
    and m.hora < v_hora + make_interval(mins => coalesce(v_dur,90))
  limit 1;
  if found then raise exception 'CHOQUE_HORARIO'; end if;

  return new;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 11. Sin suspensiones automáticas por puntaje
-- ─────────────────────────────────────────────────────────────

create or replace function public.tg_auto_suspend()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Con TrueScore no existe restricción automática por puntaje bajo.
  if public.flag_activo('truescore_fase1') then
    return new;
  end if;
  if new.trust_score <= 0 and coalesce(old.trust_score, 100) > 0 then
    new.estado := 'suspendido';
    new.suspended_until := now() + interval '7 days';
    new.trust_score := 0;
  end if;
  return new;
end $$;

create or replace function public.reactivate_suspended()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Con TrueScore el puntaje sólo lo mueve el registro de eventos: se
  -- levanta la suspensión vencida, pero no se sube a 50.
  if public.flag_activo('truescore_fase1') then
    update public.profiles
       set estado = 'activo', suspended_until = null
     where estado = 'suspendido'
       and suspended_until is not null
       and suspended_until <= now();
    return;
  end if;

  update public.profiles
     set estado = 'activo',
         suspended_until = null,
         trust_score = greatest(trust_score, 50)
   where estado = 'suspendido'
     and suspended_until is not null
     and suspended_until <= now();
end $$;


-- ─────────────────────────────────────────────────────────────
-- 12. Salir de un partido
-- ─────────────────────────────────────────────────────────────

create or replace function public.leave_match_penalized(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match record; v_estado text; v_att uuid; v_pen int := 0; v_freed boolean := false;
  v_ts jsonb; v_horas numeric;
begin
  if v_user is null then return jsonb_build_object('ok',false,'reason','No autenticado'); end if;

  -- Partido primero, inscripción después (122).
  select * into v_match from public.matches where id = p_match_id for update;
  if not found then return jsonb_build_object('ok',false,'reason','Partido no existe'); end if;

  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'Este es un partido entre clubes: las bajas se gestionan por club');
  end if;

  if v_match.id_organizador = v_user then
    return jsonb_build_object('ok',false,'reason','Eres el anfitrión: debes cancelar el partido');
  end if;

  if v_match.estado = 'cancelado' then
    return jsonb_build_object('ok', false,
      'reason', 'Este partido fue cancelado por el organizador: no tienes que salirte');
  end if;

  if v_match.estado = 'finalizado'
     or v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90)) <= now() then
    return jsonb_build_object('ok', false, 'reason', 'Este partido ya terminó');
  end if;

  -- La inscripción se reclama con la MISMA sentencia que la borra (122).
  delete from public.attendees
   where id_partido = p_match_id
     and id_jugador = v_user
     and estado in ('inscrito','confirmado_gps','pendiente')
  returning estado, id into v_estado, v_att;

  if not found then return jsonb_build_object('ok',false,'reason','No estás en este partido'); end if;

  if v_estado in ('inscrito','confirmado_gps') then
    v_freed := true;

    update public.matches
       set cupos_disponibles = cupos_disponibles + 1,
           estado = case when estado = 'lleno' then 'abierto' else estado end
     where id = p_match_id;

    insert into public.messages (sender_id, match_id, content)
    values (v_user, p_match_id, 'Un jugador se ha salido, ¡vuelve a haber un cupo disponible!');

    if public.flag_activo('truescore_fase1') then
      -- 134: la penalización sale de la tabla interpolada, igual para quien
      -- entró desde la lista de espera, y aunque otro tome el cupo.
      v_horas := greatest(extract(epoch from (v_match.hora - now())) / 3600.0, 0);
      v_ts := public.truescore_registrar(v_user, p_match_id, 'salida', 'salida:' || v_att,
        format('Te saliste con %s h de aviso', round(v_horas, 1)), v_horas);
      v_pen := abs(coalesce((v_ts->>'nominal')::int, 0));
      return jsonb_build_object('ok', true, 'penalty', v_pen, 'freed', v_freed,
        'truescore', v_ts);
    end if;

    v_pen := case when v_match.hora > now() + interval '2 hours' then 3 else 20 end;
    update public.profiles set trust_score = greatest(trust_score - v_pen, 0) where id = v_user;
  end if;

  return jsonb_build_object('ok', true, 'penalty', v_pen, 'freed', v_freed);
end $$;


-- ─────────────────────────────────────────────────────────────
-- 13. Cambiarse de partido (la otra puerta de la salida)
-- ─────────────────────────────────────────────────────────────

create or replace function public.swap_match(p_old uuid, p_new uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old record; v_new record; v_estado text; v_att uuid; v_prof record; v_username text;
  v_solto boolean := false; v_pen int := 0; v_ts jsonb; v_horas numeric;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;

  select * into v_old from public.matches where id = p_old for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido original no existe'); end if;

  if v_old.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'Este es un partido entre clubes: las bajas se gestionan por club');
  end if;

  if v_old.id_organizador = v_user then
    return jsonb_build_object('ok', false, 'reason', 'Eres el anfitrión: debes cancelar tu partido');
  end if;

  if v_old.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'reason',
      'Tu partido original fue cancelado: puedes inscribirte en el otro directamente, sin costo');
  end if;
  if v_old.estado = 'finalizado' then
    return jsonb_build_object('ok', false, 'reason', 'Tu partido original ya terminó');
  end if;

  if v_old.hora <= now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'reason', 'Faltan menos de 2 horas para tu partido original');
  end if;

  select * into v_new from public.matches where id = p_new;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido no encontrado'); end if;
  if v_new.estado <> 'abierto' then return jsonb_build_object('ok', false, 'reason', 'El partido no está abierto'); end if;
  if v_new.cupos_disponibles <= 0 then return jsonb_build_object('ok', false, 'reason', 'No quedan cupos'); end if;

  select trust_score, estado, suspended_until into v_prof from public.profiles where id = v_user;
  if v_prof.estado = 'suspendido' and (v_prof.suspended_until is null or v_prof.suspended_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'Tu cuenta está suspendida temporalmente');
  end if;
  if coalesce(v_prof.trust_score,0) < coalesce(v_new.min_trust_score,0) then
    return jsonb_build_object('ok', false, 'reason',
      'Trust Score insuficiente: necesitas ' || v_new.min_trust_score || ' y tienes ' || coalesce(v_prof.trust_score,0));
  end if;

  delete from public.attendees
   where id_partido = p_old
     and id_jugador = v_user
     and estado in ('inscrito','confirmado_gps','pendiente')
  returning estado, id into v_estado, v_att;

  if found and v_estado in ('inscrito','confirmado_gps') then
    v_solto := true;
    update public.matches
       set cupos_disponibles = cupos_disponibles + 1,
           estado = case when estado = 'lleno' then 'abierto' else estado end
     where id = p_old;
    insert into public.messages (sender_id, match_id, content)
    values (v_user, p_old, 'Un jugador se ha salido, ¡vuelve a haber un cupo disponible!');
  end if;

  if v_solto then
    if public.flag_activo('truescore_fase1') then
      v_horas := greatest(extract(epoch from (v_old.hora - now())) / 3600.0, 0);
      v_ts := public.truescore_registrar(v_user, p_old, 'salida', 'salida:' || v_att,
        format('Te cambiaste de partido con %s h de aviso', round(v_horas, 1)), v_horas);
      v_pen := abs(coalesce((v_ts->>'nominal')::int, 0));
    else
      v_pen := 3;
      update public.profiles set trust_score = greatest(trust_score - 3, 0) where id = v_user;
    end if;
  end if;

  if v_new.aprobacion = 'manual' then
    insert into public.attendees (id_partido, id_jugador, estado) values (p_new, v_user, 'pendiente');
    select username into v_username from public.profiles where id = v_user;
    perform public.create_notification(
      v_new.id_organizador, 'join_request',
      coalesce(v_username,'Alguien') || ' quiere unirse a tu partido',
      coalesce(v_new.titulo,'Partido'),
      jsonb_build_object('matchId', p_new, 'playerId', v_user)
    );
    return jsonb_build_object('ok', true, 'pending', true, 'penalty', v_pen);
  else
    insert into public.attendees (id_partido, id_jugador, estado) values (p_new, v_user, 'inscrito');
    update public.matches set cupos_disponibles = cupos_disponibles - 1 where id = p_new;
    return jsonb_build_object('ok', true, 'pending', false, 'penalty', v_pen);
  end if;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 14. Cancelar: neutro para los jugadores, castigo al organizador < 12 h
-- ─────────────────────────────────────────────────────────────

-- Registra la cancelación en TrueScore y devuelve lo que pierde el
-- organizador (en positivo). Lo usan `cancel_match` y `cancel_match_and_join`.
create or replace function public.truescore_registrar_cancelacion(p_match_id uuid, p_tipo text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record; r record; v_horas numeric; v_ts jsonb;
begin
  select * into v_match from public.matches where id = p_match_id;
  v_horas := extract(epoch from (v_match.hora - now())) / 3600.0;

  -- Todos los de la nómina: neutro, sin tocar su racha. En orden de id para
  -- que dos cancelaciones simultáneas bloqueen perfiles en el mismo orden.
  for r in
    select a.id, a.id_jugador from public.attendees a
     where a.id_partido = p_match_id
       and a.estado in ('inscrito', 'confirmado_gps')
       and a.id_jugador <> v_match.id_organizador
     order by a.id_jugador
  loop
    perform public.truescore_registrar(r.id_jugador, p_match_id, 'neutro', 'neutro:' || r.id,
      case p_tipo when 'lluvia' then 'Partido suspendido por lluvia'
                  when 'cierre_cancha' then 'Partido suspendido por cierre de cancha'
                  else 'El organizador canceló el partido' end);
  end loop;

  if p_tipo in ('lluvia', 'cierre_cancha') then
    perform public.truescore_registrar(v_match.id_organizador, p_match_id, 'neutro',
      'cancelacion:' || p_match_id,
      case p_tipo when 'lluvia' then 'Cancelaste por lluvia' else 'Cancelaste por cierre de cancha' end);
    return 0;
  end if;

  v_ts := public.truescore_registrar(v_match.id_organizador, p_match_id, 'cancelacion_organizador',
    'cancelacion:' || p_match_id,
    format('Cancelaste el partido con %s h de aviso', round(greatest(v_horas, 0), 1)),
    greatest(v_horas, 0));
  return abs(coalesce((v_ts->>'nominal')::int, 0));
end $$;

revoke all on function public.truescore_registrar_cancelacion(uuid, text) from public, anon, authenticated;

-- La firma cambia: se agrega el tipo de motivo con valor por defecto. Se
-- borra la de un argumento porque con las dos, una llamada con sólo
-- `p_match_id` sería ambigua para PostgREST.
drop function if exists public.cancel_match(uuid);

create or replace function public.cancel_match(p_match_id uuid, p_tipo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid     uuid := auth.uid();
    v_match   record;
    v_reglas  jsonb := public.partido_reglas();
    v_penalty integer;
    v_row     record;
    v_tipo    text := coalesce(nullif(p_tipo, ''), 'otro');
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if v_tipo not in ('lluvia', 'cierre_cancha', 'otro') then
        return jsonb_build_object('ok', false, 'reason', 'Tipo de cancelación no válido');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.id_organizador <> v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede cancelar el partido');
    end if;
    if v_match.estado = 'cancelado' then
        return jsonb_build_object('ok', true, 'penalty', 0, 'already', true);
    end if;

    -- GUARDA 50: un partido entre clubes no se cancela por acá.
    if v_match.challenge_proposal_id is not null then
        return jsonb_build_object('ok', false, 'reason',
            'Un encuentro entre clubes se cancela desde el hilo del desafío, no desde el partido');
    end if;

    update public.matches
       set estado = 'cancelado', tipo_cancelacion = v_tipo
     where id = p_match_id;

    if public.flag_activo('truescore_fase1') then
        v_penalty := public.truescore_registrar_cancelacion(p_match_id, v_tipo);
    else
        v_penalty := case
            when v_match.hora - now() > make_interval(
                    hours => (v_reglas->>'ventana_sin_penalizacion_horas')::int)
            then (v_reglas->>'penalizacion_cancelar_temprano')::int
            else (v_reglas->>'penalizacion_cancelar_tarde')::int
        end;
        update public.profiles
           set trust_score = greatest(0, trust_score - v_penalty)
         where id = v_uid;
    end if;

    for v_row in
        select id_jugador from public.attendees
        where id_partido = p_match_id
          and estado in ('pendiente', 'inscrito', 'confirmado_gps')
          and id_jugador <> v_uid
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_cancelled', 'Se canceló el partido',
                case
                    when coalesce(v_match.motivo_cancelacion, '') = ''
                    then format('«%s» fue cancelado por el organizador.', v_match.titulo)
                    else format('«%s» fue cancelado. Motivo: %s',
                                v_match.titulo, v_match.motivo_cancelacion)
                end,
                jsonb_build_object('matchId', p_match_id));
    end loop;

    for v_row in
        select id_jugador from public.match_waitlist where id_partido = p_match_id
    loop
        insert into public.notifications (user_id, type, title, body, data)
        values (v_row.id_jugador, 'match_cancelled', 'Se canceló el partido',
                format('«%s» fue cancelado, así que la lista de espera se cerró.', v_match.titulo),
                jsonb_build_object('matchId', p_match_id));
    end loop;

    delete from public.match_waitlist where id_partido = p_match_id;

    return jsonb_build_object('ok', true, 'penalty', v_penalty, 'tipo', v_tipo);
end;
$$;

revoke all on function public.cancel_match(uuid, text) from public, anon;
grant execute on function public.cancel_match(uuid, text) to authenticated;

create or replace function public.cancel_match_and_join(p_old uuid, p_new uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_old record; v_new record; v_prof record; r record; v_username text; v_when text;
  v_cancelado uuid; v_pen int;
begin
  if v_user is null then return jsonb_build_object('ok', false, 'reason', 'No autenticado'); end if;

  select * into v_old from public.matches where id = p_old for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido no existe'); end if;

  if v_old.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false, 'reason',
      'Un encuentro entre clubes se cancela desde el hilo del desafío, no desde el partido');
  end if;

  if v_old.id_organizador <> v_user then
    return jsonb_build_object('ok', false, 'reason', 'No eres el organizador de ese partido');
  end if;

  if v_old.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'reason',
      'Ese partido ya está cancelado: puedes inscribirte en el otro directamente');
  end if;
  if v_old.estado = 'finalizado' then
    return jsonb_build_object('ok', false, 'reason', 'Ese partido ya terminó');
  end if;

  if v_old.hora <= now() + interval '2 hours' then
    return jsonb_build_object('ok', false, 'reason', 'Faltan menos de 2 horas; no puedes cancelar para cambiarte');
  end if;

  select * into v_new from public.matches where id = p_new;
  if not found then return jsonb_build_object('ok', false, 'reason', 'Partido destino no existe'); end if;
  if v_new.estado <> 'abierto' then return jsonb_build_object('ok', false, 'reason', 'El partido no está abierto'); end if;
  if v_new.cupos_disponibles <= 0 then return jsonb_build_object('ok', false, 'reason', 'No quedan cupos'); end if;

  select trust_score, estado, suspended_until into v_prof from public.profiles where id = v_user;
  if v_prof.estado = 'suspendido' and (v_prof.suspended_until is null or v_prof.suspended_until > now()) then
    return jsonb_build_object('ok', false, 'reason', 'Tu cuenta está suspendida temporalmente');
  end if;
  if coalesce(v_prof.trust_score,0) < coalesce(v_new.min_trust_score,0) then
    return jsonb_build_object('ok', false, 'reason',
      'Trust Score insuficiente: necesitas ' || v_new.min_trust_score || ' y tienes ' || coalesce(v_prof.trust_score,0));
  end if;

  update public.matches
     set estado = 'cancelado', tipo_cancelacion = 'otro'
   where id = p_old and estado <> 'cancelado'
  returning id into v_cancelado;
  if v_cancelado is null then
    return jsonb_build_object('ok', false, 'reason', 'Ese partido ya está cancelado');
  end if;

  if public.flag_activo('truescore_fase1') then
    -- 134: la misma regla que `cancel_match` (decisión aprobada).
    v_pen := public.truescore_registrar_cancelacion(p_old, 'otro');
  else
    v_pen := 25;
    update public.profiles set trust_score = greatest(trust_score - 25, 0) where id = v_user;
  end if;

  v_when := to_char(v_old.hora at time zone 'America/Santiago', 'HH24:MI');
  for r in
    select distinct id_jugador from public.attendees
    where id_partido = p_old
      and estado in ('pendiente', 'inscrito', 'confirmado_gps')
      and id_jugador <> v_user and id_jugador is not null
  loop
    perform public.create_notification(
      r.id_jugador, 'match_cancelled',
      '❌ Partido cancelado',
      'El anfitrión canceló la pichanga de las ' || v_when || ' en ' ||
        coalesce(v_old.cancha_nombre, 'la cancha') ||
        '. Tu cupo fue liberado, ¡busca otro partido y no te quedes sin jugar!',
      jsonb_build_object('matchId', p_old)
    );
  end loop;

  for r in
    select id_jugador from public.match_waitlist where id_partido = p_old
  loop
    perform public.create_notification(
      r.id_jugador, 'match_cancelled',
      '❌ Partido cancelado',
      format('«%s» fue cancelado, así que la lista de espera se cerró.',
             coalesce(v_old.titulo, 'El partido')),
      jsonb_build_object('matchId', p_old)
    );
  end loop;
  delete from public.match_waitlist where id_partido = p_old;

  if v_new.aprobacion = 'manual' then
    insert into public.attendees (id_partido, id_jugador, estado) values (p_new, v_user, 'pendiente');
    select username into v_username from public.profiles where id = v_user;
    perform public.create_notification(
      v_new.id_organizador, 'join_request',
      coalesce(v_username,'Alguien') || ' quiere unirse a tu partido',
      coalesce(v_new.titulo,'Partido'),
      jsonb_build_object('matchId', p_new, 'playerId', v_user)
    );
    return jsonb_build_object('ok', true, 'pending', true, 'penalty', v_pen);
  else
    insert into public.attendees (id_partido, id_jugador, estado) values (p_new, v_user, 'inscrito');
    update public.matches set cupos_disponibles = cupos_disponibles - 1 where id = p_new;
    return jsonb_build_object('ok', true, 'pending', false, 'penalty', v_pen);
  end if;
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 15. Asistencia: tres estados, una sola vez, 24 horas
-- ─────────────────────────────────────────────────────────────

alter table public.attendees
  add column if not exists asistencia text;

do $$ begin
  alter table public.attendees
    add constraint attendees_asistencia_check
    check (asistencia is null or asistencia in ('asistio', 'tarde', 'no_fue'));
exception when duplicate_object then null; end $$;

comment on column public.attendees.asistencia is
  'Marca del organizador para TrueScore. `estado` sigue diciendo si jugó (confirmado_gps) o no (no_asistio).';

create or replace function public.truescore_guardar_asistencia(p_match_id uuid, p_marks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match record; v_fin timestamptz; r record; v_mark text;
  v_faltan int := 0; v_asis int := 0; v_tarde int := 0; v_no int := 0;
  v_plazo int := (public.truescore_cfg('confirmacion_plazo_horas'))::int;
begin
  -- El partido ya viene bloqueado por `save_match_attendance`.
  select * into v_match from public.matches where id = p_match_id;

  if v_match.asistencia_confirmada_at is not null then
    return jsonb_build_object('ok', true, 'already', true,
      'reason', 'Ya confirmaste la asistencia de este partido');
  end if;
  if v_match.asistencia_vencida_at is not null then
    return jsonb_build_object('ok', false, 'reason',
      'Se venció el plazo para confirmar: el partido quedó neutro');
  end if;

  v_fin := v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90));
  if now() < v_fin then
    return jsonb_build_object('ok', false, 'reason', 'El partido todavía no ha terminado');
  end if;
  if now() > v_fin + make_interval(hours => v_plazo) then
    return jsonb_build_object('ok', false, 'reason',
      format('El plazo para confirmar la asistencia era de %s h después del partido', v_plazo));
  end if;

  -- Se confirma a TODA la nómina de una vez: sin esto, confirmar a medias
  -- dejaría al resto sin evento y sin forma de completarlo (es una sola vez).
  for r in
    select a.id_jugador from public.attendees a
     where a.id_partido = p_match_id
       and a.estado in ('inscrito', 'confirmado_gps')
       and a.id_jugador <> v_match.id_organizador
  loop
    if public.truescore_normalizar_marca(p_marks->>(r.id_jugador::text)) is null then
      v_faltan := v_faltan + 1;
    end if;
  end loop;
  if v_faltan > 0 then
    return jsonb_build_object('ok', false, 'faltan', v_faltan,
      'reason', format('Marca a todos los jugadores antes de confirmar (faltan %s)', v_faltan));
  end if;

  for r in
    select a.id, a.id_jugador, a.estado from public.attendees a
     where a.id_partido = p_match_id
       and a.estado in ('inscrito', 'confirmado_gps')
       and a.id_jugador <> v_match.id_organizador
     order by a.id_jugador
     for update
  loop
    v_mark := public.truescore_normalizar_marca(p_marks->>(r.id_jugador::text));

    if v_mark in ('asistio', 'tarde') then
      update public.attendees
         set estado = 'confirmado_gps', asistencia = v_mark,
             confirmado_at = coalesce(confirmado_at, now())
       where id = r.id;
      if r.estado <> 'confirmado_gps' then
        update public.profiles set asistencias_confirmadas = asistencias_confirmadas + 1
         where id = r.id_jugador;
      end if;
    else
      update public.attendees set estado = 'no_asistio', asistencia = v_mark where id = r.id;
      if r.estado = 'confirmado_gps' then
        update public.profiles set asistencias_confirmadas = greatest(0, asistencias_confirmadas - 1)
         where id = r.id_jugador;
      end if;
    end if;

    if v_mark = 'asistio' then
      perform public.truescore_registrar(r.id_jugador, p_match_id, 'asistio', 'asistencia:' || r.id,
        format('Asististe a «%s»', v_match.titulo));
      v_asis := v_asis + 1;
    elsif v_mark = 'tarde' then
      perform public.truescore_registrar(r.id_jugador, p_match_id, 'tarde', 'asistencia:' || r.id,
        format('Llegaste tarde a «%s»', v_match.titulo));
      insert into public.notifications (user_id, type, title, body, data)
      values (r.id_jugador, 'match_attendance', 'Quedaste con llegada tarde',
              format('El organizador marcó que llegaste tarde a «%s».', v_match.titulo),
              jsonb_build_object('matchId', p_match_id));
      v_tarde := v_tarde + 1;
    else
      perform public.truescore_registrar(r.id_jugador, p_match_id, 'planton', 'asistencia:' || r.id,
        format('No fuiste a «%s» y no avisaste', v_match.titulo));
      insert into public.notifications (user_id, type, title, body, data)
      values (r.id_jugador, 'match_attendance', 'Quedaste como ausente',
              format('El organizador marcó que no asististe a «%s».', v_match.titulo),
              jsonb_build_object('matchId', p_match_id));
      v_no := v_no + 1;
    end if;
  end loop;

  update public.matches
     set asistencia_confirmada_at = now(),
         estado = case when estado in ('cancelado', 'finalizado') then estado else 'finalizado' end
   where id = p_match_id;

  return jsonb_build_object('ok', true, 'presentes', v_asis, 'tarde', v_tarde, 'ausentes', v_no);
end $$;

-- Acepta las marcas nuevas y las de la app instalada ('presente'/'ausente'):
-- no hay OTA, y un teléfono sin actualizar sigue mandando las viejas.
create or replace function public.truescore_normalizar_marca(p text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p
    when 'asistio' then 'asistio' when 'presente' then 'asistio'
    when 'tarde'   then 'tarde'
    when 'no_fue'  then 'no_fue'  when 'ausente'  then 'no_fue'
    else null end;
$$;

revoke all on function public.truescore_guardar_asistencia(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.truescore_normalizar_marca(text) from public, anon, authenticated;

create or replace function public.save_match_attendance(p_match_id uuid, p_marks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_match     record;
    v_fin       timestamptz;
    v_plazo     integer := (public.partido_reglas()->>'horas_plazo_asistencia')::int;
    v_key       text;
    v_val       text;
    v_presentes integer := 0;
    v_ausentes  integer := 0;
    v_prev      text;
    v_jug       uuid;
    v_aplicado  integer;
    v_objetivo  integer;
    v_antes     integer;
    v_despues   integer;
    v_motivo    text;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_match from public.matches where id = p_match_id for update;
    if not found then
        return jsonb_build_object('ok', false, 'reason', 'El partido no existe');
    end if;
    if v_match.id_organizador <> v_uid then
        return jsonb_build_object('ok', false, 'reason', 'Solo el organizador puede registrar la asistencia');
    end if;

    if v_match.challenge_proposal_id is not null then
        return jsonb_build_object('ok', false, 'reason',
            'La asistencia de un partido entre clubes se registra junto al resultado, y la confirma el club contrario');
    end if;

    if v_match.estado = 'cancelado' then
        return jsonb_build_object('ok', false, 'reason',
            'Este partido está cancelado: no se registra asistencia');
    end if;

    -- 134: con TrueScore, la confirmación es de una vez y en tres estados.
    if public.flag_activo('truescore_fase1') then
        return public.truescore_guardar_asistencia(p_match_id, p_marks);
    end if;

    v_fin := v_match.hora + make_interval(mins => coalesce(v_match.duracion_min, 90));
    if now() < v_fin then
        return jsonb_build_object('ok', false, 'reason', 'El partido todavía no ha terminado');
    end if;
    if now() > v_fin + make_interval(hours => v_plazo) then
        return jsonb_build_object('ok', false, 'reason',
            format('El plazo para registrar la asistencia era de %s h después del partido', v_plazo));
    end if;

    for v_key, v_val in select * from jsonb_each_text(p_marks) loop
        if v_val not in ('presente', 'ausente') then
            continue;
        end if;
        v_jug := v_key::uuid;

        select estado into v_prev
        from public.attendees
        where id_partido = p_match_id and id_jugador = v_jug
        for update;

        if v_prev is null or v_prev in ('pendiente', 'cancelado') then
            continue;
        end if;

        select coalesce(sum(change_amount), 0) into v_aplicado
          from public.trust_score_history
         where user_id = v_jug
           and match_id = p_match_id
           and reason in ('Asistencia registrada por el organizador',
                          'Ausencia registrada por el organizador');

        if v_val = 'presente' then
            v_objetivo := 2;
            v_motivo := 'Asistencia registrada por el organizador';

            update public.attendees
               set estado = 'confirmado_gps',
                   confirmado_at = coalesce(confirmado_at, now())
             where id_partido = p_match_id and id_jugador = v_jug;

            if v_prev <> 'confirmado_gps' then
                update public.profiles
                   set asistencias_confirmadas = asistencias_confirmadas + 1
                 where id = v_jug;
            end if;
            v_presentes := v_presentes + 1;
        else
            v_objetivo := -15;
            v_motivo := 'Ausencia registrada por el organizador';

            update public.attendees
               set estado = 'no_asistio'
             where id_partido = p_match_id and id_jugador = v_jug;

            if v_prev = 'confirmado_gps' then
                update public.profiles
                   set asistencias_confirmadas = greatest(0, asistencias_confirmadas - 1)
                 where id = v_jug;
            end if;

            if v_prev <> 'no_asistio' then
                insert into public.notifications (user_id, type, title, body, data)
                values (v_jug, 'match_attendance', 'Quedaste como ausente',
                        format('El organizador marcó que no asististe a «%s».', v_match.titulo),
                        jsonb_build_object('matchId', p_match_id));
            end if;
            v_ausentes := v_ausentes + 1;
        end if;

        if v_objetivo <> v_aplicado then
            select trust_score into v_antes from public.profiles where id = v_jug;
            update public.profiles
               set trust_score = least(100, greatest(0, trust_score + (v_objetivo - v_aplicado)))
             where id = v_jug
            returning trust_score into v_despues;

            if v_despues <> v_antes then
                insert into public.trust_score_history (user_id, change_amount, reason, match_id)
                values (v_jug, v_despues - v_antes, v_motivo, p_match_id);
            end if;
        end if;
    end loop;

    update public.matches
       set estado = 'finalizado'
     where id = p_match_id and estado not in ('cancelado', 'finalizado');

    return jsonb_build_object('ok', true, 'presentes', v_presentes, 'ausentes', v_ausentes);
end;
$$;


-- ─────────────────────────────────────────────────────────────
-- 16. El organizador que no confirma en 24 horas
-- ─────────────────────────────────────────────────────────────

create or replace function public.truescore_cerrar_sin_confirmar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desde timestamptz;
  v_plazo interval := make_interval(hours => (public.truescore_cfg('confirmacion_plazo_horas'))::int);
  m record; r record; v_n int := 0; v_nomina int;
begin
  if not public.flag_activo('truescore_fase1') then return 0; end if;
  select activado_at into v_desde from public.feature_flags where nombre = 'truescore_fase1';

  for m in
    select * from public.matches
     where challenge_proposal_id is null
       and estado <> 'cancelado'
       and asistencia_confirmada_at is null
       and asistencia_vencida_at is null
       and hora + make_interval(mins => coalesce(duracion_min, 90)) + v_plazo <= now()
       -- Un plazo que venció antes de activar TrueScore no se cobra.
       and hora + make_interval(mins => coalesce(duracion_min, 90)) + v_plazo > v_desde
     order by id
     for update skip locked
  loop
    v_nomina := 0;
    for r in
      select a.id, a.id_jugador from public.attendees a
       where a.id_partido = m.id
         and a.estado in ('inscrito', 'confirmado_gps')
         and a.id_jugador <> m.id_organizador
       order by a.id_jugador
    loop
      perform public.truescore_registrar(r.id_jugador, m.id, 'neutro', 'neutro:' || r.id,
        'El organizador no confirmó la asistencia a tiempo');
      v_nomina := v_nomina + 1;
    end loop;

    -- Sin nadie a quien marcar no había nada que confirmar.
    if v_nomina > 0 then
      perform public.truescore_registrar(m.id_organizador, m.id, 'sin_confirmar_organizador',
        'sin_confirmar:' || m.id, format('No confirmaste la asistencia de «%s» a tiempo', m.titulo));
      insert into public.notifications (user_id, type, title, body, data)
      values (m.id_organizador, 'match_attendance', 'No confirmaste la asistencia',
              format('Pasaron %s h desde «%s» sin confirmar la asistencia: el partido quedó neutro para los jugadores y tu TrueScore bajó %s puntos.',
                     public.truescore_cfg('confirmacion_plazo_horas'), m.titulo,
                     public.truescore_cfg('sin_confirmar_puntos')),
              jsonb_build_object('matchId', m.id));
    end if;

    update public.matches set asistencia_vencida_at = now() where id = m.id;
    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

revoke all on function public.truescore_cerrar_sin_confirmar() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('futfinder-truescore-sin-confirmar');
exception when others then null; end $$;
select cron.schedule('futfinder-truescore-sin-confirmar', '*/15 * * * *',
                     'select public.truescore_cerrar_sin_confirmar()');


-- ─────────────────────────────────────────────────────────────
-- 17. GPS: sigue confirmando la llegada, pero ya no da puntos
-- ─────────────────────────────────────────────────────────────

create or replace function public.confirm_attendance_gps(
    p_match_id uuid,
    p_user_lat numeric,
    p_user_lng numeric
)
returns json
language plpgsql
security definer
set search_path = public
as $$
DECLARE
    v_match         record;
    v_attendance    record;
    v_distance      numeric;
    v_lat           numeric;
    v_lng           numeric;
    v_within_window boolean;
    v_window_end    timestamptz;
    v_confirmada    uuid;
    v_user_id       uuid := auth.uid();
    v_antes         integer;
    v_despues       integer;
    v_delta         integer;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No autenticado');
    END IF;

    SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
    IF v_match IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'Partido no existe');
    END IF;

    SELECT * INTO v_attendance
    FROM public.attendees
    WHERE id_partido = p_match_id AND id_jugador = v_user_id
    FOR UPDATE;

    IF v_attendance IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'No estás inscrito en este partido');
    END IF;

    IF v_attendance.estado = 'confirmado_gps' THEN
        RETURN json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    END IF;

    IF v_match.estado = 'cancelado' THEN
        RETURN json_build_object('ok', false, 'reason', 'Este partido fue cancelado');
    END IF;

    IF v_attendance.estado <> 'inscrito' THEN
        RETURN json_build_object('ok', false, 'reason',
            CASE v_attendance.estado
                WHEN 'pendiente' THEN 'Tu solicitud todavía está esperando la aprobación del organizador'
                ELSE 'Ya no tienes cupo en este partido'
            END);
    END IF;

    IF v_match.challenge_proposal_id IS NOT NULL THEN
        SELECT l.latitud, l.longitud INTO v_lat, v_lng
          FROM public.club_match_locations l
         WHERE l.match_id = p_match_id;
    ELSE
        v_lat := v_match.latitud;
        v_lng := v_match.longitud;
    END IF;

    IF v_lat IS NULL OR v_lng IS NULL THEN
        RETURN json_build_object(
            'ok', false,
            'reason', 'Este partido no tiene ubicación guardada, así que no podemos confirmar por GPS'
        );
    END IF;

    v_distance := public.haversine_meters(v_lat, v_lng, p_user_lat, p_user_lng);

    v_window_end := v_match.hora
        + (COALESCE(v_match.duracion_min, 90) || ' minutes')::interval
        + interval '30 minutes';
    v_within_window := now() BETWEEN (v_match.hora - interval '30 minutes') AND v_window_end;

    IF v_distance IS NULL OR v_distance > 200 THEN
        RETURN json_build_object('ok', false,
            'reason', 'Estás demasiado lejos de la cancha', 'distance', v_distance);
    END IF;

    IF NOT v_within_window THEN
        RETURN json_build_object('ok', false,
            'reason', 'Fuera de la ventana de confirmación (30 min antes / hasta 30 min después de terminar)',
            'distance', v_distance);
    END IF;

    UPDATE public.attendees
       SET estado = 'confirmado_gps', confirmado_at = now(), distancia_metros = v_distance
     WHERE id = v_attendance.id AND estado = 'inscrito'
    RETURNING id INTO v_confirmada;

    IF v_confirmada IS NULL THEN
        RETURN json_build_object('ok', true, 'reason', 'Ya estaba confirmado', 'already', true);
    END IF;

    -- 134: con TrueScore el puntaje lo mueve la confirmación del organizador.
    -- El GPS queda como evidencia de llegada y sigue contando la asistencia.
    IF public.flag_activo('truescore_fase1') THEN
        UPDATE public.profiles
           SET asistencias_confirmadas = asistencias_confirmadas + 1
         WHERE id = v_user_id
        RETURNING trust_score INTO v_despues;
        RETURN json_build_object('ok', true, 'distance', v_distance,
            'trust_delta', 0, 'trust_score', v_despues, 'truescore', true,
            'reason', 'Llegada confirmada por GPS');
    END IF;

    SELECT trust_score INTO v_antes
      FROM public.profiles
     WHERE id = v_user_id
       FOR UPDATE;

    UPDATE public.profiles
       SET trust_score = LEAST(trust_score + 1, 100),
           asistencias_confirmadas = asistencias_confirmadas + 1
     WHERE id = v_user_id
    RETURNING trust_score INTO v_despues;

    v_delta := coalesce(v_despues, 0) - coalesce(v_antes, 0);

    IF v_delta > 0 THEN
        INSERT INTO public.trust_score_history (user_id, change_amount, reason, match_id)
        VALUES (v_user_id, v_delta, 'Asistencia confirmada por GPS', p_match_id);
    END IF;

    RETURN json_build_object('ok', true, 'distance', v_distance,
        'trust_delta', v_delta, 'trust_score', v_despues,
        'reason', 'Asistencia confirmada por GPS');
END;
$$;
