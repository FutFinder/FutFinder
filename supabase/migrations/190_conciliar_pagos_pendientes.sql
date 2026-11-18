-- =============================================================
-- 190. CONCILIAR LOS PAGOS QUE QUEDARON `pendiente`
--
-- El hueco (pendientes.md, «Diseño propuesto», 2026-11-14): un pago sale de
-- `pendiente` sólo si llega el aviso de Flow o si la misma persona vuelve a
-- tocar «pagar». Si alguien paga, el aviso se pierde y no vuelve a la app,
-- la plata queda cobrada con el pago en `pendiente` y sin ninguna marca:
-- la revisión diaria sólo lista `reversar`. Ninguna de las tareas de
-- `pg_cron` mira `pagos`.
--
-- Esto agrega:
--   1. `conciliaciones`: una fila por pasada que revisó algo (cuántos,
--      cuántos se confirmaron, quedaron para devolver, se cerraron, siguen
--      pendientes, sin respuesta). Sólo la lee el equipo.
--   2. `llamar_conciliar_pagos()`: encola con `pg_net` la llamada a la Edge
--      Function `conciliar-pagos`, con el secreto de Vault
--      `conciliar_pagos_secreto` en la cabecera `x-conciliar-secreto`. La
--      URL sale de Vault (`conciliar_pagos_url`) si existe —la base local
--      llama a su propia función— y si no, la de producción. Nunca lanza:
--      sin secreto avisa y no hace nada.
--   3. El cron cada 10 minutos.
--
-- La lógica de qué hacer con cada pago NO está acá: está en la Edge Function
-- (`_shared/conciliarPagos.ts`), porque preguntarle a Flow exige firmar con
-- la Secret Key, que no vive en la base. Resuelve por `confirmar_pago`,
-- `pago_cobrado_sin_reserva` y `rechazar_pago`, que ya son idempotentes.
--
-- PARA ENCENDERLO (no hace falta hasta que Flow esté conectado; sin
-- secreto el cron corre y no hace nada):
--   1. Inventar un secreto largo (32+ caracteres) y cargarlo como
--      `CONCILIAR_PAGOS_SECRETO` en los secretos de las Edge Functions.
--   2. El mismo valor en Vault:
--        select vault.create_secret('<secreto>', 'conciliar_pagos_secreto',
--          'Cabecera x-conciliar-secreto para la Edge Function conciliar-pagos');
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La bitácora de pasadas ────────────────────────────────────
create table if not exists public.conciliaciones (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    ambiente text not null check (ambiente in ('sandbox', 'produccion')),
    revisados integer not null default 0 check (revisados >= 0),
    confirmados integer not null default 0 check (confirmados >= 0),
    reversar integer not null default 0 check (reversar >= 0),
    cerrados integer not null default 0 check (cerrados >= 0),
    siguen_pendientes integer not null default 0 check (siguen_pendientes >= 0),
    sin_respuesta integer not null default 0 check (sin_respuesta >= 0),
    errores integer not null default 0 check (errores >= 0)
);

comment on table public.conciliaciones is
  'Una fila por pasada de la Edge Function conciliar-pagos que revisó algún '
  'pago pendiente (migración 190). Sólo la escribe service_role; nadie de la '
  'app la lee.';

alter table public.conciliaciones enable row level security;
revoke all on public.conciliaciones from public, anon, authenticated;

-- ── 2. La llamada ────────────────────────────────────────────────
create or replace function public.llamar_conciliar_pagos()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secreto text;
  v_url text;
begin
  begin
    select s.decrypted_secret into v_secreto
      from vault.decrypted_secrets s
     where s.name = 'conciliar_pagos_secreto';

    if v_secreto is null or v_secreto = '' then
      raise notice 'llamar_conciliar_pagos: falta el secreto `conciliar_pagos_secreto` en Vault; no se concilia.';
      return;
    end if;

    select s.decrypted_secret into v_url
      from vault.decrypted_secrets s
     where s.name = 'conciliar_pagos_url';

    perform net.http_post(
      url := coalesce(nullif(v_url, ''),
                      'https://jvfoendzblkoxvwvommz.supabase.co/functions/v1/conciliar-pagos'),
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-conciliar-secreto', v_secreto),
      timeout_milliseconds := 60000);
  exception when others then
    raise warning 'llamar_conciliar_pagos: no se pudo encolar (%): %', sqlstate, sqlerrm;
  end;
end $$;

comment on function public.llamar_conciliar_pagos() is
  'La llama pg_cron cada 10 minutos: encola la llamada a la Edge Function '
  'conciliar-pagos con el secreto de Vault. Nunca lanza excepción.';

revoke all on function public.llamar_conciliar_pagos() from public, anon, authenticated;

-- ── 3. El cron ───────────────────────────────────────────────────
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('futfinder-conciliar-pagos', '*/10 * * * *', 'select public.llamar_conciliar_pagos();');
  end if;
end $$;
