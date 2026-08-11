-- =============================================================
-- FutFinder migration 42b: cerrar EXECUTE público de aceptar_desafio()
-- =============================================================
-- Corrección de la 42, en archivo aparte porque la 42 ya está aplicada
-- y editar una migración aplicada deja el repositorio y la base
-- contando historias distintas.
--
-- QUÉ PASÓ: la 42 hacía `revoke execute ... from anon`, que NO sirve.
-- PostgreSQL concede `EXECUTE` a `PUBLIC` por defecto en toda función
-- nueva, y `anon` lo hereda por ahí. El ACL quedaba así:
--
--     =X/postgres | postgres=X/postgres | authenticated=X/postgres | ...
--      ^^^ el grantee vacío es PUBLIC
--
-- Lo detectó el advisor de seguridad de Supabase («Public Can Execute
-- SECURITY DEFINER Function»).
--
-- GRAVEDAD REAL: baja. `aceptar_desafio()` corta con
-- `if v_me is null then raise exception 'No autenticado'`, así que una
-- llamada anónima no cambiaba nada. Pero una función `security definer`
-- alcanzable sin sesión no tiene por qué estar expuesta, y el arreglo es
-- de una línea.
--
-- Revocar de PUBLIC es lo único que quita el permiso de verdad; el grant
-- explícito a `authenticated` se reafirma después para no dejar la
-- función inalcanzable desde la app.
-- =============================================================

revoke execute on function public.aceptar_desafio(uuid) from public;
revoke execute on function public.aceptar_desafio(uuid) from anon;
grant execute on function public.aceptar_desafio(uuid) to authenticated;
