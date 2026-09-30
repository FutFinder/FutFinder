-- =============================================================
-- 139. LA UBICACIÓN DEL JUGADOR NO ES PÚBLICA
--
-- `profiles` se lee con `using (true)` para todos los roles, anon incluido,
-- y ahí vivían `latitud`, `longitud` y `location_updated_at`: la posición
-- GPS del teléfono que guardan `saveMyLocation()` y `completeOnboarding()`.
-- Comprobado el 2026-09-28 como anon, en una transacción revertida: 32
-- perfiles visibles, 7 con coordenadas de 7 decimales. Con la clave pública
-- que va dentro del bundle web, cualquiera sacaba dónde está (o vive) cada
-- jugador.
--
-- POR QUÉ UNA TABLA APARTE Y NO PRIVILEGIOS POR COLUMNA
--   La 129 cerró `clubs` por columna, pero `profiles` se lee con
--   `select('*')` en getMyProfile, getProfileById, getCurrentProfile y en el
--   `update(...).select()` de updateMyProfile. Quitar SELECT a dos columnas
--   hace fallar el `*` entero con «permission denied». La salida es la de
--   la 138 con el teléfono: el dato va a `perfil_ubicaciones`, que nadie lee
--   directo, y la app ve sólo la suya con `mi_ubicacion()`.
--
-- POR QUÉ NO SE BORRAN LAS COLUMNAS
--   Las apps ya instaladas mandan `latitud` en el UPDATE del perfil; si la
--   columna no existiera, fallaría el guardado completo (42703). Se quedan,
--   siempre en null: el trigger desvía lo que llegue a la tabla privada, y
--   el CHECK hace que un camino que se salte el trigger falle en vez de
--   volver a publicar la posición.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/139_la_ubicacion_no_es_publica_test.sql
-- =============================================================

create table if not exists public.perfil_ubicaciones (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  latitud        numeric not null,
  longitud       numeric not null,
  actualizada_at timestamptz not null default now()
);
alter table public.perfil_ubicaciones enable row level security;
revoke all on public.perfil_ubicaciones from public, anon, authenticated;

-- Lo que ya estaba publicado pasa a la tabla privada y sale de `profiles`.
insert into public.perfil_ubicaciones (user_id, latitud, longitud, actualizada_at)
select id, latitud, longitud, coalesce(location_updated_at, now())
  from public.profiles
 where latitud is not null and longitud is not null
on conflict (user_id) do nothing;

update public.profiles
   set latitud = null, longitud = null, location_updated_at = null
 where latitud is not null or longitud is not null or location_updated_at is not null;

alter table public.profiles drop constraint if exists profiles_sin_coordenadas;
alter table public.profiles add constraint profiles_sin_coordenadas
  check (latitud is null and longitud is null and location_updated_at is null);

-- Desvía la ubicación que llegue al perfil. Sin `security definer` no
-- podría escribir en `perfil_ubicaciones`, que no tiene privilegios para
-- nadie. `new.id` es siempre el perfil propio: `profiles_update_self` ya
-- limita las filas a `auth.uid()`.
create or replace function public.tg_perfil_guarda_ubicacion() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.latitud is not null and new.longitud is not null then
    insert into public.perfil_ubicaciones (user_id, latitud, longitud, actualizada_at)
    values (new.id, new.latitud, new.longitud, coalesce(new.location_updated_at, now()))
    on conflict (user_id) do update
      set latitud = excluded.latitud,
          longitud = excluded.longitud,
          actualizada_at = excluded.actualizada_at;
  end if;
  new.latitud := null;
  new.longitud := null;
  new.location_updated_at := null;
  return new;
end $$;
revoke all on function public.tg_perfil_guarda_ubicacion() from public, anon, authenticated;

drop trigger if exists trg_perfil_guarda_ubicacion on public.profiles;
create trigger trg_perfil_guarda_ubicacion
  before insert or update of latitud, longitud, location_updated_at on public.profiles
  for each row execute function public.tg_perfil_guarda_ubicacion();

-- Mi ubicación guardada, o null si no hay.
create or replace function public.mi_ubicacion() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('latitud', u.latitud, 'longitud', u.longitud, 'actualizada_at', u.actualizada_at)
    from public.perfil_ubicaciones u
   where u.user_id = auth.uid();
$$;
revoke all on function public.mi_ubicacion() from public, anon;
grant execute on function public.mi_ubicacion() to authenticated;
