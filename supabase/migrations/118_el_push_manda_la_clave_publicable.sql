-- =============================================================
-- FutFinder migration 118: el push manda la clave publicable
-- =============================================================
-- Continuación de la 117. Aquélla sacó el token del catálogo y lo metió en
-- Vault, pero el token seguía siendo la **service key**, y eso importa
-- porque —como la propia 117 dejó anotado— el token NO deja de pasar por
-- `net.http_request_queue`, una tabla legible por PUBLIC que no se puede
-- revocar.
--
-- O sea: mientras ahí viajara la llave maestra, la defensa entera dependía
-- de que PostgREST no expusiera el esquema `net`. Una sola línea de
-- configuración de por medio.
--
-- POR QUÉ SE PUEDE CAMBIAR, MEDIDO
--
-- `send-push` NO LEE la cabecera `Authorization`. Se comprobó leyendo su
-- código: crea su cliente con `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`,
-- que se lo inyecta la plataforma. La cabecera sólo sirve para pasar el
-- portero `verify_jwt`, y ése acepta CUALQUIER JWT válido del proyecto,
-- sin mirar el rol. Comprobado contra la función desplegada:
--
--     con la clave publicable  → HTTP 200 {"skipped":"not an insert"}
--     sin cabecera             → HTTP 401 UNAUTHORIZED_NO_AUTH_HEADER
--
-- El 401 es la calibración: sin él, el 200 no probaría nada.
--
-- QUÉ CAMBIA DE VERDAD: lo que viaja por la cola pasa a ser la clave
-- PUBLICABLE, la misma que va dentro del bundle de la app y que cualquiera
-- puede leer decompilándola. Si mañana alguien llegara a leer
-- `net.http_request_queue`, no se llevaría nada que no tuviera ya.
--
-- Lo que NO cambia: la puerta sigue igual de cerrada (PostgREST expone
-- sólo `public` y `graphql_public`). Esto no sustituye a esa defensa, le
-- quita el premio.
--
-- EL VALOR DEL SECRETO NO ESTÁ EN ESTE ARCHIVO, igual que en la 117. Se
-- cambió con `vault.update_secret` sobre el secreto `send_push_authorization`,
-- que conserva su nombre: la función de la 117 no se toca. En una base
-- nueva se crea con la clave publicable del proyecto, no con la service key.
--
-- El arnés de la 117 gana un caso que lo vigila: comprueba que el rol del
-- token guardado es `anon` y NO `service_role`, así que si algún día
-- alguien vuelve a poner la llave maestra ahí, la prueba lo dice.
--
-- Idempotente: sólo actualiza un comentario.
-- =============================================================

comment on function public.notificar_push() is
  'Encola el push de una notificación nueva llamando a la Edge Function '
  'send-push. Saca el Authorization del secreto `send_push_authorization` '
  'de Vault, que guarda la clave PUBLICABLE (rol anon), no la service key: '
  'send-push no lee esa cabecera —usa su propia service key del entorno— y '
  'el portero verify_jwt acepta cualquier JWT del proyecto. Así, lo que '
  'viaja por net.http_request_queue no vale nada. Nunca lanza excepción: un '
  'fallo del push no puede impedir que la notificación se guarde.';
