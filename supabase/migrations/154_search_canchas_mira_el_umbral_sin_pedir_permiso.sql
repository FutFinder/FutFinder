-- =============================================================
-- 154. `search_canchas` MIRA EL UMBRAL SIN PEDIR PERMISO
--
-- ARREGLA UN FALLO QUE INTRODUJO LA 153, Y VALE LA PENA CONTAR CÓMO SE
-- COLÓ. La 153 metió en `search_canchas` una subconsulta contra
-- `cancha_usos`, que a propósito no tiene privilegios de cliente: diría
-- dónde juega cada persona. Pero `search_canchas` es **security
-- invoker**, así que esa subconsulta corre con el rol de quien llama, y
-- para `authenticated` reventaba con `42501 permission denied for table
-- cancha_usos`. El autocompletado de canchas al publicar un partido
-- quedó roto para TODO el mundo.
--
-- POR QUÉ EL ARNÉS DE LA 153 NO LO VIO: corre como `postgres`, que se
-- salta los privilegios. Dio 8/8 dos veces sobre una función que no
-- funcionaba. La lección ya estaba anotada —medir con la lente
-- equivocada— y volvió a pasar: un arnés que no cambia de rol no puede
-- decir nada sobre lo que ve un usuario.
--
-- EL ARREGLO: `security definer`. La función pasa a leer `canchas` sin
-- RLS, y eso **no destapa nada**: la única política de `canchas` es
-- `canchas_select_any`, que ya es `true` para `authenticated`. Lo que sí
-- cambia es que puede contar `cancha_usos` sin publicarla — el conteo
-- sale, las filas no.
--
-- Y SIGUE SIN SER DE `anon`. Antes de este cambio el `execute` era de
-- `postgres`, `authenticated` y `service_role`; se vuelve a fijar igual.
-- Con `security definer` esto importa más que antes: si `anon` pudiera
-- ejecutarla, leería el directorio saltándose la política que hoy se lo
-- impide, porque esa política es sólo para `authenticated`.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/154_search_canchas_como_authenticated_test.sql
-- =============================================================

create or replace function public.search_canchas(p_query text, p_limit integer default 5)
returns table(id uuid, nombre text, direccion text, comuna text, region text,
              latitud double precision, longitud double precision, usos_count integer)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_q text := public.norm_text(coalesce(p_query, ''));
  -- Cuántas personas distintas tienen que haber usado una cancha para que
  -- el directorio la ofrezca. Dos es el número más bajo que ya no deja
  -- pasar lo que escribió una sola persona una sola vez.
  v_minimo constant integer := 2;
begin
  if v_q = '' or length(v_q) < 2 then return; end if;
  return query
    select c.id, c.nombre, c.direccion, c.comuna, c.region,
           c.latitud, c.longitud, c.usos_count
    from public.canchas c
    where (c.nombre_norm like '%' || v_q || '%'
           or coalesce(c.direccion,'') ilike '%' || p_query || '%')
      and (select count(*) from public.cancha_usos u where u.cancha_id = c.id) >= v_minimo
    order by c.usos_count desc, c.updated_at desc
    limit p_limit;
end $function$;

revoke all on function public.search_canchas(text, integer) from public, anon;
grant execute on function public.search_canchas(text, integer) to authenticated;

comment on function public.search_canchas(text, integer) is
  'Sugiere canchas del directorio al publicar un partido. Solo las que usaron DOS organizadores distintos. Es security definer para poder CONTAR cancha_usos sin publicarla; no la ejecuta anon (migraciones 153 y 154).';
