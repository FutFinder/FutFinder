-- =============================================================
-- 172. LA COLA SE LE MUESTRA A QUIEN VE EL PARTIDO
--
-- Segunda pasada de seguridad (2026-11-09), punto «`lista_de_espera()` no
-- mira si quien llama puede ver el partido».
--
-- QUÉ PASABA. `lista_de_espera(p_match_id)` es `security definer` (tiene
-- que serlo: cruza `match_waitlist` con `profiles` para ordenar por
-- TrueScore, y desde la 143 el perfil de un desconocido no se lee) y lo
-- único que miraba era el id del partido. La tabla, en cambio, sí tiene
-- regla: la política `waitlist_select` sólo deja leer la cola de un partido
-- que quien pregunta puede ver, y `matches_read_publico_o_de_mi_club` dice
-- que un partido de clubes sólo existe para los integrantes de sus dos
-- clubes. La función se saltaba las dos: con el id de un partido de clubes
-- ajeno devolvía quién espera y con qué prioridad.
--
-- QUÉ TAN GRAVE ERA, DICHO COMO ES. Poco. Hay que conocer el id, y además
-- un partido de clubes NO puede tener cola: el disparador
-- `trg_waitlist_no_en_partido_de_clubes` (44d) rechaza el insert. En
-- producción, el 2026-11-09, `match_waitlist` tenía cero filas en partidos
-- de clubes (y cero en total). Así que hoy la función contestaba una lista
-- vacía por dos motivos y sólo uno era una regla. Esto es cerrar la puerta
-- que dependía de que la otra siguiera cerrada: si mañana una migración
-- cambia el disparador, o los partidos de clubes ganan lista de espera, la
-- función ya no filtra nada por su cuenta.
--
-- QUÉ CAMBIA. La función devuelve filas sólo si quien llama podría ver ese
-- partido, con la MISMA condición de la política de `matches`: partido
-- normal, o integrante de uno de los dos clubes. A quien no lo ve le llega
-- una lista vacía, no un error — igual que le pasa leyendo la tabla.
--
-- SIN SESIÓN (`auth.uid()` nulo: cron, `service_role`, el editor SQL) se
-- contesta la verdad, mismo criterio que la 171 con `is_blocked_pair`: ahí
-- no hay a quién esconderle nada y `anon` no ejecuta la función desde la
-- 114.
--
-- A QUIÉN MÁS LLAMA, REVISADO UNO POR UNO (catálogo, 2026-11-09):
--   · `join_waitlist` es la única función que la usa, para devolver la
--     posición de quien acaba de entrar. Corre con la sesión de esa persona
--     y sobre un partido normal (uno de clubes ya rebotó en el disparador),
--     que siempre puede ver. No cambia.
--   · `avanzar_lista_de_espera`, `barrer_lista_de_espera` (el cron),
--     `leave_waitlist` y `notify_waitlist_slot_free` NO la llaman: leen
--     `match_waitlist` directo. El turno de la cola no pasa por acá.
--   · `perfil_relacionado` sólo la nombra en un comentario.
--   · El cliente la llama desde `getWaitlist` (`src/services/matches.js`),
--     en el detalle de un partido que ya está viendo.
--
-- La firma no cambia (mismas columnas, mismo orden), así que es un
-- `create or replace` y conserva los privilegios.
--
-- Pruebas: supabase/tests/172_la_cola_se_le_muestra_a_quien_ve_el_partido_test.sql
-- =============================================================

create or replace function public.lista_de_espera(p_match_id uuid)
returns table(
  id uuid,
  id_jugador uuid,
  created_at timestamptz,
  avisado_at timestamptz,
  confirmar_antes_de timestamptz,
  prioridad boolean,
  posicion integer
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.id_jugador, w.created_at, w.avisado_at, w.confirmar_antes_de, x.prio,
         (row_number() over (order by x.prio desc, w.created_at))::int
    from public.match_waitlist w
    join public.profiles p on p.id = w.id_jugador
    cross join lateral (select public.truescore_prioridad_espera(p.trust_score) as prio) x
   where w.id_partido = p_match_id
     and (
       -- Sin sesión no hay a quién esconderle la cola (cron, service_role).
       (select auth.uid()) is null
       -- Con sesión: la misma regla que `matches_read_publico_o_de_mi_club`.
       or exists (
         select 1
           from public.matches m
          where m.id = p_match_id
            and (
              m.challenge_proposal_id is null
              or exists (
                select 1
                  from public.club_members cm
                 where cm.user_id = (select auth.uid())
                   and cm.club_id = any (array[m.club_local_id, m.club_visitante_id])
              )
            )
       )
     )
   order by x.prio desc, w.created_at;
$$;

-- `create or replace` conserva los privilegios; se reafirman por si una base
-- nueva llega acá con otros (mismo criterio que la 95 y la 171).
revoke execute on function public.lista_de_espera(uuid) from public;
revoke execute on function public.lista_de_espera(uuid) from anon;
grant execute on function public.lista_de_espera(uuid) to authenticated;
