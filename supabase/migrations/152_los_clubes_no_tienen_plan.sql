-- =============================================================
-- 152. LOS CLUBES NO TIENEN PLAN
--
-- Se retiran los planes de club (Estándar gratis / Premium de pago). El
-- producto deja de venderlos, y lo que hacían de verdad era una sola cosa:
-- elegir el tope de `check_club_limits()`. Estándar daba 15 integrantes y
-- 1 administrador; Premium, 26 y 3.
--
-- TODOS LOS CLUBES QUEDAN CON EL TOPE QUE ERA DE PREMIUM: 26 integrantes
-- y 3 administradores. Se eligió el mayor para que ningún club pierda
-- nada con el cambio. En producción, al escribir esto, los 13 clubes eran
-- `estandar` y el más grande tenía 2 integrantes y 1 administrador, así que
-- ninguno queda por encima del tope nuevo.
--
-- `check_club_limits()` sigue colgada de `trg_check_club_limits` (BEFORE
-- INSERT OR UPDATE OF rol en `club_members`) y sigue siendo la única que
-- manda; el cliente sólo avisa antes con `CLUB_LIMITS`. Cambia el número,
-- no la forma: se conserva el «Club no encontrado» —antes salía de no
-- encontrar el plan, ahora de no encontrar el club— y el mensaje ya no
-- dice «de su plan». El `capitan` sigue sin contar contra el tope de
-- administradores (90). No es invocable desde el cliente: su `EXECUTE`
-- sólo lo tienen `postgres` y `service_role`, y el `create or replace`
-- conserva ese ACL.
--
-- LA COLUMNA `clubs.plan` SE BORRA. Antes de borrarla se comprobó en
-- producción que nada más la lee: ninguna vista depende de ella, ninguna
-- política de RLS la nombra y la única función que la menciona en su
-- cuerpo es `check_club_limits()`, que se reescribe arriba. `verificado`
-- NO se toca: es otra columna y otra cosa.
--
-- OJO CON LAS VERSIONES NATIVAS YA INSTALADAS: piden `plan` en sus
-- `select` de clubes, y PostgREST rechaza con 400 una columna que no
-- existe. Hay que repartirles una versión nueva.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/152_los_clubes_no_tienen_plan_test.sql
-- =============================================================

create or replace function public.check_club_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_members integer;
    v_admins integer;
    v_max_members constant integer := 26;
    v_max_admins constant integer := 3;
begin
    if not exists (select 1 from public.clubs where id = new.club_id) then
        raise exception 'Club no encontrado';
    end if;

    -- cuenta sin incluir la fila que se está insertando/actualizando
    select count(*) into v_members
    from public.club_members
    where club_id = new.club_id and id <> new.id;

    select count(*) into v_admins
    from public.club_members
    where club_id = new.club_id and rol = 'admin' and id <> new.id;

    if tg_op = 'INSERT' and v_members >= v_max_members then
        raise exception 'El club alcanzó el límite de % integrantes', v_max_members;
    end if;

    if new.rol = 'admin' and v_admins >= v_max_admins then
        raise exception 'El club alcanzó el límite de % administradores', v_max_admins;
    end if;

    return new;
end;
$$;

alter table public.clubs drop column if exists plan;
