-- =============================================================
-- 156. EL NIVEL LO FIJA QUIEN PROPONE
--
-- QUÉ PASABA. Un encuentro entre clubes no acordaba el nivel en ninguna
-- parte: `club_challenge_proposals` no tenía la columna y
-- `aprobar_propuesta()` creaba el `matches` sin `nivel`, así que quedaba
-- el `default 'recreativo'` de la tabla. Los nueve partidos de clubes que
-- existen están los nueve en `recreativo` y **ninguno por elección**. La
-- tarjeta del historial lo mostraba como «tipo de partido», así que un
-- encuentro competitivo se leía «Recreativo»: un valor por omisión
-- disfrazado de dato. En la 6.3 se dejó de pintar (ver `NIVEL_POR_OMISION`
-- en `src/utils/historialClub.js`), que tapaba el síntoma sin resolverlo.
--
-- LA DECISIÓN (Vicente, 2026-10-14): **lo fija quien propone y no se
-- negocia**, igual que la modalidad. El club rival lo ve antes de aceptar
-- —la propuesta entera se le muestra— pero no lo contrapropone. Menos ida
-- y vuelta entre los dos clubes, y menos código, a cambio de que quien
-- recibe no pueda ajustarlo sin rechazar la propuesta entera.
--
-- `null` NO ES `'recreativo'`, Y ESA ES LA PARTE QUE IMPORTA. La columna
-- nueva admite nulo y nace nula: significa «no se eligió», que es
-- exactamente lo que pasa con las propuestas viejas y con quien no toque
-- el campo. Poner `'recreativo'` por defecto habría repetido el problema
-- que esta migración viene a cerrar. Sólo al crear el `matches` se cae a
-- `'recreativo'`, porque esa tabla sí tiene ese valor por omisión desde
-- siempre y cambiarlo sería otra migración y otra conversación.
--
-- SE PARCHEAN LOS CUERPOS DESPLEGADOS, NO SE REESCRIBEN. Las dos
-- funciones miden 7 KB y 12 KB; transcribirlas entera es la forma más
-- fácil de introducir un error que nadie va a notar. Cada `replace` lleva
-- su ancla y **la migración falla si el ancla no existe o aparece más de
-- una vez**, así que no puede aplicarse a medias ni sobre una versión
-- distinta de la que se probó.
--
-- Idempotente: seguro de re-ejecutar. Los `replace` no encuentran su ancla
-- la segunda vez —ya está reemplazada— así que se comprueba primero si el
-- trabajo ya está hecho y se sale sin tocar nada.
-- Pruebas: supabase/tests/156_el_nivel_lo_fija_quien_propone_test.sql
-- =============================================================

-- ── 1. La columna ────────────────────────────────────────────────
alter table public.club_challenge_proposals
  add column if not exists nivel text;

alter table public.club_challenge_proposals
  drop constraint if exists club_challenge_proposals_nivel_check;
alter table public.club_challenge_proposals
  add constraint club_challenge_proposals_nivel_check
  check (nivel is null or nivel = any (array['recreativo','intermedio','competitivo']));

comment on column public.club_challenge_proposals.nivel is
  'Nivel del encuentro, elegido por quien propone y no negociable. NULL significa que no se eligio: no es lo mismo que recreativo (migracion 156).';

-- ── 2. Las dos funciones, parcheadas sobre lo desplegado ─────────
do $$
declare
  v_src text;
  v_out text;
begin
  -- Cada ancla tiene que aparecer EXACTAMENTE una vez: cero significa que la
  -- función desplegada no es la que se probó, y dos que el reemplazo tocaría
  -- algo que nadie miró.
  -- crear_propuesta_oficial: guarda el nivel que viene en el jsonb.
  if (select count(*) from pg_attribute
       where attrelid = 'public.club_challenge_proposals'::regclass
         and attname = 'nivel' and not attisdropped) = 0 then
    raise exception 'La columna nivel no existe; el paso 1 no se aplicó';
  end if;

  v_src := pg_get_functiondef('public.crear_propuesta_oficial(uuid,jsonb,uuid)'::regprocedure);

  if position('p_payload ->> ''nivel''' in v_src) > 0 then
    raise notice '156: crear_propuesta_oficial ya estaba parcheada; no se toca';
  else
    if (length(v_src) - length(replace(v_src, 'instrucciones, client_token, proponente_juega', ''))) 
       / length('instrucciones, client_token, proponente_juega') <> 1 then
      raise exception '156: el ancla de columnas de crear_propuesta_oficial no aparece exactamente una vez';
    end if;
    if (length(v_src) - length(replace(v_src, 'coalesce((p_payload ->> ''proponente_juega'')::boolean, false)', '')))
       / length('coalesce((p_payload ->> ''proponente_juega'')::boolean, false)') <> 1 then
      raise exception '156: el ancla de valores de crear_propuesta_oficial no aparece exactamente una vez';
    end if;

    v_out := replace(v_src,
      'instrucciones, client_token, proponente_juega',
      'instrucciones, client_token, proponente_juega, nivel');
    v_out := replace(v_out,
      'coalesce((p_payload ->> ''proponente_juega'')::boolean, false)',
      'coalesce((p_payload ->> ''proponente_juega'')::boolean, false),'
      || E'\n            nullif(trim(coalesce(p_payload ->> ''nivel'', '''')), '''')');
    execute v_out;
  end if;

  -- aprobar_propuesta: lo lleva al partido que crea.
  v_src := pg_get_functiondef('public.aprobar_propuesta(uuid,boolean)'::regprocedure);

  if position('v_prop.nivel' in v_src) > 0 then
    raise notice '156: aprobar_propuesta ya estaba parcheada; no se toca';
  else
    if (length(v_src) - length(replace(v_src, 'challenge_id, challenge_proposal_id', '')))
       / length('challenge_id, challenge_proposal_id') <> 1 then
      raise exception '156: el ancla de columnas de aprobar_propuesta no aparece exactamente una vez';
    end if;
    if (length(v_src) - length(replace(v_src, 'v_row.club_retador_id, v_row.club_retado_id, v_row.id, v_prop.id', '')))
       / length('v_row.club_retador_id, v_row.club_retado_id, v_row.id, v_prop.id') <> 1 then
      raise exception '156: el ancla de valores de aprobar_propuesta no aparece exactamente una vez';
    end if;

    v_out := replace(v_src,
      'challenge_id, challenge_proposal_id',
      'challenge_id, challenge_proposal_id, nivel');
    -- Si la propuesta no trae nivel —las viejas, y quien no lo elija— el
    -- partido conserva el `recreativo` de siempre. Nada cambia hacia atrás.
    v_out := replace(v_out,
      'v_row.club_retador_id, v_row.club_retado_id, v_row.id, v_prop.id',
      'v_row.club_retador_id, v_row.club_retado_id, v_row.id, v_prop.id,'
      || E'\n        coalesce(v_prop.nivel, ''recreativo'')');
    execute v_out;
  end if;
end $$;
