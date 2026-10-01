-- =============================================================
-- 148. LA PUERTA PARA QUE LAS PREFERENCIAS DEJEN DE SER PÚBLICAS
--
-- PRIMERA DE DOS, Y ÉSTA NO CAMBIA NADA DE LO QUE SE VE. Crea la RPC y
-- la función que la 149 necesita, y rehace la política de amistad para
-- que deje de leer la columna directo. El revoke —lo que de verdad
-- cierra las preferencias— va en la 149, que NO se puede aplicar hasta
-- que se distribuya un build. El motivo está explicado ahí.
--
-- Aplicar esto solo es seguro en los dos sentidos: una app ya instalada
-- sigue funcionando igual, y una app nueva ya puede leer sus ajustes por
-- `mis_ajustes()` antes de que exista el revoke.
--
-- Nueve columnas de `profiles` las puede leer cualquier cuenta con
-- sesión: los cuatro `notif_*`, `pref_region`, `pref_comuna`,
-- `search_radius_km` y los dos `privacy_*`. Dicen dónde busca partidos
-- cada persona, en qué radio, si acepta solicitudes de amistad y si eligió
-- ocultarse. Nada de eso es asunto de nadie más.
--
-- EL TAMAÑO DEL PROBLEMA SE ENCOGIÓ, Y CONVIENE DECIRLO. Cuando se anotó
-- este pendiente, `profiles` se leía con `using (true)` y hasta `anon`
-- veía las 32 filas enteras. La migración 143 cerró eso: hoy `anon` no lee
-- nada y una cuenta con sesión sólo ve los perfiles DESCUBRIBLES y los
-- relacionados. Lo que queda es eso: cualquier cuenta puede ver las
-- preferencias de quien se dejó descubrible. Menos grave que antes, pero
-- sigue sin haber razón para publicarlo.
--
-- POR QUÉ PRIVILEGIOS POR COLUMNA Y NO UNA TABLA APARTE, al revés que la
-- 138 con el teléfono y la 139 con la ubicación. Se probó primero, contra
-- producción y en una transacción revertida, porque la 139 había
-- descartado esta vía. El experimento mostró tres cosas:
--
--   1. La política de lectura de `profiles` (143) lee
--      `privacy_visible_in_search` y SIGUE FUNCIONANDO con la columna
--      revocada: una política sobre su propia tabla no exige privilegio
--      de columna.
--   2. `select *` y la columna privada quedan denegados, que es el efecto
--      buscado — y la objeción de la 139, que ahora se resuelve en el
--      cliente.
--   3. `buscar_jugadores` (142) es `security definer` y `send-push` usa
--      `service_role`: a ninguno de los dos los alcanza.
--
--   Mover los datos habría exigido además un trigger de desvío, un CHECK,
--   migrar las filas y tocar la Edge Function. Esto no toca ninguno.
--
-- LA TRAMPA, CONFIRMADA ANTES DE ESCRIBIR NADA: la política
-- `friendships_insert` (migración 35) comprueba
-- `privacy_friend_requests <> 'nobody'` con una subconsulta sobre
-- `profiles`. Al revocar la columna, esa política falla con
-- `42501 permission denied for table profiles` — y falla CERRADA: nadie
-- podría mandar una solicitud de amistad, sin ningún mensaje que lo
-- explique. Se midió en el experimento. Por eso la comprobación pasa a
-- `perfil_acepta_solicitudes()`, `security definer`, y la política se
-- rehace para llamarla.
--
-- EL DUEÑO TAMBIÉN PIERDE LO SUYO, y eso también se midió: los
-- privilegios por columna no son por fila, así que sin esto una persona
-- no podría leer ni su propio radio de búsqueda. Para eso está
-- `mis_ajustes()`, que devuelve las nueve del que llama y de nadie más.
--
-- CONSECUENCIA OPERATIVA QUE HAY QUE RECORDAR: al quitar el `select` de
-- tabla y conceder columna por columna, **una columna nueva de `profiles`
-- nace sin lectura para el cliente** hasta que se le conceda. Es un
-- defecto seguro —se nota enseguida, no en silencio— pero quien agregue
-- una columna tiene que acordarse de concederla.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/148_la_puerta_de_las_preferencias_test.sql
-- =============================================================

-- ── 1. La comprobación que la política necesita ──────────────────
create or replace function public.perfil_acepta_solicitudes(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = p_user
       and p.privacy_friend_requests <> 'nobody'
  );
$$;

revoke all on function public.perfil_acepta_solicitudes(uuid) from public, anon;
grant execute on function public.perfil_acepta_solicitudes(uuid) to authenticated;

comment on function public.perfil_acepta_solicitudes(uuid) is
  'true si ese perfil acepta solicitudes de amistad. Existe porque la politica friendships_insert lo comprobaba leyendo privacy_friend_requests directo, y desde la migracion 148 esa columna no es legible por el cliente (migracion 148).';

-- ── 2. La política, rehecha sobre la función ─────────────────────
-- Mismo contenido que la 35 y la 51: quien pide es el solicitante, el
-- destinatario acepta solicitudes, y no hay bloqueo entre los dos. Lo
-- único que cambia es de dónde sale el segundo dato.
drop policy if exists friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert
  with check (
    auth.uid() = requester_id
    and public.perfil_acepta_solicitudes(addressee_id)
    and not public.is_blocked_pair(requester_id, addressee_id)
  );

-- ── 3. Lo propio, para el dueño ──────────────────────────────────
create or replace function public.mis_ajustes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'privacy_friend_requests',   p.privacy_friend_requests,
    'privacy_visible_in_search', p.privacy_visible_in_search,
    'notif_matches',             p.notif_matches,
    'notif_clubs',               p.notif_clubs,
    'notif_chat',                p.notif_chat,
    'notif_friends',             p.notif_friends,
    'pref_region',               p.pref_region,
    'pref_comuna',               p.pref_comuna,
    'search_radius_km',          p.search_radius_km
  )
  from public.profiles p
  where p.id = auth.uid();
$$;

revoke all on function public.mis_ajustes() from public, anon;
grant execute on function public.mis_ajustes() to authenticated;

comment on function public.mis_ajustes() is
  'Las nueve preferencias del perfil de quien llama, y de nadie mas. Existe porque los privilegios por columna no son por fila: sin esto el dueno tampoco podria leer las suyas (migracion 148).';
