#!/usr/bin/env bash
# Ejecuta la prueba de carga de Susana Segura y guarda los resultados en resultados/<fecha>-<nombre>/.
#
# Uso (Git Bash, desde cualquier carpeta):
#   bash herramientas/load-testing/ejecutar-prueba.sh
#   VUS=100 MANTENER=1m NOMBRE=cien bash herramientas/load-testing/ejecutar-prueba.sh
#   RITMO=maximo PAUSAS=0 VUS=50 NOMBRE=estres bash herramientas/load-testing/ejecutar-prueba.sh
#
# Variables: las de escenarios/susana-segura.js (BASE_URL, VUS, MEZCLA, RAMPA, MANTENER, BAJADA,
# RITMO, PAUSAS, RETORNO) más NOMBRE (sufijo de la carpeta) y K6 (ruta del binario).
# Argumentos extra se pasan a "k6 run" (ej. --scenario video).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K6="${K6:-$DIR/bin/k6.exe}"
[[ -x "$K6" ]] || K6="$(command -v k6 || true)"
[[ -n "$K6" ]] || { echo "No se encontró k6. Ver ORIGEN-k6.md para instalarlo." >&2; exit 1; }

export BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
NOMBRE="${NOMBRE:-prueba}"
SALIDA="$DIR/resultados/$(date +%Y-%m-%d_%H%M%S)-$NOMBRE"
mkdir -p "$SALIDA"

ruta_nativa() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else echo "$1"; fi; }

# Evita medir contra un servidor apagado o contra la URL equivocada.
if ! curl -fsS -o /dev/null --max-time 5 "$BASE_URL/media/videos/catalogo.json"; then
  echo "El servidor $BASE_URL no responde o no tiene media/videos/catalogo.json." >&2
  echo "Arranca 'wrangler-local' (o 'sitio-estatico') y procesa los videos antes de medir." >&2
  exit 1
fi

{
  echo "fecha: $(date -Iseconds)"
  echo "base_url: $BASE_URL"
  for v in VUS MEZCLA RAMPA MANTENER BAJADA RITMO PAUSAS RETORNO; do echo "$v: ${!v:-(por defecto)}"; done
  echo "k6: $("$K6" version | head -1)"
  echo "args_extra: $*"
} > "$SALIDA/parametros.txt"

# Muestreo de CPU/memoria en segundo plano (solo Windows).
if command -v powershell >/dev/null; then
  powershell -NoProfile -ExecutionPolicy Bypass -File "$(ruta_nativa "$DIR/muestrear-procesos.ps1")" \
    -Salida "$(ruta_nativa "$SALIDA/procesos.csv")" &
fi

cd "$DIR"
set +e
K6_WEB_DASHBOARD=true \
K6_WEB_DASHBOARD_OPEN=false \
K6_WEB_DASHBOARD_EXPORT="$(ruta_nativa "$SALIDA/informe.html")" \
  "$K6" run --no-color -q \
    --summary-export "$(ruta_nativa "$SALIDA/resumen.json")" \
    "$@" escenarios/susana-segura.js 2>&1 | tee "$SALIDA/consola.txt"
CODIGO=${PIPESTATUS[0]}
set -e
wait || true

if command -v node >/dev/null; then
  node "$DIR/resumir.mjs" "$SALIDA" > "$SALIDA/resumen.md" && cat "$SALIDA/resumen.md"
fi

echo
echo "Resultados en: $SALIDA"
# k6 sale con 99 cuando algún umbral falla.
exit "$CODIGO"
