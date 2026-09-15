-- =============================================================
-- FutFinder migration 94: armar la reserva dividida
-- =============================================================
-- EL PAGO DIVIDIDO SE PAGA CON BALANCE, Y ESO NO ES UN DETALLE
-- TÉCNICO: ES LA DECISIÓN QUE HACE QUE TODO LO DEMÁS SEA SIMPLE.
--
-- Con Balance nadie pone plata hasta el final. Cada uno AUTORIZA su
-- cuota, y `confirmar_reserva` cobra a todos en una sola transacción o
-- no cobra a nadie. De ahí salen tres consecuencias que valen más que
-- cualquier pantalla:
--
--   1. LA CANCHA NO SE RETIENE. El índice único del slot solo mira
--      'confirmada' (migración 55), así que varios grupos pueden estar
--      armando la misma hora a la vez y gana el que complete primero.
--      No hay que inventar un tiempo de retención ni explicarle a nadie
--      por qué su hora "estaba tomada" por alguien que nunca pagó.
--   2. NO HAY DEVOLUCIONES INDIVIDUALES. Si uno no autoriza, no se
--      cobró nada: no hay plata que devolver a la tarjeta de los otros
--      cuatro. Esto es exactamente lo contrario del pago dividido con
--      tarjeta, donde cada pago mueve plata de verdad y un grupo que no
--      se completa deja cinco reembolsos que alguien tiene que hacer.
--   3. NADIE TIENE QUE TIPEAR SU TARJETA. El que ya tiene saldo
--      autoriza con un botón.
--
-- Todo eso YA ESTABA construido desde la migración 55 —`crear_reserva`
-- exige Balance para 'jugadores' y 'capitanes', y `confirmar_reserva`
-- cobra a todos junto— y nunca tuvo una sola pantalla que lo usara.
-- Esta migración NO reinventa ese motor: le pone las cuatro piezas que
-- le faltaban para que una pantalla pueda manejarlo.
--
-- ── 1. `detalle_reserva`: QUIÉN VA Y QUIÉN YA AUTORIZÓ ──
-- `mis_reservas` (migración 86) devuelve la reserva, no su nómina. Sin
-- esto la pantalla no puede decir "faltan 2" ni mostrar a quién hay que
-- apurar. Devuelve `listo` por persona —autorizó la cuota VIGENTE— y
-- nunca, en ningún campo, el saldo de nadie: esa es la regla de
-- privacidad de la 55 y acá se mantiene igual.
--
-- ── 2. AUTOCONFIRMAR CUANDO ENTRA EL ÚLTIMO ──
-- Sin esto, el último jugador autoriza y no pasa nada hasta que el
-- organizador entre a la app y apriete un botón. Como la cancha no se
-- retiene, cada minuto de esa espera es una chance de perder la hora
-- con el grupo entero listo. Peor: el que la pierde no se entera por
-- qué, porque desde su lado él ya hizo todo.
--
-- Para no tener DOS copias de la lógica de plata, el cuerpo de
-- `confirmar_reserva` se muda tal cual a `confirmar_reserva_interna`
-- —sin el chequeo de organizador, que es lo único que cambia— y las dos
-- vías llaman a la misma función. `confirmar_reserva` conserva su firma,
-- su chequeo y su respuesta: para el cliente no cambió nada.
--
-- `confirmar_reserva_interna` NO se concede a nadie. Solo la llaman
-- funciones `security definer` de este mismo esquema.
--
-- La autoconfirmación va dentro de un bloque con EXCEPTION a propósito,
-- que en plpgsql es un savepoint: si confirmar revienta, se deshace
-- confirmar —el cobro es atómico, esa es la regla— pero la autorización
-- que la persona acaba de dar SOBREVIVE. Sin el savepoint, un fallo al
-- confirmar borraría también su autorización y tendría que volver a
-- darla sin entender por qué.
--
-- ── 3. INVITAR DE MÁS ERA UN CALLEJÓN SIN SALIDA ──
-- `invitar_participante_reserva` no miraba `n_jugadores`: se podía
-- invitar a 10 en una reserva de 4. `confirmar_reserva` exige EXACTO
-- `n_jugadores` aceptados, así que en cuanto aceptaba el quinto la
-- reserva no se podía confirmar nunca más y nada en la app explicaba
-- por qué. Se corta al invitar, que es donde se entiende.
--
-- ── 4. EL QUE NUNCA CONTESTA ──
-- Un invitado que no acepta ni rechaza deja la reserva colgada para
-- siempre: su fila 'pendiente' no suma para confirmar y tampoco libera
-- el cupo. `quitar_participante_reserva` le devuelve el control al
-- organizador; `recordar_pago_reserva` le da el empujón antes de llegar
-- a eso, con un tope de un recordatorio por hora para que no se
-- convierta en una forma de molestar a alguien.
--
-- LO QUE ESTA MIGRACIÓN NO TOCA: el pago con tarjeta sigue siendo de un
-- solo pagador ('completa'), y `cargar_balance` sigue revocada desde la
-- migración 73. O sea: esto queda completo y probable, pero nadie puede
-- cargar saldo de verdad hasta que exista la pasarela. Es el mismo
-- portón que el resto del vertical, no uno nuevo.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 0. Los dos avisos nuevos ─────────────────────────────────────
-- `notifications.type` tiene un CHECK con la lista cerrada de tipos. No
-- es decorativo: es lo que impide que un aviso con un tipo inventado
-- llegue a un teléfono sin que ninguna pantalla sepa qué hacer con él.
-- Por eso cada aviso nuevo pasa por acá — y por eso `recordar_pago_reserva`
-- reventó en la primera corrida del arnés antes de que nadie lo usara.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
    type = any (array[
        'match_join', 'friend_request', 'friend_accept', 'message_new',
        'match_reminder', 'match_rate', 'join_request', 'join_approved',
        'join_rejected', 'match_cancelled', 'match_updated', 'match_slot_free',
        'waitlist_turn', 'match_left', 'match_attendance', 'club_request',
        'club_request_accepted', 'club_request_rejected', 'club_member_joined',
        'club_member_left', 'club_invite_accepted', 'club_challenge',
        'club_challenge_accepted', 'club_challenge_rejected', 'chat_mention_all',
        'club_challenge_extension', 'club_challenge_closed',
        'club_challenge_proposal', 'club_challenge_proposal_rejected',
        'club_match_published', 'club_match_reserva_omitida', 'club_match_change',
        'club_match_change_responded', 'club_match_cancelled', 'club_sancionado',
        'club_revision_resuelta', 'club_resultado_propuesto',
        'club_resultado_confirmado', 'club_resultado_disputado',
        'reserva_confirmada', 'reserva_cancelada', 'reserva_invitacion_capitan',
        'reserva_invitacion_jugador', 'reserva_invitacion_rechazada',
        'reserva_cuota_recalculada', 'reserva_saldo_insuficiente',
        'reserva_cancelacion_solicitada', 'balance_cargado',
        'complejo_admin_agregado',
        -- Nuevos en la 94:
        'reserva_recordatorio_pago', 'reserva_participante_quitado'
    ])
);

-- ── 1. El cuerpo de confirmar, sin el chequeo de organizador ─────
-- Copia literal del cuerpo vigente de `confirmar_reserva` (migración 79)
-- salvo el `organizador_id <> v_me`, que es lo que sube a la envoltura.
create or replace function public.confirmar_reserva_interna(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_reserva public.reservas;
    v_lock_key bigint;
    v_ya_confirmada boolean;
    v_pagadores uuid[];
    v_montos integer[];
    v_faltan_autorizar uuid[] := array[]::uuid[];
    v_faltan_saldo uuid[] := array[]::uuid[];
    v_uid uuid;
    v_monto integer;
    v_saldo integer;
    v_ok_autorizacion boolean;
    i integer;
begin
    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.estado = 'confirmada' then
        return json_build_object('ok', true, 'already', true);
    end if;
    if v_reserva.estado not in ('armando', 'procesando') then
        return json_build_object('ok', false, 'reason', 'La reserva no está disponible para confirmar');
    end if;
    -- Una reserva con tarjeta NO se confirma por acá: la confirma
    -- `confirmar_pago` cuando el proveedor avisa (migración 78). Cobrarla
    -- del Balance falsearía el medio de pago.
    if v_reserva.medio_pago <> 'balance' then
        return json_build_object('ok', false, 'reason',
            'Esta reserva se paga con tarjeta: se confirma sola al completar el pago');
    end if;

    -- Serializa a cualquiera que intente confirmar ESTE slot al mismo
    -- tiempo. Un `for update` normal no alcanza acá: puede que todavía
    -- no exista ninguna fila 'confirmada' que lockear (varias reservas
    -- 'armando'/'procesando' del mismo slot coexisten a propósito).
    v_lock_key := hashtextextended(
        v_reserva.cancha_id::text || '|' || v_reserva.fecha::text || '|' || v_reserva.hora_inicio::text, 0
    );
    perform pg_advisory_xact_lock(v_lock_key);

    select exists (
        select 1 from public.reservas
         where cancha_id = v_reserva.cancha_id
           and fecha = v_reserva.fecha
           and hora_inicio = v_reserva.hora_inicio
           and estado = 'confirmada'
           and id <> v_reserva.id
    ) into v_ya_confirmada;
    if v_ya_confirmada then
        return json_build_object('ok', false, 'reason', 'ocupado');
    end if;

    -- ── Pagadores y monto exacto de cada uno ──
    -- `estado = 'aceptado'` es imprescindible acá: sin filtrar, una fila
    -- 'rechazada' (que nadie borra ni limpia — es historial, igual que
    -- las autorizaciones) sigue contando como pagador para siempre.
    if v_reserva.modalidad = 'completa' then
        v_pagadores := array[v_reserva.organizador_id];
        v_montos := array[v_reserva.precio_total];
    else
        select array_agg(user_id order by user_id), array_agg(
                   case when v_reserva.modalidad = 'capitanes'
                        then ceil(v_reserva.precio_total::numeric / 2)::integer
                        else v_reserva.cuota
                   end order by user_id)
          into v_pagadores, v_montos
          from public.reserva_participantes
         where reserva_id = p_reserva_id and estado = 'aceptado';
    end if;

    if v_pagadores is null or array_length(v_pagadores, 1) is null then
        return json_build_object('ok', false, 'reason', 'No hay participantes para cobrar');
    end if;

    -- ── El grupo tiene que estar COMPLETO ──
    -- Por CONTEO de participantes, no por sum(v_montos) = precio_total:
    -- el redondeo hacia arriba de las cuotas casi nunca calza exacto con
    -- el total, así que comparar sumas daría falsos rechazos.
    if v_reserva.modalidad = 'capitanes' and array_length(v_pagadores, 1) <> 2 then
        return json_build_object('ok', false, 'reason', 'falta_capitan');
    end if;
    if v_reserva.modalidad = 'jugadores' and array_length(v_pagadores, 1) <> v_reserva.n_jugadores then
        return json_build_object('ok', false, 'reason', 'faltan_jugadores');
    end if;

    -- ── Aceptación + autorización vigente de CADA pagador ──
    for i in 1 .. array_length(v_pagadores, 1) loop
        v_uid := v_pagadores[i];
        v_monto := v_montos[i];

        if v_reserva.modalidad <> 'completa' and not exists (
            select 1 from public.reserva_participantes
             where reserva_id = p_reserva_id and user_id = v_uid and estado = 'aceptado'
        ) then
            v_faltan_autorizar := array_append(v_faltan_autorizar, v_uid);
            continue;
        end if;

        select exists (
            select 1 from public.autorizaciones_cobro
             where reserva_id = p_reserva_id and user_id = v_uid
               and vigente = true and monto = v_monto
        ) into v_ok_autorizacion;
        if not v_ok_autorizacion then
            v_faltan_autorizar := array_append(v_faltan_autorizar, v_uid);
        end if;
    end loop;

    if array_length(v_faltan_autorizar, 1) > 0 then
        return json_build_object(
            'ok', false, 'reason', 'autorizacion_pendiente',
            'usuarios_afectados', to_json(v_faltan_autorizar)
        );
    end if;

    -- ── Doble validación de saldo: acá, dentro de la transacción de
    -- confirmar, es la que de verdad cuenta. Nunca se expone el número:
    -- solo quién de los ya-conocidos participantes no alcanza. ──
    for i in 1 .. array_length(v_pagadores, 1) loop
        v_uid := v_pagadores[i];
        v_monto := v_montos[i];
        select coalesce(sum(monto), 0) into v_saldo
          from public.balance_movimientos where user_id = v_uid;
        if v_saldo < v_monto then
            v_faltan_saldo := array_append(v_faltan_saldo, v_uid);
        end if;
    end loop;

    if array_length(v_faltan_saldo, 1) > 0 then
        -- El alias del unnest NO puede llamarse v_uid: esa variable ya
        -- existe en el DECLARE de esta función, y Postgres no distingue
        -- cuál de las dos quiere el SELECT ("column reference is
        -- ambiguous", 42702).
        insert into public.notifications (user_id, type, title, body, data)
        select v_afectado_id, 'reserva_saldo_insuficiente', 'Necesitas cargar saldo',
               'Tu Balance no alcanza para confirmar esta reserva.',
               jsonb_build_object('reservaId', p_reserva_id)
          from unnest(v_faltan_saldo) as v_afectado_id;

        return json_build_object(
            'ok', false, 'reason', 'saldo_insuficiente',
            'usuarios_afectados', to_json(v_faltan_saldo)
        );
    end if;

    -- ── Todo validado: cobrar a todos y confirmar, mismo statement ──
    for i in 1 .. array_length(v_pagadores, 1) loop
        insert into public.balance_movimientos (user_id, tipo, monto, reserva_id)
        values (v_pagadores[i], 'cobro_reserva', -v_montos[i], p_reserva_id);
    end loop;

    -- TODO (heredado de la 55): sum(v_montos) puede quedar unos pesos
    -- por encima de precio_total por el ceil() de las cuotas. No se le
    -- cobra el excedente al organizador porque él no autorizó ESE monto
    -- (regla #4: nunca cobrar sin autorización explícita).
    if (select coalesce(sum(m), 0) from unnest(v_montos) as m) > v_reserva.precio_total then
        raise notice 'confirmar_reserva %: excedente de redondeo de % pesos sin registrar',
            p_reserva_id, (select sum(m) from unnest(v_montos) as m) - v_reserva.precio_total;
    end if;

    update public.reservas
       set estado = 'confirmada', confirmada_at = now()
     where id = p_reserva_id;

    insert into public.notifications (user_id, type, title, body, data)
    select v_pagadores[gs], 'reserva_confirmada', '¡Cancha reservada!',
           'Tu reserva quedó confirmada.',
           jsonb_build_object('reservaId', p_reserva_id)
      from generate_subscripts(v_pagadores, 1) as gs;

    return json_build_object('ok', true, 'reserva_id', p_reserva_id);
end;
$$;

-- Nadie la llama de afuera: es el cuerpo compartido, no una puerta.
revoke all on function public.confirmar_reserva_interna(uuid) from public, anon, authenticated;

-- ── 2. La envoltura que el cliente ya conocía ────────────────────
create or replace function public.confirmar_reserva(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_organizador uuid;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select organizador_id into v_organizador from public.reservas where id = p_reserva_id;
    if v_organizador is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_organizador <> v_me then
        return json_build_object('ok', false, 'reason', 'Solo el organizador confirma la reserva');
    end if;

    return public.confirmar_reserva_interna(p_reserva_id);
end;
$$;

revoke all on function public.confirmar_reserva(uuid) from public, anon;
grant execute on function public.confirmar_reserva(uuid) to authenticated;

-- ── 3. Autorizar, y confirmar solo si entró el último ────────────
create or replace function public.autorizar_cobro_reserva(
    p_reserva_id uuid,
    p_monto integer
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_monto_esperado integer;
    v_participante public.reserva_participantes;
    v_listos integer;
    v_necesarios integer;
    v_confirmacion json := null;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if p_monto is null or p_monto < 0 then
        return json_build_object('ok', false, 'reason', 'Monto inválido');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.estado not in ('armando', 'procesando') then
        return json_build_object('ok', false, 'reason', 'La reserva ya no admite autorizaciones');
    end if;

    if v_reserva.modalidad = 'completa' then
        if v_me <> v_reserva.organizador_id then
            return json_build_object('ok', false, 'reason', 'Solo el organizador paga en esta modalidad');
        end if;
        v_monto_esperado := v_reserva.precio_total;
    elsif v_reserva.modalidad = 'capitanes' then
        select * into v_participante
          from public.reserva_participantes
         where reserva_id = p_reserva_id and user_id = v_me and rol in ('organizador', 'capitan');
        if v_participante is null then
            return json_build_object('ok', false, 'reason', 'No eres capitán de esta reserva');
        end if;
        v_monto_esperado := ceil(v_reserva.precio_total::numeric / 2);
        v_necesarios := 2;
    else -- jugadores
        select * into v_participante
          from public.reserva_participantes
         where reserva_id = p_reserva_id and user_id = v_me;
        if v_participante is null then
            return json_build_object('ok', false, 'reason', 'No formas parte de esta reserva');
        end if;
        v_monto_esperado := v_reserva.cuota;
        v_necesarios := v_reserva.n_jugadores;
    end if;

    if p_monto <> v_monto_esperado then
        return json_build_object(
            'ok', false, 'reason', 'El monto no coincide con la cuota vigente',
            'monto_esperado', v_monto_esperado
        );
    end if;

    if v_reserva.modalidad <> 'completa' then
        update public.reserva_participantes
           set estado = 'aceptado', monto_autorizado = p_monto, autorizado_at = now()
         where reserva_id = p_reserva_id and user_id = v_me;
    end if;

    insert into public.autorizaciones_cobro (reserva_id, user_id, monto, vigente)
    values (p_reserva_id, v_me, p_monto, true);

    -- ── ¿Entró el último? ──
    -- Se cuenta lo mismo que cuenta `confirmar_reserva_interna`: quién
    -- está 'aceptado' Y tiene autorización vigente por la cuota vigente.
    -- Contar solo 'aceptado' dispararía el intento cada vez que alguien
    -- acepta después de un recálculo de cuota, aunque su autorización
    -- vieja ya no sirva.
    if v_reserva.modalidad <> 'completa' and v_necesarios is not null then
        select count(*) into v_listos
          from public.reserva_participantes rp
         where rp.reserva_id = p_reserva_id
           and rp.estado = 'aceptado'
           and exists (
               select 1 from public.autorizaciones_cobro ac
                where ac.reserva_id = p_reserva_id and ac.user_id = rp.user_id
                  and ac.vigente = true and ac.monto = v_monto_esperado
           );

        if v_listos >= v_necesarios then
            -- Savepoint: si confirmar falla, se deshace confirmar —el
            -- cobro es todo o nada— pero la autorización de arriba queda.
            begin
                v_confirmacion := public.confirmar_reserva_interna(p_reserva_id);
            exception when others then
                v_confirmacion := json_build_object('ok', false, 'reason', 'error_al_confirmar');
            end;
        end if;
    end if;

    return json_build_object(
        'ok', true,
        'monto', p_monto,
        'confirmacion', v_confirmacion,
        'confirmada', coalesce((v_confirmacion->>'ok')::boolean, false)
    );
end;
$$;

revoke all on function public.autorizar_cobro_reserva(uuid, integer) from public, anon;
grant execute on function public.autorizar_cobro_reserva(uuid, integer) to authenticated;

-- ── 4. No invitar a más gente que cupos ──────────────────────────
create or replace function public.invitar_participante_reserva(
    p_reserva_id uuid,
    p_user_id uuid,
    p_rol text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_nombre text;
    v_ocupados integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if p_rol not in ('capitan', 'jugador') then
        return json_build_object('ok', false, 'reason', 'Rol inválido');
    end if;
    if p_user_id = v_me then
        return json_build_object('ok', false, 'reason', 'No puedes invitarte a ti mismo');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.organizador_id <> v_me then
        return json_build_object('ok', false, 'reason', 'Solo el organizador invita participantes');
    end if;
    if v_reserva.estado <> 'armando' then
        return json_build_object('ok', false, 'reason', 'La reserva ya no admite cambios');
    end if;
    if p_rol = 'capitan' and v_reserva.modalidad <> 'capitanes' then
        return json_build_object('ok', false, 'reason', 'Esta reserva no es de modalidad capitanes');
    end if;
    if p_rol = 'jugador' and v_reserva.modalidad <> 'jugadores' then
        return json_build_object('ok', false, 'reason', 'Esta reserva no es de modalidad jugadores');
    end if;
    -- `estado <> 'rechazado'`: la fila del que ya rechazó no puede seguir
    -- ocupando el cupo, o nunca se puede invitar a un reemplazo.
    if p_rol = 'capitan' and exists (
        select 1 from public.reserva_participantes
         where reserva_id = p_reserva_id and rol = 'capitan' and estado <> 'rechazado'
    ) then
        return json_build_object('ok', false, 'reason', 'Ya hay un segundo capitán invitado');
    end if;

    -- El cupo de 'jugadores' (nuevo en la 94). `confirmar_reserva` exige
    -- EXACTAMENTE `n_jugadores` aceptados: si se invita de más y aceptan
    -- de más, la reserva no se puede confirmar nunca y nada lo explica.
    -- Cortar acá deja el error donde la persona lo entiende.
    if p_rol = 'jugador' then
        select count(*) into v_ocupados
          from public.reserva_participantes
         where reserva_id = p_reserva_id and estado <> 'rechazado'
           and user_id <> p_user_id;
        if v_ocupados >= v_reserva.n_jugadores then
            return json_build_object(
                'ok', false, 'reason', 'cupos_llenos',
                'n_jugadores', v_reserva.n_jugadores
            );
        end if;
    end if;

    insert into public.reserva_participantes (reserva_id, user_id, rol, estado)
    values (p_reserva_id, p_user_id, p_rol, 'pendiente')
    on conflict (reserva_id, user_id) do nothing;

    select username into v_nombre from public.profiles where id = v_me;

    insert into public.notifications (user_id, type, title, body, data)
    values (
        p_user_id,
        case when p_rol = 'capitan' then 'reserva_invitacion_capitan' else 'reserva_invitacion_jugador' end,
        case when p_rol = 'capitan' then 'Te invitaron como capitán' else 'Te invitaron a jugar' end,
        coalesce(v_nombre, 'Un jugador') || ' te invitó a una reserva de cancha.',
        jsonb_build_object('reservaId', p_reserva_id)
    );

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.invitar_participante_reserva(uuid, uuid, text) from public, anon;
grant execute on function public.invitar_participante_reserva(uuid, uuid, text) to authenticated;

-- ── 5. Sacar al que no va a pagar ────────────────────────────────
create or replace function public.quitar_participante_reserva(
    p_reserva_id uuid,
    p_user_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_borradas integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id for update;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.organizador_id <> v_me then
        return json_build_object('ok', false, 'reason', 'Solo el organizador saca participantes');
    end if;
    if v_reserva.estado <> 'armando' then
        return json_build_object('ok', false, 'reason', 'La reserva ya no admite cambios');
    end if;
    if p_user_id = v_reserva.organizador_id then
        return json_build_object('ok', false, 'reason',
            'El organizador no se puede sacar a sí mismo. Cancela la reserva.');
    end if;

    delete from public.reserva_participantes
     where reserva_id = p_reserva_id and user_id = p_user_id;
    get diagnostics v_borradas = row_count;

    if v_borradas = 0 then
        return json_build_object('ok', false, 'reason', 'Esa persona no está en la reserva');
    end if;

    -- `autorizaciones_cobro` es historial inmutable (migración 55): no se
    -- borra, se invalida. Si no se invalidara, alguien sacado y vuelto a
    -- invitar entraría con su autorización vieja ya vigente, sin haberla
    -- dado de nuevo.
    update public.autorizaciones_cobro
       set vigente = false
     where reserva_id = p_reserva_id and user_id = p_user_id and vigente = true;

    insert into public.notifications (user_id, type, title, body, data)
    values (
        p_user_id, 'reserva_participante_quitado', 'Te sacaron de una reserva',
        'El organizador te quitó de una reserva que se estaba armando.',
        jsonb_build_object('reservaId', p_reserva_id)
    );

    return json_build_object('ok', true);
end;
$$;

revoke all on function public.quitar_participante_reserva(uuid, uuid) from public, anon;
grant execute on function public.quitar_participante_reserva(uuid, uuid) to authenticated;

-- ── 6. Recordarle al que falta ───────────────────────────────────
create or replace function public.recordar_pago_reserva(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_monto integer;
    v_nombre text;
    v_reciente boolean;
    v_avisados integer;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    if v_reserva.organizador_id <> v_me then
        return json_build_object('ok', false, 'reason', 'Solo el organizador manda el recordatorio');
    end if;
    if v_reserva.estado <> 'armando' then
        return json_build_object('ok', false, 'reason', 'Esta reserva ya no está armándose');
    end if;

    -- Un recordatorio por hora. Sin tope, el botón se convierte en una
    -- forma de spamear a alguien desde adentro de la app.
    select exists (
        select 1 from public.notifications
         where type = 'reserva_recordatorio_pago'
           and data->>'reservaId' = p_reserva_id::text
           and created_at > now() - interval '1 hour'
    ) into v_reciente;
    if v_reciente then
        return json_build_object('ok', false, 'reason', 'Ya mandaste un recordatorio hace poco. Espera un rato.');
    end if;

    v_monto := case when v_reserva.modalidad = 'capitanes'
                    then ceil(v_reserva.precio_total::numeric / 2)::integer
                    else v_reserva.cuota end;
    select username into v_nombre from public.profiles where id = v_me;

    -- A los que NO tienen autorización vigente por la cuota vigente: los
    -- que no contestaron y también los que autorizaron un monto viejo
    -- después de un recálculo. Los dos tienen que volver a entrar.
    insert into public.notifications (user_id, type, title, body, data)
    select rp.user_id, 'reserva_recordatorio_pago', 'Te falta confirmar tu parte',
           coalesce(v_nombre, 'El organizador') || ' está esperando tu parte para cerrar la cancha.',
           jsonb_build_object('reservaId', p_reserva_id)
      from public.reserva_participantes rp
     where rp.reserva_id = p_reserva_id
       and rp.user_id <> v_me
       and rp.estado <> 'rechazado'
       and not exists (
           select 1 from public.autorizaciones_cobro ac
            where ac.reserva_id = p_reserva_id and ac.user_id = rp.user_id
              and ac.vigente = true and ac.monto = v_monto
       );
    get diagnostics v_avisados = row_count;

    if v_avisados = 0 then
        return json_build_object('ok', false, 'reason', 'No falta nadie por confirmar.');
    end if;

    return json_build_object('ok', true, 'avisados', v_avisados);
end;
$$;

revoke all on function public.recordar_pago_reserva(uuid) from public, anon;
grant execute on function public.recordar_pago_reserva(uuid) to authenticated;

-- ── 7. La nómina de una reserva ──────────────────────────────────
create or replace function public.detalle_reserva(p_reserva_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_reserva public.reservas;
    v_cuota integer;
    v_necesarios integer;
    v_participantes json;
    v_listos integer;
    v_en_reserva integer;
    v_mi_estado text;
    v_mio_listo boolean;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;

    select * into v_reserva from public.reservas where id = p_reserva_id;
    if v_reserva is null then
        return json_build_object('ok', false, 'reason', 'Reserva no existe');
    end if;
    -- Security definer: la RLS del que llama no filtra nada acá, así que
    -- el permiso se comprueba a mano o cualquiera lee la nómina de
    -- cualquier reserva con solo tener el id.
    if v_reserva.organizador_id <> v_me
       and not public.es_participante_de_reserva(p_reserva_id, v_me) then
        return json_build_object('ok', false, 'reason', 'Esta reserva no es tuya');
    end if;

    v_cuota := case
        when v_reserva.modalidad = 'completa' then v_reserva.precio_total
        when v_reserva.modalidad = 'capitanes' then ceil(v_reserva.precio_total::numeric / 2)::integer
        else v_reserva.cuota end;
    v_necesarios := case
        when v_reserva.modalidad = 'completa' then 1
        when v_reserva.modalidad = 'capitanes' then 2
        else v_reserva.n_jugadores end;

    -- `listo` = aceptó Y su autorización vigente es por la cuota VIGENTE.
    -- Nunca se devuelve el saldo de nadie: la privacidad del Balance es
    -- la regla de la migración 55 y no se relaja para pintar una lista.
    select coalesce(json_agg(json_build_object(
               'user_id', t.user_id,
               'username', t.username,
               'foto_url', t.foto_url,
               'rol', t.rol,
               'estado', t.estado,
               'monto_autorizado', t.monto_autorizado,
               'listo', t.listo,
               'soy_yo', t.user_id = v_me
           ) order by t.rol <> 'organizador', t.username), '[]'::json),
           count(*) filter (where t.listo),
           count(*) filter (where t.estado <> 'rechazado')
      into v_participantes, v_listos, v_en_reserva
      from (
        select rp.user_id, p.username, p.foto_url, rp.rol, rp.estado, rp.monto_autorizado,
               (rp.estado = 'aceptado' and exists (
                   select 1 from public.autorizaciones_cobro ac
                    where ac.reserva_id = p_reserva_id and ac.user_id = rp.user_id
                      and ac.vigente = true and ac.monto = v_cuota
               )) as listo
          from public.reserva_participantes rp
          join public.profiles p on p.id = rp.user_id
         where rp.reserva_id = p_reserva_id
      ) t;

    select rp.estado,
           (rp.estado = 'aceptado' and exists (
               select 1 from public.autorizaciones_cobro ac
                where ac.reserva_id = p_reserva_id and ac.user_id = v_me
                  and ac.vigente = true and ac.monto = v_cuota))
      into v_mi_estado, v_mio_listo
      from public.reserva_participantes rp
     where rp.reserva_id = p_reserva_id and rp.user_id = v_me;

    return json_build_object(
        'ok', true,
        'reserva', json_build_object(
            'id', v_reserva.id,
            'fecha', v_reserva.fecha,
            'hora_inicio', v_reserva.hora_inicio,
            'hora_fin', v_reserva.hora_fin,
            'inicio', public.inicio_de_reserva(v_reserva.fecha, v_reserva.hora_inicio),
            'estado', v_reserva.estado,
            'modalidad', v_reserva.modalidad,
            'medio_pago', v_reserva.medio_pago,
            'precio_total', v_reserva.precio_total,
            'n_jugadores', v_reserva.n_jugadores,
            'cuota', v_cuota,
            'organizador_id', v_reserva.organizador_id
        ),
        'cancha', (select json_build_object('id', k.id, 'nombre', k.nombre, 'tipo', k.tipo,
                                            'complejo_id', c.id, 'complejo_nombre', c.nombre,
                                            'complejo_direccion', c.direccion, 'complejo_comuna', c.comuna,
                                            'complejo_foto_url', c.foto_url)
                     from public.canchas_reservables k
                     join public.complejos c on c.id = k.complejo_id
                    where k.id = v_reserva.cancha_id),
        'soy_organizador', v_reserva.organizador_id = v_me,
        'mi_estado', v_mi_estado,
        'mi_listo', coalesce(v_mio_listo, false),
        'participantes', v_participantes,
        'cupos', v_necesarios,
        'listos', coalesce(v_listos, 0),
        'en_reserva', coalesce(v_en_reserva, 0),
        'faltan_invitar', greatest(0, v_necesarios - coalesce(v_en_reserva, 0)),
        'faltan_autorizar', greatest(0, v_necesarios - coalesce(v_listos, 0))
    );
end;
$$;

revoke all on function public.detalle_reserva(uuid) from public, anon;
grant execute on function public.detalle_reserva(uuid) to authenticated;

-- ── 8. Mis reservas, ahora con el avance del grupo ───────────────
-- `create or replace` no puede cambiar el tipo de fila de un
-- `returns table`: hay que soltar y recrear, y volver a conceder.
drop function if exists public.mis_reservas(integer);

create function public.mis_reservas(p_limite integer default 60)
returns table (
    id uuid,
    fecha date,
    hora_inicio time,
    hora_fin time,
    inicio timestamptz,
    estado text,
    modalidad text,
    medio_pago text,
    precio_total integer,
    cuota integer,
    soy_organizador boolean,
    cancha_id uuid,
    cancha_nombre text,
    cancha_tipo text,
    complejo_id uuid,
    complejo_nombre text,
    complejo_direccion text,
    complejo_comuna text,
    complejo_foto_url text,
    complejo_latitud numeric,
    complejo_longitud numeric,
    pago_estado text,
    cobros json,
    puede_cancelar boolean,
    cancelacion_hasta timestamptz,
    n_jugadores integer,
    cupos integer,
    listos integer,
    mi_estado text
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
begin
    if v_me is null then
        return;
    end if;

    return query
    select r.id,
           r.fecha,
           r.hora_inicio,
           r.hora_fin,
           public.inicio_de_reserva(r.fecha, r.hora_inicio) as inicio,
           r.estado,
           r.modalidad,
           r.medio_pago,
           r.precio_total,
           r.cuota,
           (r.organizador_id = v_me) as soy_organizador,
           k.id,
           k.nombre,
           k.tipo,
           c.id,
           c.nombre,
           c.direccion,
           c.comuna,
           c.foto_url,
           c.latitud,
           c.longitud,
           (select p.estado from public.pagos p
             where p.reserva_id = r.id
             order by p.created_at desc limit 1) as pago_estado,
           (select coalesce(json_agg(json_build_object('nombre', rc.nombre, 'precio', rc.precio)
                            order by rc.precio), '[]'::json)
              from public.reserva_cobros rc where rc.reserva_id = r.id) as cobros,
           (r.estado in ('armando', 'procesando')
            or (r.estado = 'confirmada'
                and now() <= public.inicio_de_reserva(r.fecha, r.hora_inicio) - interval '12 hours')
           ) as puede_cancelar,
           case when r.estado = 'confirmada'
                then public.inicio_de_reserva(r.fecha, r.hora_inicio) - interval '12 hours'
                else null end as cancelacion_hasta,
           r.n_jugadores,
           -- Cuánta gente tiene que estar lista, y cuánta ya lo está.
           -- La tarjeta de una reserva dividida sin esto no puede decir
           -- "faltan 2" sin pedir el detalle de cada una: una consulta
           -- por reserva solo para pintar la lista.
           case when r.modalidad = 'completa' then 1
                when r.modalidad = 'capitanes' then 2
                else r.n_jugadores end as cupos,
           (select count(*)::integer
              from public.reserva_participantes rp
             where rp.reserva_id = r.id
               and rp.estado = 'aceptado'
               and exists (
                   select 1 from public.autorizaciones_cobro ac
                    where ac.reserva_id = r.id and ac.user_id = rp.user_id
                      and ac.vigente = true
                      and ac.monto = case when r.modalidad = 'capitanes'
                                          then ceil(r.precio_total::numeric / 2)::integer
                                          else r.cuota end
               )) as listos,
           (select rp.estado from public.reserva_participantes rp
             where rp.reserva_id = r.id and rp.user_id = v_me) as mi_estado
      from public.reservas r
      join public.canchas_reservables k on k.id = r.cancha_id
      join public.complejos c on c.id = k.complejo_id
     where r.organizador_id = v_me
        or public.es_participante_de_reserva(r.id, v_me)
     order by public.inicio_de_reserva(r.fecha, r.hora_inicio) desc
     limit greatest(1, least(coalesce(p_limite, 60), 200));
end;
$$;

revoke all on function public.mis_reservas(integer) from public, anon;
grant execute on function public.mis_reservas(integer) to authenticated;
