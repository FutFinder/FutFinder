#!/usr/bin/env bash
#
# La carrera de dos sesiones sobre los cambios negociados (migración 46).
#
# POR QUÉ ESTO NO ES UN ARCHIVO .sql COMO LOS DEMÁS ARNESES. Los de
# `supabase/tests/` corren en UNA sesión: prueban que el invariante se
# cumple, no la carrera. El invariante lo sostienen tres piezas —el
# `select … for update` sobre el partido, el índice único parcial
# `club_match_changes_pendiente_uidx` y el `update … where estado =
# 'pendiente'`— y ninguna de las tres se puede ejercitar sin dos
# transacciones vivas a la vez.
#
# POR QUÉ NO SE PUDO ANTES. Contra producción no hay forma: `dblink` no está
# instalado —y no se instala para una prueba, porque deja la capacidad de
# abrir conexiones arbitrarias— y `max_prepared_transactions` es 0, así que
# `PREPARE TRANSACTION` tampoco retiene el bloqueo entre llamadas. Hace falta
# una base propia. Desde el 2026-10-14 la hay: ver `scripts/construir-base.mjs`.
#
# CÓMO CORRE. Dos procesos `psql` de verdad, lanzados a la vez con `&`. No se
# orquesta el entrelazado: se lanzan y se mira quién gana. Se repite varias
# veces porque una carrera que no llegó a solaparse no prueba nada, y con
# una sola pasada no se distingue.
#
# Uso:  bash scripts/carrera-dos-sesiones.sh [vueltas]
set -uo pipefail

CT=${CT:-supabase_db_futfinder-local}
VUELTAS=${1:-5}

psqlq() { docker exec -i "$CT" psql -U postgres -d postgres -t -A -q -c "$1" 2>&1; }

# Devuelve el uuid, o NADA. `psqlq` captura stderr, así que sin este filtro
# un error de SQL vuelve como «valor» no vacío y quien pregunte creerá que
# el fixture está. Costó cuatro falsos fallos.
leer() {
  psqlq "select valor from public.carrera_fixture where clave='$1';" \
    | grep -oE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || true
}

MATCH=$(leer match); CH=$(leer challenge)
CA=$(leer club_a);   CB=$(leer club_b)
UA=$(leer user_a);   UB=$(leer user_b)

if [ -z "$MATCH" ]; then
  echo "Sin fixture: sembrando…"
  docker exec -i "$CT" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q \
    < "$(dirname "$0")/carrera-semilla.sql" >/dev/null || { echo "La semilla falló"; exit 1; }
  MATCH=$(leer match); CH=$(leer challenge)
  CA=$(leer club_a);   CB=$(leer club_b)
  UA=$(leer user_a);   UB=$(leer user_b)
fi
if [ -z "$MATCH" ]; then echo "No encuentro el fixture ni pude sembrarlo."; exit 1; fi

# Una sesión: se hace pasar por `usuario` y llama la RPC.
como() {
  local usuario="$1" sql="$2"
  docker exec -i "$CT" psql -U postgres -d postgres -t -A -q -c "
    begin;
    set local role authenticated;
    select set_config('request.jwt.claims',
      json_build_object('sub','$usuario','role','authenticated')::text, true);
    $sql
    commit;" 2>&1 | tail -1
}

fallos=0

echo "═══ CASO 1: dos SOLICITUDES de cambio a la vez ═══"
for i in $(seq 1 "$VUELTAS"); do
  psqlq "delete from public.club_match_changes where match_id='$MATCH';" >/dev/null
  # Una hora DISTINTA en cada vuelta: una aceptación mueve la hora del
  # partido, y proponer la que ya tiene no es un cambio — la RPC lo rechaza
  # con razón y el arnés se lo comería como si fuera un fallo de carrera.
  CAMPOS='{"hora":"2026-11-'$(printf '%02d' $((i+1)))'T20:00:00Z"}'
  como "$UA" "select public.proponer_cambio_partido('$MATCH','$CAMPOS'::jsonb, gen_random_uuid());" > /tmp/c1a.txt &
  como "$UB" "select public.proponer_cambio_partido('$MATCH','$CAMPOS'::jsonb, gen_random_uuid());" > /tmp/c1b.txt &
  wait
  n=$(psqlq "select count(*) from public.club_match_changes where match_id='$MATCH' and estado='pendiente';")
  if [ "$n" != "1" ]; then
    echo "  ✖ vuelta $i: quedaron $n cambios pendientes (se esperaba 1)"
    echo "    A: $(cat /tmp/c1a.txt)"; echo "    B: $(cat /tmp/c1b.txt)"
    fallos=$((fallos+1))
  else
    echo "  ✔ vuelta $i: exactamente 1 pendiente"
  fi
done

echo
echo "═══ CASO 2: dos ACEPTACIONES del mismo cambio a la vez ═══"
for i in $(seq 1 "$VUELTAS"); do
  psqlq "delete from public.club_match_changes where match_id='$MATCH';" >/dev/null
  CAMPOS='{"hora":"2026-12-'$(printf '%02d' $((i+1)))'T20:00:00Z"}'
  como "$UA" "select public.proponer_cambio_partido('$MATCH','$CAMPOS'::jsonb, gen_random_uuid());" >/dev/null
  CID=$(psqlq "select id from public.club_match_changes where match_id='$MATCH' and estado='pendiente' limit 1;")
  if [ -z "$CID" ]; then echo "  ✖ vuelta $i: no se pudo crear el cambio"; fallos=$((fallos+1)); continue; fi

  # Las dos aceptaciones salen del club contrario, a la vez.
  como "$UB" "select public.responder_cambio_partido('$CID', true, null);" > /tmp/c2a.txt &
  como "$UB" "select public.responder_cambio_partido('$CID', true, null);" > /tmp/c2b.txt &
  wait
  aplicados=$(psqlq "select count(*) from public.club_match_changes where id='$CID' and estado='aceptado';")
  # Las dos respuestas pueden decir `ok:true` y eso NO es un fallo: la
  # segunda trae `already`, que es la idempotencia que la 46 promete. Lo que
  # importa es que el cambio se aplicara UNA sola vez.
  yas=$(( $(grep -c 'already' /tmp/c2a.txt) + $(grep -c 'already' /tmp/c2b.txt) ))
  if [ "$aplicados" != "1" ]; then
    echo "  ✖ vuelta $i: el cambio quedó en $aplicados filas aceptadas"
    echo "    A: $(cat /tmp/c2a.txt)"; echo "    B: $(cat /tmp/c2b.txt)"
    fallos=$((fallos+1))
  elif [ "$yas" != "1" ]; then
    echo "  ✖ vuelta $i: se aplicó una vez, pero $yas respuestas traen «already» (se esperaba 1)"
    echo "    A: $(cat /tmp/c2a.txt)"; echo "    B: $(cat /tmp/c2b.txt)"
    fallos=$((fallos+1))
  else
    echo "  ✔ vuelta $i: una aplicó y la otra contestó «already» — idempotente, no doble"
  fi
done

echo
if [ "$fallos" = "0" ]; then
  echo "═══ $((VUELTAS*2))/$((VUELTAS*2)) — el invariante aguanta la carrera ═══"
else
  echo "═══ $fallos FALLOS ═══"; exit 1
fi
