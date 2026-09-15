-- 106. Salirse de un partido cuesta lo mismo por las dos puertas.
--
-- `leave_match` es la RPC heredada: borra la inscripción, libera el cupo y no
-- descuenta nada. `leave_match_penalized` es la que usa la app y la que aplica
-- la regla vigente —3 puntos con más de 2 horas de anticipación, 20 después—,
-- avisa al chat del partido y despierta a la lista de espera.
--
-- Ninguna pantalla llama a la heredada, pero sigue concedida a `authenticated`:
-- es una segunda puerta que se salta la regla. En vez de dejarla ahí o de
-- quitarla y romper cualquier build antiguo que la tenga, pasa a delegar. Una
-- sola puerta, como el resto del proyecto.
create or replace function public.leave_match(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
    return public.leave_match_penalized(p_match_id)::json;
end;
$$;
revoke all on function public.leave_match(uuid) from public, anon;
grant execute on function public.leave_match(uuid) to authenticated;
