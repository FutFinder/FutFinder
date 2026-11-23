-- =============================================================
-- 171. SIN CUENTA NO SE LEE A LAS PERSONAS
--
-- Revisión de seguridad del 2026-11-09, sobre lo que quedaba después de la
-- 165 y la 166. Tres huecos, los tres comprobados contra producción antes
-- de escribir una línea.
--
-- 1. SIN CUENTA SE PODÍA LEER QUIÉN JUEGA DÓNDE.
--    La clave pública viaja dentro del bundle de la app, así que «sin
--    cuenta» es cualquiera que abra el bundle. Con esa clave y nada más,
--    por la API de tablas (`/rest/v1/<tabla>`), el 2026-11-09 respondían
--    con filas: `attendees` (32: quién va a cada partido), `club_members`
--    (15: quién está en cada club y con qué rol) y `profile_photos` (10:
--    las fotos de galería de cada persona). Las tres políticas de lectura
--    estaban escritas para el rol `public`, que incluye a `anon`.
--
--    La 143 ya había decidido que `anon` no lee `profiles`. Esto es lo
--    mismo, una capa más abajo: los ids de esas tablas son los de las
--    personas, y saber quién va a estar en qué cancha a qué hora, o en qué
--    club juega, no es un dato para alguien que ni siquiera se registró.
--
--    Las tres políticas pasan a `authenticated`. Sólo cambia el rol:
--    `alter policy ... to` no toca `using` ni `with check`, así que quien
--    tiene sesión lee exactamente lo mismo que antes. A `anon` le llega una
--    lista vacía, no un error — igual que le pasa hoy con `profiles`.
--
--    Nada de la app lo necesita: las pantallas previas al inicio de sesión
--    (Splash, Welcome, Tutorial, Register, Login, Verification, las
--    legales) sólo usan Auth y `profiles`, y todas las demás rutas pasan
--    por `withAuthGuard`.
--
--    LO QUE NO SE TOCA, A PROPÓSITO:
--    · `matches` sigue legible sin cuenta (sólo los partidos normales; los
--      de clubes ya son privados desde la 44d). El arnés de la 44d lo exige
--      de forma explícita («anon sigue viendo los partidos normales»), y un
--      partido abierto es justo lo que una vitrina pública mostraría. Ojo
--      con lo que eso deja a la vista: la fila trae `id_organizador`. Queda
--      anotado en el pendiente de abajo.
--    · `clubs`, `club_photos` y lo de recintos (`complejos`,
--      `canchas_reservables`, `cancha_tarifas`, `cancha_horario_reglas`,
--      `complejo_*`) tampoco: no hablan de personas.
--    Las dos cosas son la misma decisión de producto, que sigue abierta
--    (pendiente P2: «¿tiene FutFinder superficie pública sin cuenta?»). Si
--    la respuesta es no, se cierran igual que estas tres. Si es sí, lo
--    correcto es una función que devuelva sólo lo que se quiere mostrar, no
--    la tabla entera.
--
-- 2. `is_blocked_pair(a, b)` RESPONDÍA POR CUALQUIER PAR.
--    La 95 se la cerró a `anon`, pero cualquiera con cuenta podía
--    preguntar por `/rest/v1/rpc/is_blocked_pair` si la persona X tiene
--    bloqueada a la persona Y, para todo par de ids, y así dibujar el
--    grafo de bloqueos completo. La política de `blocked_users` dice que
--    un bloqueo sólo lo ve quien lo hizo; la función se saltaba eso.
--
--    Sus dos únicos usos son la política `friendships_insert` (con
--    `requester_id`, que la misma política obliga a ser quien inserta) y
--    `desbloquear_usuario()` (con `auth.uid()`): en los dos, quien pregunta
--    es una de las dos personas del par. Ahora la función exige eso. A un
--    tercero le contesta `false` siempre. Sin sesión (`auth.uid()` nulo:
--    cron, `service_role`, el editor SQL) contesta la verdad, porque ahí
--    no hay a quién esconderle nada y `anon` ya no la ejecuta.
--
--    No se revoca el EXECUTE: la política se evalúa con el rol de quien
--    inserta, y sin el privilegio nadie podría mandar una solicitud de
--    amistad (misma razón que da la 95).
--
-- 3. LA GALERÍA DE PERFIL ACEPTABA CUALQUIER ARCHIVO DE CUALQUIER TAMAÑO.
--    `profile-gallery` es el único bucket que nació (migración 23) sin
--    `file_size_limit` ni `allowed_mime_types`. Es público: una persona con
--    cuenta podía subir a su carpeta un HTML, un SVG con script o un
--    archivo de varios gigas, y quedaba servido desde el dominio de
--    Supabase del proyecto. Queda como `avatars`: 5 MB e imágenes. La app
--    siempre recodifica a JPEG antes de subir (`src/services/gallery.js`),
--    y lo más grande que hay hoy en el bucket pesa 5.051.101 bytes, bajo
--    el tope. El límite rige para lo que se suba desde ahora; no borra
--    nada.
--
-- Pruebas: supabase/tests/171_sin_cuenta_no_se_lee_a_las_personas_test.sql
-- =============================================================

-- ── 1. Las tres lecturas dejan de ser para `public` ──
alter policy "attendees_read_si_veo_el_partido" on public.attendees to authenticated;
alter policy "club_members_read" on public.club_members to authenticated;
alter policy "profile_photos_select" on public.profile_photos to authenticated;

-- ── 2. El bloqueo sólo se le contesta a quien es parte ──
create or replace function public.is_blocked_pair(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
    select case
        -- Con sesión y sin ser ninguna de las dos personas: no se contesta.
        when (select auth.uid()) is not null
             and (select auth.uid()) is distinct from a
             and (select auth.uid()) is distinct from b
        then false
        else exists (
            select 1 from public.blocked_users
             where (blocker_id = a and blocked_id = b)
                or (blocker_id = b and blocked_id = a)
        )
    end;
$$;

-- `create or replace` conserva los privilegios; se reafirman por si una base
-- nueva llega acá con otros (mismo criterio que la 95).
revoke execute on function public.is_blocked_pair(uuid, uuid) from public;
revoke execute on function public.is_blocked_pair(uuid, uuid) from anon;
grant execute on function public.is_blocked_pair(uuid, uuid) to authenticated;

-- ── 3. La galería de perfil, con tope y sólo imágenes ──
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'profile-gallery';
