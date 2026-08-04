-- ============================================================
-- 31. Reportes de usuario ("Reportar esta cuenta")
-- ============================================================
-- Idempotente: seguro de re-ejecutar.
--
-- Alcance de esta migración: SOLO la recepción del reporte. La moderación
-- (revisar, resolver, sancionar, apelar) todavía NO existe: no hay panel de
-- soporte ni flujo de apelaciones. Por eso:
--   - `estado` nace siempre en 'pendiente' y nadie lo mueve automáticamente.
--   - El perfil muestra el CONTEO de reportes recibidos, nunca su contenido.
--   - "Apelar una decisión" sigue deshabilitado en la UI, porque no hay
--     decisiones que apelar hasta que exista moderación.
-- ============================================================

create table if not exists public.user_reports (
    id uuid primary key default gen_random_uuid(),
    -- quién reporta
    reporter_id uuid not null references public.profiles(id) on delete cascade,
    -- a quién se reporta
    reported_id uuid not null references public.profiles(id) on delete cascade,
    motivo text not null check (motivo in (
        'informacion_falsa',
        'contenido_ofensivo',
        'foto_inapropiada',
        'suplantacion',
        'conducta_antideportiva',
        'spam',
        'otro'
    )),
    descripcion text check (descripcion is null or length(descripcion) <= 600),
    -- elemento concreto reportado, cuando aplica (ej: 'foto:<uuid>')
    elemento text,
    estado text not null default 'pendiente'
        check (estado in ('pendiente', 'revisado', 'descartado')),
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,

    -- no puedes reportarte a ti mismo
    constraint user_reports_no_self check (reporter_id <> reported_id)
);

create index if not exists idx_user_reports_reported
    on public.user_reports (reported_id, created_at desc);

-- Un reporte pendiente por par reportante→reportado, para evitar spam.
create unique index if not exists user_reports_unique_pending
    on public.user_reports (reporter_id, reported_id)
    where estado = 'pendiente';

alter table public.user_reports enable row level security;

-- INSERT: cualquiera autenticado puede reportar a otro (el check de la tabla
-- impide auto-reportarse).
drop policy if exists user_reports_insert on public.user_reports;
create policy user_reports_insert on public.user_reports
    for insert to authenticated
    with check (auth.uid() = reporter_id);

-- SELECT: solo veo los reportes que YO envié. Nadie puede leer los reportes
-- recibidos en su contra (ni su contenido ni quién los envió).
drop policy if exists user_reports_select_own on public.user_reports;
create policy user_reports_select_own on public.user_reports
    for select to authenticated
    using (auth.uid() = reporter_id);

-- Conteo de reportes recibidos por un usuario, sin exponer las filas.
-- SECURITY DEFINER porque la RLS de arriba oculta los reportes en tu contra.
create or replace function public.count_reports_against(p_user_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
    select count(*)::integer
    from public.user_reports
    where reported_id = p_user_id
      and estado = 'pendiente';
$$;

revoke all on function public.count_reports_against(uuid) from public;
grant execute on function public.count_reports_against(uuid) to authenticated;

comment on table public.user_reports is
    'Reportes de un usuario sobre otro. Solo recepción: la moderación y las apelaciones no están implementadas todavía.';
