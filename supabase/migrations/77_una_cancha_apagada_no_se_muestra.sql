-- =============================================================
-- FutFinder migration 77: una cancha apagada no se le muestra al jugador
-- =============================================================
-- LA POLICY DE `canchas_reservables` FILTRA POR RECINTO PUBLICADO PERO NO
-- POR `activa`. La 65 la acotó a los complejos publicados —correcto— y ahí
-- quedó: cualquiera puede leer una cancha que su recinto sacó de
-- circulación, con su nombre y su precio.
--
-- No estaba rompiendo nada visible: `buscar_complejos` cuenta solo las
-- activas, `getComplejoById` filtra por `activa` antes de mostrarlas y
-- `get_disponibilidad_cancha` rechaza una cancha apagada. O sea que las
-- tres puertas por las que pasa la app ya hacían lo correcto y la policy
-- era la única que no. Eso es exactamente lo que hay que corregir: la
-- policy tiene que decir lo mismo que el resto, no confiar en que quien
-- consulta va a filtrar.
--
-- Se parte en dos, con la misma forma que dejó la 76 (y por la misma
-- razón: `es_admin_cancha` está concedida solo a `authenticated`, así
-- que su rama no puede ir en un `or` con la pública):
--
--   · pública: activa Y de un complejo publicado;
--   · `to authenticated`: quien administra la cancha las ve todas.
--
-- QUÉ NO SE ROMPE. El panel del recinto lee sus canchas por
-- `admin_canchas_complejo` (migración 72), que es `security definer` y se
-- salta la RLS, así que sigue viendo las apagadas para poder encenderlas.
-- Y las reservas viejas de una cancha apagada llegan por las RPC de la
-- agenda, que también son `security definer`.
--
-- Idempotente: seguro de re-ejecutar.
-- =============================================================

drop policy if exists "canchas_reservables_select" on public.canchas_reservables;
drop policy if exists "canchas_reservables_select_publico" on public.canchas_reservables;
drop policy if exists "canchas_reservables_select_admin" on public.canchas_reservables;

create policy "canchas_reservables_select_publico"
    on public.canchas_reservables for select
    using (
        activa
        and exists (
            select 1 from public.complejos c
             where c.id = canchas_reservables.complejo_id and c.publicado
        )
    );

create policy "canchas_reservables_select_admin"
    on public.canchas_reservables for select
    to authenticated
    using (public.es_admin_cancha(id));
