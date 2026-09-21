-- 130. Las membresías de un club se serializan: por el club y por el jugador.
--
-- C04, C05 y C06 de la revisión de Clubes del 21 de septiembre. Son el mismo
-- defecto que la 109 arregló para la agenda del jugador, en la otra tabla:
-- cada transacción CUENTA antes de escribir, y dos que cuentan a la vez ven
-- las dos el mismo «todavía cabe» o el mismo «queda otro administrador».
--
--   C04  Los dos administradores de un club salen a la vez. Cada uno ve al
--        otro antes de su COMMIT, las dos bajas se aceptan, y el club queda
--        con jugadores y cero administradores. El trigger de la 111 resuelve
--        la salida del ÚLTIMO administrador, no dos salidas superpuestas.
--   C05  Un club estándar con 14 integrantes y dos invitaciones pendientes:
--        los dos invitados aceptan a la vez, los dos cuentan 14, y el club
--        termina con 16 sobre un máximo de 15.
--   C06  Un jugador en dos clubes acepta a la vez las invitaciones de otros
--        dos: cuenta 2 en las dos transacciones y termina con cuatro
--        membresías sobre un máximo de tres.
--
-- POR QUÉ UN SOLO TRIGGER Y NO TRES ARREGLOS. Las tres comprobaciones viven
-- en funciones distintas (`el_club_no_se_queda_sin_admin`, `check_club_limits`
-- y `check_user_club_limit`) y ninguna es el lugar natural del bloqueo: lo que
-- hay que serializar no es cada comprobación, sino TODA escritura sobre la
-- nómina. Así que el bloqueo se toma una vez, en un trigger que corre antes
-- que los demás —`aa_` ordena primero, igual que `aa_attendees_completa_origen`
-- en la 45— y las tres funciones siguen como están, sólo que ahora cuentan
-- cuando ya nadie más puede estar contando lo mismo.
--
-- EL ORDEN ES FIJO: primero el club, después el jugador. C05 necesita el del
-- club (dos personas distintas entrando al mismo club) y C06 el del jugador
-- (la misma persona entrando a dos clubes distintos), así que hacen falta los
-- dos; y si cada uno se tomara en el orden que le conviene, dos altas cruzadas
-- —A entra a 1 mientras B entra a 2— podrían quedarse esperando la una a la
-- otra. Con un orden único eso no puede pasar.
--
-- Los `classid` 130 y 131 son sólo nombres de espacio de bloqueos, no números
-- de migración; el 107 de la agenda del jugador (109) queda intacto y no se
-- cruza con éstos.
--
-- ALCANCE: el trigger cubre INSERT, UPDATE y DELETE, así que entra también la
-- transferencia de administración (`transfer_club_admin`, que baja a uno y
-- sube a otro con dos UPDATE) y las expulsiones, no sólo las salidas.
--
-- Regresión: supabase/tests/130_las_membresias_del_club_se_serializan_test.sql
-- (mecanismo y no regresión, una conexión) y
-- supabase/tests/clubes_membresia_concurrente_test.cjs (las tres carreras con
-- dos conexiones reales, que es lo único que las reproduce).

create or replace function public.club_members_serializa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_club uuid;
    v_user uuid;
begin
    if tg_op = 'DELETE' then
        v_club := old.club_id;
        v_user := old.user_id;
    else
        v_club := new.club_id;
        v_user := new.user_id;
    end if;

    -- Siempre en este orden. Ver la cabecera.
    perform pg_advisory_xact_lock(130, hashtext(v_club::text));
    perform pg_advisory_xact_lock(131, hashtext(v_user::text));

    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;
revoke all on function public.club_members_serializa() from public, anon, authenticated;

-- `aa_` para que corra ANTES que los tres triggers que comprueban: cuando
-- ellos cuentan, el bloqueo ya está tomado.
drop trigger if exists aa_club_members_serializa on public.club_members;
create trigger aa_club_members_serializa
    before insert or update or delete on public.club_members
    for each row
    execute function public.club_members_serializa();
