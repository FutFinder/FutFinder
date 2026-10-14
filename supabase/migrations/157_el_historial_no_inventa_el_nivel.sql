-- =============================================================
-- 157. EL HISTORIAL NO INVENTA EL NIVEL
--
-- SEGUNDA MITAD DE LA 156, Y SIN ELLA LA 156 NO SE PUEDE MOSTRAR.
-- La 156 dejó que quien propone elija el nivel, pero `historial_club()`
-- devuelve `m.nivel`, y en `matches` esa columna tiene
-- `default 'recreativo'`: un partido anterior a la 156 es
-- **indistinguible** de uno donde alguien eligió «recreativo» a
-- conciencia. Volver a pintar el nivel leyendo de ahí repetiría el fallo
-- original —un valor por omisión disfrazado de dato— sólo que ahora con
-- una migración de respaldo que lo hace parecer cierto.
--
-- La verificación que pide el pendiente lo dice con todas sus letras: «un
-- encuentro creado con nivel competitivo se lee Competitivo en el
-- historial de los dos clubes, **y uno anterior a ese cambio no miente**».
--
-- EL ARREGLO: el historial toma el nivel de **la propuesta**, no del
-- partido. `club_challenge_proposals.nivel` admite nulo y las once filas
-- que existían al aplicar la 156 lo tienen nulo, así que un encuentro
-- viejo devuelve `null` y el cliente no pinta nada. Un encuentro nuevo
-- devuelve lo que su proponente eligió.
--
-- NO CAMBIA LA FORMA DE LA RESPUESTA: la columna sigue en la misma
-- posición y con el mismo nombre y tipo. Lo único que cambia es de dónde
-- sale el dato, así que ninguna app instalada se rompe — sólo deja de
-- recibir un «recreativo» que nunca fue verdad.
--
-- Se parchea el cuerpo DESPLEGADO con un ancla que aparece exactamente
-- una vez; si no existe, la migración falla en vez de aplicarse a medias.
--
-- Idempotente: seguro de re-ejecutar.
-- Pruebas: supabase/tests/157_el_historial_no_inventa_el_nivel_test.sql
-- =============================================================

do $$
declare
  v_src text;
  v_out text;
  v_ancla constant text := E'        m.nivel,\n        yo.integrante';
begin
  v_src := pg_get_functiondef('public.historial_club(uuid,integer)'::regprocedure);

  if position('m.challenge_proposal_id' in v_src) > 0
     and position('club_challenge_proposals pr' in v_src) > 0 then
    raise notice '157: historial_club ya estaba parcheada; no se toca';
    return;
  end if;

  if (length(v_src) - length(replace(v_src, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception '157: el ancla de historial_club no aparece exactamente una vez';
  end if;

  v_out := replace(v_src, v_ancla,
    E'        (select pr.nivel from public.club_challenge_proposals pr\n'
    || E'          where pr.id = m.challenge_proposal_id),\n'
    || E'        yo.integrante');
  execute v_out;
end $$;
