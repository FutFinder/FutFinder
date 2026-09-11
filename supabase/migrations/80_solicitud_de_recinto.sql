-- =============================================================
-- FutFinder migration 80: «quiero sumar mi recinto»
-- =============================================================
-- QUÉ ES: el dueño de un complejo que todavía no trabaja con FutFinder
-- llena un formulario en la pestaña de Reservas y su solicitud queda
-- acá. El equipo la lee, lo llama y —si corresponde— le carga el
-- recinto a mano, que es como se cargó MaiClub.
--
-- NO CREA UN COMPLEJO NI UN ADMINISTRADOR. Es a propósito: `complejos`
-- y `complejo_admins` no tienen policies de escritura desde la 54 y la
-- 60, y dejar que cualquiera con cuenta se cree un recinto publicado
-- sería regalar el buscador. Una solicitud es un mensaje, no un alta.
--
-- LA SOLICITUD SE GUARDA AUNQUE EL CORREO NO SALGA. El aviso al equipo
-- lo manda la Edge Function `solicitud-recinto`, que necesita una clave
-- de proveedor de correo que hoy NO existe (misma situación que las
-- credenciales de Flow). Si esa función no está configurada o falla, la
-- fila igual quedó escrita y se puede leer desde Supabase: nadie pierde
-- una solicitud porque falte un secreto. `avisada_at` dice si el correo
-- llegó a salir.
--
-- MANDARLA DOS VECES NO CREA DOS FILAS. Un botón que no responde rápido
-- se aprieta de nuevo; si la misma persona manda el mismo recinto y
-- todavía está sin atender, se devuelve la solicitud que ya existe. Es
-- la misma idea que el índice parcial de pagos de la 78.
--
-- QUIÉN LA VE: quien la mandó (para que la pantalla pueda decir «ya nos
-- escribiste») y `service_role`. Nadie más. Lleva el teléfono y el
-- correo de una persona, así que no es de lectura pública ni siquiera
-- para el resto de los usuarios con sesión.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La solicitud ──────────────────────────────────────────────
create table if not exists public.solicitudes_recinto (
    id uuid primary key default gen_random_uuid(),

    -- Quién la mandó. `set null` y no `cascade`: si la persona borra su
    -- cuenta la solicitud sigue siendo un dato del equipo, con su
    -- teléfono y su correo adentro para poder responderla.
    solicitante_id uuid references auth.users(id) on delete set null,

    nombre_recinto text not null check (length(trim(nombre_recinto)) between 2 and 120),
    -- La dirección exacta, con calle y número: es lo que decide si el
    -- recinto se puede visitar. La comuna va aparte porque es con lo
    -- que el equipo ordena y reparte las visitas.
    direccion      text not null check (length(trim(direccion)) between 2 and 200),
    comuna         text not null check (length(trim(comuna)) between 2 and 80),
    nombre_dueno   text not null check (length(trim(nombre_dueno)) between 2 and 120),
    telefono       text not null check (telefono ~ '^\+569[0-9]{8}$'),
    correo         text not null check (correo ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$'),
    mensaje        text check (length(mensaje) <= 1000),

    -- El estado lo mueve el equipo desde Supabase, no la app.
    estado text not null default 'nueva'
        check (estado in ('nueva', 'contactada', 'aprobada', 'descartada')),

    -- Cuándo salió el correo al equipo. `null` significa «guardada pero
    -- todavía no avisada» — el estado normal mientras no haya proveedor
    -- de correo configurado.
    avisada_at timestamptz,

    created_at timestamptz not null default now()
);

create index if not exists idx_solicitudes_recinto_estado
    on public.solicitudes_recinto(estado, created_at desc);
create index if not exists idx_solicitudes_recinto_solicitante
    on public.solicitudes_recinto(solicitante_id);

-- Una sola solicitud SIN ATENDER por persona y recinto. El índice es
-- parcial: una vez contactada o descartada, la misma persona puede
-- volver a escribir por el mismo recinto.
create unique index if not exists uq_solicitudes_recinto_pendiente
    on public.solicitudes_recinto(solicitante_id, lower(trim(nombre_recinto)))
    where estado = 'nueva' and solicitante_id is not null;

alter table public.solicitudes_recinto enable row level security;

-- Solo las propias. Sin policies de escritura: se crean por la RPC, y
-- el estado lo mueve `service_role`.
drop policy if exists "solicitudes_recinto_select_propias" on public.solicitudes_recinto;
create policy "solicitudes_recinto_select_propias"
    on public.solicitudes_recinto for select
    to authenticated
    using (solicitante_id = auth.uid());

-- ── 2. Mandarla ──────────────────────────────────────────────────
-- Devuelve `{ok, ...}` y no levanta excepción, igual que el resto de las
-- RPC del lado del jugador (`crear_reserva`): lo que puede salir mal acá
-- es un dato mal escrito, no un error de programación de la pantalla.
create or replace function public.crear_solicitud_recinto(
    p_nombre_recinto text,
    p_direccion      text,
    p_comuna         text,
    p_nombre_dueno   text,
    p_telefono       text,
    p_correo         text,
    p_mensaje        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid uuid := auth.uid();
    v_tel text;
    v_correo text;
    v_mensaje text;
    v_id uuid;
    v_existente uuid;
begin
    if v_uid is null then
        return jsonb_build_object('ok', false, 'reason', 'Inicia sesión para mandarnos tu recinto.');
    end if;

    if p_nombre_recinto is null or length(trim(p_nombre_recinto)) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'Falta el nombre del recinto.');
    end if;
    if p_direccion is null or length(trim(p_direccion)) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'Falta la dirección del recinto.');
    end if;
    if p_comuna is null or length(trim(p_comuna)) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'Falta la comuna.');
    end if;
    if p_nombre_dueno is null or length(trim(p_nombre_dueno)) < 2 then
        return jsonb_build_object('ok', false, 'reason', 'Falta tu nombre.');
    end if;

    -- El mismo normalizador que usa el contacto de una reserva (67): un
    -- fijo no sirve porque el equipo escribe por WhatsApp.
    v_tel := public.normaliza_telefono_cl(p_telefono);
    if v_tel is null then
        return jsonb_build_object('ok', false, 'reason', 'Revisa el teléfono: son 9 dígitos y parte con 9.');
    end if;

    v_correo := lower(trim(coalesce(p_correo, '')));
    if v_correo !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]{2,}$' then
        return jsonb_build_object('ok', false, 'reason', 'Revisa el correo: ahí te vamos a responder.');
    end if;

    v_mensaje := nullif(trim(coalesce(p_mensaje, '')), '');
    if length(v_mensaje) > 1000 then
        v_mensaje := left(v_mensaje, 1000);
    end if;

    -- Apretar dos veces no manda dos solicitudes: si ya hay una sin
    -- atender por el mismo recinto, se devuelve esa.
    select id into v_existente
      from public.solicitudes_recinto
     where solicitante_id = v_uid
       and estado = 'nueva'
       and lower(trim(nombre_recinto)) = lower(trim(p_nombre_recinto))
     limit 1;

    if v_existente is not null then
        return jsonb_build_object('ok', true, 'id', v_existente, 'reusada', true);
    end if;

    insert into public.solicitudes_recinto (
        solicitante_id, nombre_recinto, direccion, comuna,
        nombre_dueno, telefono, correo, mensaje
    ) values (
        v_uid, trim(p_nombre_recinto), trim(p_direccion), trim(p_comuna),
        trim(p_nombre_dueno), v_tel, v_correo, v_mensaje
    )
    returning id into v_id;

    return jsonb_build_object('ok', true, 'id', v_id, 'reusada', false);
end;
$$;

revoke all on function public.crear_solicitud_recinto(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.crear_solicitud_recinto(text, text, text, text, text, text, text) to authenticated;
