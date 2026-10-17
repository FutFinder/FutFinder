#!/usr/bin/env bash
#
# Corre la suite de arneses con el RELOJ MOVIDO, para cazar los que no
# miden la regla sino la hora o el calendario.
#
# POR QUÉ HACE FALTA. El caso M7 del arnés 86 pasaba de noche y fallaba de
# mañana —ponía la reserva «hoy a las 23:30»—, y ocho arneses del vertical
# de Reservas se habrían puesto rojos el 2 de marzo de 2027 porque su
# escenario estaba clavado en `date '2027-03-01'` y `crear_reserva` rechaza
# el pasado. Ninguna de las dos cosas se ve leyendo el código con cuidado:
# se ven moviendo el reloj.
#
# CÓMO MUEVE EL RELOJ, Y POR QUÉ ASÍ. Postgres lee el reloj del kernel, que
# en esta Mac es el de la máquina virtual de colima. Dos caminos que NO
# funcionan, probados el 2026-10-17:
#
#   · `date -s` a secas: `lima-guestagent` lo devuelve a la hora real en
#     dos segundos. Hay que pararlo (y `docker` desde el host sigue
#     andando sin él, comprobado).
#   · `libfaketime` dentro del contenedor: el postgres de la imagen es de
#     Nix y la libfaketime de Alpine es musl; el proceso revienta con
#     «Fatal glibc error: malloc.c». No insistas.
#
# DEJA LA MÁQUINA COMO ESTABA aunque te vayas con Ctrl-C: repone la hora y
# vuelve a levantar el guestagent y el NTP en un `trap`.
#
# Uso:
#   bash scripts/barrido-reloj.sh horas     # nueve horas del día de hoy
#   bash scripts/barrido-reloj.sh fechas    # nueve fechas, hasta 2029
set -u
cd "$(dirname "$0")/.."

restaurar() {
  echo
  echo "Reponiendo el reloj…"
  colima ssh -- sudo systemctl start lima-guestagent >/dev/null 2>&1
  colima ssh -- sudo timedatectl set-ntp true >/dev/null 2>&1
  colima ssh -- sudo systemctl start systemd-timesyncd >/dev/null 2>&1
  sleep 5
  echo "VM:   $(colima ssh -- date -u 2>&1 | tail -1)"
  echo "host: $(date -u)"
}
trap restaurar EXIT INT TERM

corrida() {   # $1 = fecha UTC, $2 = etiqueta
  colima ssh -- sudo date -u -s "$1" >/dev/null 2>&1
  local real salida res
  real=$(docker exec supabase_db_futfinder-local psql -U postgres -At \
          -c "select to_char(now() at time zone 'America/Santiago','YYYY-MM-DD Dy HH24:MI')" 2>/dev/null)
  salida=$(node scripts/correr-arneses.mjs 2>&1)
  res=$(echo "$salida" | grep "pasaron" | head -1)
  printf '%-28s %s\n' "$2 (la base dice $real)" "$res"
  echo "$salida" | grep -A1 "✖" | grep "_test.sql" | sed 's/^ */      /'
}

echo "Parando lima-guestagent (si no, el reloj vuelve solo en dos segundos)…"
colima ssh -- sudo systemctl stop lima-guestagent >/dev/null 2>&1
colima ssh -- sudo timedatectl set-ntp false >/dev/null 2>&1

case "${1:-horas}" in
  horas)
    HOY=$(date -u +%Y-%m-%d)
    for h in 00 03 06 09 12 15 18 21 23; do
      # Chile es UTC-3: para ver las 00:00 de Chile hay que poner las 03:00 UTC.
      utc=$(( (10#$h + 3) % 24 ))
      dia=$HOY; [ $(( 10#$h + 3 )) -ge 24 ] && dia=$(date -u -v+1d +%Y-%m-%d 2>/dev/null || echo "$HOY")
      corrida "$dia $(printf '%02d' $utc):30:00" "Chile ${h}:30"
    done
    ;;
  fechas)
    for d in 2026-12-31 2027-01-01 2027-02-28 2027-03-02 2027-04-05 \
             2027-06-15 2027-09-06 2028-02-29 2029-07-04; do
      corrida "$d 15:00:00" "$d"
    done
    ;;
  *) echo "Uso: $0 [horas|fechas]"; exit 1 ;;
esac
