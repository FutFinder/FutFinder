-- 129. El permiso muere con la membresía, y editar el club no es cambiarle el plan.
--
-- Los tres P1 de la revisión de Clubes del 21 de septiembre (C01, C02 y C03).
-- El informe advertía que no había mirado las ACL de producción y que los dos
-- últimos dependían de que siguiera concedida la escritura de esas columnas.
-- Se miraron: **estaba concedida, y los tres se reprodujeron en producción**
-- dentro de una transacción revertida.
--
-- ── C01. UN EXPULSADO CONSERVA SUS PERMISOS INDIVIDUALES ──────────────────
-- `tiene_permiso_de_club` resuelve tres fuentes en orden: ser admin, la
-- excepción individual, y el permiso del rol. La del medio no exige
-- membresía, y `club_member_permission_overrides` cuelga del club y de
-- `auth.users`, no de `club_members`: expulsar a alguien no se lleva su
-- excepción. Reproducido: X, expulsado, editó la descripción del club.
--
-- Se cierra por los dos lados, porque son dos cosas distintas:
--   · la AUTORIDAD: ninguna fuente de permisos se consulta si la persona ya
--     no es del club. Es una línea y protege a todas las políticas y RPC que
--     usan el ayudante, incluidas las que se escriban mañana.
--   · la HIGIENE: al terminar la membresía se borran sus excepciones. Sin
--     esto, quien vuelve al club recupera en silencio permisos que un
--     administrador le dio hace meses, y nadie los ve en ninguna pantalla.
--
-- ── C02. UNA INVITACIÓN DE UN CLUB SIRVE PARA ENTRAR A OTRO ───────────────
-- La política de UPDATE deja al invitado responder su invitación
-- (`tipo = 'invitacion' and auth.uid() = user_id`). Como no hay `with check`
-- propio, PostgreSQL reutiliza esa misma condición para la fila nueva: el
-- invitado no puede cambiar de persona ni de tipo… pero SÍ puede cambiar
-- `club_id`. Apuntó la invitación del club A al club B, la aceptó, y el
-- trigger de aprobación le creó la membresía en B. Reproducido en producción.
--
-- El arreglo no es otra política sino quitar el privilegio: `authenticated`
-- tenía UPDATE sobre TODAS las columnas. Responder una invitación es escribir
-- `status` y `responded_at`, y nada más. Lo mismo al crearla: `status` toma
-- su default 'pending' en vez de poder nacer aprobada.
--
-- ── C03. EDITAR EL CLUB ALCANZABA PARA CAMBIARLE EL PLAN ──────────────────
-- `clubs_update` autoriza la FILA con `editClub`, pero una política no limita
-- columnas. Con UPDATE concedido sobre todas, un administrador se subía a
-- `premium` y se ponía `verificado = true`. Reproducido en producción.
-- `plan` y `verificado` los gestiona la plataforma —el propio esquema lo dice
-- desde la 11— y el cliente no los manda nunca; ahora tampoco puede.
--
-- Las columnas que sí se conceden son exactamente las que escribe la app:
-- el formulario de edición (`buildClubPatch`), el logo y el banner. `id`,
-- `created_at`, `created_by`, `plan` y `verificado` quedan fuera de las dos
-- operaciones.
--
-- Regresión: supabase/tests/129_el_permiso_muere_con_la_membresia_test.sql

-- ---------------------------------------------------------------------------
-- C01a. Sin membresía no hay permiso que resolver.
-- ---------------------------------------------------------------------------
create or replace function public.tiene_permiso_de_club(
    p_club_id uuid,
    p_user_id uuid,
    p_permiso text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    -- La guarda va PRIMERO y vale para las tres fuentes: quien ya no es del
    -- club no tiene permisos suyos, tenga la excepción que tenga.
    select case
        when not exists (
            select 1 from public.club_members m
             where m.club_id = p_club_id and m.user_id = p_user_id
        ) then false
        else coalesce(
            (
                select true
                  from public.club_members m
                 where m.club_id = p_club_id
                   and m.user_id = p_user_id
                   and m.rol = 'admin'
            ),
            (
                select o.activo
                  from public.club_member_permission_overrides o
                 where o.club_id = p_club_id
                   and o.user_id = p_user_id
                   and o.permiso = p_permiso
            ),
            (
                select r.activo
                  from public.club_members m
                  join public.club_role_permissions r
                    on r.club_id = m.club_id
                   and r.rol = m.rol
                   and r.permiso = p_permiso
                 where m.club_id = p_club_id
                   and m.user_id = p_user_id
            ),
            false
        )
    end;
$$;

-- ---------------------------------------------------------------------------
-- C01b. La excepción individual se va con la membresía.
-- ---------------------------------------------------------------------------
create or replace function public.club_member_borra_sus_excepciones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.club_member_permission_overrides
     where club_id = old.club_id and user_id = old.user_id;
    return old;
end;
$$;
revoke all on function public.club_member_borra_sus_excepciones() from public, anon, authenticated;

drop trigger if exists trg_club_member_borra_sus_excepciones on public.club_members;
create trigger trg_club_member_borra_sus_excepciones
    after delete on public.club_members
    for each row
    execute function public.club_member_borra_sus_excepciones();

-- ---------------------------------------------------------------------------
-- C02. Responder una invitación es escribir `status`, y nada más.
-- ---------------------------------------------------------------------------
revoke insert, update on public.club_join_requests from authenticated;
grant insert (club_id, user_id, tipo) on public.club_join_requests to authenticated;
grant update (status, responded_at) on public.club_join_requests to authenticated;

-- ---------------------------------------------------------------------------
-- C03. El plan y la verificación no se editan desde el cliente.
-- ---------------------------------------------------------------------------
revoke insert, update on public.clubs from authenticated;
grant insert (nombre, slug, descripcion, region, comuna, modalidad, tema,
              foto_url, banner_url, created_by)
    on public.clubs to authenticated;
grant update (nombre, slug, descripcion, region, comuna, modalidad, tema,
              foto_url, banner_url)
    on public.clubs to authenticated;
