-- 59. handle_new_user: no reventar cuando el username derivado ya existe
--
-- Problema: `profiles_username_ci_idx` es un índice ÚNICO sobre
-- lower(username), pero el trigger insertaba con `on conflict (id) do nothing`,
-- que solo cubre el choque de id. Si el username derivado del correo ya
-- existía (por ejemplo `juan@gmail.com` cuando ya hay un `juan` de
-- `juan@hotmail.com`), la inserción en `profiles` fallaba, y como el trigger
-- corre dentro de la transacción del insert en `auth.users`, el registro
-- completo se caía con un 500 opaco: "Database error saving new user".
--
-- Se reprodujo al implementar el registro por código: un correo cuyo username
-- coincidía con uno existente no podía registrarse de ninguna manera.
--
-- Arreglo: buscar un username libre agregando un sufijo numérico. El nombre
-- es un valor inicial que la persona puede cambiar en su perfil, así que
-- alterarlo es preferible a impedir el registro.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    base    text;
    intento text;
    n       integer := 0;
begin
    base := coalesce(
        nullif(trim(new.raw_user_meta_data->>'username'), ''),
        split_part(new.email, '@', 1),
        'jugador'
    );

    -- El índice único es sobre lower(username); comparamos igual.
    intento := base;
    while exists (select 1 from public.profiles where lower(username) = lower(intento)) loop
        n := n + 1;
        intento := base || n::text;
        -- Cinturón por si algo se descontrola: no bloquear el registro nunca.
        if n > 500 then
            intento := base || '_' || replace(new.id::text, '-', '');
            exit;
        end if;
    end loop;

    insert into public.profiles (id, username, comuna)
    values (
        new.id,
        intento,
        coalesce(new.raw_user_meta_data->>'comuna', null)
    )
    on conflict (id) do nothing;

    return new;
exception
    -- Que la creación del perfil nunca impida crear la cuenta: si aun así
    -- choca (dos registros simultáneos con el mismo nombre), se deja el
    -- perfil sin username y la persona lo elige en el onboarding.
    when unique_violation then
        insert into public.profiles (id, comuna)
        values (new.id, coalesce(new.raw_user_meta_data->>'comuna', null))
        on conflict (id) do nothing;
        return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();
