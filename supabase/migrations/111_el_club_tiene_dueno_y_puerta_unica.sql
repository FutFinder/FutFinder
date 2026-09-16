-- =============================================================
-- FutFinder migration 111: el club tiene dueño, y una sola puerta
-- =============================================================
-- CINCO AGUJEROS EN LOS PERMISOS DE CLUBES, encontrados revisando el
-- apartado entero contra producción. Los cinco se reprodujeron primero
-- con un arnés y los cinco se vuelven a probar acá abajo.
--
-- 1. EL FUNDADOR EXPULSADO VOLVÍA SOLO, Y DE ADMIN.
--    `club_members_founder_insert` dejaba insertarse como `admin` a
--    cualquiera que figure en `clubs.created_by`, sin mirar si seguía
--    siendo miembro. Ceder la administración o que te echaran del club
--    que creaste no servía de nada: te volvías a meter cuando querías.
--
--    Y EL ARREGLO ESTABA ESCRITO Y NUNCA FUNCIONÓ. La política hermana
--    `club_members_insert` llevaba esta condición:
--
--        not exists (select 1 from club_members m where m.club_id = m.club_id)
--
--    `m.club_id = m.club_id` se compara consigo misma; quiso decir
--    `club_members.club_id`. Tal como estaba era siempre verdadera, así
--    que esa política no autorizaba nada y la que mandaba era la otra,
--    la que no tiene la guarda. Acá se escribe UNA sola política, con la
--    comprobación que se quiso hacer: el fundador se inserta cuando el
--    club todavía no tiene a nadie — o sea, al crearlo y nunca más.
--
-- 2. UN ADMIN METÍA A QUIEN QUISIERA REESCRIBIENDO `user_id`.
--    `club_members_update` sólo exige ser admin del club, y nada impedía
--    cambiarle el `user_id` a una fila de nómina: el socio pasaba a ser
--    alguien que jamás pidió entrar. El trigger que valida no ayudaba
--    porque es `before insert or update OF rol` y no se dispara cuando el
--    SET toca otra columna.
--
--    SE ARREGLA CON GRANTS POR COLUMNA, como la 102 con `trust_score`, y
--    no con otra política: el cliente sólo escribe `rol` (promover a
--    admin y el interruptor de capitán, `services/clubs.js`), así que
--    quitarle el resto no le saca nada que use. Lo que entra por
--    `handle_club_request_approved` no se ve afectado: es SECURITY
--    DEFINER y corre como el dueño.
--
-- 3. EL ÚNICO ADMIN SE SALÍA Y DEJABA EL CLUB HUÉRFANO.
--    Quedaban miembros y cero administradores: nadie para editar la
--    ficha, aceptar solicitudes ni responder un desafío. La regla existía
--    —«nombra otro admin antes de salir»— pero SÓLO en el cliente
--    (`leaveClub`), y una regla que sólo vive en la pantalla no es una
--    regla. Pasa a ser un trigger, que cubre todas las puertas.
--
-- 4. UN CLUB SIN MIEMBROS LO BORRABA CUALQUIERA.
--    La tercera rama de `clubs_delete` decía «si no hay miembros
--    distintos de mí», que para un club vacío es cierto para todo el
--    mundo, fuera o no del club.
--
-- 5. Y PEOR: EL FUNDADOR EXPULSADO BORRABA EL CLUB ENTERO, con sus
--    miembros dentro, porque `auth.uid() = created_by` bastaba. Haber
--    fundado un club no puede ser un poder que sobreviva a que te vayas.
--
--    Las dos ramas se reemplazan por una: borra quien ADMINISTRA hoy. Se
--    conserva un caso y sólo uno — el creador puede borrar su club
--    mientras no tenga ningún miembro — porque `createClub` deshace a
--    mano el club recién creado si falla la inserción del fundador, y sin
--    esa rama ese rollback dejaría un club vacío para siempre.
--
-- Y UNA SEXTA COSA, QUE NO ES DE PERMISOS:
--
-- 6. SALIRSE DE UN PARTIDO DE CLUBES COSTABA DISTINTO SEGÚN EL BOTÓN.
--    Por la nómina (`leave_club_match`) era gratis; por la puerta normal
--    (`leave_match` → `leave_match_penalized`) cobraba 3 puntos.
--    Comprobado: 100 → 97. Es el mismo caso que cerró la 106 para los
--    partidos normales, que en clubes quedó abierto.
--
--    SE CIERRA LA PUERTA, NO SE CAMBIA EL PRECIO. `join_match` ya rechaza
--    los partidos entre clubes con «la inscripción es por club» (y el
--    trigger de la 109 lo vuelve a comprobar en `attendees`, así que
--    `swap_match` tampoco deja colarse: probado). Lo simétrico es que la
--    baja también se gestione por club, que además es lo que la interfaz
--    ya hace — `MatchDetail` manda a la nómina. Así nadie paga 3 puntos
--    por algo que por el botón de al lado es gratis, y la economía queda
--    exactamente como está hoy en la práctica.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. Quién entra a la nómina ───────────────────────────────────
drop policy if exists "club_members_insert" on public.club_members;
drop policy if exists "club_members_founder_insert" on public.club_members;

create policy "club_members_el_fundador_estrena_su_club"
    on public.club_members for insert
    to authenticated
    with check (
        auth.uid() = user_id
        and rol = 'admin'
        and exists (
            select 1 from public.clubs c
             where c.id = club_members.club_id and c.created_by = auth.uid()
        )
        -- La guarda que faltaba: sólo cuando el club no tiene a nadie.
        and not exists (
            select 1 from public.club_members m where m.club_id = club_members.club_id
        )
    );

-- ── 2. Qué se puede cambiar de una fila de nómina ────────────────
-- La política sigue diciendo QUIÉN (un admin del club); el grant dice
-- QUÉ. `user_id`, `club_id`, `id` y `joined_at` dejan de ser escribibles
-- desde el cliente: ninguno se edita, y con `user_id` abierto un admin
-- metía a un desconocido.
revoke update on public.club_members from authenticated;
grant update (rol) on public.club_members to authenticated;

-- ── 3. El club no se queda sin administrador ─────────────────────
create or replace function public.el_club_no_se_queda_sin_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    -- Sólo importa cuando el que se va es admin.
    if old.rol <> 'admin' then
        return old;
    end if;

    -- El club ya no existe: esto es el cascade de borrarlo, no una baja.
    -- Sin esta salida, borrar un club con nómina se bloquearía a sí mismo.
    if not exists (select 1 from public.clubs where id = old.club_id) then
        return old;
    end if;

    -- Era el último miembro: el club se borra solo
    -- (`trg_auto_delete_empty_club`) y no hay nadie a quien dejar huérfano.
    if not exists (
        select 1 from public.club_members m
         where m.club_id = old.club_id and m.id <> old.id
    ) then
        return old;
    end if;

    if not exists (
        select 1 from public.club_members m
         where m.club_id = old.club_id and m.id <> old.id and m.rol = 'admin'
    ) then
        raise exception 'El club se quedaría sin administrador: nombra a otro o saca a los demás antes de salir';
    end if;

    return old;
end;
$$;

drop trigger if exists trg_el_club_no_se_queda_sin_admin on public.club_members;
create trigger trg_el_club_no_se_queda_sin_admin
    before delete on public.club_members
    for each row execute function public.el_club_no_se_queda_sin_admin();

-- ── 4 y 5. Quién puede borrar el club ────────────────────────────
drop policy if exists "clubs_delete" on public.clubs;
create policy "clubs_delete"
    on public.clubs for delete
    to authenticated
    using (
        exists (
            select 1 from public.club_members m
             where m.club_id = clubs.id and m.user_id = auth.uid() and m.rol = 'admin'
        )
        -- El único resto de `created_by`: deshacer un club recién creado
        -- que todavía no tiene a nadie. Ver la cabecera.
        or (
            auth.uid() = created_by
            and not exists (select 1 from public.club_members m where m.club_id = clubs.id)
        )
    );

-- ── 6. Una sola puerta para salirse de un partido de clubes ──────
create or replace function public.leave_match_penalized(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_match record; v_att record; v_pen int := 0; v_freed boolean := false;
begin
  if v_user is null then return jsonb_build_object('ok',false,'reason','No autenticado'); end if;
  select * into v_match from public.matches where id = p_match_id;
  if not found then return jsonb_build_object('ok',false,'reason','Partido no existe'); end if;

  -- Simétrico al rechazo que ya hace `join_match`: si la inscripción es
  -- por club, la baja también. Va ANTES de la comprobación del anfitrión
  -- porque en un partido de clubes el anfitrión es el admin que aprobó, y
  -- «debes cancelar el partido» sería un consejo equivocado.
  if v_match.challenge_proposal_id is not null then
    return jsonb_build_object('ok', false,
      'reason', 'Este es un partido entre clubes: las bajas se gestionan por club');
  end if;

  if v_match.id_organizador = v_user then
    return jsonb_build_object('ok',false,'reason','Eres el anfitrión: debes cancelar el partido');
  end if;

  select * into v_att from public.attendees
   where id_partido = p_match_id and id_jugador = v_user
     and estado in ('inscrito','confirmado_gps','pendiente');
  if not found then return jsonb_build_object('ok',false,'reason','No estás en este partido'); end if;

  delete from public.attendees where id = v_att.id;

  if v_att.estado in ('inscrito','confirmado_gps') then
    v_freed := true;
    v_pen := case when v_match.hora > now() + interval '2 hours' then 3 else 20 end;
    update public.matches
       set cupos_disponibles = cupos_disponibles + 1, estado = 'abierto'
     where id = p_match_id;
    insert into public.messages (sender_id, match_id, content)
    values (v_user, p_match_id, 'Un jugador se ha salido, ¡vuelve a haber un cupo disponible!');
    update public.profiles set trust_score = greatest(trust_score - v_pen, 0) where id = v_user;
  end if;

  return jsonb_build_object('ok', true, 'penalty', v_pen, 'freed', v_freed);
end $$;

revoke all on function public.leave_match_penalized(uuid) from public, anon;
grant execute on function public.leave_match_penalized(uuid) to authenticated;
