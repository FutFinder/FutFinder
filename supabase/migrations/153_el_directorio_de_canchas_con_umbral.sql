-- =============================================================
-- 153. UN DIRECTORIO DE CANCHAS CON UMBRAL DE ENTRADA
--
-- QUÉ PASABA. `trg_register_cancha` mete una fila en `public.canchas` por
-- cada partido publicado, con el nombre de cancha que el organizador
-- escribió a mano, y ese directorio alimenta el autocompletado de
-- `LocationAutocomplete` al publicar un partido. Como no hay ningún
-- filtro, al publicar te podían ofrecer «Nsjsjsj» o «jnkj» como cancha:
-- de las 17 filas de producción, casi todas son basura de prueba o
-- nombres tecleados con error.
--
-- Y no había salida: `canchas` tiene UNA sola política, `canchas_select_any`,
-- así que RLS bloquea el borrado aunque `authenticated` tenga el privilegio
-- `delete`. No faltaba un `grant`, faltaba una política — conviene decirlo
-- porque la nota de pendientes lo contaba al revés.
--
-- LA DECISIÓN (Vicente, 2026-10-04): umbral de entrada, no puerta de
-- salida. Una cancha entra al directorio público cuando la han usado
-- **dos organizadores distintos**. La basura se corta en la fuente, sin
-- juzgar el texto —«jnkj» no se distingue de un nombre raro de verdad— y
-- sin pantallas nuevas. Se acepta a cambio que una cancha real tarde un
-- partido más en aparecer; mientras tanto el autocompletado sigue
-- ofreciendo las de Mapbox, que es de donde salen casi todas.
--
-- POR QUÉ DOS ORGANIZADORES Y NO DOS USOS. `usos_count` ya existe y no
-- sirve para esto: `tangus` tiene 2 usos y UN solo organizador. Una
-- persona publicando cinco partidos en su cancha inventada la ascendería
-- sola. El umbral tiene que contar personas.
--
-- POR QUÉ UNA TABLA Y NO UN CONTADOR. `canchas.usos_count` se queda como
-- está y no se toca. Para contar personas hace falta saber QUIÉNES, no
-- cuántas veces, y un contador denormalizado se desincroniza el día que
-- alguien recalcule. `cancha_usos` es la fuente y su clave primaria ya es
-- el índice que la consulta necesita.
--
-- EL UMBRAL VIVE EN `search_canchas`, NO EN LA RLS. La fila tiene que
-- existir desde el primer uso para poder acumular el segundo; lo que se
-- filtra es qué se SUGIERE. Mover esto a la política habría impedido que
-- una cancha llegara nunca a su segundo organizador.
--
-- NO SE BORRA NINGUNA FILA AQUÍ. Las 17 que ya están se revisan aparte y
-- a mano: borrar datos de producción no es trabajo de una migración
-- idempotente que alguien puede volver a correr.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/153_el_directorio_de_canchas_con_umbral_test.sql
-- =============================================================

-- ── 1. Quién ha usado cada cancha ────────────────────────────────
create table if not exists public.cancha_usos (
  cancha_id  uuid not null references public.canchas(id) on delete cascade,
  user_id    uuid not null references auth.users(id)     on delete cascade,
  created_at timestamptz not null default now(),
  primary key (cancha_id, user_id)
);

alter table public.cancha_usos enable row level security;
-- Sin políticas y sin privilegios: la app no necesita saber quién usó qué
-- cancha, y publicarlo diría dónde juega cada persona. Lo escribe el
-- disparador, que es `security definer`.
revoke all on public.cancha_usos from public, anon, authenticated;

comment on table public.cancha_usos is
  'Que organizadores han usado cada cancha. Es la fuente del umbral de entrada al directorio publico: una cancha se sugiere cuando la usaron dos personas distintas (migracion 153).';

-- ── 2. El disparador también anota quién ─────────────────────────
create or replace function public.tg_register_cancha()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_cancha_id uuid;
begin
  -- Ni la exacta ni la aproximada: meter un punto redondeado en el
  -- buscador público ensuciaría el buscador con una ubicación que no es
  -- la de ninguna cancha real.
  if new.challenge_proposal_id is not null then return new; end if;

  if new.cancha_nombre is null or trim(new.cancha_nombre) = '' then return new; end if;
  if new.latitud is null or new.longitud is null then return new; end if;

  insert into public.canchas (nombre, direccion, comuna, region, latitud, longitud, created_by)
  values (new.cancha_nombre, new.direccion, new.comuna, new.region,
          new.latitud, new.longitud, new.id_organizador)
  on conflict (nombre_norm, comuna) do update
    set usos_count = canchas.usos_count + 1,
        updated_at = now(),
        latitud   = coalesce(canchas.latitud,   excluded.latitud),
        longitud  = coalesce(canchas.longitud,  excluded.longitud),
        direccion = coalesce(canchas.direccion, excluded.direccion),
        region    = coalesce(canchas.region,    excluded.region)
  returning id into v_cancha_id;

  -- El par, no el conteo. Repetir la misma cancha no asciende a nadie:
  -- la clave primaria se encarga.
  if v_cancha_id is not null and new.id_organizador is not null then
    insert into public.cancha_usos (cancha_id, user_id)
    values (v_cancha_id, new.id_organizador)
    on conflict do nothing;
  end if;

  return new;
end;
$function$;

-- ── 3. El umbral, al sugerir ─────────────────────────────────────
create or replace function public.search_canchas(p_query text, p_limit integer default 5)
returns table(id uuid, nombre text, direccion text, comuna text, region text,
              latitud double precision, longitud double precision, usos_count integer)
language plpgsql
stable
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

comment on function public.search_canchas(text, integer) is
  'Sugiere canchas del directorio al publicar un partido. Solo las que usaron DOS organizadores distintos: el umbral corta en la fuente los nombres tecleados por error, que llenaban el directorio (migracion 153).';

-- ── 4. Relleno con lo que los partidos todavía recuerdan ─────────
-- Sin esto, cada cancha existente quedaría en cero organizadores y el
-- directorio nacería vacío aunque haya historia real. Las mismas
-- condiciones del disparador, para no inventar usos que él no habría
-- anotado. `on conflict do nothing` lo hace repetible.
insert into public.cancha_usos (cancha_id, user_id)
select c.id, m.id_organizador
  from public.matches m
  join public.canchas c
    on c.nombre_norm = public.norm_text(m.cancha_nombre)
   and c.comuna is not distinct from m.comuna
 where m.challenge_proposal_id is null
   and m.cancha_nombre is not null and trim(m.cancha_nombre) <> ''
   and m.latitud is not null and m.longitud is not null
   and m.id_organizador is not null
 group by c.id, m.id_organizador
on conflict do nothing;
