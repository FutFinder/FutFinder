-- =============================================================
-- FutFinder migration 57: calificación de complejos
-- =============================================================
-- Solo puede calificar quien tuvo una reserva CONFIRMADA en ese
-- complejo (organizador o participante), una vez por reserva. Sin
-- policies de update/delete: una calificación enviada es inmutable
-- desde el cliente (no hay caso de uso descrito para editarla).
--
-- `complejos.rating_avg`/`rating_count` se recalculan con un trigger,
-- mismo patrón usado para contadores derivados en las migraciones de
-- club.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

create table if not exists public.complejo_calificaciones (
    id uuid primary key default gen_random_uuid(),
    complejo_id uuid not null references public.complejos(id) on delete cascade,
    reserva_id uuid not null references public.reservas(id),
    user_id uuid not null references public.profiles(id),
    estrellas integer not null check (estrellas between 1 and 5),
    etiquetas text[],
    comentario text,
    created_at timestamptz not null default now(),

    unique (reserva_id, user_id)
);

create index if not exists idx_complejo_calificaciones_complejo on public.complejo_calificaciones(complejo_id);

alter table public.complejo_calificaciones enable row level security;

drop policy if exists "complejo_calificaciones_select" on public.complejo_calificaciones;
create policy "complejo_calificaciones_select"
    on public.complejo_calificaciones for select
    using (true);

drop policy if exists "complejo_calificaciones_insert" on public.complejo_calificaciones;
create policy "complejo_calificaciones_insert"
    on public.complejo_calificaciones for insert
    with check (
        auth.uid() = user_id
        and exists (
            select 1
              from public.reservas r
              join public.canchas_reservables k on k.id = r.cancha_id
             where r.id = reserva_id
               -- Sin calificar `complejo_calificaciones.complejo_id`, esta
               -- comparación resuelve contra el `complejo_id` de `k` (misma
               -- tabla, mismo nombre de columna, más cercano en alcance) y
               -- queda en un tautológico k.complejo_id = k.complejo_id: deja
               -- calificar cualquier complejo con una reserva de otro.
               and k.complejo_id = public.complejo_calificaciones.complejo_id
               and r.estado = 'confirmada'
               and (
                   r.organizador_id = auth.uid()
                   or exists (
                       select 1 from public.reserva_participantes p
                        where p.reserva_id = r.id and p.user_id = auth.uid()
                   )
               )
        )
    );

-- ── Trigger: recalcular rating_avg/rating_count del complejo ────────
create or replace function public.recalc_complejo_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_complejo_id uuid := coalesce(new.complejo_id, old.complejo_id);
    v_avg numeric(3, 2);
    v_count integer;
begin
    select round(avg(estrellas), 2), count(*)
      into v_avg, v_count
      from public.complejo_calificaciones
     where complejo_id = v_complejo_id;

    update public.complejos
       set rating_avg = v_avg, rating_count = coalesce(v_count, 0)
     where id = v_complejo_id;

    return coalesce(new, old);
end;
$$;

drop trigger if exists trg_recalc_complejo_rating on public.complejo_calificaciones;
create trigger trg_recalc_complejo_rating
    after insert or update or delete on public.complejo_calificaciones
    for each row execute function public.recalc_complejo_rating();
