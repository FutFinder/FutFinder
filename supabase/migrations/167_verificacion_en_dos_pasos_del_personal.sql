-- 167. Verificación en dos pasos (TOTP) obligatoria para el personal — apagada.
--
-- QUÉ ES ESTO. Supabase Auth trae MFA con TOTP (app de autenticación). La
-- cuenta de cualquiera puede activarlo desde Ajustes (cliente, sin cambios en
-- la base). Lo que esta migración agrega es la parte que SÓLO el servidor
-- puede imponer: que quien administra un recinto o modera no pueda usar esos
-- poderes con una sesión de un solo factor.
--
--   · `mfa_ok_para_staff()` — la pregunta, en un solo lugar: «¿esta sesión
--     cumple lo que se le exige al personal?». Verdadero si no hay sesión (el
--     cron, el servicio), si la bandera está apagada, o si el JWT trae
--     `aal = 'aal2'` (o sea, ya presentó el código en esta sesión).
--   · Se pega a las puertas del personal: `es_moderador`, `es_admin_complejo`,
--     `es_admin_cancha`, `es_admin_de_reserva`, `puede_en_complejo`,
--     `admin_mis_complejos` y, por inyección sobre el cuerpo vivo, las cinco
--     RPC que mira la tabla `complejo_admins` por su cuenta (agregar, quitar y
--     dar permisos a administradores; publicar; pedir revisión). Todas las
--     políticas y RPC de moderación y del panel pasan por alguna de ésas.
--   · `mi_requisito_mfa()` — lo que la app necesita saber para guiar a la
--     persona: si es personal, si hoy se le exige y a qué nivel está su sesión.
--
-- LA BANDERA NACE APAGADA, y no es prudencia vaga: FutFinder no tiene
-- actualizaciones por aire, así que una persona con una app instalada sin la
-- pantalla de activar el código quedaría fuera de su panel sin forma de
-- entrar. Orden: build con las pantallas → cada administrador y moderador
-- activa su código → `update feature_flags set activo = true where nombre =
-- 'mfa_obligatoria_staff'`. Mientras esté apagada, NADA de esto cambia el
-- comportamiento de ninguna función (lo comprueba el arnés).
--
-- UN ADMINISTRADOR SIN CÓDIGO, CON LA BANDERA ENCENDIDA, PIERDE ACCESO al
-- panel hasta que lo active: es lo que significa «obligatoria». La pantalla
-- se lo dice y lo lleva a activarlo (`MfaSetupScreen`).
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/167_verificacion_en_dos_pasos_del_personal_test.sql

-- ── 1. La bandera ────────────────────────────────────────────────
insert into public.feature_flags (nombre, activo, descripcion)
values ('mfa_obligatoria_staff', false,
        'Exige verificación en dos pasos (aal2) a moderadores y administradores de recinto. Activar sólo cuando todos tengan su código y haya un build con la pantalla de activarlo.')
on conflict (nombre) do nothing;

-- ── 2. La pregunta ───────────────────────────────────────────────
create or replace function public.mfa_ok_para_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is null
      or not public.flag_activo('mfa_obligatoria_staff')
      or coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;

revoke all on function public.mfa_ok_para_staff() from public, anon, authenticated;

-- ── 3. La puerta que usan las RPC largas ─────────────────────────
create or replace function public._exigir_mfa_staff()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.mfa_ok_para_staff() then
    raise exception 'Para esta acción necesitas verificar tu identidad con el código de tu app de autenticación.'
      using errcode = '42501', detail = 'MFA_REQUERIDA';
  end if;
end;
$$;

revoke all on function public._exigir_mfa_staff() from public, anon, authenticated;

-- ── 4. Las puertas del personal ──────────────────────────────────
create or replace function public.es_moderador()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and public.mfa_ok_para_staff()
     and exists (select 1 from public.moderadores m where m.user_id = auth.uid());
$$;

create or replace function public.es_admin_complejo(p_complejo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok_para_staff()
     and exists (
       select 1 from public.complejo_admins
        where complejo_id = p_complejo_id and user_id = auth.uid()
     );
$$;

create or replace function public.es_admin_cancha(p_cancha_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok_para_staff()
     and exists (
       select 1
         from public.canchas_reservables c
         join public.complejo_admins ca on ca.complejo_id = c.complejo_id
        where c.id = p_cancha_id and ca.user_id = auth.uid()
     );
$$;

create or replace function public.es_admin_de_reserva(p_reserva_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.mfa_ok_para_staff()
     and exists (
       select 1
         from public.reservas r
         join public.canchas_reservables k on k.id = r.cancha_id
         join public.complejo_admins ca on ca.complejo_id = k.complejo_id
        where r.id = p_reserva_id and ca.user_id = auth.uid()
     );
$$;

create or replace function public.puede_en_complejo(p_complejo_id uuid, p_permiso text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    v_fila public.complejo_admins;
begin
    -- SIN SESIÓN DEVUELVE `true`, y hay que decir por qué: es el equipo
    -- de FutFinder escribiendo por SQL, o una función de sistema como
    -- `recalc_complejo_rating`. Esto NO abre nada: las RPC empiezan todas
    -- comprobando `auth.uid() is null` y sin sesión no se llega a
    -- escribir desde la app. Si alguna vez una RPC deja de comprobarlo,
    -- el agujero está acá.
    if auth.uid() is null then
        return true;
    end if;

    select * into v_fila
      from public.complejo_admins
     where complejo_id = p_complejo_id and user_id = auth.uid();

    if v_fila.user_id is null then
        return false;
    end if;
    -- Verificación en dos pasos del personal (migración 167).
    if not public.mfa_ok_para_staff() then
        return false;
    end if;
    -- El dueño no tiene banderas que mirar: puede todo, siempre.
    if v_fila.rol = 'dueño' then
        return true;
    end if;

    return case p_permiso
        when 'canchas' then v_fila.puede_canchas
        when 'cobros'  then v_fila.puede_cobros
        when 'ficha'   then v_fila.puede_ficha
        else false
    end;
end;
$$;

create or replace function public.admin_mis_complejos()
returns table (
  id uuid, nombre text, descripcion text, direccion text, region text, comuna text,
  latitud numeric, longitud numeric, foto_url text, verificado_futfinder boolean,
  publicado boolean, aprobado_futfinder boolean, revision_pedida_at timestamptz,
  rating_avg numeric, rating_count integer, created_at timestamptz, updated_at timestamptz,
  rol text, puede_canchas boolean, puede_cobros boolean, puede_ficha boolean
)
language sql
security definer
set search_path = public
as $$
    select c.id, c.nombre, c.descripcion, c.direccion, c.region, c.comuna,
           c.latitud, c.longitud, c.foto_url, c.verificado_futfinder,
           c.publicado, c.aprobado_futfinder, c.revision_pedida_at,
           c.rating_avg, c.rating_count, c.created_at, c.updated_at,
           ca.rol,
           -- Las mismas tres respuestas que daría `puede_en_complejo()`,
           -- incluido que el dueño no tiene banderas que mirar. Si algún
           -- día esto y esa función dejaran de coincidir, el panel
           -- escondería filas que sí se pueden usar, o al revés.
           ca.rol = 'dueño' or coalesce(ca.puede_canchas, false),
           ca.rol = 'dueño' or coalesce(ca.puede_cobros, false),
           ca.rol = 'dueño' or coalesce(ca.puede_ficha, false)
      from public.complejos c
      join public.complejo_admins ca on ca.complejo_id = c.id
     where ca.user_id = auth.uid()
       and public.mfa_ok_para_staff()
     order by c.nombre;
$$;

-- Las cinco RPC de dueño que miran `complejo_admins` por su cuenta: se
-- inyecta la exigencia como primera sentencia del cuerpo vivo (mismo método
-- y mismo motivo que en la 166: no copiar cuerpos grandes).
create or replace function pg_temp.exigir_mfa_en(p_firma regprocedure)
returns void language plpgsql as $$
declare
  v_def text := pg_get_functiondef(p_firma);
  v_nuevo text;
begin
  if v_def like '%_exigir_mfa_staff()%' then
    return;
  end if;
  v_nuevo := regexp_replace(v_def, E'(\\nbegin\\n)', E'\\1  perform public._exigir_mfa_staff();\n', 'i');
  if v_nuevo = v_def then
    raise exception 'No encontré el begin de % para inyectar la verificación', p_firma;
  end if;
  execute v_nuevo;
end $$;

select pg_temp.exigir_mfa_en('public.admin_agregar_admin(uuid,uuid,text)'::regprocedure);
select pg_temp.exigir_mfa_en('public.admin_quitar_admin(uuid,uuid)'::regprocedure);
select pg_temp.exigir_mfa_en('public.admin_permisos_admin(uuid,uuid,boolean,boolean,boolean)'::regprocedure);
select pg_temp.exigir_mfa_en('public.admin_publicar_complejo(uuid,boolean)'::regprocedure);
select pg_temp.exigir_mfa_en('public.admin_solicitar_revision_complejo(uuid)'::regprocedure);

-- ── 5. Lo que la app necesita saber ──────────────────────────────
create or replace function public.mi_requisito_mfa()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_staff boolean;
  v_exige boolean := public.flag_activo('mfa_obligatoria_staff');
begin
  if v_uid is null then
    return jsonb_build_object('es_staff', false, 'requerida', false, 'cumple', true, 'nivel', null);
  end if;
  v_staff := exists (select 1 from public.moderadores where user_id = v_uid)
          or exists (select 1 from public.complejo_admins where user_id = v_uid);
  return jsonb_build_object(
    'es_staff',  v_staff,
    'requerida', v_staff and v_exige,
    'cumple',    not (v_staff and v_exige) or coalesce(auth.jwt() ->> 'aal', '') = 'aal2',
    'nivel',     auth.jwt() ->> 'aal'
  );
end;
$$;

revoke all on function public.mi_requisito_mfa() from public, anon;
grant execute on function public.mi_requisito_mfa() to authenticated;
