-- "Reportar un problema" (Ajustes → Soporte).
--
-- Tabla independiente de `user_reports` (migración 31): esa es para
-- reportar la CONDUCTA de otro jugador (con reported_id, RLS que oculta
-- quién reportó a quién). Esta es para reportar un problema con la APP
-- misma (fallo técnico, reserva/cancha, sugerencia, o el contexto general
-- de un problema de conducta) — no tiene destinatario, solo autor.
--
-- Gestión de estado deliberadamente simple: sin RPC ni panel propio. El
-- equipo de soporte cambia `estado` directo desde el Table Editor de
-- Supabase (con su rol, que no pasa por RLS). El cliente solo inserta y
-- lee lo suyo; nunca actualiza ni borra.
create table if not exists public.support_tickets (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    category text not null check (category in (
        'fallo_tecnico', 'reserva_cancha', 'comportamiento_jugador', 'sugerencia'
    )),
    title text not null,
    description text,
    screenshot_url text,
    app_version text,
    platform text,
    estado text not null default 'pendiente' check (estado in ('pendiente', 'en_proceso', 'resuelto')),
    created_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_user on public.support_tickets(user_id, created_at desc);

alter table public.support_tickets enable row level security;

-- Cada uno solo ve y crea los suyos. Nadie actualiza ni borra desde la
-- app a propósito: eso es trabajo de soporte, con su propio rol.
drop policy if exists "support_tickets_select_own" on public.support_tickets;
create policy "support_tickets_select_own" on public.support_tickets for select
    using (auth.uid() = user_id);

drop policy if exists "support_tickets_insert_own" on public.support_tickets;
create policy "support_tickets_insert_own" on public.support_tickets for insert
    with check (auth.uid() = user_id);

-- Capturas de pantalla adjuntas al reporte. Público como el resto de los
-- buckets de esta app (avatars, profile-gallery, club-logos,
-- match-covers) — mismo criterio y misma limitación ya documentada: no es
-- para contenido que requiera confidencialidad. El nombre del archivo
-- incluye el id del usuario y una marca de tiempo, así que no es
-- adivinable, pero sí es de lectura pública si alguien tiene la URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-screenshots', 'support-screenshots', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

drop policy if exists "support_screenshots_public_select" on storage.objects;
create policy "support_screenshots_public_select" on storage.objects for select
    using (bucket_id = 'support-screenshots');

drop policy if exists "support_screenshots_owner_insert" on storage.objects;
create policy "support_screenshots_owner_insert" on storage.objects for insert
    with check (
        bucket_id = 'support-screenshots'
        and auth.uid()::text = (storage.foldername(name))[1]
    );

drop policy if exists "support_screenshots_owner_delete" on storage.objects;
create policy "support_screenshots_owner_delete" on storage.objects for delete
    using (
        bucket_id = 'support-screenshots'
        and auth.uid()::text = (storage.foldername(name))[1]
    );
