#!/usr/bin/env bash
# Prueba de carga contra un nginx igual al de la intranet, con k6 y nginx en Docker.
# Ambos contenedores comparten una red de Docker: no pasa por la red de Windows ni
# por el reenvío de puertos de Docker Desktop.
#
# Uso (Git Bash, desde cualquier carpeta):
#   bash herramientas/load-testing/intranet/ejecutar-prueba-intranet.sh
#   ESCALONES=50,200 MANTENER=1m NOMBRE=corta bash herramientas/load-testing/intranet/ejecutar-prueba-intranet.sh
#
# Valores por defecto de esta prueba (se pueden cambiar con variables de entorno):
#   ESCALONES=50,200,500,1000  RAMPA=30s  MANTENER=90s  CALIDAD=maxima  COPIAS=5
# El resto de variables de escenarios/susana-segura.js también aplica.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LT="$(cd "$DIR/.." && pwd)"
RAIZ="$(cd "$LT/../.." && pwd)"
IMAGEN_SERVIDOR="susana-segura/servidor-prueba"
IMAGEN_K6="grafana/k6:2.3.0"
RED="carga-susana"
SERVIDOR="servidor-susana"
GENERADOR="k6-susana"

export ESCALONES="${ESCALONES:-50,200,500,1000}"
export RAMPA="${RAMPA:-30s}"
export MANTENER="${MANTENER:-90s}"
export CALIDAD="${CALIDAD:-maxima}"
export COPIAS="${COPIAS:-5}"
NOMBRE="${NOMBRE:-intranet}"
CARPETA="$(date +%Y-%m-%d_%H%M%S)-$NOMBRE"
SALIDA="$LT/resultados/$CARPETA"
mkdir -p "$SALIDA"

ruta_nativa() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }
export MSYS_NO_PATHCONV=1   # que Git Bash no reescriba las rutas /pruebas del contenedor

[[ -f "$RAIZ/app-plataforma/media/videos/catalogo.json" ]] || {
  echo "Falta app-plataforma/media/videos/catalogo.json: procesa los videos primero." >&2; exit 1; }

echo "Construyendo $IMAGEN_SERVIDOR…"
docker build -q -f "$(ruta_nativa "$DIR/Dockerfile.servidor")" -t "$IMAGEN_SERVIDOR" "$(ruta_nativa "$RAIZ")" >/dev/null
docker network create "$RED" >/dev/null 2>&1 || true
docker rm -f "$SERVIDOR" "$GENERADOR" >/dev/null 2>&1 || true
docker run -d --name "$SERVIDOR" --network "$RED" "$IMAGEN_SERVIDOR" >/dev/null
trap 'docker rm -f "$SERVIDOR" "$GENERADOR" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 20); do
  docker exec "$SERVIDOR" wget -q -O /dev/null http://127.0.0.1/media/videos/catalogo.json 2>/dev/null && break
  sleep 1
done

NUCLEOS="$(docker info --format '{{.NCPU}}')"
{
  echo "fecha: $(date -Iseconds)"
  echo "servidor: $(docker exec "$SERVIDOR" nginx -v 2>&1) en Docker ($NUCLEOS núcleos, sin límite de CPU)"
  echo "generador: $IMAGEN_K6 en la misma red de Docker"
  for v in ESCALONES RAMPA MANTENER BAJADA CALIDAD COPIAS MEZCLA RITMO PAUSAS RETORNO; do echo "$v: ${!v:-(por defecto)}"; done
  echo "args_extra: $*"
} > "$SALIDA/parametros.txt"

# Muestreo de CPU y memoria de los dos contenedores (mismo formato que muestrear-procesos.ps1).
muestrear() {
  local archivo="$SALIDA/procesos.csv"
  echo "marca,proceso,cpu_pct_equipo,memoria_mb,cpu_total_pct" > "$archivo"
  sleep 5
  while [[ -n "$(docker ps -q -f "name=^${GENERADOR}$")" ]]; do
    docker stats --no-stream --format '{{.Name}};{{.CPUPerc}};{{.MemUsage}}' "$SERVIDOR" "$GENERADOR" 2>/dev/null |
      awk -F';' -v n="$NUCLEOS" -v t="$(date +%H:%M:%S)" '{
        cpu = $2; sub("%", "", cpu)
        split($3, m, " / "); mem = m[1] + 0
        if (m[1] ~ /GiB/) mem *= 1024; else if (m[1] ~ /KiB/) mem /= 1024
        printf "%s,%s,%.1f,%.1f,\n", t, $1, cpu / n, mem
      }' >> "$archivo" || true
  done
}
muestrear &
MUESTREO=$!

set +e
docker run --rm --name "$GENERADOR" --network "$RED" \
  -v "$(ruta_nativa "$LT"):/pruebas" -w /pruebas \
  -e BASE_URL="http://$SERVIDOR" \
  -e ESCALONES -e RAMPA -e MANTENER -e BAJADA -e CALIDAD -e COPIAS -e MEZCLA -e RITMO -e PAUSAS -e RETORNO -e VUS \
  -e K6_WEB_DASHBOARD=true -e K6_WEB_DASHBOARD_OPEN=false \
  -e K6_WEB_DASHBOARD_EXPORT="/pruebas/resultados/$CARPETA/informe.html" \
  "$IMAGEN_K6" run --no-color -q \
    --summary-export "/pruebas/resultados/$CARPETA/resumen.json" \
    "$@" escenarios/susana-segura.js 2>&1 | tee "$SALIDA/consola.txt"
CODIGO=${PIPESTATUS[0]}
set -e
wait "$MUESTREO" 2>/dev/null || true

# El JSON lo escribe el contenedor en un montaje de Windows y puede tardar en verse completo.
if command -v node >/dev/null; then
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    node "$LT/resumir.mjs" "$SALIDA" > "$SALIDA/resumen.md" 2>/dev/null && break
    sleep 2
  done
  cat "$SALIDA/resumen.md"
fi
echo
echo "Resultados en: $SALIDA"
exit "$CODIGO"
