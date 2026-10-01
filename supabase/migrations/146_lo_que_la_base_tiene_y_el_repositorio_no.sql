-- =============================================================
-- 146. LO QUE LA BASE TIENE Y EL REPOSITORIO NO
--
-- Migración de RECUPERACIÓN. Existe para que una base nueva se pueda
-- levantar sólo desde `supabase/`, que hoy no se puede: hay objetos que
-- viven en producción desde antes del historial versionado y ninguna
-- migración los crea. Eso ya costó caro una vez — los arneses de
-- concurrencia del 2026-09-23 no pudieron armar la base desde el
-- repositorio y hubo que copiar el catálogo de producción a mano.
--
-- EL INVENTARIO SE HIZO DE NUEVO, Y ES MAYOR DEL QUE DECÍA LA NOTA.
-- Se cruzó el catálogo entero contra todas las migraciones y
-- `schema.sql`, buscando la sentencia que CREA cada objeto:
--
--   · 4 tablas:        canchas, notifications, push_tokens, ratings
--   · 8 funciones:     norm_text, search_canchas, recalc_user_ratings,
--                      tg_ratings_recalc, create_notification,
--                      tg_match_future_only, tg_notify_friend_request,
--                      tg_notify_friend_accept
--   · 8 disparadores:  trg_auto_suspend, trg_enforce_join_rules,
--                      trg_match_future_only, trg_notify_friend_accept,
--                      trg_notify_friend_request, trg_notify_match_join,
--                      trg_ratings_recalc, trg_register_cancha
--   · 2 columnas:      profiles.estado, profiles.suspended_until
--   · 3 cron:          futfinder-match-reminders, futfinder-rating-reminders,
--                      futfinder-reactivate
--
-- Los OCHO DISPARADORES son el hallazgo que la nota no tenía. Seis de sus
-- funciones sí estaban versionadas —`tg_enforce_join_rules`,
-- `tg_notify_match_join`, `tg_register_cancha`, `tg_auto_suspend`— pero
-- su `create trigger` no, así que en una base nueva la función existiría
-- y NADIE LA LLAMARÍA. Es el peor de los casos: todo compila, nada falla,
-- y las reglas simplemente no se aplican.
--
-- ESTA MIGRACIÓN NO TOCA NADA DE LO QUE YA EXISTE. Cada objeto va detrás
-- de su propia comprobación de existencia, así que contra producción es
-- un no-op completo y contra una base vacía lo crea todo. En particular
-- NO se usa `create or replace function`: reemplazaría el cuerpo
-- desplegado por esta transcripción, y un error de copia cambiaría el
-- comportamiento de producción sin que nadie lo note. Si una función ya
-- está, se deja exactamente como está.
--
-- EL ORDEN IMPORTA, y por eso no está alfabético:
--   1. `norm_text` antes que `canchas`, porque la columna `nombre_norm`
--      la tiene como `default`.
--   2. `create_notification` antes que las funciones que notifican.
--   3. Las tablas antes que sus disparadores.
--
-- UNA FUNCIÓN QUEDA FUERA A PROPÓSITO: `tg_notify_message_new`. No está
-- versionada, pero tampoco la usa nadie — `trg_notify_message_new`
-- ejecuta `notify_message_new()`, que es otra y sí está versionada. Es
-- código muerto de antes de la migración 32 y resucitarlo en una base
-- nueva sería fabricar un objeto que en producción no hace nada. Queda
-- anotado como pendiente propio para retirarlo de la base.
--
-- LO QUE ESTA MIGRACIÓN NO RESUELVE: que una base nueva levante y FUNCIONE
-- de punta a punta. Eso sólo lo demuestra construirla, y eso necesita un
-- PostgreSQL local que esta Mac no tiene. Acá se cierra la parte que sí
-- se puede cerrar y comprobar: que los objetos están descritos y que
-- aplicar esto sobre producción no cambia absolutamente nada.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/146_lo_que_la_base_tiene_y_el_repositorio_no_test.sql
-- =============================================================

-- ── 1. norm_text ─────────────────────────────────────────────────
-- Va primero: `canchas.nombre_norm` la usa como default.
do $$
begin
  if to_regprocedure('public.norm_text(text)') is null then
    execute $fn$
      create function public.norm_text(s text)
      returns text language sql immutable set search_path to 'public'
      as $body$
        select lower(translate(coalesce(s,''), 'áéíóúüÁÉÍÓÚÜñÑ', 'aeiouuaeiouunn'))
      $body$;
    $fn$;
  end if;
end $$;

-- ── 2. create_notification ───────────────────────────────────────
-- Antes de las funciones que notifican. El cuerpo inserta en
-- `notifications`, que se crea más abajo: plpgsql no valida el cuerpo al
-- crear la función, así que el orden entre estas dos no importa.
do $$
begin
  if to_regprocedure('public.create_notification(uuid,text,text,text,jsonb)') is null then
    execute $fn$
      create function public.create_notification(
        p_user_id uuid, p_type text, p_title text, p_body text, p_data jsonb default '{}'::jsonb)
      returns void language plpgsql security definer set search_path to 'public'
      as $body$
      begin
        if p_user_id is null then
          return;
        end if;
        insert into public.notifications(user_id, type, title, body, data)
        values (p_user_id, p_type, p_title, p_body, coalesce(p_data, '{}'::jsonb));
      end;
      $body$;
    $fn$;
  end if;
end $$;

-- ── 3. Las cuatro tablas ─────────────────────────────────────────
-- `create table if not exists` lleva dentro sus restricciones, así que
-- contra producción no se evalúa ninguna y contra una base vacía quedan
-- todas puestas de una vez.

create table if not exists public.canchas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  nombre_norm text default public.norm_text(nombre),
  direccion   text,
  comuna      text,
  region      text,
  latitud     double precision,
  longitud    double precision,
  usos_count  integer not null default 1,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint canchas_nombre_norm_comuna_key unique (nombre_norm, comuna)
);
create index if not exists canchas_comuna_idx on public.canchas using btree (comuna);
create index if not exists canchas_norm_idx   on public.canchas using btree (nombre_norm);

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  type            text not null,
  title           text not null,
  body            text,
  data            jsonb default '{}'::jsonb,
  read            boolean not null default false,
  created_at      timestamptz not null default now(),
  push_status     text not null default 'pending',
  push_claimed_at timestamptz,
  constraint notifications_push_status_check check (push_status in
    ('pending','sending','sent','skipped_preference','skipped_no_token','failed'))
);
create index if not exists notifications_user_idx
  on public.notifications using btree (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications using btree (user_id) where (read = false);

-- `notifications_type_check` NO va acá. Es la lista de los 53 tipos de
-- aviso y la han ampliado catorce migraciones posteriores; copiarla
-- fijaría una versión vieja y la próxima migración que agregue un tipo
-- chocaría. En una base nueva la restricción la pone la migración que
-- corresponda. La guarda real de que ningún tipo se quede sin categoría
-- es `src/utils/__tests__/avisosCompletos.test.js`.

create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  token       text not null,
  platform    text,
  device_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint push_tokens_platform_check check (platform in ('ios','android','web')),
  constraint push_tokens_user_id_token_key unique (user_id, token)
);
create index if not exists push_tokens_user_idx on public.push_tokens using btree (user_id);

create table if not exists public.ratings (
  id          uuid primary key default gen_random_uuid(),
  match_id    uuid not null references public.matches(id) on delete cascade,
  rater_id    uuid not null references auth.users(id) on delete cascade,
  rated_id    uuid not null references auth.users(id) on delete cascade,
  puntualidad smallint not null,
  fairplay    smallint not null,
  nivel       smallint not null,
  comentario  text,
  created_at  timestamptz not null default now(),
  constraint ratings_check             check (rater_id <> rated_id),
  constraint ratings_puntualidad_check check (puntualidad >= 1 and puntualidad <= 5),
  constraint ratings_fairplay_check    check (fairplay >= 1 and fairplay <= 5),
  constraint ratings_nivel_check       check (nivel >= 1 and nivel <= 5),
  constraint ratings_match_id_rater_id_rated_id_key unique (match_id, rater_id, rated_id)
);
create index if not exists ratings_match_idx on public.ratings using btree (match_id);
create index if not exists ratings_rated_idx on public.ratings using btree (rated_id);

alter table public.canchas       enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens   enable row level security;
alter table public.ratings       enable row level security;

-- ── 4. Las políticas ─────────────────────────────────────────────
-- Cada una detrás de su comprobación: recrearlas en producción las
-- dejaría caídas durante un instante, y no hay razón para arriesgarlo.
-- `ratings_insert_eligible` NO va acá: la migración 124 la reescribió
-- para exigir que el partido no esté cancelado, y esa versión es la que
-- manda. En una base nueva la pone la 124.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='canchas_select_any') then
    create policy canchas_select_any on public.canchas for select to authenticated using (true);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and policyname='notifications_select_own') then
    create policy notifications_select_own on public.notifications for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='notifications_update_own') then
    create policy notifications_update_own on public.notifications for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='notifications_delete_own') then
    create policy notifications_delete_own on public.notifications for delete to authenticated using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and policyname='push_tokens_select_own') then
    create policy push_tokens_select_own on public.push_tokens for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='push_tokens_insert_own') then
    create policy push_tokens_insert_own on public.push_tokens for insert with check (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='push_tokens_update_own') then
    create policy push_tokens_update_own on public.push_tokens for update using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='push_tokens_delete_own') then
    create policy push_tokens_delete_own on public.push_tokens for delete using (auth.uid() = user_id);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and policyname='ratings_select_any_auth') then
    create policy ratings_select_any_auth on public.ratings for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='ratings_update_comment_own') then
    create policy ratings_update_comment_own on public.ratings for update to authenticated
      using (rater_id = auth.uid()) with check (rater_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and policyname='ratings_delete_own') then
    create policy ratings_delete_own on public.ratings for delete to authenticated using (rater_id = auth.uid());
  end if;
end $$;

-- ── 5. Las dos columnas de profiles ──────────────────────────────
-- Las lee `tg_auto_suspend`, `reactivate_suspended` y toda la tarjeta de
-- estado de cuenta. Sin ellas, una base nueva no arranca el perfil.
alter table public.profiles add column if not exists estado text not null default 'activo';
alter table public.profiles add column if not exists suspended_until timestamptz;

-- ── 6. Las funciones que faltaban ────────────────────────────────
do $$
begin
  if to_regprocedure('public.search_canchas(text,integer)') is null then
    execute $fn$
      create function public.search_canchas(p_query text, p_limit integer default 5)
      returns table (id uuid, nombre text, direccion text, comuna text, region text,
                     latitud double precision, longitud double precision, usos_count integer)
      language plpgsql stable set search_path to 'public'
      as $body$
      declare
        v_q text := public.norm_text(coalesce(p_query, ''));
      begin
        if v_q = '' or length(v_q) < 2 then return; end if;
        return query
          select c.id, c.nombre, c.direccion, c.comuna, c.region,
                 c.latitud, c.longitud, c.usos_count
          from public.canchas c
          where c.nombre_norm like '%' || v_q || '%'
             or coalesce(c.direccion,'') ilike '%' || p_query || '%'
          order by c.usos_count desc, c.updated_at desc
          limit p_limit;
      end
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.recalc_user_ratings(uuid)') is null then
    execute $fn$
      create function public.recalc_user_ratings(p_user_id uuid)
      returns void language plpgsql security definer set search_path to 'public'
      as $body$
      begin
        update public.profiles p
           set rating_puntualidad_avg = coalesce(s.avg_p, 0),
               rating_fairplay_avg    = coalesce(s.avg_f, 0),
               rating_nivel_avg       = coalesce(s.avg_n, 0),
               rating_count           = coalesce(s.cnt, 0)
          from (
            select round(avg(puntualidad)::numeric, 2) as avg_p,
                   round(avg(fairplay)::numeric,    2) as avg_f,
                   round(avg(nivel)::numeric,       2) as avg_n,
                   count(*)                            as cnt
            from public.ratings
            where rated_id = p_user_id
          ) s
         where p.id = p_user_id;
      end;
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.tg_ratings_recalc()') is null then
    execute $fn$
      create function public.tg_ratings_recalc()
      returns trigger language plpgsql security definer set search_path to 'public'
      as $body$
      begin
        if tg_op = 'DELETE' then
          perform public.recalc_user_ratings(old.rated_id);
          return old;
        else
          perform public.recalc_user_ratings(new.rated_id);
          if tg_op = 'UPDATE' and old.rated_id <> new.rated_id then
            perform public.recalc_user_ratings(old.rated_id);
          end if;
          return new;
        end if;
      end;
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.tg_match_future_only()') is null then
    execute $fn$
      create function public.tg_match_future_only()
      returns trigger language plpgsql set search_path to 'public'
      as $body$
      begin
        if new.hora <= now() then
          raise exception 'La fecha y hora del partido ya pasaron';
        end if;
        return new;
      end
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.tg_notify_friend_request()') is null then
    execute $fn$
      create function public.tg_notify_friend_request()
      returns trigger language plpgsql security definer set search_path to 'public'
      as $body$
      declare
        v_username text;
      begin
        if new.status <> 'pending' then
          return new;
        end if;
        select username into v_username from public.profiles where id = new.requester_id;
        perform public.create_notification(
          new.addressee_id,
          'friend_request',
          'Nueva solicitud de amistad',
          coalesce(v_username, 'Alguien') || ' quiere ser tu amigo',
          jsonb_build_object('friendshipId', new.id, 'fromUserId', new.requester_id)
        );
        return new;
      end;
      $body$;
    $fn$;
  end if;

  if to_regprocedure('public.tg_notify_friend_accept()') is null then
    execute $fn$
      create function public.tg_notify_friend_accept()
      returns trigger language plpgsql security definer set search_path to 'public'
      as $body$
      declare
        v_username text;
      begin
        if new.status <> 'accepted' or old.status = 'accepted' then
          return new;
        end if;
        select username into v_username from public.profiles where id = new.addressee_id;
        perform public.create_notification(
          new.requester_id,
          'friend_accept',
          'Solicitud aceptada',
          coalesce(v_username, 'Tu amigo') || ' aceptó tu solicitud',
          jsonb_build_object('friendshipId', new.id, 'fromUserId', new.addressee_id)
        );
        return new;
      end;
      $body$;
    $fn$;
  end if;
end $$;

-- ── 7. Los ocho disparadores ─────────────────────────────────────
-- Éste es el hallazgo que la nota no tenía: sin ellos, en una base nueva
-- las funciones existen y nadie las llama. `create trigger if not exists`
-- no existe en PostgreSQL, así que va cada uno tras su comprobación.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_match_future_only' and not tgisinternal) then
    create trigger trg_match_future_only before insert on public.matches
      for each row execute function public.tg_match_future_only();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_register_cancha' and not tgisinternal) then
    create trigger trg_register_cancha after insert on public.matches
      for each row execute function public.tg_register_cancha();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_enforce_join_rules' and not tgisinternal) then
    create trigger trg_enforce_join_rules before insert on public.attendees
      for each row execute function public.tg_enforce_join_rules();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_notify_match_join' and not tgisinternal) then
    create trigger trg_notify_match_join after insert on public.attendees
      for each row execute function public.tg_notify_match_join();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_notify_friend_request' and not tgisinternal) then
    create trigger trg_notify_friend_request after insert on public.friendships
      for each row execute function public.tg_notify_friend_request();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_notify_friend_accept' and not tgisinternal) then
    create trigger trg_notify_friend_accept after update on public.friendships
      for each row execute function public.tg_notify_friend_accept();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_ratings_recalc' and not tgisinternal) then
    create trigger trg_ratings_recalc after insert or delete or update on public.ratings
      for each row execute function public.tg_ratings_recalc();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_auto_suspend' and not tgisinternal) then
    create trigger trg_auto_suspend before update of trust_score on public.profiles
      for each row execute function public.tg_auto_suspend();
  end if;
end $$;

-- ── 8. Los tres cron ─────────────────────────────────────────────
-- `cron.schedule` con un nombre que ya existe lo REESCRIBE, así que va
-- detrás de su comprobación para no tocar los de producción.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron no está: los tres cron quedan sin programar';
    return;
  end if;
  if not exists (select 1 from cron.job where jobname = 'futfinder-match-reminders') then
    perform cron.schedule('futfinder-match-reminders', '*/5 * * * *', 'select public.send_match_reminders();');
  end if;
  if not exists (select 1 from cron.job where jobname = 'futfinder-rating-reminders') then
    perform cron.schedule('futfinder-rating-reminders', '*/5 * * * *', 'select public.send_rating_reminders();');
  end if;
  if not exists (select 1 from cron.job where jobname = 'futfinder-reactivate') then
    perform cron.schedule('futfinder-reactivate', '*/30 * * * *', 'select public.reactivate_suspended();');
  end if;
end $$;
