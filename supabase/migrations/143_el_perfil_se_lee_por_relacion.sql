-- =============================================================
-- 143. EL PERFIL SE LEE POR RELACIÓN, NO PORQUE SÍ
--
-- `profiles_read_all` era `for select to public using (true)`: cualquiera
-- con la clave publicable —incluido `anon`, sin iniciar sesión— leía las
-- 32 filas enteras. Comprobado en vivo el 2026-09-30 con una petición
-- HTTP real: `GET /rest/v1/profiles?select=...` devolvió 200 y filas sin
-- ninguna sesión.
--
-- Eso es lo que dejaba mentir al interruptor «Visible en búsquedas». La
-- migración 142 movió la búsqueda al servidor, pero declaró su propio
-- límite: mientras la tabla se lea entera, quien no use la app se arma su
-- propia búsqueda. Esta migración cierra esa puerta.
--
-- LA REGLA, Y POR QUÉ ES ÉSTA
--   Un perfil se lee si se cumple una de tres:
--     1. Es el mío.
--     2. Su dueño lo dejó DESCUBRIBLE (`privacy_visible_in_search`). Es
--        el valor por omisión y hoy lo tienen las 32 cuentas, así que
--        para todo el mundo no cambia nada.
--     3. Hay una RELACIÓN, y son SIETE: amistad en cualquier estado,
--        club compartido, partido compartido (por nómina o por
--        organizarlo), desafío entre mi club y el suyo, lista de espera
--        de un partido mío, alguien a quien bloqueé, y co-administrar un
--        recinto (o ser su dueño).
--   La 2 es la que le da sentido al interruptor: apagarlo ya no es sólo
--   «no salgo en la lista», es «los desconocidos no me leen». La 3 es la
--   que evita que apagarlo te borre de tu propio club: tus compañeros,
--   tus amigos y tus rivales te siguen viendo.
--
-- `anon` PIERDE LA LECTURA ENTERA. Se revisó antes: las únicas rutas sin
-- sesión son Splash, Welcome, Tutorial, Register, Login, Verification,
-- LocationPermission y Terms, y ninguna lee un perfil ajeno.
--
-- LA TRAMPA, y por la que el arnés pesa más que la migración: una
-- política que niega de más NO rompe ninguna pantalla. Devuelve cero
-- filas y la app dibuja un vacío creíble. Peor todavía con un INNER
-- JOIN: ahí la fila entera DESAPARECE y lo que queda se ve sano.
-- Las cuatro últimas relaciones de la lista no salieron de pensar el
-- modelo, sino de buscar quién hacía ese join. Lo que se encontró:
--   · `friendships_insert` (migración 35) comprueba
--     `privacy_friend_requests <> 'nobody'` con una subconsulta sobre
--     `profiles` que corre como quien llama. Si el perfil del
--     destinatario no se lee, mandar una solicitud falla CERRADO y sin
--     mensaje.
--   · `lista_de_espera()` hacía INNER JOIN contra `profiles`. Un jugador
--     oculto no aparecía vacío: desaparecía de la cola, y el
--     `row_number()` corría un puesto a todos los de abajo. Se resuelve
--     por los DOS lados: la relación de lista de espera, y la función
--     pasa a `security definer` porque cualquier `authenticated` puede
--     llamarla y la relación no alcanza para todos sus llamadores.
--   · `administradoresDelRecinto()` usa `profiles!inner`, y su propio
--     comentario dice que se apoya en que «`profiles` es de lectura
--     pública». Un administrador oculto desaparecería de la lista y el
--     dueño creería que lo sacó.
--   · La pantalla de Bloqueados trae a cada bloqueado con un embed
--     contra `profiles`.
--   · `get_my_threads()` es SECURITY INVOKER y hace INNER JOIN contra
--     `profiles` para el otro lado de un DM; los otros tres joins de esa
--     función son LEFT y sólo perderían un nombre. La amistad y el
--     desafío cubren los DM, que es lo único que llega ahí.
--   · `buscar_jugadores()` (142) es SECURITY DEFINER y corre como su
--     dueño, así que NO la alcanza esta política — y por eso la búsqueda
--     sigue funcionando. Hay un caso que lo fija, para que se note si
--     alguien la convierte en invoker.
--
-- NO SE USAN SUBCONSULTAS SUELTAS EN LA POLÍTICA. Van dentro de
-- `perfil_relacionado()`, `security definer`, por dos razones: la
-- política no queda a merced de la RLS de `friendships`, `club_members`
-- y `attendees`, y la regla se lee en un solo lugar. El orden de los
-- `or` importa: lo barato primero, así el caso normal —un perfil
-- descubrible— nunca llega a llamar a la función.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/143_el_perfil_se_lee_por_relacion_test.sql
-- =============================================================

create or replace function public.perfil_relacionado(p_otro uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or p_otro is null then false
    else exists (
      -- Amistad en CUALQUIER estado: una solicitud pendiente tiene que
      -- poder mostrar de quién viene, y un bloqueo también.
      select 1 from public.friendships f
       where (f.requester_id = auth.uid() and f.addressee_id = p_otro)
          or (f.requester_id = p_otro      and f.addressee_id = auth.uid())
    ) or exists (
      -- Algún club en común.
      select 1 from public.club_members a
        join public.club_members b on b.club_id = a.club_id
       where a.user_id = auth.uid() and b.user_id = p_otro
    ) or exists (
      -- Algún partido en común, por nómina o por organizar.
      select 1 from public.attendees x
        join public.attendees y on y.id_partido = x.id_partido
       where x.id_jugador = auth.uid() and y.id_jugador = p_otro
    ) or exists (
      select 1 from public.matches m
        join public.attendees a on a.id_partido = m.id
       where (m.id_organizador = auth.uid() and a.id_jugador = p_otro)
          or (m.id_organizador = p_otro      and a.id_jugador = auth.uid())
    ) or exists (
      -- Un desafío entre mi club y el suyo: el hilo de negociación junta
      -- a gente de dos clubes distintos que no comparten nada más.
      select 1
        from public.club_challenges d
        join public.club_members mio  on mio.user_id  = auth.uid()
        join public.club_members otro on otro.user_id = p_otro
       where (mio.club_id = d.club_retador_id and otro.club_id = d.club_retado_id)
          or (mio.club_id = d.club_retado_id  and otro.club_id = d.club_retador_id)
    ) or exists (
      -- La lista de espera de un partido que organizo o juego. Quien
      -- espera NO es `attendee`, así que las dos reglas de arriba no lo
      -- alcanzan, y `lista_de_espera()` hace INNER JOIN contra profiles:
      -- sin esto, el que se ocultó desaparecería de la cola y todos los
      -- de abajo subirían una posición.
      select 1
        from public.match_waitlist w
        join public.matches m on m.id = w.id_partido
       where w.id_jugador = p_otro
         and (m.id_organizador = auth.uid()
              or exists (select 1 from public.attendees a
                          where a.id_partido = m.id and a.id_jugador = auth.uid()))
    ) or exists (
      -- A quien bloqueé tengo que poder verlo: la pantalla de Bloqueados
      -- lo trae con un embed contra profiles.
      select 1 from public.blocked_users b
       where b.blocker_id = auth.uid() and b.blocked_id = p_otro
    ) or exists (
      -- Co-administramos un recinto. `administradoresDelRecinto()` usa
      -- `profiles!inner`, y su propio comentario dice que se apoya en que
      -- `profiles` sea de lectura pública: sin esta regla, un
      -- administrador que se oculte desaparece de la lista y el dueño
      -- creería que lo sacó.
      select 1
        from public.complejo_admins mio
        join public.complejo_admins otro on otro.complejo_id = mio.complejo_id
       where mio.user_id = auth.uid() and otro.user_id = p_otro
    ) or exists (
      -- Y el dueño del recinto con sus administradores, en los dos
      -- sentidos: el dueño no siempre tiene fila en complejo_admins.
      select 1
        from public.complejos c
        join public.complejo_admins a on a.complejo_id = c.id
       where (c.created_by = auth.uid() and a.user_id = p_otro)
          or (c.created_by = p_otro      and a.user_id = auth.uid())
    )
  end;
$$;

revoke all on function public.perfil_relacionado(uuid) from public, anon;
grant execute on function public.perfil_relacionado(uuid) to authenticated;

comment on function public.perfil_relacionado(uuid) is
  'true si quien llama comparte con p_otro una amistad (cualquier estado), un club, un partido o un desafío entre clubes. La usa la política de lectura de profiles (migración 143).';

drop policy if exists profiles_read_all on public.profiles;
drop policy if exists profiles_read_propio_descubrible_o_relacionado on public.profiles;

create policy profiles_read_propio_descubrible_o_relacionado
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or privacy_visible_in_search is true
    or public.perfil_relacionado(id)
  );

-- ── `lista_de_espera()` pasa a SECURITY DEFINER ──────────────────
-- Hace `join public.profiles` (INNER) sólo para leer el `trust_score`
-- con el que ordena la cola. Cualquier `authenticated` puede llamarla
-- —`waitlist_select` sólo exige sesión—, así que la regla de relación no
-- alcanza para todos sus llamadores: un jugador oculto se caería de la
-- cola y las posiciones de abajo se correrían. La función no publica
-- ninguna columna del perfil: devuelve `id_jugador`, tiempos y posición.
-- Se recrea IDÉNTICA salvo `security definer`.
create or replace function public.lista_de_espera(p_match_id uuid)
returns table (
  id uuid, id_jugador uuid, created_at timestamptz, avisado_at timestamptz,
  confirmar_antes_de timestamptz, prioridad boolean, posicion integer
)
language sql
stable
security definer
set search_path = public
as $le$
  select w.id, w.id_jugador, w.created_at, w.avisado_at, w.confirmar_antes_de, x.prio,
         (row_number() over (order by x.prio desc, w.created_at))::int
    from public.match_waitlist w
    join public.profiles p on p.id = w.id_jugador
    cross join lateral (select public.truescore_prioridad_espera(p.trust_score) as prio) x
   where w.id_partido = p_match_id
   order by x.prio desc, w.created_at;
$le$;

revoke all on function public.lista_de_espera(uuid) from public, anon;
grant execute on function public.lista_de_espera(uuid) to authenticated;

comment on table public.profiles is
  'Perfil del jugador. Lectura por relación desde la migración 143: el propio, los que se dejaron descubribles (privacy_visible_in_search) y aquellos con quienes se comparte amistad, club, partido o desafío. anon no lee nada.';
