-- =============================================================
-- FutFinder migration 83: permisos de cada administrador
-- =============================================================
-- HASTA ACÁ «ADMINISTRADOR» ERA TODO O NADA. Quien entraba a
-- `complejo_admins` podía crear canchas, cambiar precios, editar la ficha
-- y publicar — exactamente lo mismo que el dueño. Eso obliga a elegir
-- entre darle la llave entera a quien solo va a mirar la agenda, o no
-- darle nada.
--
-- Se parten en tres permisos, que son las tres cosas que cambian PLATA o
-- CARA del recinto:
--
--   · `puede_canchas` — crear y editar canchas, horarios y tarifas;
--   · `puede_cobros`  — los adicionales (balón, petos, árbitro);
--   · `puede_ficha`   — nombre, descripción, dirección, fotos, servicios.
--
-- LO QUE NO ES PERMISO Y QUEDA PARA TODOS: el día a día. Ver la agenda,
-- abrir el calendario, ocupar una hora por fuera, cancelar una reserva y
-- mirar los datos de contacto del día del partido. Es para lo que se suma
-- a alguien, y bloquearlo dejaría al administrador sin razón de existir.
--
-- DÓNDE SE APLICA: EN LAS TABLAS, NO EN CADA RPC. Son doce funciones las
-- que escriben, todas `security definer`, y tocarlas una por una es doce
-- oportunidades de olvidar una — y la que se olvide no va a fallar, va a
-- dejar pasar. Los disparadores cubren la tabla, así que cualquier RPC
-- que se agregue mañana queda protegida sola. Es el mismo criterio de
-- «una sola puerta» que el resto del vertical, un nivel más abajo.
--
-- LOS QUE YA ESTABAN NO PIERDEN NADA: se les encienden los tres. Quitarle
-- permisos a alguien por una migración sería romper algo que funcionaba.
-- Los administradores NUEVOS nacen sin ninguno, que es lo que pidió
-- Vicente: el dueño los enciende a mano.
--
-- PUBLICAR Y PEDIR REVISIÓN PASAN A SER DEL DUEÑO. No están en la lista de
-- permisos porque no son una tarea que se delegue: sacar el recinto del
-- buscador, o mandarlo a revisión, es una decisión del dueño. Antes
-- cualquier administrador podía hacerlo.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Los permisos ──────────────────────────────────────────────
alter table public.complejo_admins
    add column if not exists puede_canchas boolean not null default false;
alter table public.complejo_admins
    add column if not exists puede_cobros boolean not null default false;
alter table public.complejo_admins
    add column if not exists puede_ficha boolean not null default false;

-- Los que ya estaban podían todo. Que una migración se los quite sería
-- romperle el trabajo a alguien sin avisarle.
update public.complejo_admins
   set puede_canchas = true, puede_cobros = true, puede_ficha = true
 where not (puede_canchas and puede_cobros and puede_ficha);

-- De paso, la policy de lectura tenía la forma que la 76 tuvo que
-- corregir dos veces: `es_admin_complejo` está concedida solo a
-- `authenticated` y estaba en un `or` con una rama que `anon` sí puede
-- evaluar. Se parte en dos.
drop policy if exists "complejo_admins_select" on public.complejo_admins;
drop policy if exists "complejo_admins_select_propio" on public.complejo_admins;
drop policy if exists "complejo_admins_select_equipo" on public.complejo_admins;

create policy "complejo_admins_select_propio"
    on public.complejo_admins for select
    to authenticated
    using (user_id = auth.uid());

create policy "complejo_admins_select_equipo"
    on public.complejo_admins for select
    to authenticated
    using (public.es_admin_complejo(complejo_id));

-- ── 2. ¿Puede? ───────────────────────────────────────────────────
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

revoke all on function public.puede_en_complejo(uuid, text) from public, anon;
grant execute on function public.puede_en_complejo(uuid, text) to authenticated;

-- ── 3. Los disparadores ──────────────────────────────────────────
-- Dos, según de dónde cuelga la fila. El permiso viaja en `TG_ARGV[0]`
-- para no escribir una función por tabla.
create or replace function public.tg_permiso_por_complejo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fila jsonb := to_jsonb(coalesce(NEW, OLD));
    v_complejo uuid := (v_fila->>coalesce(TG_ARGV[1], 'complejo_id'))::uuid;
begin
    if not public.puede_en_complejo(v_complejo, TG_ARGV[0]) then
        raise exception 'No tienes permiso para esto en este recinto'
            using hint = 'Permiso necesario: ' || TG_ARGV[0];
    end if;
    return coalesce(NEW, OLD);
end;
$$;

create or replace function public.tg_permiso_por_cancha()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_fila jsonb := to_jsonb(coalesce(NEW, OLD));
    v_complejo uuid;
begin
    select k.complejo_id into v_complejo
      from public.canchas_reservables k
     where k.id = (v_fila->>'cancha_id')::uuid;

    if not public.puede_en_complejo(v_complejo, TG_ARGV[0]) then
        raise exception 'No tienes permiso para esto en este recinto'
            using hint = 'Permiso necesario: ' || TG_ARGV[0];
    end if;
    return coalesce(NEW, OLD);
end;
$$;

-- Canchas, horarios y tarifas ─────────────────────────────────────
drop trigger if exists tg_permiso_canchas on public.canchas_reservables;
create trigger tg_permiso_canchas
    before insert or update or delete on public.canchas_reservables
    for each row execute function public.tg_permiso_por_complejo('canchas');

drop trigger if exists tg_permiso_horarios on public.cancha_horario_reglas;
create trigger tg_permiso_horarios
    before insert or update or delete on public.cancha_horario_reglas
    for each row execute function public.tg_permiso_por_cancha('canchas');

drop trigger if exists tg_permiso_tarifas on public.cancha_tarifas;
create trigger tg_permiso_tarifas
    before insert or update or delete on public.cancha_tarifas
    for each row execute function public.tg_permiso_por_cancha('canchas');

-- Cobros adicionales ──────────────────────────────────────────────
drop trigger if exists tg_permiso_cobros on public.complejo_cobros;
create trigger tg_permiso_cobros
    before insert or update or delete on public.complejo_cobros
    for each row execute function public.tg_permiso_por_complejo('cobros');

-- La ficha ────────────────────────────────────────────────────────
drop trigger if exists tg_permiso_servicios on public.complejo_servicios;
create trigger tg_permiso_servicios
    before insert or update or delete on public.complejo_servicios
    for each row execute function public.tg_permiso_por_complejo('ficha');

drop trigger if exists tg_permiso_fotos on public.complejo_fotos;
create trigger tg_permiso_fotos
    before insert or update or delete on public.complejo_fotos
    for each row execute function public.tg_permiso_por_complejo('ficha');

-- El complejo mismo: SOLO las columnas que edita una persona.
--
-- `update of ...` no es un detalle: `recalc_complejo_rating` escribe
-- `rating_avg` cada vez que un jugador califica, y ese jugador no es
-- administrador de nada. Con un disparador sobre toda la tabla, calificar
-- un recinto reventaría. `publicado` tampoco va en la lista — publicar se
-- resuelve abajo, y es del dueño.
drop trigger if exists tg_permiso_ficha on public.complejos;
create trigger tg_permiso_ficha
    before update of nombre, descripcion, direccion, comuna, region,
                     latitud, longitud, foto_url
    on public.complejos
    for each row execute function public.tg_permiso_por_complejo('ficha', 'id');

-- ── 4. El dueño reparte los permisos ─────────────────────────────
create or replace function public.admin_permisos_admin(
    p_complejo_id uuid,
    p_user_id uuid,
    p_canchas boolean,
    p_cobros boolean,
    p_ficha boolean
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_objetivo public.complejo_admins;
begin
    if v_me is null then
        raise exception 'No autenticado';
    end if;
    if not exists (
        select 1 from public.complejo_admins
         where complejo_id = p_complejo_id and user_id = v_me and rol = 'dueño'
    ) then
        raise exception 'Solo quien es dueño reparte los permisos';
    end if;

    select * into v_objetivo from public.complejo_admins
     where complejo_id = p_complejo_id and user_id = p_user_id;
    if v_objetivo.user_id is null then
        return json_build_object('ok', false, 'reason', 'Esa persona no administra este recinto');
    end if;
    -- El dueño no tiene permisos que editar: los tiene todos por ser
    -- dueño. Dejar cambiarlos daría una casilla que no hace nada.
    if v_objetivo.rol = 'dueño' then
        return json_build_object('ok', false, 'reason',
            'El dueño puede todo: no hay permisos que cambiarle');
    end if;

    update public.complejo_admins
       set puede_canchas = coalesce(p_canchas, false),
           puede_cobros  = coalesce(p_cobros, false),
           puede_ficha   = coalesce(p_ficha, false)
     where complejo_id = p_complejo_id and user_id = p_user_id;

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.admin_permisos_admin(uuid, uuid, boolean, boolean, boolean)
    from public, anon;
grant execute on function public.admin_permisos_admin(uuid, uuid, boolean, boolean, boolean)
    to authenticated;

-- ── 5. Publicar y pedir revisión pasan a ser del dueño ───────────
-- Mismo cuerpo de la 82 con una comprobación más.
create or replace function public.admin_solicitar_revision_complejo(p_complejo_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_aprobado boolean;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not exists (
        select 1 from public.complejo_admins
         where complejo_id = p_complejo_id and user_id = auth.uid() and rol = 'dueño'
    ) then
        raise exception 'Solo quien es dueño manda el recinto a revisión';
    end if;

    select aprobado_futfinder into v_aprobado
      from public.complejos where id = p_complejo_id;
    if v_aprobado then
        return json_build_object('ok', true, 'ya_estaba', true);
    end if;

    if not exists (
        select 1
          from public.canchas_reservables k
          join public.cancha_horario_reglas hr on hr.cancha_id = k.id
         where k.complejo_id = p_complejo_id and k.activa
    ) then
        return json_build_object('ok', false, 'reason',
            'Antes de pedir la revisión necesitas al menos una cancha activa con horario cargado');
    end if;

    update public.complejos
       set revision_pedida_at = now(), updated_at = now()
     where id = p_complejo_id;

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.admin_solicitar_revision_complejo(uuid) from public, anon;
grant execute on function public.admin_solicitar_revision_complejo(uuid) to authenticated;

create or replace function public.admin_publicar_complejo(
    p_complejo_id uuid,
    p_publicado boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not exists (
        select 1 from public.complejo_admins
         where complejo_id = p_complejo_id and user_id = auth.uid() and rol = 'dueño'
    ) then
        raise exception 'Solo quien es dueño publica o despublica el recinto';
    end if;

    if p_publicado then
        if not exists (
            select 1
              from public.canchas_reservables k
              join public.cancha_horario_reglas hr on hr.cancha_id = k.id
             where k.complejo_id = p_complejo_id
               and k.activa
        ) then
            raise exception 'Para publicar el recinto necesitas al menos una cancha activa con horario cargado';
        end if;

        if not exists (
            select 1 from public.complejos c
             where c.id = p_complejo_id and c.aprobado_futfinder
        ) then
            raise exception 'FutFinder todavía no aprueba este recinto. Pide la revisión y te avisamos.';
        end if;
    end if;

    -- Despublicar NO exige nada más: si el recinto tiene que salir del
    -- buscador, sale. Es lo mismo que decidió la 65.
    update public.complejos
       set publicado = p_publicado,
           updated_at = now()
     where id = p_complejo_id;
end;
$$;

revoke all on function public.admin_publicar_complejo(uuid, boolean) from public, anon;
grant execute on function public.admin_publicar_complejo(uuid, boolean) to authenticated;
