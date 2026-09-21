-- 124. Un partido cancelado no se califica, tampoco en el servidor.
--
-- N10 de la revisión del 21 de septiembre de 2026. La revisión demostró la
-- parte de interfaz —el detalle de un partido cancelado ofrecía «Calificar a
-- los jugadores»— y dejó anotado su límite: no probaba que Supabase aceptara
-- guardar esas evaluaciones, porque la política de `ratings` no estaba
-- versionada en el repositorio.
--
-- COMPROBADO EL 2026-09-21 LEYENDO `pg_policy`: sí las aceptaba. El `with
-- check` de `ratings_insert_eligible` exigía tres cosas —ser uno mismo, que
-- los dos hayan confirmado GPS en ese partido, y que hayan pasado 90 minutos
-- desde la hora— y ninguna mira el estado. La cancelación conserva a los
-- asistentes con `confirmado_gps`, así que dos jugadores que alcanzaron a
-- marcar GPS antes de que el organizador cancelara podían calificarse por un
-- partido que no se jugó, y esas notas entran al promedio público del otro.
--
-- Acá se versiona la política tal como estaba y se le agrega la condición que
-- le faltaba. Lo demás no se toca: quién puede leer, editar su comentario y
-- borrar el propio queda igual.
--
-- Regresión: supabase/tests/124_no_se_califica_un_partido_que_no_se_jugo_test.sql

drop policy if exists "ratings_insert_eligible" on public.ratings;
create policy "ratings_insert_eligible"
    on public.ratings for insert
    to authenticated
    with check (
        rater_id = auth.uid()
        and rater_id <> rated_id
        and exists (
            select 1
              from public.attendees a_self
              join public.attendees a_other
                on a_other.id_partido = a_self.id_partido
               and a_other.id_jugador = ratings.rated_id
             where a_self.id_partido = ratings.match_id
               and a_self.id_jugador = ratings.rater_id
               and a_self.estado = 'confirmado_gps'
               and a_other.estado = 'confirmado_gps'
        )
        and exists (
            select 1 from public.matches m
             where m.id = ratings.match_id
               and m.hora <= now() - interval '90 minutes'
               -- Lo nuevo: el partido tiene que haberse jugado.
               and m.estado <> 'cancelado'
        )
    );
