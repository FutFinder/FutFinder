-- =============================================================
-- 144. QUIEN ORGANIZA UN PARTIDO TIENE NOMBRE
--
-- La migración 143 cerró `profiles` a la relación. Con eso, el nombre y
-- la foto de quien ORGANIZA un partido abierto desaparecen de la tarjeta
-- para todo el que no esté inscrito, si esa persona apagó «Visible en
-- búsquedas»: `withOrganizers()` lee `profiles` directo, y ahí ya no hay
-- relación que valga. Hoy no le pasa a nadie —las 32 cuentas están
-- descubribles— pero es un hueco esperando a que alguien use el
-- interruptor.
--
-- LA REGLA: publicar un partido es un acto público. Si la ficha del
-- partido se puede ver, se puede ver de quién es. Lo que NO se sigue de
-- ahí es que se entregue la fila entera del perfil, y por eso esto es una
-- función que devuelve TRES columnas —usuario, foto y puntaje, las que la
-- tarjeta dibuja— y no una relación más en `perfil_relacionado()`. Una
-- relación abre el perfil completo; acá alcanza con la identidad.
--
-- LA VISIBILIDAD DEL PARTIDO SE COMPRUEBA, NO SE SUPONE. La función es
-- `security definer`, así que la RLS de `matches` no la alcanza y hay que
-- repetir su regla a mano: un partido normal lo ve cualquiera; uno nacido
-- de un desafío, sólo los integrantes de los dos clubes. Es la misma
-- condición de `matches_read_publico_o_de_mi_club`. Si esa política
-- cambia, ESTA FUNCIÓN HAY QUE CAMBIARLA TAMBIÉN — el arnés tiene un caso
-- que lo vigila (un partido de clubes ajeno no entrega su organizador).
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/144_quien_organiza_un_partido_tiene_nombre_test.sql
-- =============================================================

create or replace function public.organizadores_publicos(p_match_ids uuid[])
returns table (
  id_partido  uuid,
  id          uuid,
  username    text,
  foto_url    text,
  trust_score integer
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, p.id, p.username, p.foto_url, p.trust_score
    from public.matches m
    join public.profiles p on p.id = m.id_organizador
   where auth.uid() is not null
     and m.id = any (coalesce(p_match_ids, array[]::uuid[]))
     -- Misma condición que `matches_read_publico_o_de_mi_club`.
     and (
       m.challenge_proposal_id is null
       or exists (
         select 1 from public.club_members cm
          where cm.user_id = auth.uid()
            and cm.club_id = any (array[m.club_local_id, m.club_visitante_id])
       )
     );
$$;

revoke all on function public.organizadores_publicos(uuid[]) from public, anon;
grant execute on function public.organizadores_publicos(uuid[]) to authenticated;

comment on function public.organizadores_publicos(uuid[]) is
  'Identidad publica (usuario, foto, puntaje) de quien organiza cada partido dado, solo para los partidos que quien llama puede ver. Existe porque la migracion 143 cerro profiles a la relacion y la tarjeta de un partido abierto perderia el nombre de su organizador (migracion 144).';
