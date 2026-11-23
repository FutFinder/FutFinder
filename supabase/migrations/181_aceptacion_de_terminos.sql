-- =============================================================
-- 181. QUÉ VERSIÓN DE LOS TÉRMINOS ACEPTÓ CADA PERSONA, Y CUÁNDO
--
-- EL HUECO. El registro tiene una casilla «Acepto los Términos y la
-- Política de Privacidad» y el onboarding un paso «Términos y condiciones»,
-- pero el servidor no guardaba nada de eso: sólo `onboarding_completed`,
-- que dice que la persona terminó el recorrido, no QUÉ texto aceptó ni
-- CUÁNDO. Los textos cambian (`ACTUALIZADO` en `src/data/legal.js`), así
-- que sin la versión no se puede saber a qué dijo que sí cada cuenta, ni
-- pedirle que acepte de nuevo cuando cambien de fondo.
--
-- QUÉ HACE.
--   · `aceptaciones_legales`: una fila por persona y versión, con la hora
--     del SERVIDOR (no la del teléfono).
--   · `aceptar_terminos(p_version)`: la única manera de escribir. Toma la
--     identidad de la sesión, nunca de un parámetro; es idempotente (aceptar
--     dos veces la misma versión conserva la primera fecha).
--   · La persona puede LEER las suyas (para saber si le falta aceptar una
--     versión nueva); no puede insertar, cambiar ni borrar.
--
-- LA VERSIÓN es la fecha del texto, `AAAA-MM-DD` (`VERSION_LEGAL` en
-- `src/data/legal.js`). El servidor no conoce el texto, así que sólo valida
-- la forma y que no sea una fecha futura ni anterior a la app.
--
-- SE BORRA CON LA CUENTA (`on delete cascade`, como exige la 176).
--
-- LA APP TOLERA QUE ESTO NO EXISTA: sin esta migración, `aceptar_terminos`
-- contesta «función no encontrada» y el cliente sigue como hasta hoy. Se
-- puede aplicar antes o después de distribuir el build.
--
-- Idempotente.
-- =============================================================

create table if not exists public.aceptaciones_legales (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.profiles(id) on delete cascade,
    version     text not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
    aceptado_at timestamptz not null default now(),
    unique (user_id, version)
);

alter table public.aceptaciones_legales enable row level security;

revoke all on public.aceptaciones_legales from public, anon, authenticated;
grant select (version, aceptado_at, user_id) on public.aceptaciones_legales to authenticated;

drop policy if exists "aceptaciones_legales_select" on public.aceptaciones_legales;
create policy "aceptaciones_legales_select"
    on public.aceptaciones_legales for select
    to authenticated
    using (user_id = (select auth.uid()));

create or replace function public.aceptar_terminos(p_version text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
    v_me uuid := auth.uid();
    v_fecha date;
    v_at timestamptz;
begin
    if v_me is null then
        return json_build_object('ok', false, 'reason', 'No autenticado');
    end if;
    if p_version is null or p_version !~ '^\d{4}-\d{2}-\d{2}$' then
        return json_build_object('ok', false, 'reason', 'Versión inválida');
    end if;
    begin
        v_fecha := p_version::date;
    exception when others then
        return json_build_object('ok', false, 'reason', 'Versión inválida');
    end;
    -- Un día de holgura por la zona horaria: el texto se fecha en Chile y
    -- el servidor corre en UTC.
    if v_fecha < date '2026-01-01' or v_fecha > (now() at time zone 'utc')::date + 1 then
        return json_build_object('ok', false, 'reason', 'Versión inválida');
    end if;

    insert into public.aceptaciones_legales (user_id, version)
    values (v_me, p_version)
    on conflict (user_id, version) do nothing;

    select aceptado_at into v_at
      from public.aceptaciones_legales
     where user_id = v_me and version = p_version;

    return json_build_object('ok', true, 'version', p_version, 'aceptado_at', v_at);
end;
$$;

revoke all on function public.aceptar_terminos(text) from public, anon;
grant execute on function public.aceptar_terminos(text) to authenticated;
