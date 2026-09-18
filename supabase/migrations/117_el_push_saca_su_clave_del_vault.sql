-- =============================================================
-- FutFinder migration 117: el push saca su clave del Vault
-- =============================================================
-- El aviso de push lo disparaba un Database Webhook creado desde el panel
-- —el disparador `notifications_send_push` sobre `public.notifications`,
-- que llamaba a `supabase_functions.http_request`—. Dos problemas, y
-- ninguno de los dos era teórico.
--
-- 1. LA SERVICE KEY VIVÍA EN EL CATÁLOGO. Un Database Webhook guarda sus
--    cabeceras dentro de `pg_trigger.tgargs`, en claro. Ahí estaba el
--    `Authorization: Bearer <jwt>` y ese jwt es, medido, de rol
--    `service_role`: la llave maestra, la que se salta toda la RLS.
--    `pg_trigger` es un catálogo legible por cualquiera que pueda
--    ejecutar SQL, y encima la cabecera viajaba después por
--    `net.http_request_queue`, una tabla cuyo ACL es `=arwdDxtm` para
--    PUBLIC y que no se puede revocar (el otorgante es `supabase_admin`,
--    y el disparador de eventos `grant_pg_net_access` de la propia
--    plataforma la vuelve a conceder en cada DDL).
--
-- 2. NO ESTABA EN EL REPOSITORIO. Se creó a mano desde el panel, así que
--    no había forma de saber que existía leyendo las migraciones, ni de
--    reconstruirlo en una base nueva.
--
-- QUÉ CAMBIA: el disparador pasa a ser una función nuestra que saca el
-- token de `vault.decrypted_secrets` en el momento de usarlo. El esquema
-- `vault` no le da USAGE ni a `anon` ni a `authenticated` —comprobado— y
-- el secreto queda cifrado en reposo.
--
-- QUÉ NO CAMBIA, Y HAY QUE DECIRLO: el token SIGUE viajando por
-- `net.http_request_queue` mientras `pg_net` procesa la petición, porque
-- la cabecera tiene que existir para que la petición salga. Esto saca la
-- copia ESTÁTICA del catálogo; la copia en tránsito dura lo que tarda el
-- worker en consumir la fila. Hoy eso no es alcanzable —PostgREST expone
-- sólo `public` y `graphql_public`, y la publicación de Realtime no lleva
-- ninguna tabla de `net`— pero conviene no fingir que queda cerrado del
-- todo.
--
-- EL SECRETO NO ESTÁ EN ESTE ARCHIVO, a propósito: es una credencial y no
-- va al repositorio. Se cargó una sola vez, copiándolo de las cabeceras
-- del webhook viejo a Vault sin que el valor saliera de la base:
--
--     select vault.create_secret(<el token>, 'send_push_authorization', '…');
--
-- Si mañana hay que rehacerlo en otra base, se crea ese secreto a mano con
-- la service key del proyecto. SIN el secreto esto NO se cae: la función
-- avisa y deja pasar el INSERT (ver más abajo), que es exactamente lo que
-- tiene que hacer.
--
-- NUNCA BLOQUEA EL INSERT. Un disparador que lanza una excepción aborta la
-- transacción que lo disparó: un fallo mandando el push —vault caído, red,
-- lo que sea— haría que la notificación NI SIQUIERA SE GUARDARA, y el
-- usuario perdería el aviso dentro de la app además del push. Todo el
-- cuerpo va en un bloque con `exception when others`: avisa y sigue.
-- Es la misma regla que la 116, y por el mismo motivo.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

-- ── 1. La función ────────────────────────────────────────────────
create or replace function public.notificar_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  begin
    select s.decrypted_secret into v_token
      from vault.decrypted_secrets s
     where s.name = 'send_push_authorization';

    if v_token is null or v_token = '' then
      -- Sin secreto no hay push, pero sí notificación dentro de la app.
      raise warning 'notificar_push: falta el secreto `send_push_authorization` en Vault; la notificacion % se guarda sin push.', new.id;
      return null;
    end if;

    -- El cuerpo imita exactamente lo que mandaba el Database Webhook,
    -- porque `send-push` lo lee así: comprueba `type` y `table` y después
    -- usa `record`. Ver supabase/functions/send-push/index.ts.
    perform net.http_post(
      url := 'https://jvfoendzblkoxvwvommz.supabase.co/functions/v1/send-push',
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'notifications',
        'schema', 'public',
        'record', to_jsonb(new),
        'old_record', null),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_token),
      timeout_milliseconds := 5000);

  exception when others then
    raise warning 'notificar_push: no se pudo encolar el push de la notificacion % (%): %',
      new.id, sqlstate, sqlerrm;
  end;

  return null;
end $$;

comment on function public.notificar_push() is
  'Encola el push de una notificación nueva llamando a la Edge Function '
  'send-push. Saca el Authorization de Vault en el momento de usarlo, para '
  'que la service key no viva en `pg_trigger.tgargs` como con el webhook. '
  'Nunca lanza excepción: un fallo del push no puede impedir que la '
  'notificación se guarde.';

-- Sólo la dispara el disparador. Nadie la llama por RPC.
revoke execute on function public.notificar_push() from public, anon, authenticated;

-- ── 2. El disparador ─────────────────────────────────────────────
-- Se reemplaza el webhook del panel por éste, con el mismo nombre, la
-- misma tabla y el mismo momento: AFTER INSERT FOR EACH ROW.
drop trigger if exists notifications_send_push on public.notifications;
create trigger notifications_send_push
  after insert on public.notifications
  for each row execute function public.notificar_push();
