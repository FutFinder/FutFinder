-- =============================================================
-- FutFinder migration 112: el tablero abierto de desafíos
-- =============================================================
-- HASTA HOY, DESAFIAR ERA SIEMPRE 1 A 1: se elige un club rival concreto
-- (desde su ficha) y se le manda un desafío a ÉL. Esta migración agrega
-- un segundo camino, EN PARALELO al de siempre, no en vez de él: un club
-- publica que busca rival —sin elegir a nadie todavía—, cualquier otro
-- club interesado responde, y el que publicó elige una respuesta y
-- descarta el resto. El ciclo formal de desafíos (migraciones 41/42:
-- pendiente → negociación → propuesta oficial → partido) NO SE TOCA ni
-- se duplica: en el momento en que se elige una respuesta, esta
-- migración crea una fila normal de `club_challenges` y reutiliza
-- `aceptar_desafio()` tal cual para entrar al mismo ciclo de siempre,
-- con el mismo hilo de chat, la misma bitácora y los mismos avisos.
--
-- QUÉ NO SE INVENTA. El mockup de referencia («FutFinder Desafíos») trae
-- «nivel del rival» y «valoración» por club — ninguno de los dos existe
-- en la base (`clubMeta.js` ya lo documenta: "Hoy NO existe cálculo de
-- nivel en la BD" / "Hoy no existe el campo rating"). Tampoco existen
-- etiquetas como «Revancha» o «Invicto»: no hay ninguna señal calculada
-- que las respalde. Esta migración no agrega ninguna de esas tres
-- cosas. Lo que sí es real y se usa tal cual: `modalidad`
-- (`futbol7`/`futbol11`, mismo vocabulario que `matches.modalidad`), la
-- comuna/región YA REGISTRADA del club (no se le vuelve a preguntar),
-- la distancia entre comunas (`clubMeta.js`) y el historial real V/E/D
-- (`club_estadisticas()`, migración 49).
--
-- `club_open_challenges`: una publicación por fila. Un club puede tener
-- varias publicaciones abiertas a la vez (formatos o fechas distintas),
-- así que NO hay un índice de "una sola activa por club" como sí existe
-- para el desafío 1 a 1.
--
-- `club_open_challenge_responses`: una respuesta de un club a una
-- publicación. `unique (open_challenge_id, club_id)` es a propósito UNA
-- fila por par: "retirar" y "volver a responder" mueven el `estado` de
-- esa misma fila (pendiente ⇄ retirada), nunca crean una segunda.
--
-- POR QUÉ LA ACEPTACIÓN REUTILIZA `aceptar_desafio()` EN VEZ DE COPIAR
-- SU LÓGICA: escribir el mensaje de sistema, la bitácora y los avisos
-- una segunda vez es exactamente cómo dos caminos que deberían llegar al
-- mismo sitio terminan contando historias distintas. `aceptar_respuesta_
-- desafio_abierto()` inserta un `club_challenges` en 'pendiente' con
-- `club_retador_id = <club que respondió>` y `club_retado_id = <club que
-- publicó>` —porque quien ACEPTA en `aceptar_desafio()` tiene que ser
-- admin del RETADO, y acá quien acepta es justamente el club que
-- publicó— y de inmediato llama a `aceptar_desafio()` sobre esa fila. A
-- partir de ahí es un desafío como cualquier otro: mismo hilo, mismos
-- plazos, misma propuesta oficial.
--
-- SIN «deshacer» LA ACEPTACIÓN. El ciclo formal tampoco lo tiene una vez
-- en negociación —no hay "deshacer aceptar" en el desafío 1 a 1—, así
-- que inventarlo acá sería una regla nueva y no una que ya existe en
-- otro lado.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La publicación ──────────────────────────────────────────
create table if not exists public.club_open_challenges (
    id                      uuid primary key default gen_random_uuid(),
    club_id                 uuid not null references public.clubs(id) on delete cascade,
    creado_por              uuid not null references auth.users(id) on delete cascade,
    modalidad               text not null check (modalidad in ('futbol7', 'futbol11')),
    fecha_propuesta         timestamptz not null,
    zona                    text,
    mensaje                 text check (mensaje is null or length(mensaje) <= 300),
    estado                  text not null default 'abierto'
        check (estado in ('abierto', 'cerrado', 'cancelado', 'expirado')),
    resultante_challenge_id uuid references public.club_challenges(id) on delete set null,
    created_at              timestamptz not null default now()
);

create index if not exists idx_club_open_challenges_club
    on public.club_open_challenges (club_id, created_at desc);
create index if not exists idx_club_open_challenges_abiertos
    on public.club_open_challenges (estado, created_at)
    where estado = 'abierto';

alter table public.club_open_challenges enable row level security;

-- Lectura: cualquier autenticado ve las publicaciones ABIERTAS —así se
-- navegan sin ser socio del club que publicó, igual que «Buscar
-- rivales»—; el club dueño ve además las propias en cualquier estado,
-- para su propia lista.
drop policy if exists club_open_challenges_read on public.club_open_challenges;
create policy club_open_challenges_read on public.club_open_challenges
    for select
    using (
        estado = 'abierto'
        or exists (
            select 1 from public.club_members m
            where m.club_id = club_open_challenges.club_id
              and m.user_id = auth.uid()
        )
    );

drop policy if exists club_open_challenges_insert on public.club_open_challenges;
create policy club_open_challenges_insert on public.club_open_challenges
    for insert
    with check (
        creado_por = auth.uid()
        and estado = 'abierto'
        and exists (
            select 1 from public.club_members m
            where m.club_id = club_open_challenges.club_id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    );

-- Editar (mientras siga abierta) o retirarla: SIEMPRE admin del club que
-- publicó. Pasar a 'cerrado' con su `resultante_challenge_id` es
-- exclusivo de `aceptar_respuesta_desafio_abierto()`, que corre
-- `security definer` y no pasa por esta política.
drop policy if exists club_open_challenges_update on public.club_open_challenges;
create policy club_open_challenges_update on public.club_open_challenges
    for update
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_open_challenges.club_id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    )
    with check (estado in ('abierto', 'cancelado'));

revoke delete on public.club_open_challenges from anon, authenticated;

-- ── 2. Las respuestas ──────────────────────────────────────────
create table if not exists public.club_open_challenge_responses (
    id                uuid primary key default gen_random_uuid(),
    open_challenge_id uuid not null references public.club_open_challenges(id) on delete cascade,
    club_id           uuid not null references public.clubs(id) on delete cascade,
    creado_por        uuid not null references auth.users(id) on delete cascade,
    mensaje           text check (mensaje is null or length(mensaje) <= 300),
    estado            text not null default 'pendiente'
        check (estado in ('pendiente', 'aceptada', 'rechazada', 'retirada')),
    created_at        timestamptz not null default now(),
    unique (open_challenge_id, club_id)
);

create index if not exists idx_club_open_challenge_responses_open
    on public.club_open_challenge_responses (open_challenge_id, created_at);

alter table public.club_open_challenge_responses enable row level security;

-- Lectura: el propio club que respondió ve su respuesta; el club dueño
-- de la publicación ve TODAS las respuestas que recibió.
drop policy if exists club_open_challenge_responses_read on public.club_open_challenge_responses;
create policy club_open_challenge_responses_read on public.club_open_challenge_responses
    for select
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_open_challenge_responses.club_id
              and m.user_id = auth.uid()
        )
        or exists (
            select 1
              from public.club_open_challenges oc
              join public.club_members m on m.club_id = oc.club_id
             where oc.id = club_open_challenge_responses.open_challenge_id
               and m.user_id = auth.uid()
        )
    );

-- Responder: admin de un club DISTINTO al que publicó, y la publicación
-- tiene que seguir abierta. No hace falta impedir responderse a uno
-- mismo con una condición aparte: `club_open_challenges_read` ya exige
-- ser admin del club_id para que la fila exista, y la comparación de acá
-- alcanza igual.
drop policy if exists club_open_challenge_responses_insert on public.club_open_challenge_responses;
create policy club_open_challenge_responses_insert on public.club_open_challenge_responses
    for insert
    with check (
        creado_por = auth.uid()
        and estado = 'pendiente'
        and exists (
            select 1 from public.club_members m
            where m.club_id = club_open_challenge_responses.club_id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
        and exists (
            select 1 from public.club_open_challenges oc
            where oc.id = club_open_challenge_responses.open_challenge_id
              and oc.estado = 'abierto'
              and oc.club_id <> club_open_challenge_responses.club_id
        )
    );

-- El propio club que respondió: retira su respuesta o vuelve a intentar.
drop policy if exists club_open_challenge_responses_update_mine on public.club_open_challenge_responses;
create policy club_open_challenge_responses_update_mine on public.club_open_challenge_responses
    for update
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_open_challenge_responses.club_id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    )
    with check (estado in ('pendiente', 'retirada'));

-- El club que publicó: rechaza una respuesta o la reconsidera. Aceptar
-- («aceptada») es exclusivo de la RPC, que no pasa por esta política.
drop policy if exists club_open_challenge_responses_update_owner on public.club_open_challenge_responses;
create policy club_open_challenge_responses_update_owner on public.club_open_challenge_responses
    for update
    using (
        exists (
            select 1
              from public.club_open_challenges oc
              join public.club_members m on m.club_id = oc.club_id
             where oc.id = club_open_challenge_responses.open_challenge_id
               and m.user_id = auth.uid()
               and m.rol = 'admin'
        )
    )
    with check (estado in ('pendiente', 'rechazada'));

revoke delete on public.club_open_challenge_responses from anon, authenticated;

-- ── 3. Vencimiento, igual que el desafío 1 a 1 ──────────────────
-- Mismo plazo que `desafio_reglas() ->> 'expiracion_pendiente_dias'`
-- (7 días): una publicación sin ninguna respuesta aceptada durante ese
-- tiempo deja de ofrecerse. Best-effort desde el cliente, igual que
-- `expire_old_challenges()` — no hay cron nuevo en esta migración.
create or replace function public.expirar_desafios_abiertos()
returns void
language sql
security definer
set search_path = public
as $$
    update public.club_open_challenges
       set estado = 'expirado'
     where estado = 'abierto'
       and created_at < now() - make_interval(
           days => (public.desafio_reglas() ->> 'expiracion_pendiente_dias')::int
       );
$$;

revoke execute on function public.expirar_desafios_abiertos() from anon;
grant execute on function public.expirar_desafios_abiertos() to authenticated;

-- ── 4. Aceptar una respuesta: entra al ciclo formal de siempre ──
create or replace function public.aceptar_respuesta_desafio_abierto(p_response_id uuid)
returns public.club_challenges
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me       uuid := auth.uid();
    v_resp     public.club_open_challenge_responses%rowtype;
    v_open     public.club_open_challenges%rowtype;
    v_challenge public.club_challenges;
begin
    if v_me is null then
        raise exception 'No autenticado' using errcode = '42501';
    end if;

    select * into v_resp
      from public.club_open_challenge_responses
     where id = p_response_id
     for update;
    if not found then
        raise exception 'Esta respuesta ya no existe' using errcode = 'no_data_found';
    end if;

    select * into v_open
      from public.club_open_challenges
     where id = v_resp.open_challenge_id
     for update;
    if not found then
        raise exception 'Esta publicación ya no existe' using errcode = 'no_data_found';
    end if;

    -- Reintento: esta respuesta ya fue la aceptada. Se devuelve el
    -- desafío resultante sin repetir nada.
    if v_resp.estado = 'aceptada' and v_open.resultante_challenge_id is not null then
        select * into v_challenge
          from public.club_challenges
         where id = v_open.resultante_challenge_id;
        return v_challenge;
    end if;

    if v_open.estado <> 'abierto' then
        raise exception 'Esta publicación ya no está abierta'
            using errcode = 'check_violation';
    end if;
    if v_resp.estado <> 'pendiente' then
        raise exception 'Esta respuesta ya no está pendiente'
            using errcode = 'check_violation';
    end if;

    -- Solo un administrador del club que publicó elige una respuesta.
    if not exists (
        select 1 from public.club_members m
        where m.user_id = v_me
          and m.club_id = v_open.club_id
          and m.rol = 'admin'
    ) then
        raise exception 'Solo un administrador del club que publicó puede elegir una respuesta'
            using errcode = '42501';
    end if;

    -- El club que respondió pasa a ser el "retador": `aceptar_desafio()`
    -- exige que quien acepta administre el RETADO, y acá quien acepta es
    -- el club que publicó.
    insert into public.club_challenges (
        club_retador_id, club_retado_id, creado_por,
        fecha_propuesta, zona, mensaje
    ) values (
        v_resp.club_id, v_open.club_id, v_resp.creado_por,
        v_open.fecha_propuesta, v_open.zona,
        coalesce(v_resp.mensaje, v_open.mensaje)
    )
    returning * into v_challenge;

    -- Reutiliza el ciclo formal tal cual: mismo hilo, misma bitácora,
    -- mismos avisos a los administradores de los dos clubes. Si ya
    -- hubiera un desafío activo entre este mismo par de clubes, esto
    -- falla con el mismo mensaje amable que ya usa el ciclo 1 a 1.
    select * into v_challenge from public.aceptar_desafio(v_challenge.id);

    update public.club_open_challenges
       set estado = 'cerrado', resultante_challenge_id = v_challenge.id
     where id = v_open.id;

    update public.club_open_challenge_responses
       set estado = 'aceptada'
     where id = v_resp.id;

    -- Se descarta el resto de las respuestas pendientes. No lleva
    -- bitácora propia: para el club rechazado esto se ve igual que un
    -- desafío 1 a 1 que no prosperó.
    update public.club_open_challenge_responses
       set estado = 'rechazada'
     where open_challenge_id = v_open.id
       and id <> v_resp.id
       and estado = 'pendiente';

    return v_challenge;
end;
$$;

revoke execute on function public.aceptar_respuesta_desafio_abierto(uuid) from anon;
grant execute on function public.aceptar_respuesta_desafio_abierto(uuid) to authenticated;
