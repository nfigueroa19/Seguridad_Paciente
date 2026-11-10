#!/usr/bin/env bash
# =====================================================================
#  SUSANA SEGURA: pipeline de videos para la web (HLS adaptativo)
#
#  Toma cada video de la carpeta de entrada y genera, por video:
#    <salida>/<slug>/master.m3u8         lista maestra (ABR)
#    <salida>/<slug>/index_<kbps>.m3u8   lista por resolución
#    <salida>/<slug>/seg_<kbps>_NNNNN.ts segmentos de SEGUNDOS s
#    <salida>/<slug>/poster.webp         imagen de portada
#    <salida>/<slug>/video.json          metadatos (futura fila SQL)
#  y al final <salida>/catalogo.json con todos los videos.
#
#  El transcodificado lo hace HLS-Stream-Creator (vendor/, BSD-3) sin
#  modificaciones; este wrapper fija los parámetros web y valida los
#  límites de Cloudflare Workers static assets.
#
#  Uso:   herramientas/video/procesar-videos.sh [ENTRADA] [SALIDA]
#  Por defecto: ENTRADA=videos-fuente  SALIDA=app-plataforma/media/videos
#
#  Variables opcionales:
#    SEGUNDOS=6      duración de cada segmento
#    CRF=23          calidad x264 (menor = mejor y más pesado)
#    ESCALERA="360:800 720:2400 1080:4500"   alto:kbps_máximo
#    PRESET=medium   preset de x264
#    FORZAR=1        reprocesa aunque el video no haya cambiado
# =====================================================================
set -euo pipefail

DIR_SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$DIR_SCRIPT/../.." && pwd)"
HLSC="$DIR_SCRIPT/vendor/HLS-Stream-Creator/HLS-Stream-Creator.sh"

ENTRADA="${1:-$RAIZ/videos-fuente}"
SALIDA="${2:-$RAIZ/app-plataforma/media/videos}"
SEGUNDOS="${SEGUNDOS:-6}"
CRF="${CRF:-23}"
ESCALERA="${ESCALERA:-360:800 720:2400 1080:4500}"
PRESET="${PRESET:-medium}"
FORZAR="${FORZAR:-0}"
RUTA_WEB="${RUTA_WEB:-media/videos}"   # ruta pública relativa a app-plataforma/

LIMITE_ARCHIVO=$((25 * 1024 * 1024))   # 25 MiB por archivo (Workers static assets)
LIMITE_ARCHIVOS=20000                  # archivos por versión (plan Free)

for herramienta in ffmpeg ffprobe; do
  command -v "$herramienta" >/dev/null || { echo "Error: falta $herramienta en el PATH" >&2; exit 1; }
done
[ -f "$HLSC" ] || { echo "Error: no se encuentra $HLSC" >&2; exit 1; }
[ -d "$ENTRADA" ] || { echo "Error: no existe la carpeta de entrada $ENTRADA" >&2; exit 1; }
mkdir -p "$SALIDA"
# Rutas absolutas: el transcodificado cambia de carpeta (cd "$tmp") y una ruta relativa dejaría de apuntar a su destino.
ENTRADA="$(cd "$ENTRADA" && pwd)"
SALIDA="$(cd "$SALIDA" && pwd)"

# ---------- utilidades ----------
slug() {
  printf '%s' "$1" \
    | sed -E 's/Á|á|À|à/a/g; s/É|é|È|è/e/g; s/Í|í|Ì|ì/i/g; s/Ó|ó|Ò|ò/o/g; s/Ú|ú|Ù|ù|Ü|ü/u/g; s/Ñ|ñ/n/g' \
    | tr '[:upper:]' '[:lower:]' \
    | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//'
}

json_texto() {   # escapa un texto para JSON
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\t'/ }"; s="${s//$'\n'/ }"
  printf '"%s"' "$s"
}

sonda() {   # sonda <archivo> <entradas> -> valor
  ffprobe -v error -select_streams v:0 -show_entries "$2" -of default=nw=1:nk=1 "$1" | head -n1 | tr -d '\r'
}

huella() {   # tamaño + fecha de modificación: detecta cambios sin leer el archivo entero
  stat -c '%s-%Y' "$1"
}

# ---------- proceso por video ----------
procesados=0; omitidos=0; fallidos=0

shopt -s nullglob nocaseglob
fuentes=("$ENTRADA"/*.{mp4,mov,mkv,avi,webm,m4v,wmv,mpg,mpeg})
shopt -u nocaseglob
[ ${#fuentes[@]} -gt 0 ] || { echo "No hay videos en $ENTRADA"; }

for fuente in "${fuentes[@]}"; do
  nombre="$(basename "$fuente")"
  titulo="${nombre%.*}"
  id="$(slug "$titulo")"
  destino="$SALIDA/$id"
  meta="$destino/video.json"
  firma="$(huella "$fuente")"

  if [ "$FORZAR" != "1" ] && [ -f "$meta" ] && grep -q "\"fuente_huella\": \"$firma\"" "$meta"; then
    echo "= $nombre: sin cambios, se omite"
    omitidos=$((omitidos + 1)); continue
  fi

  echo "> $nombre  ->  $id/"
  ancho_src="$(sonda "$fuente" stream=width)"
  alto_src="$(sonda "$fuente" stream=height)"
  fps_txt="$(sonda "$fuente" stream=avg_frame_rate)"
  duracion="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$fuente" | tr -d '\r')"
  # Bitrate de video de la fuente (kbps). Si el contenedor no lo declara, se estima desde el total.
  kbps_src="$(sonda "$fuente" stream=bit_rate)"
  if ! [[ "$kbps_src" =~ ^[0-9]+$ ]]; then
    kbps_src="$(ffprobe -v error -show_entries format=bit_rate -of default=nw=1:nk=1 "$fuente" | tr -d '\r')"
    [[ "$kbps_src" =~ ^[0-9]+$ ]] && kbps_src=$((kbps_src - 128000)) || kbps_src=0
  fi
  kbps_src=$((kbps_src / 1000))
  fps="$(awk -v f="$fps_txt" 'BEGIN{split(f,p,"/"); v=(p[2]>0)?p[1]/p[2]:p[1]; if(v<=0||v>120)v=30; printf "%d", v+0.5}')"
  gop=$((fps * SEGUNDOS))

  # Escalera: solo resoluciones <= a la fuente (nunca se amplía); al menos la más baja.
  bitrates=""; renditions_json=""; primera=""; kbps_previo=0
  for peldano in $ESCALERA; do
    alto="${peldano%%:*}"; kbps="${peldano##*:}"
    [ -z "$primera" ] && primera="$peldano"
    [ "$alto" -le "$alto_src" ] || continue
    # Ningún escalón supera el bitrate de la fuente escalado a su altura: recomprimir por
    # encima solo engorda el archivo. El tope proporcional mantiene bitrates distintos por
    # escalón; HLS-Stream-Creator nombra los archivos por bitrate y dos iguales se pisarían.
    if [ "$kbps_src" -gt 0 ]; then
      tope=$(( kbps_src * alto / alto_src ))
      [ "$kbps" -gt "$tope" ] && kbps="$tope"
    fi
    [ "$kbps" -gt "$kbps_previo" ] || kbps=$(( kbps_previo + 1 ))
    kbps_previo="$kbps"
    ancho=$(( (ancho_src * alto / alto_src + 1) / 2 * 2 ))
    bitrates+="${bitrates:+,}${kbps}-${ancho}x${alto}"
    renditions_json+="${renditions_json:+, }{\"alto\": $alto, \"ancho\": $ancho, \"kbps_max\": $kbps, \"lista\": \"index_${kbps}.m3u8\"}"
  done
  if [ -z "$bitrates" ]; then   # fuente más pequeña que el peldaño mínimo: se conserva su tamaño
    kbps="${primera##*:}"; ancho=$(( ancho_src / 2 * 2 )); alto=$(( alto_src / 2 * 2 ))
    bitrates="${kbps}-${ancho}x${alto}"
    renditions_json="{\"alto\": $alto, \"ancho\": $ancho, \"kbps_max\": $kbps, \"lista\": \"index_${kbps}.m3u8\"}"
  fi

  tmp="$SALIDA/.tmp-$id"
  rm -rf "$tmp"; mkdir -p "$tmp"

  # Parámetros web comunes a todas las resoluciones (ver vendor/ORIGEN-HLS-Stream-Creator.md)
  flags="-sn -dn -preset $PRESET -profile:v high -pix_fmt yuv420p"
  flags+=" -g $gop -keyint_min $gop -sc_threshold 0 -force_key_frames expr:gte(t,n_forced*$SEGUNDOS)"
  # El muxer segment compara tiempos con decimales: sin margen, el keyframe forzado en 6 s
  # (5,99999 tras el desfase de MPEG-TS) no abre segmento y los cortes salen cada 12 s.
  flags+=" -segment_time_delta 0.05"
  flags+=" -b:a 128k -ac 2 -ar 48000 -loglevel error -nostats"

  inicio=$SECONDS
  if ( cd "$tmp" && TMPDIR="$tmp" FFMPEG_FLAGS="$flags" \
        bash "$HLSC" -i "$fuente" -s "$SEGUNDOS" -o . -p index -t seg -q "$CRF" -b "$bitrates" >"$tmp/.log" 2>&1 ); then
    :
  else
    echo "  ! Falló el transcodificado de $nombre (registro: $tmp/.log)" >&2
    fallidos=$((fallidos + 1)); continue
  fi
  # HLS-Stream-Creator devuelve 0 aunque ffmpeg falle en segundo plano: se comprueba el resultado.
  if compgen -G "$tmp/bw-*.failfile" >/dev/null || [ ! -f "$tmp/index_master.m3u8" ]; then
    echo "  ! Falló el transcodificado de $nombre (registro: $tmp/.log)" >&2
    fallidos=$((fallidos + 1)); continue
  fi
  mv "$tmp/index_master.m3u8" "$tmp/master.m3u8"

  # Portada al 10 % de la duración
  t_poster="$(awk -v d="$duracion" 'BEGIN{printf "%.2f", d*0.10}')"
  ffmpeg -v error -y -ss "$t_poster" -i "$fuente" -frames:v 1 -vf "scale=-2:'min(720,ih)'" -c:v libwebp -quality 80 "$tmp/poster.webp"

  rm -f "$tmp/.log"
  peso=$(du -sb "$tmp" | cut -f1)
  segmentos=$(find "$tmp" -name '*.ts' | wc -l)
  cat > "$tmp/video.json" <<EOF
{
  "id": "$id",
  "titulo": $(json_texto "$titulo"),
  "archivo_fuente": $(json_texto "$nombre"),
  "fuente_huella": "$firma",
  "duracion_s": $(awk -v d="$duracion" 'BEGIN{printf "%.1f", d}'),
  "fuente": {"ancho": $ancho_src, "alto": $alto_src, "fps": $fps, "kbps": $kbps_src},
  "master": "$RUTA_WEB/$id/master.m3u8",
  "poster": "$RUTA_WEB/$id/poster.webp",
  "renditions": [$renditions_json],
  "segmento_s": $SEGUNDOS,
  "segmentos": $segmentos,
  "peso_bytes": $peso,
  "procesado": "$(date +%Y-%m-%d)"
}
EOF

  rm -rf "$destino"; mv "$tmp" "$destino"
  printf '  ok  %ss · %s MB -> %s MB · %s segmentos · %s\n' "$((SECONDS - inicio))" \
    "$(( $(stat -c %s "$fuente") / 1048576 ))" "$(( peso / 1048576 ))" "$segmentos" "$bitrates"
  procesados=$((procesados + 1))
done

# ---------- catálogo ----------
{
  echo "["
  primero=1
  for m in "$SALIDA"/*/video.json; do
    [ $primero -eq 1 ] || echo ","
    primero=0
    cat "$m"
  done
  echo "]"
} > "$SALIDA/catalogo.json"

# ---------- validación de límites de Cloudflare ----------
grandes=$(find "$SALIDA" -type f -size +"${LIMITE_ARCHIVO}"c | wc -l)
total_archivos=$(find "$SALIDA" -type f | wc -l)
total_app=$(find "$RAIZ/app-plataforma" -type f | wc -l)
echo
echo "Resumen: $procesados procesados · $omitidos sin cambios · $fallidos con error"
echo "Salida:  $SALIDA ($(du -sh "$SALIDA" | cut -f1), $total_archivos archivos; app-plataforma completa: $total_app de $LIMITE_ARCHIVOS permitidos)"
if [ "$grandes" -gt 0 ]; then
  echo "AVISO: $grandes archivo(s) superan 25 MiB y Workers static assets los rechazará:" >&2
  find "$SALIDA" -type f -size +"${LIMITE_ARCHIVO}"c >&2
fi
[ "$total_app" -le "$LIMITE_ARCHIVOS" ] || echo "AVISO: app-plataforma supera $LIMITE_ARCHIVOS archivos (límite del plan Free)" >&2
[ "$fallidos" -eq 0 ]
