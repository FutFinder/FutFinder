-- =============================================================
-- FutFinder migration 92: alineación del club
-- =============================================================
-- UN TABLERO POR CLUB, NO POR PARTIDO: `club_lineups` guarda la ÚLTIMA
-- alineación armada por el club — formación, modo (7 u 11) y qué integrante
-- va en cada puesto — para que todos vean la misma. No se ata a ningún
-- partido: es un tablero general, igual que lo pidió el mockup de
-- referencia, que arma la alineación con la lista de integrantes del club y
-- no con la nómina de un partido.
--
-- `club_id` es PRIMARY KEY a propósito: hay UNA alineación vigente por club,
-- que se sobrescribe al guardar. Guardar de nuevo no crea historial —
-- «Guardar» reemplaza, no archiva.
--
-- `asignaciones` es un jsonb `{ "<puesto>": "<member_id>" }`. No hay FK desde
-- adentro del jsonb hacia `club_members`, así que un `member_id` que ya no
-- pertenece al club (expulsado después de guardar la alineación) simplemente
-- deja de resolver a nadie en el cliente — no revienta la lectura, y es el
-- mismo tipo de degradación silenciosa que ya usa `columnasOpcionales.js`
-- para otras columnas opcionales.
--
-- SÓLO ADMIN O CAPITÁN ARMAN Y GUARDAN; el resto del club la ve. Es la
-- misma regla de permisos que ya separa «gestionar integrantes» de «verlos»
-- en `QuickActionGrid`, aplicada acá a mover jugadores por la cancha. Nótese
-- la calificación EXPLÍCITA `club_lineups.club_id` en las políticas: la
-- migración 90 encontró un bug real de auto-referencia sin calificar en una
-- política parecida (`club_members_update`), así que esta tabla nueva nace
-- ya con la forma correcta en vez de repetir ese error.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create table if not exists public.club_lineups (
    club_id       uuid primary key references public.clubs(id) on delete cascade,
    modo          smallint not null check (modo in (7, 11)),
    formacion     text not null check (length(trim(formacion)) between 1 and 20),
    personalizado boolean not null default false,
    asignaciones  jsonb not null default '{}'::jsonb,
    updated_by    uuid not null references auth.users(id) on delete cascade,
    updated_at    timestamptz not null default now()
);

alter table public.club_lineups enable row level security;

-- Lectura: cualquier integrante del club, igual que `club_members_read`.
drop policy if exists club_lineups_read on public.club_lineups;
create policy club_lineups_read on public.club_lineups
    for select
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_lineups.club_id
              and m.user_id = auth.uid()
        )
    );

-- Primer guardado.
drop policy if exists club_lineups_insert on public.club_lineups;
create policy club_lineups_insert on public.club_lineups
    for insert
    with check (
        updated_by = auth.uid()
        and exists (
            select 1 from public.club_members m
            where m.club_id = club_lineups.club_id
              and m.user_id = auth.uid()
              and m.rol in ('admin', 'capitan')
        )
    );

-- Guardados siguientes: sobrescriben la fila existente.
drop policy if exists club_lineups_update on public.club_lineups;
create policy club_lineups_update on public.club_lineups
    for update
    using (
        exists (
            select 1 from public.club_members m
            where m.club_id = club_lineups.club_id
              and m.user_id = auth.uid()
              and m.rol in ('admin', 'capitan')
        )
    )
    with check (
        updated_by = auth.uid()
        and exists (
            select 1 from public.club_members m
            where m.club_id = club_lineups.club_id
              and m.user_id = auth.uid()
              and m.rol in ('admin', 'capitan')
        )
    );

-- Sin DELETE: «Limpiar» guarda `asignaciones = '{}'`, no borra la fila.
revoke delete on public.club_lineups from anon, authenticated;

comment on table public.club_lineups is
    'Una fila por club: la última alineación guardada (formación + puesto→integrante). Sólo admin/capitán la escriben; cualquier integrante la lee.';
