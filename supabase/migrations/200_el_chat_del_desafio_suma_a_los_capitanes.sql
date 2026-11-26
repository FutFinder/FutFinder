-- 200. El chat del desafío es de los administradores Y los capitanes.
--
-- Decisión de Vicente (2026-11-26, rediseño de Clubes): el hilo
-- `challenge:<id>` lo comparten los administradores y los capitanes de los dos
-- clubes.
--
-- NO HACE FALTA TOCAR EL CHAT. Desde la 119 quien entra al hilo lo decide el
-- permiso delegable `chatClubs`: `chat_puede_ver_desafio()`,
-- `chat_puede_escribir_desafio()`, `chat_destinatarios()` (175, el reparto por
-- Broadcast) y la bandeja (131) preguntan todos por
-- `tiene_permiso_de_club(club, usuario, 'chatClubs')`, y el administrador lo
-- tiene siempre. Lo que dejaba fuera a los capitanes era el VALOR CON EL QUE
-- NACE el permiso: la 119 sembró al capitán sólo con `lineup`.
--
-- Lo que cambia:
--   1. Un club nuevo nace con `chatClubs` encendido para el capitán (además
--      de `lineup`, como ya era). El jugador sigue sin él.
--   2. Los clubes que ya existen pasan a lo mismo. Se comprobó en producción
--      el 2026-11-26 que NINGÚN club había cambiado nunca sus permisos (las
--      filas de los 13 clubes seguían exactamente como las sembró la 119), así
--      que encenderlo no pisa ninguna decisión de un administrador. Las
--      excepciones por integrante (`club_member_permission_overrides`) no se
--      tocan: si alguna existiera, seguiría mandando sobre el rol.
--
-- Lo que NO cambia:
--   · Sigue siendo un permiso: un administrador puede apagárselo a los
--     capitanes de su club desde «Permisos de club», o a un capitán puntual.
--   · Los avisos de acción del desafío (`desafio_avisar()`: aceptar, aprobar,
--     responder una prórroga) siguen llegando sólo a los administradores,
--     porque son ellos quienes pueden hacer esas acciones. El capitán ve el
--     hilo y escribe en él.
--   · «Restaurar» (`club_restaurar_permisos_default`) ya ponía `chatClubs` en
--     verdadero para el capitán desde la 119.
--
-- Idempotente.

create or replace function public._sembrar_permisos_actuales(p_club_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
    insert into public.club_role_permissions (club_id, rol, permiso, activo)
    select p_club_id, rol, permiso,
           (rol = 'capitan' and permiso in ('lineup', 'chatClubs'))
      from unnest(array['capitan', 'jugador']) as rol
      cross join unnest(array[
          'pubChallenge', 'answerChallenge', 'chatClubs',
          'invite', 'removeMembers', 'editNicks',
          'lineup', 'results', 'editClub'
      ]) as permiso
    on conflict (club_id, rol, permiso) do nothing;
$$;
revoke all on function public._sembrar_permisos_actuales(uuid) from public, anon, authenticated;

update public.club_role_permissions
   set activo = true,
       updated_at = now()
 where rol = 'capitan'
   and permiso = 'chatClubs'
   and activo = false;
