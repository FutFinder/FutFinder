-- =============================================================
-- FutFinder migration 90: el capitán del equipo
-- =============================================================
-- AGREGA EL ROL 'capitan' a club_members.rol, que hasta ahora sólo
-- admitía 'admin'/'jugador'. Nombrar o quitar un capitán es un simple
-- cambio de `rol` — el mismo mecanismo que ya usa `promoteToAdmin()` en
-- el cliente— y no interactúa con `check_club_limits()` (33 y sig.):
-- esa función sólo cuenta y limita `rol = 'admin'`, así que un capitán
-- nunca cuenta contra el tope de administradores del plan ni tiene tope
-- propio. Puede haber más de un capitán a la vez, igual que el diseño
-- de referencia lo permite.
--
-- DE PASO, CORRIGE UN BUG DE RLS DE VERDAD, encontrado al revisar cómo
-- iba a viajar este cambio: `club_members_update` (migración 11) tiene
-- la MISMA auto-referencia que ya se había encontrado y corregido en
-- `club_members_insert` (18) y `club_members_delete` (20), pero nunca se
-- arregló acá:
--
--   using (
--       exists (
--           select 1 from public.club_members m
--           where m.club_id = club_id and ...   -- club_id sin calificar
--       )
--   )
--
-- Dentro del `exists`, `club_id` sin calificar se resuelve contra `m`
-- (la única tabla del FROM de la subconsulta), no contra la fila de
-- `club_members` que se está actualizando. La condición queda
-- `m.club_id = m.club_id`, siempre verdadera para cualquier fila de
-- administrador que exista EN CUALQUIER CLUB — así que HOY, un
-- administrador de un club puede actualizar el `rol` de un integrante de
-- CUALQUIER OTRO club, no sólo el propio. `promoteToAdmin()` y la
-- promoción/degradación de capitán que agrega esta migración corren
-- sobre esta política, así que se corrige acá, con la misma calificación
-- explícita (`m.club_id = club_members.club_id`) que ya usó la 20 para
-- `club_members_delete`.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. El bug de cross-tenant en club_members_update ─────────
drop policy if exists "club_members_update" on public.club_members;
create policy "club_members_update"
    on public.club_members for update
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_members.club_id
              and m.user_id = auth.uid()
              and m.rol = 'admin'
        )
    );

-- ── 2. El CHECK de rol, con 'capitan' ─────────────────────────
-- Igual que la migración 53 con `clubs.tema`: se comprueba el nombre real
-- de la restricción antes de tocarla, en vez de asumirlo.
do $$
begin
    if exists (
        select 1 from pg_constraint
        where conname = 'club_members_rol_check'
          and conrelid = 'public.club_members'::regclass
    ) then
        alter table public.club_members drop constraint club_members_rol_check;
    end if;
end $$;

alter table public.club_members
    add constraint club_members_rol_check
    check (rol in ('admin', 'capitan', 'jugador'));

comment on column public.club_members.rol is
    'admin | capitan | jugador. Un solo valor a la vez — capitán y admin son roles distintos, no acumulables. capitan no cuenta contra el tope de administradores del plan (check_club_limits sólo mira ''admin'').';
