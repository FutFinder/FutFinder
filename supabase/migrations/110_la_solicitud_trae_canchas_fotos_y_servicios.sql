-- =============================================================
-- FutFinder migration 110: la solicitud trae canchas, fotos y servicios
-- =============================================================
-- LA PRIMERA LLAMADA EMPEZABA DESDE CERO. El formulario de «quiero sumar
-- mi recinto» (migración 80) pedía nombre, dirección, comuna, contacto y
-- un campo libre. Con eso el equipo sabía a quién llamar, pero no si el
-- recinto valía la visita: cuántas canchas tiene, cómo se ve, qué más
-- ofrece. Todo eso se preguntaba por teléfono, una vez por recinto.
--
-- SE AGREGAN TRES COSAS, y solo una es obligatoria:
--
--   `n_canchas`  · OBLIGATORIO desde la app. Es un número, se contesta
--                  en dos segundos y es lo que decide si el recinto entra
--                  ahora o más adelante. Sigue siendo NULLABLE en la
--                  tabla y el servidor acepta null: las solicitudes
--                  anteriores a esta migración no lo tienen, y una app
--                  vieja que no lo mande no puede quedarse sin poder
--                  escribirnos — una solicitud es un mensaje, y perder un
--                  recinto de verdad por un campo que su versión no
--                  conocía sería el peor cambio posible.
--
--   `fotos`      · OPCIONAL. Nadie tiene las fotos a mano siempre, y
--                  exigirlas convertiría un formulario de dos minutos en
--                  una tarea para otro día.
--
--   `servicios`  · OPCIONAL y del MISMO CATÁLOGO CERRADO de la 75. No es
--                  una lista nueva a propósito: lo que el dueño marca acá
--                  es exactamente lo que después se guarda en
--                  `complejo_servicios` cuando el equipo carga el
--                  recinto, así que se copia sin traducir nada. Si acá
--                  fuera texto libre, esa copia sería a mano y volvería
--                  el problema que la 75 resolvió.
--
-- LAS FOTOS SE GUARDAN COMO RUTA, NO COMO URL. El bucket es PRIVADO —a
-- diferencia de `complejo-fotos`, que es público porque su foto es lo
-- primero que se ve en el buscador— porque estas son fotos de un recinto
-- que todavía no acepta nada y que quizá nunca entre: son para que el
-- equipo decida, no para publicarlas. Guardando la ruta, el enlace para
-- mirarlas se firma cuando hace falta y vence solo.
--
-- Y LA RUTA TIENE QUE EMPEZAR CON EL uid DE QUIEN MANDA. Es la misma
-- carpeta que mira la política del bucket, así que la RPC no puede
-- terminar guardando la ruta de una foto de otra persona: si no calza, la
-- solicitud se rechaza entera.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Las tres columnas ─────────────────────────────────────────
alter table public.solicitudes_recinto
    add column if not exists n_canchas int,
    add column if not exists fotos     text[] not null default '{}',
    add column if not exists servicios text[] not null default '{}';

-- Sesenta canchas es más del doble del recinto más grande que conocemos:
-- el tope no está para discutir un caso real, sino para que un dedo
-- apoyado en el botón no deje un 4000 en la ficha.
alter table public.solicitudes_recinto drop constraint if exists solicitudes_recinto_n_canchas_check;
alter table public.solicitudes_recinto add constraint solicitudes_recinto_n_canchas_check
    check (n_canchas is null or n_canchas between 1 and 60);

alter table public.solicitudes_recinto drop constraint if exists solicitudes_recinto_fotos_check;
alter table public.solicitudes_recinto add constraint solicitudes_recinto_fotos_check
    check (coalesce(array_length(fotos, 1), 0) <= 6);

-- El mismo catálogo que `complejo_servicios` (migración 75). Los dos
-- CHECK dicen lo mismo a propósito: lo que se marca acá se copia tal cual
-- allá el día que el equipo carga el recinto.
alter table public.solicitudes_recinto drop constraint if exists solicitudes_recinto_servicios_check;
alter table public.solicitudes_recinto add constraint solicitudes_recinto_servicios_check
    check (
        servicios <@ array[
            'estacionamiento', 'camarines', 'duchas', 'banos', 'quincho',
            'iluminacion', 'arriendo_balon', 'kiosco', 'graderias', 'wifi'
        ]::text[]
        and coalesce(array_length(servicios, 1), 0) <= 10
    );

-- ── 2. El bucket de las fotos ────────────────────────────────────
-- PRIVADO, y es la única diferencia con `complejo-fotos`. Lectura solo
-- para quien las subió y para `service_role`; el equipo las mira desde
-- Supabase o por el enlace firmado que arma la Edge Function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('solicitud-fotos', 'solicitud-fotos', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

-- La primera carpeta de la ruta es el uid de quien manda la solicitud, así
-- que las tres políticas son la misma comprobación.
drop policy if exists "solicitud_fotos_propias_read" on storage.objects;
create policy "solicitud_fotos_propias_read"
    on storage.objects for select
    to authenticated
    using (
        bucket_id = 'solicitud-fotos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "solicitud_fotos_propias_upload" on storage.objects;
create policy "solicitud_fotos_propias_upload"
    on storage.objects for insert
    to authenticated
    with check (
        bucket_id = 'solicitud-fotos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- Borrar hace falta porque la pantalla sube la foto al elegirla: si no se
-- pudiera quitar, arrepentirse dejaría el archivo adentro para siempre.
drop policy if exists "solicitud_fotos_propias_delete" on storage.objects;
create policy "solicitud_fotos_propias_delete"
    on storage.objects for delete
    to authenticated
    using (
        bucket_id = 'solicitud-fotos'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

-- ── 3. La RPC, con los tres datos nuevos ─────────────────────────
-- Se BORRA la versión de siete argumentos en vez de dejarla al lado: con
-- las dos vivas, una pantalla que se olvide de mandar los campos nuevos
-- llamaría a la vieja sin que nadie lo note. Los parámetros nuevos tienen
-- valor por omisión, así que quien todavía mande los siete de siempre cae
-- igual en esta.
drop function if exists public.crear_solicitud_recinto(text, text, text, text, text, text, text);

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
    v_uid uuid := auth.uid();
    v_tel text;
    v_correo text;
    v_mensaje text;
    v_fotos text[];
    v_servicios text[];
    v_foto text;
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

    -- Null pasa: ver la cabecera. Un número absurdo no.
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
        if v_foto is null or v_foto !~ ('^' || v_uid::text || '/[A-Za-z0-9._-]+$') then
            return jsonb_build_object('ok', false, 'reason', 'No pudimos guardar una de las fotos. Vuelve a elegirlas.');
        end if;
    end loop;

    -- Los servicios: catálogo cerrado, igual que en la 75. Uno que no
    -- existe se rechaza por el mismo motivo que allá: si la pantalla manda
    -- algo fuera de la lista es un error de la pantalla.
    v_servicios := coalesce(p_servicios, array[]::text[]);
    if coalesce(array_length(v_servicios, 1), 0) > 10
       or not (v_servicios <@ array[
            'estacionamiento', 'camarines', 'duchas', 'banos', 'quincho',
            'iluminacion', 'arriendo_balon', 'kiosco', 'graderias', 'wifi'
       ]::text[]) then
        return jsonb_build_object('ok', false, 'reason', 'Revisa los servicios que marcaste.');
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
        nombre_dueno, telefono, correo, mensaje,
        n_canchas, fotos, servicios
    ) values (
        v_uid, trim(p_nombre_recinto), trim(p_direccion), trim(p_comuna),
        trim(p_nombre_dueno), v_tel, v_correo, v_mensaje,
        p_n_canchas, v_fotos, v_servicios
    )
    returning id into v_id;

    return jsonb_build_object('ok', true, 'id', v_id, 'reusada', false);
end;
$$;

revoke all on function public.crear_solicitud_recinto(text, text, text, text, text, text, text, int, text[], text[]) from public, anon;
grant execute on function public.crear_solicitud_recinto(text, text, text, text, text, text, text, int, text[], text[]) to authenticated;
