-- =============================================================
-- 142. LA BÚSQUEDA DE JUGADORES LA FILTRA EL SERVIDOR
--
-- Ajustes ofrece «Visible en búsquedas — Tu perfil aparece al buscar
-- jugadores», y hasta hoy ese interruptor lo aplicaba SÓLO EL CLIENTE:
-- `buildSearchPlayersQuery()` agregaba `.eq('privacy_visible_in_search',
-- true)` a una consulta directa contra `profiles`. Como
-- `profiles_read_all` es `using (true)` para `public`, cualquiera que
-- hable con PostgREST —con la clave publicable que va dentro del bundle
-- web— arma la misma consulta sin ese filtro y obtiene el listado
-- completo. El interruptor prometía algo que la base no sostenía.
--
-- La migración 35 ya había resuelto el problema gemelo del OTRO
-- interruptor de privacidad: `privacy_friend_requests` se aplica en la
-- política de `friendships`, o sea en el servidor, donde ocurre la
-- acción. Acá la acción es leer una lista, y una política de RLS no
-- puede expresar «esta fila no sale en la búsqueda pero sí en la nómina
-- de tu club», así que la puerta pasa a ser una función.
--
-- QUÉ HACE `buscar_jugadores()`
--   · Aplica `privacy_visible_in_search` en el servidor. Ésta es la
--     corrección.
--   · Exige sesión iniciada. Antes, `anon` podía buscar: la pantalla
--     está detrás del login, pero la consulta no lo estaba.
--   · Devuelve ONCE columnas, las mismas que ya pedía el cliente. No
--     expone ninguna que antes no viajara.
--   · Excluye a quien busca, que hasta hoy se filtraba en JavaScript
--     después de recibir la fila.
--   · Topa el límite en 50. El cliente pide 25 o 30; una llamada directa
--     pedía lo que quisiera.
--
-- LO QUE ESTA MIGRACIÓN **NO** ARREGLA, Y HAY QUE DECIRLO
--   `profiles_read_all` sigue siendo `using (true)`, así que una cuenta
--   con sesión puede seguir listando perfiles consultando la tabla
--   directamente y armarse su propia búsqueda. Para que el interruptor
--   sea cierto de verdad hay que cerrar las FILAS de `profiles` a una
--   relación —yo mismo, amigos, compañeros de club, alguien con quien
--   comparto partido o chat—, y eso toca las 25 lecturas de `profiles`
--   del cliente. Queda anotado como pendiente propio. Lo que sí cambia
--   hoy: la regla dejó de ser un `if` del cliente y vive donde se puede
--   hacer cumplir, y la puerta que la app ofrece la respeta siempre.
--   Por eso el texto del interruptor pasa a decir lo que cumple.
--
-- POR QUÉ NO SE MUEVE `privacy_visible_in_search` A UNA TABLA APARTE,
-- como hicieron la 138 con el teléfono y la 139 con la ubicación: su
-- columna hermana `privacy_friend_requests` la leen las políticas de las
-- migraciones 35 y 51 con una subconsulta sobre `profiles`. Moverlas a
-- una tabla sin privilegios de cliente dejaría esas políticas leyendo
-- null y fallando CERRADAS y en silencio: nadie podría mandar una
-- solicitud de amistad. Ese traslado necesita rehacer las dos políticas
-- y su arnés, y va en su propio cambio.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/142_la_busqueda_de_jugadores_la_filtra_el_servidor_test.sql
-- =============================================================

create or replace function public.buscar_jugadores(
  p_texto    text    default null,
  p_region   text    default null,
  p_comuna   text    default null,
  p_posicion text    default null,
  p_flanco   text    default null,
  p_edad_min integer default null,
  p_edad_max integer default null,
  p_limite   integer default 30
)
returns table (
  id                 uuid,
  username           text,
  foto_url           text,
  comuna             text,
  region             text,
  edad               integer,
  flanco             text,
  posicion_preferida text[],
  trust_score        integer,
  rating_count       integer,
  rating_nivel_avg   numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_yo     uuid := auth.uid();
  v_texto  text := nullif(btrim(coalesce(p_texto, '')), '');
  v_limite integer := least(greatest(coalesce(p_limite, 30), 1), 50);
begin
  -- La pantalla vive detrás del login; la consulta también, desde ahora.
  if v_yo is null then
    raise exception 'SIN_SESION' using errcode = '42501';
  end if;

  return query
  select p.id, p.username, p.foto_url, p.comuna, p.region, p.edad, p.flanco,
         p.posicion_preferida, p.trust_score, p.rating_count, p.rating_nivel_avg
    from public.profiles p
   where p.privacy_visible_in_search is true   -- ésta es la corrección
     and p.id <> v_yo
     and (v_texto  is null or p.username ilike '%' || v_texto || '%')
     and (p_region is null or p.region = p_region)
     and (p_comuna is null or p.comuna = p_comuna)
     and (p_posicion is null or p.posicion_preferida @> array[p_posicion])
     and (
       p_flanco is null
       or (p_flanco = 'ambos' and p.flanco = 'ambos')
       or (p_flanco in ('derecho', 'izquierdo') and p.flanco in (p_flanco, 'ambos'))
     )
     and (p_edad_min is null or p.edad >= p_edad_min)
     and (p_edad_max is null or p.edad <= p_edad_max)
   -- Sin texto, el listado inicial es una sugerencia por reputación; con
   -- texto manda el parecido del nombre y el orden lo fija `username`
   -- para que la misma búsqueda devuelva siempre lo mismo.
   order by
     case when v_texto is null then p.trust_score end desc nulls last,
     case when v_texto is null then null else p.username end asc,
     p.id
   limit v_limite;
end;
$$;

revoke all on function public.buscar_jugadores(text, text, text, text, text, integer, integer, integer)
  from public, anon;
grant execute on function public.buscar_jugadores(text, text, text, text, text, integer, integer, integer)
  to authenticated;

comment on function public.buscar_jugadores(text, text, text, text, text, integer, integer, integer) is
  'Búsqueda de jugadores con «Visible en búsquedas» aplicado en el servidor (migración 142). Exige sesión, excluye a quien busca, devuelve sólo las once columnas públicas del buscador y topa el límite en 50.';
