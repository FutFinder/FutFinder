-- =============================================================
-- FutFinder migration 68: cobros adicionales del recinto
-- =============================================================
-- QUÉ SON: cosas que el recinto ya presta o arrienda y ahora puede cobrar
-- por la app — balón, petos, árbitro, estacionamiento, botiquín. El
-- jugador los elige al reservar y los paga junto con la cancha, y al
-- recinto le llega todo en el mismo depósito.
--
-- SIEMPRE OPCIONALES. Nunca se puede exigir un adicional para poder
-- reservar; ningún camino de este archivo permite marcarlos obligatorios.
-- Un recinto no puede convertirlos en un peaje.
--
-- SON DEL PARTIDO COMPLETO, NO POR PERSONA. Se cobran una vez por
-- reserva: o los toma el grupo entero, o nadie. Se descartó la unidad
-- «por jugador» porque obligaría a cuentas separadas por persona dentro
-- de un pago único, y en el pago dividido los adicionales entran en el
-- total y se reparten igual que la cancha.
--
-- LA COMISIÓN VA SOBRE EL TOTAL, cancha + adicionales, y eso es
-- deliberado: si fuera solo sobre la cancha bastaría poner la cancha a
-- $1.000 y un «balón obligatorio» a $27.000 para esquivarla. Nadie tiene
-- que actuar de mala fe para que eso pase — alguien lo descubre y el
-- resto lo copia. Cobrando sobre el total, el recinto arma su precio como
-- quiera y a FutFinder le da igual.
--
-- CONGELADOS, igual que la comisión: `reserva_cobros` guarda el NOMBRE y
-- el PRECIO que tenían el día de la reserva. Cambiar el precio de un
-- cobro no toca las reservas ya hechas, y apagar uno no lo borra del
-- historial. Sin esto, subir el arriendo del balón reescribiría hacia
-- atrás lo que se le cobró a gente que ya jugó.
--
-- `reservas.precio_total` PASA A SER EL TOTAL COBRADO (cancha +
-- adicionales) y se agrega `precio_cancha` con el precio de la cancha
-- sola. Antes eran lo mismo, así que nada cambió de significado para las
-- reservas viejas — pero de ahora en adelante el desglose de la pantalla
-- se lee sin restar nada. Los tres números quedan congelados y se
-- verifican entre sí: `precio_total = precio_cancha + suma(adicionales)`.
--
-- `crear_reserva` cambia de firma otra vez (recibe la lista de cobros
-- elegidos) y por eso se elimina la de once argumentos, por lo mismo que
-- en la 67: dos sobrecargas y PostgREST no sabe cuál llamar.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Los cobros que ofrece un recinto ──────────────────────────
-- Son del complejo y no de la cancha: el balón y el árbitro son del
-- recinto, y obligar a cargarlos seis veces —una por cancha— sería
-- trabajo inútil y una fuente de inconsistencias.
create table if not exists public.complejo_cobros (
    id uuid primary key default gen_random_uuid(),
    complejo_id uuid not null references public.complejos(id) on delete cascade,
    nombre text not null check (length(trim(nombre)) between 2 and 40),
    precio integer not null check (precio >= 0),
    activo boolean not null default true,
    created_at timestamptz not null default now()
);

create index if not exists idx_complejo_cobros_complejo on public.complejo_cobros(complejo_id);

alter table public.complejo_cobros enable row level security;

-- El jugador ve los ACTIVOS de un recinto PUBLICADO — los necesita para
-- elegirlos al reservar. El administrador ve todos, incluidos los
-- apagados, porque tiene que poder volver a encenderlos.
drop policy if exists "complejo_cobros_select" on public.complejo_cobros;
create policy "complejo_cobros_select"
    on public.complejo_cobros for select
    using (
        (activo and exists (
            select 1 from public.complejos c
             where c.id = complejo_cobros.complejo_id and c.publicado
        ))
        or public.es_admin_complejo(complejo_id)
    );
-- Sin policies de escritura: solo vía `admin_crear_cobro` /
-- `admin_actualizar_cobro`.

-- ── 2. Los cobros de una reserva, congelados ─────────────────────
-- `nombre` y `precio` se copian acá al reservar y no se vuelven a tocar.
-- El `cobro_id` queda como referencia para saber de cuál vino, pero lo
-- que vale es lo que está en esta fila.
create table if not exists public.reserva_cobros (
    reserva_id uuid not null references public.reservas(id) on delete cascade,
    cobro_id uuid not null references public.complejo_cobros(id),
    nombre text not null,
    precio integer not null check (precio >= 0),

    primary key (reserva_id, cobro_id)
);

alter table public.reserva_cobros enable row level security;

-- Los ve quien participa de la reserva (tiene que saber qué se pagó) y el
-- recinto (tiene que saber qué preparar). Sin ventana de tiempo: a
-- diferencia del teléfono, esto no es un dato personal — es qué se
-- compró.
drop policy if exists "reserva_cobros_select" on public.reserva_cobros;
create policy "reserva_cobros_select"
    on public.reserva_cobros for select
    to authenticated
    using (
        public.es_participante_de_reserva(reserva_id, auth.uid())
        or public.es_organizador_de_reserva(reserva_id, auth.uid())
        or public.es_admin_de_reserva(reserva_id)
    );

-- ── 3. El precio de la cancha, aparte del total ──────────────────
-- Hasta acá `precio_total` era el precio de la cancha. Ahora es el total
-- cobrado, así que se guarda la cancha por separado para no tener que
-- restar en cada pantalla.
alter table public.reservas
  add column if not exists precio_cancha integer;

-- Las reservas anteriores no tenían adicionales, así que su total ERA la
-- cancha. En producción no hay ninguna, pero esto deja la migración
-- correcta si alguna vez se corre sobre datos.
update public.reservas set precio_cancha = precio_total where precio_cancha is null;

alter table public.reservas
  alter column precio_cancha set not null;

-- ── 4. Administración de los cobros ──────────────────────────────
-- El tope de 8 ACTIVOS es del diseño y tiene una razón: con más, la
-- pantalla donde el jugador los elige se vuelve un catálogo y baja la
-- conversión de la reserva, que es lo que de verdad importa. Los apagados
-- no cuentan, así que el recinto puede tener un historial largo sin
-- chocar con el tope.
create or replace function public.admin_crear_cobro(
    p_complejo_id uuid,
    p_nombre text,
    p_precio integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id uuid;
    v_activos integer;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;
    if p_nombre is null or length(trim(p_nombre)) < 2 then
        raise exception 'El cobro necesita un nombre';
    end if;
    if p_precio is null or p_precio < 0 then
        raise exception 'El precio no puede ser negativo';
    end if;

    select count(*) into v_activos
      from public.complejo_cobros
     where complejo_id = p_complejo_id and activo;

    if v_activos >= 8 then
        raise exception 'Ya tienes 8 cobros activos: apaga uno antes de agregar otro';
    end if;

    insert into public.complejo_cobros (complejo_id, nombre, precio)
    values (p_complejo_id, trim(p_nombre), p_precio)
    returning id into v_id;

    return v_id;
end;
$$;

revoke all on function public.admin_crear_cobro(uuid, text, integer) from public, anon;
grant execute on function public.admin_crear_cobro(uuid, text, integer) to authenticated;

-- Apagar NO borra: el cobro deja de ofrecerse en reservas nuevas y las
-- que ya lo incluyen lo siguen mostrando, con el precio que tenían.
-- Cambiar el precio tampoco toca las reservas ya hechas.
create or replace function public.admin_actualizar_cobro(
    p_cobro_id uuid,
    p_nombre text default null,
    p_precio integer default null,
    p_activo boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_complejo_id uuid;
    v_activos integer;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select complejo_id into v_complejo_id from public.complejo_cobros where id = p_cobro_id;
    if v_complejo_id is null or not public.es_admin_complejo(v_complejo_id) then
        raise exception 'No administras este cobro';
    end if;
    if p_precio is not null and p_precio < 0 then
        raise exception 'El precio no puede ser negativo';
    end if;

    -- Encenderlo también cuenta contra el tope.
    if p_activo is true then
        select count(*) into v_activos
          from public.complejo_cobros
         where complejo_id = v_complejo_id and activo and id <> p_cobro_id;
        if v_activos >= 8 then
            raise exception 'Ya tienes 8 cobros activos: apaga uno antes de encender este';
        end if;
    end if;

    update public.complejo_cobros set
        nombre = coalesce(nullif(trim(p_nombre), ''), nombre),
        precio = coalesce(p_precio, precio),
        activo = coalesce(p_activo, activo)
     where id = p_cobro_id;
end;
$$;

revoke all on function public.admin_actualizar_cobro(uuid, text, integer, boolean) from public, anon;
grant execute on function public.admin_actualizar_cobro(uuid, text, integer, boolean) to authenticated;

-- ── 5. `crear_reserva` con los adicionales elegidos ──────────────
-- Se elimina la versión de once argumentos por lo mismo que en la 67.
drop function if exists public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid, text, text);

create or replace function public.crear_reserva(
    p_cancha_id uuid,
    p_fecha date,
    p_hora_inicio time,
    p_modalidad text,
    p_medio_pago text default 'balance',
    p_n_jugadores integer default null,
    p_es_desafio_club boolean default false,
    p_club_organizador_id uuid default null,
    p_club_rival_id uuid default null,
    -- Obligatorios pese al `default null`: el default existe para que la
    -- firma sea legible, y la validación de más abajo los exige. Van al
    -- final para no mover la posición de los que ya estaban.
    p_contacto_nombre text default null,
    p_contacto_telefono text default null,
    -- Los cobros adicionales elegidos. Vacío o NULL es lo normal: son
    -- opcionales y la mayoría de las reservas no lleva ninguno.
    p_cobros uuid[] default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_cancha public.canchas_reservables;
    v_hora_fin time;
    v_precio_total integer;
    v_cuota integer;
    v_estado text;
    v_reserva_id uuid;
    v_ocupada boolean;
    v_contacto_tel text;
    v_precio_cancha integer;
    v_total_cobros integer := 0;
    v_n_cobros integer := 0;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    if p_modalidad not in ('completa', 'capitanes', 'jugadores') then
        return json_build_object('ok', false, 'reason', 'Modalidad inválida');
    end if;
    if p_medio_pago not in ('balance', 'tarjeta') then
        return json_build_object('ok', false, 'reason', 'Medio de pago inválido');
    end if;
    -- Regla de negocio: capitanes/jugadores requieren Balance.
    if p_modalidad in ('capitanes', 'jugadores') and p_medio_pago <> 'balance' then
        return json_build_object('ok', false, 'reason', 'Esta modalidad requiere Balance FutFinder');
    end if;
    if p_modalidad = 'jugadores' and (p_n_jugadores is null or p_n_jugadores < 2) then
        return json_build_object('ok', false, 'reason', 'Indica cuántos jugadores participan (mínimo 2)');
    end if;
    if p_es_desafio_club and (p_club_organizador_id is null or p_club_rival_id is null) then
        return json_build_object('ok', false, 'reason', 'Falta indicar los clubes del desafío');
    end if;

    -- Contacto obligatorio (migración 67). Se valida ANTES de tocar nada
    -- para no crear una reserva a la que después le falte el contacto.
    if p_contacto_nombre is null or length(trim(p_contacto_nombre)) < 2 then
        return json_build_object('ok', false, 'reason', 'Escribe un nombre de contacto');
    end if;
    v_contacto_tel := public.normaliza_telefono_cl(p_contacto_telefono);
    if v_contacto_tel is null then
        return json_build_object('ok', false, 'reason', 'Revisa el teléfono: son 9 dígitos y parte con 9');
    end if;

    -- Normaliza parámetros que no aplican a la modalidad/tipo elegido,
    -- para que un caller que los manda de todos modos no choque contra
    -- el CHECK de la tabla (eso sería un error de sistema por un
    -- descuido del cliente, no un rechazo de negocio real).
    if p_modalidad <> 'jugadores' then
        p_n_jugadores := null;
    end if;
    if not p_es_desafio_club then
        p_club_organizador_id := null;
        p_club_rival_id := null;
    end if;

    select * into v_cancha from public.canchas_reservables where id = p_cancha_id;
    if v_cancha is null or not v_cancha.activa then
        return json_build_object('ok', false, 'reason', 'Cancha no disponible');
    end if;

    v_hora_fin := p_hora_inicio + (v_cancha.duracion_slot_min || ' minutes')::interval;
    -- El precio sale de la FRANJA del bloque elegido (migración 64), no
    -- de la columna de la cancha. `precio_de_bloque` cae en
    -- `precio_hora` cuando la cancha no tiene tarifas cargadas, así que
    -- una cancha de precio único se comporta igual que antes.
    v_precio_cancha := public.precio_de_bloque(p_cancha_id, p_fecha, p_hora_inicio);

    -- Cobros adicionales (migración 68). Se validan contra el complejo de
    -- ESTA cancha y solo los activos: un id de otro recinto, o uno
    -- apagado, no entra. Se cuenta cuántos coinciden para detectar un id
    -- inválido en vez de ignorarlo en silencio y cobrar de menos.
    if p_cobros is not null and array_length(p_cobros, 1) > 0 then
        select count(*), coalesce(sum(cc.precio), 0)
          into v_n_cobros, v_total_cobros
          from public.complejo_cobros cc
         where cc.id = any(p_cobros)
           and cc.activo
           and cc.complejo_id = v_cancha.complejo_id;

        if v_n_cobros <> array_length(array(select distinct unnest(p_cobros)), 1) then
            return json_build_object('ok', false, 'reason', 'Alguno de los adicionales ya no está disponible');
        end if;
    end if;

    -- El total es lo que el jugador paga: cancha + adicionales. Sobre este
    -- número se calcula la comisión.
    v_precio_total := v_precio_cancha + v_total_cobros;

    select exists (
        select 1 from public.reservas
         where cancha_id = p_cancha_id
           and fecha = p_fecha
           and hora_inicio = p_hora_inicio
           and estado = 'confirmada'
    ) into v_ocupada;
    if v_ocupada then
        return json_build_object('ok', false, 'reason', 'ocupado');
    end if;

    -- Cableado de los bloqueos de administración (migración 60). Va
    -- aparte de `v_ocupada` y con su propio `reason`: para quien reserva
    -- son lo mismo (no puede tomar ese horario), pero el recinto y el
    -- soporte necesitan poder distinguir "otro se te adelantó" de "el
    -- complejo cerró ese bloque".
    if public.slot_bloqueado(p_cancha_id, p_fecha, p_hora_inicio, v_hora_fin) then
        return json_build_object('ok', false, 'reason', 'bloqueado');
    end if;

    if p_modalidad = 'jugadores' then
        v_cuota := ceil(v_precio_total::numeric / p_n_jugadores);
    end if;

    v_estado := case when p_modalidad = 'completa' then 'procesando' else 'armando' end;

    insert into public.reservas (
        cancha_id, organizador_id, fecha, hora_inicio, hora_fin,
        precio_total, precio_cancha, modalidad, medio_pago, n_jugadores, cuota, estado,
        es_desafio_club, club_organizador_id, club_rival_id
    ) values (
        p_cancha_id, v_me, p_fecha, p_hora_inicio, v_hora_fin,
        v_precio_total, v_precio_cancha, p_modalidad, p_medio_pago, p_n_jugadores, v_cuota, v_estado,
        p_es_desafio_club, p_club_organizador_id, p_club_rival_id
    )
    returning id into v_reserva_id;

    -- Se copian NOMBRE y PRECIO, no solo el id: cambiar el precio del
    -- cobro mañana no puede reescribir lo que se cobró hoy.
    if p_cobros is not null and array_length(p_cobros, 1) > 0 then
        insert into public.reserva_cobros (reserva_id, cobro_id, nombre, precio)
        select distinct v_reserva_id, cc.id, cc.nombre, cc.precio
          from public.complejo_cobros cc
         where cc.id = any(p_cobros) and cc.activo and cc.complejo_id = v_cancha.complejo_id;
    end if;

    -- Comisión de FutFinder, CONGELADA acá y para siempre (migración
    -- 62). Se guardan también la tasa, el piso, el techo y la tasa de
    -- IVA vigentes, para que esta fila se explique sola dentro de dos
    -- años aunque los números hayan cambiado. `base` es hoy el precio
    -- de la cancha; cuando existan los cobros adicionales pasa a ser
    -- cancha + adicionales, y por eso se guarda explícita.
    insert into public.reserva_comisiones
        (reserva_id, base, tasa, piso, techo, iva_tasa, monto)
    values (
        v_reserva_id,
        v_precio_total,
        (public.comision_params()->>'tasa')::numeric,
        (public.comision_params()->>'piso')::integer,
        (public.comision_params()->>'techo')::integer,
        (public.comision_params()->>'iva_tasa')::numeric,
        public.calcular_comision(v_precio_total)
    );

    insert into public.reserva_contacto (reserva_id, nombre, telefono)
    values (v_reserva_id, trim(p_contacto_nombre), v_contacto_tel);

    -- El organizador cuenta como participante (y pagador) en capitanes y
    -- jugadores; en 'completa' no aplica reserva_participantes (spec).
    if p_modalidad in ('capitanes', 'jugadores') then
        insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
        values (v_reserva_id, v_me, 'organizador', 'aceptado');
    end if;

    return json_build_object('ok', true, 'reserva_id', v_reserva_id);
end;
$$;

revoke all on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid, text, text, uuid[]) from public, anon;
grant execute on function public.crear_reserva(uuid, date, time, text, text, integer, boolean, uuid, uuid, text, text, uuid[]) to authenticated;

-- ── 6. El recinto ve qué tiene que preparar ──────────────────────
-- La agenda y el detalle traen la lista de adicionales de cada reserva,
-- más el precio de la cancha y el total de adicionales por separado, para
-- que el desglose de la pantalla se lea sin restar nada.
--
-- El calendario NO los trae a propósito: la agenda es la vista operativa
-- del día, y ahí es donde el recinto mira qué preparar. Meterlos también
-- en cada bloque del calendario sería ruido.

create or replace function public.admin_agenda_complejo(
    p_complejo_id uuid,
    p_fecha date
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reservas json;
    v_bloqueos json;
    v_resumen json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;
    if not public.es_admin_complejo(p_complejo_id) then
        raise exception 'No administras este complejo';
    end if;

    select coalesce(json_agg(x order by x.hora_inicio, x.cancha_nombre), '[]'::json)
      into v_reservas
      from (
          select r.id,
                 r.cancha_id,
                 k.nombre                      as cancha_nombre,
                 k.tipo                        as cancha_tipo,
                 -- `fecha` en cada reserva y no solo en la raíz de la
                 -- respuesta: sin ella el cliente no puede saber si el
                 -- partido ya terminó. Ver el encabezado.
                 to_char(r.fecha, 'YYYY-MM-DD')    as fecha,
                 to_char(r.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(r.hora_fin, 'HH24:MI')    as hora_fin,
                 r.estado,
                 r.modalidad,
                 r.medio_pago,
                 r.precio_total,
                 -- Qué tiene que preparar el recinto. No es un detalle
                 -- contable: es la razón por la que la función sirve. Si el
                 -- recinto se entera de que tenía que prestar un balón
                 -- cuando el partido ya empezó, deja de usarla.
                 coalesce((select json_agg(json_build_object('nombre', rc.nombre, 'precio', rc.precio)
                                           order by rc.nombre)
                             from public.reserva_cobros rc where rc.reserva_id = r.id), '[]'::json) as cobros,
                 r.precio_cancha,
                 coalesce((select sum(rc.precio) from public.reserva_cobros rc
                            where rc.reserva_id = r.id), 0) as total_cobros,
                 -- Desglose de la comisión (migración 62). `left join`
                 -- porque una reserva anterior a esa migración no tiene
                 -- fila: en producción no existe ninguna, pero no se
                 -- asume que no exista.
                 coalesce(c.base, r.precio_total)                        as comision_base,
                 coalesce(c.monto, 0)                                    as comision,
                 coalesce(c.base, r.precio_total) - coalesce(c.monto, 0) as neto,
                 r.es_desafio_club,
                 r.n_jugadores,
                 -- Contacto del organizador, solo dentro de la ventana
                 -- (migración 67). Se filtra acá ADEMÁS de en la policy
                 -- porque esta función es `security definer` y se salta la
                 -- RLS: sin este `case`, el recinto vería el teléfono para
                 -- siempre.
                 case when public.contacto_visible(r.id) then ct.nombre end   as contacto_nombre,
                 case when public.contacto_visible(r.id) then ct.telefono end as contacto_telefono,
                 p.username                    as organizador_username,
                 p.foto_url                    as organizador_foto_url,
                 -- Agregado, nunca la lista: el recinto necesita saber
                 -- si esto se va a completar, no quiénes son.
                 (select count(*) from public.reserva_participantes rp
                   where rp.reserva_id = r.id)                          as participantes_total,
                 (select count(*) from public.reserva_participantes rp
                   where rp.reserva_id = r.id and rp.estado = 'aceptado') as participantes_aceptados,
                 r.cancelada_at
            from public.reservas r
            join public.canchas_reservables k on k.id = r.cancha_id
            join public.profiles p            on p.id = r.organizador_id
            left join public.reserva_comisiones c on c.reserva_id = r.id
            left join public.reserva_contacto ct  on ct.reserva_id = r.id
           where k.complejo_id = p_complejo_id
             and r.fecha = p_fecha
             and r.estado in ('confirmada', 'armando', 'procesando', 'cancelada')
      ) x;

    select coalesce(json_agg(y order by y.hora_inicio, y.cancha_nombre), '[]'::json)
      into v_bloqueos
      from (
          select b.id,
                 b.cancha_id,
                 k.nombre                      as cancha_nombre,
                 to_char(b.hora_inicio, 'HH24:MI') as hora_inicio,
                 to_char(b.hora_fin, 'HH24:MI')    as hora_fin,
                 b.motivo
            from public.cancha_bloqueos b
            join public.canchas_reservables k on k.id = b.cancha_id
           where k.complejo_id = p_complejo_id
             and b.fecha = p_fecha
      ) y;

    select json_build_object(
               'reservas_confirmadas', count(*) filter (where r.estado = 'confirmada'),
               'reservas_en_curso',    count(*) filter (where r.estado in ('armando', 'procesando')),
               'reservas_canceladas',  count(*) filter (where r.estado = 'cancelada'),
               -- Solo lo confirmado suma plata: lo que está armando
               -- todavía no es un peso de nadie.
               'monto_confirmado',     coalesce(sum(r.precio_total) filter (where r.estado = 'confirmada'), 0),
               -- Solo las confirmadas pagan comisión: una cancelada no
               -- cobra nada, sin importar quién canceló ni cuándo. Por
               -- eso no hace falta borrar el monto al cancelar — queda
               -- congelado y simplemente no se suma.
               'comision_confirmada',  coalesce(sum(cc.monto) filter (where r.estado = 'confirmada'), 0),
               'neto_confirmado',      coalesce(sum(coalesce(cc.base, r.precio_total) - coalesce(cc.monto, 0))
                                                filter (where r.estado = 'confirmada'), 0),
               'bloqueos', (select count(*) from public.cancha_bloqueos b
                             join public.canchas_reservables k2 on k2.id = b.cancha_id
                            where k2.complejo_id = p_complejo_id and b.fecha = p_fecha),
               'canchas_activas', (select count(*) from public.canchas_reservables
                                    where complejo_id = p_complejo_id and activa),
               'canchas_total', (select count(*) from public.canchas_reservables
                                  where complejo_id = p_complejo_id)
           )
      into v_resumen
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      left join public.reserva_comisiones cc on cc.reserva_id = r.id
     where k.complejo_id = p_complejo_id
       and r.fecha = p_fecha;

    return json_build_object(
        'ok', true,
        'fecha', to_char(p_fecha, 'YYYY-MM-DD'),
        'resumen', v_resumen,
        'reservas', v_reservas,
        'bloqueos', v_bloqueos
    );
end;
$$;

revoke all on function public.admin_agenda_complejo(uuid, date) from public, anon;
grant execute on function public.admin_agenda_complejo(uuid, date) to authenticated;

create or replace function public.admin_reserva_detalle(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_cancha_id uuid;
    v_out json;
begin
    if auth.uid() is null then
        raise exception 'No autenticado';
    end if;

    select cancha_id into v_cancha_id from public.reservas where id = p_reserva_id;

    if v_cancha_id is null or not public.es_admin_cancha(v_cancha_id) then
        raise exception 'Esa reserva no es de un recinto que administres';
    end if;

    select json_build_object(
               'ok', true,
               'id', r.id,
               'cancha_id', r.cancha_id,
               'cancha_nombre', k.nombre,
               'cancha_tipo', k.tipo,
               'complejo_id', k.complejo_id,
               'fecha', to_char(r.fecha, 'YYYY-MM-DD'),
               'hora_inicio', to_char(r.hora_inicio, 'HH24:MI'),
               'hora_fin', to_char(r.hora_fin, 'HH24:MI'),
               'estado', r.estado,
               'modalidad', r.modalidad,
               'medio_pago', r.medio_pago,
               'precio_total', r.precio_total,
               'precio_cancha', r.precio_cancha,
               'cobros', coalesce((select json_agg(json_build_object('nombre', rc.nombre, 'precio', rc.precio)
                                                   order by rc.nombre)
                                     from public.reserva_cobros rc where rc.reserva_id = r.id), '[]'::json),
               'total_cobros', coalesce((select sum(rc.precio) from public.reserva_cobros rc
                                          where rc.reserva_id = r.id), 0),
               -- El desglose que el recinto ve al abrir la reserva:
               -- bruto, comisión y neto. Los tres con IVA incluido;
               -- `comision_iva_tasa` va para que el recinto pueda
               -- separarlo en su contabilidad.
               'comision_base', coalesce(c.base, r.precio_total),
               'comision', coalesce(c.monto, 0),
               'comision_tasa', c.tasa,
               'comision_iva_tasa', c.iva_tasa,
               'neto', coalesce(c.base, r.precio_total) - coalesce(c.monto, 0),
               'n_jugadores', r.n_jugadores,
               'cuota', r.cuota,
               'es_desafio_club', r.es_desafio_club,
               -- Ver la nota de la agenda: el filtro va acá además de
               -- en la policy, porque esto es `security definer`.
               'contacto_nombre', case when public.contacto_visible(r.id) then ct.nombre end,
               'contacto_telefono', case when public.contacto_visible(r.id) then ct.telefono end,
               'contacto_visible', public.contacto_visible(r.id),
               'organizador_username', p.username,
               'organizador_foto_url', p.foto_url,
               'created_at', r.created_at,
               'confirmada_at', r.confirmada_at,
               'cancelada_at', r.cancelada_at,
               'cancelacion_estado', r.cancelacion_estado,
               'participantes_total', (select count(*) from public.reserva_participantes rp
                                        where rp.reserva_id = r.id),
               'participantes_aceptados', (select count(*) from public.reserva_participantes rp
                                            where rp.reserva_id = r.id and rp.estado = 'aceptado'),
               'participantes_pendientes', (select count(*) from public.reserva_participantes rp
                                             where rp.reserva_id = r.id and rp.estado = 'pendiente')
           )
      into v_out
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      join public.profiles p            on p.id = r.organizador_id
      left join public.reserva_comisiones c on c.reserva_id = r.id
      left join public.reserva_contacto ct  on ct.reserva_id = r.id
     where r.id = p_reserva_id;

    return v_out;
end;
$$;

revoke all on function public.admin_reserva_detalle(uuid) from public, anon;
grant execute on function public.admin_reserva_detalle(uuid) to authenticated;
