-- =============================================================
-- FutFinder migration 120: corregir la solicitud de recinto
-- =============================================================
-- HASTA HOY HABÍA UNA SOLA PUERTA Y SERVÍA PARA UNA SOLA COSA.
-- `crear_solicitud_recinto()` (migración 110) dedupea por (persona,
-- estado 'nueva', nombre del recinto): mandar otra vez el MISMO recinto
-- devuelve la solicitud vieja con `reusada: true` y **descarta en
-- silencio todo lo que se haya corregido**. El teléfono nuevo, la
-- dirección arreglada, la foto que faltaba: nada de eso entra.
--
-- Eso era tolerable mientras el correo al equipo no salía. Desde el
-- 2026-09-19 `RESEND_API_KEY` está cargada y las solicitudes llegan de
-- verdad a `futfindercl@gmail.com`, así que un dato mal escrito ya no es
-- una fila fea en una tabla: es un correo con un teléfono equivocado al
-- que el equipo va a llamar, sin forma de enterarse de la corrección.
--
-- LO QUE HACE ESTA MIGRACIÓN: separar las dos intenciones que hasta
-- ahora compartían botón.
--   · «Sumar OTRO recinto»  → `crear_solicitud_recinto()`, sin cambios.
--   · «CORREGIR la mía»     → `actualizar_solicitud_recinto()`, nueva.
--
-- LA VALIDACIÓN SE MUEVE A UN SOLO LUGAR. Las dos puertas tienen que
-- exigir exactamente lo mismo —mismo teléfono chileno, mismo catálogo de
-- servicios, mismas seis fotos dentro de la carpeta propia— y dos copias
-- de setenta líneas se separan sin que nadie lo note. Por eso nace
-- `valida_solicitud_recinto()`: recibe lo escrito y devuelve el motivo
-- del rechazo, o los valores YA NORMALIZADOS para guardar. No toca
-- ninguna tabla.
--
-- QUÉ SE PUEDE CORREGIR Y QUÉ NO. Sólo una solicitud PROPIA y todavía en
-- `estado = 'nueva'`. Una que el equipo ya tomó no se corrige por acá:
-- para entonces alguien está trabajando con esos datos y cambiarlos por
-- debajo sería peor que llamar por teléfono.
--
-- CORREGIR VUELVE A AVISAR. La corrección pone `avisada_at` en null, que
-- es la marca que mira la Edge Function para decidir si manda el correo.
-- Sin eso, el equipo se quedaría con el primer correo —el que tiene el
-- dato malo— y la corrección viviría sólo dentro de la base. El asunto
-- del correo dice que es una corrección, así que dos correos del mismo
-- recinto no se leen como dos recintos.
--
-- NO SE PUEDE CORREGIR HASTA CHOCAR CON OTRA. Si la persona tiene dos
-- solicitudes sin atender y renombra una con el nombre de la otra,
-- quedarían dos «nuevas» indistinguibles y `crear_` no sabría cuál
-- devolver. Se rechaza con un motivo que se entiende.
-- =============================================================

-- ── 1. La validación, una sola vez ───────────────────────────────
-- Devuelve `{ok:false, reason}` o `{ok:true, ...}` con los valores ya
-- normalizados. Es PURA: ni lee ni escribe tablas, así que no necesita
-- `security definer` — quien la llama ya comprobó quién es.
create or replace function public.valida_solicitud_recinto(
    p_uid            uuid,
    p_nombre_recinto text,
    p_direccion      text,
    p_comuna         text,
    p_nombre_dueno   text,
    p_telefono       text,
    p_correo         text,
    p_mensaje        text,
    p_n_canchas      int,
    p_fotos          text[],
    p_servicios      text[]
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
    v_tel       text;
    v_correo    text;
    v_mensaje   text;
    v_fotos     text[];
    v_servicios text[];
    v_foto      text;
begin
    if p_uid is null then
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

    -- Null pasa: las solicitudes anteriores a la 110 no traen el dato.
    -- Un número absurdo no.
    if p_n_canchas is not null and (p_n_canchas < 1 or p_n_canchas > 60) then
        return jsonb_build_object('ok', false, 'reason', 'Revisa cuántas canchas tiene tu recinto.');
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

    -- Las fotos: como mucho seis, y todas dentro de la carpeta de quien
    -- manda. Se RECHAZA en vez de descartar la que no calza — una ruta
    -- ajena en el arreglo no es un descuido de la pantalla, y guardar el
    -- resto en silencio escondería de dónde salió.
    v_fotos := coalesce(p_fotos, array[]::text[]);
    if coalesce(array_length(v_fotos, 1), 0) > 6 then
        return jsonb_build_object('ok', false, 'reason', 'Son hasta seis fotos.');
    end if;
    foreach v_foto in array v_fotos loop
        if v_foto is null or v_foto !~ ('^' || p_uid::text || '/[A-Za-z0-9._-]+$') then
            return jsonb_build_object('ok', false, 'reason', 'No pudimos guardar una de las fotos. Vuelve a elegirlas.');
        end if;
    end loop;

    -- Los servicios: catálogo cerrado, igual que en la 75.
    v_servicios := coalesce(p_servicios, array[]::text[]);
    if coalesce(array_length(v_servicios, 1), 0) > 10
       or not (v_servicios <@ array[
            'estacionamiento', 'camarines', 'duchas', 'banos', 'quincho',
            'iluminacion', 'arriendo_balon', 'kiosco', 'graderias', 'wifi'
       ]::text[]) then
        return jsonb_build_object('ok', false, 'reason', 'Revisa los servicios que marcaste.');
    end if;

    return jsonb_build_object(
        'ok', true,
        'nombre_recinto', trim(p_nombre_recinto),
        'direccion', trim(p_direccion),
        'comuna', trim(p_comuna),
        'nombre_dueno', trim(p_nombre_dueno),
        'telefono', v_tel,
        'correo', v_correo,
        'mensaje', v_mensaje,
        'fotos', to_jsonb(v_fotos),
        'servicios', to_jsonb(v_servicios)
    );
end;
$$;

comment on function public.valida_solicitud_recinto(uuid, text, text, text, text, text, text, text, int, text[], text[]) is
  'Valida y normaliza una solicitud de recinto. La usan crear_ y actualizar_ '
  'para no tener dos copias de las mismas reglas. No toca ninguna tabla.';

-- También se le quita a `authenticated`, y no por costumbre: los
-- privilegios por defecto de `supabase_admin` le conceden EXECUTE a toda
-- función nueva de `public`, y el disparador de la 115 sólo cierra a
-- `public` y `anon`. Medido en el ensayo de esta migración: sin esta
-- línea, `authenticated` podía llamar al validador. No es peligroso —es
-- puro y recibe el uid como parámetro— pero no es una puerta de la app, y
-- lo que no es puerta no se deja abierto.
revoke all on function public.valida_solicitud_recinto(uuid, text, text, text, text, text, text, text, int, text[], text[]) from public, anon, authenticated;

-- ── 2. Crear: la misma puerta de siempre, sin la copia ───────────
-- El comportamiento no cambia en nada: mismas reglas, mismo dedupe por
-- nombre, misma respuesta. Lo único que se fue son las setenta líneas de
-- validación, que ahora viven en un solo lugar.
create or replace function public.crear_solicitud_recinto(
    p_nombre_recinto text,
    p_direccion      text,
    p_comuna         text,
    p_nombre_dueno   text,
    p_telefono       text,
    p_correo         text,
    p_mensaje        text default null,
    p_n_canchas      int default null,
    p_fotos          text[] default null,
    p_servicios      text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid       uuid := auth.uid();
    v_ok        jsonb;
    v_id        uuid;
    v_existente uuid;
begin
    v_ok := public.valida_solicitud_recinto(
        v_uid, p_nombre_recinto, p_direccion, p_comuna, p_nombre_dueno,
        p_telefono, p_correo, p_mensaje, p_n_canchas, p_fotos, p_servicios);
    if not (v_ok ->> 'ok')::boolean then
        return v_ok;
    end if;

    -- Apretar dos veces no manda dos solicitudes: si ya hay una sin
    -- atender por el mismo recinto, se devuelve esa. Corregirla es otra
    -- puerta (`actualizar_solicitud_recinto`), a propósito: esta función
    -- no puede adivinar si lo que llegó es una corrección o un doble clic.
    select id into v_existente
      from public.solicitudes_recinto
     where solicitante_id = v_uid
       and estado = 'nueva'
       and lower(trim(nombre_recinto)) = lower(v_ok ->> 'nombre_recinto')
     limit 1;

    if v_existente is not null then
        return jsonb_build_object('ok', true, 'id', v_existente, 'reusada', true);
    end if;

    insert into public.solicitudes_recinto (
        solicitante_id, nombre_recinto, direccion, comuna,
        nombre_dueno, telefono, correo, mensaje,
        n_canchas, fotos, servicios
    ) values (
        v_uid,
        v_ok ->> 'nombre_recinto', v_ok ->> 'direccion', v_ok ->> 'comuna',
        v_ok ->> 'nombre_dueno', v_ok ->> 'telefono', v_ok ->> 'correo',
        v_ok ->> 'mensaje',
        p_n_canchas,
        array(select jsonb_array_elements_text(v_ok -> 'fotos')),
        array(select jsonb_array_elements_text(v_ok -> 'servicios'))
    )
    returning id into v_id;

    return jsonb_build_object('ok', true, 'id', v_id, 'reusada', false);
end;
$$;

revoke all on function public.crear_solicitud_recinto(text, text, text, text, text, text, text, int, text[], text[]) from public, anon;
grant execute on function public.crear_solicitud_recinto(text, text, text, text, text, text, text, int, text[], text[]) to authenticated;

-- ── 3. Corregir: la puerta nueva ─────────────────────────────────
create or replace function public.actualizar_solicitud_recinto(
    p_id             uuid,
    p_nombre_recinto text,
    p_direccion      text,
    p_comuna         text,
    p_nombre_dueno   text,
    p_telefono       text,
    p_correo         text,
    p_mensaje        text default null,
    p_n_canchas      int default null,
    p_fotos          text[] default null,
    p_servicios      text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_uid    uuid := auth.uid();
    v_ok     jsonb;
    v_estado text;
begin
    v_ok := public.valida_solicitud_recinto(
        v_uid, p_nombre_recinto, p_direccion, p_comuna, p_nombre_dueno,
        p_telefono, p_correo, p_mensaje, p_n_canchas, p_fotos, p_servicios);
    if not (v_ok ->> 'ok')::boolean then
        return v_ok;
    end if;

    -- El dueño y el estado se miran JUNTOS y con un solo mensaje: decir
    -- «esa solicitud no es tuya» le confirmaría a quien prueba un id
    -- ajeno que ese id existe.
    select estado into v_estado
      from public.solicitudes_recinto
     where id = p_id and solicitante_id = v_uid;

    if v_estado is null then
        return jsonb_build_object('ok', false, 'reason', 'No encontramos esa solicitud.');
    end if;
    if v_estado <> 'nueva' then
        return jsonb_build_object('ok', false,
            'reason', 'Ya estamos trabajando en esa solicitud. Escríbenos y la corregimos contigo.');
    end if;

    -- Renombrarla con el nombre de OTRA solicitud pendiente propia
    -- dejaría dos «nuevas» iguales, y `crear_` no sabría cuál devolver.
    if exists (
        select 1 from public.solicitudes_recinto
         where solicitante_id = v_uid
           and estado = 'nueva'
           and id <> p_id
           and lower(trim(nombre_recinto)) = lower(v_ok ->> 'nombre_recinto')
    ) then
        return jsonb_build_object('ok', false,
            'reason', 'Ya tienes otra solicitud con ese nombre. Corrige esa.');
    end if;

    -- `avisada_at` vuelve a null A PROPÓSITO: es la marca que mira la
    -- Edge Function para decidir si manda el correo. Sin esto, el equipo
    -- se quedaría con el primer aviso —el del dato malo— y la corrección
    -- no saldría nunca de la base.
    update public.solicitudes_recinto
       set nombre_recinto = v_ok ->> 'nombre_recinto',
           direccion      = v_ok ->> 'direccion',
           comuna         = v_ok ->> 'comuna',
           nombre_dueno   = v_ok ->> 'nombre_dueno',
           telefono       = v_ok ->> 'telefono',
           correo         = v_ok ->> 'correo',
           mensaje        = v_ok ->> 'mensaje',
           n_canchas      = p_n_canchas,
           fotos          = array(select jsonb_array_elements_text(v_ok -> 'fotos')),
           servicios      = array(select jsonb_array_elements_text(v_ok -> 'servicios')),
           avisada_at     = null
     where id = p_id;

    return jsonb_build_object('ok', true, 'id', p_id, 'corregida', true);
end;
$$;

comment on function public.actualizar_solicitud_recinto(uuid, text, text, text, text, text, text, text, int, text[], text[]) is
  'Corrige una solicitud PROPIA todavía en estado nueva. Vuelve a dejar '
  'avisada_at en null para que el equipo reciba el correo con los datos '
  'corregidos. Una solicitud ya tomada no se corrige por acá.';

revoke all on function public.actualizar_solicitud_recinto(uuid, text, text, text, text, text, text, text, int, text[], text[]) from public, anon;
grant execute on function public.actualizar_solicitud_recinto(uuid, text, text, text, text, text, text, text, int, text[], text[]) to authenticated;
