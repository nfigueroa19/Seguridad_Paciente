#!/usr/bin/env bash
# Instala las fuentes libres más usadas en las presentaciones del hospital, para que la conversión a PDF
# no las sustituya por otras (Google Fonts, licencia OFL). Si una no se puede bajar, se sigue sin ella.
# Uso: bash instalar-fuentes.sh [carpeta-destino]   (por defecto ~/.fonts)
set -u
DESTINO="${1:-$HOME/.fonts}"
mkdir -p "$DESTINO"
BASE="https://raw.githubusercontent.com/google/fonts/main/ofl"
ARCHIVOS=(
  "amaranth/Amaranth-Regular.ttf" "amaranth/Amaranth-Bold.ttf" "amaranth/Amaranth-Italic.ttf" "amaranth/Amaranth-BoldItalic.ttf"
  "belleza/Belleza-Regular.ttf"
  "exo2/Exo2%5Bwght%5D.ttf" "exo2/Exo2-Italic%5Bwght%5D.ttf"
  "montserrat/Montserrat%5Bwght%5D.ttf" "poppins/Poppins-Regular.ttf" "poppins/Poppins-Bold.ttf"
  "lato/Lato-Regular.ttf" "lato/Lato-Bold.ttf" "opensans/OpenSans%5Bwdth%2Cwght%5D.ttf"
  "roboto/Roboto%5Bwdth%2Cwght%5D.ttf" "nunito/Nunito%5Bwght%5D.ttf" "raleway/Raleway%5Bwght%5D.ttf"
)
for f in "${ARCHIVOS[@]}"; do
  nombre="$(basename "$f" | sed 's/%5B/[/g; s/%5D/]/g; s/%2C/,/g')"
  curl -fsSL --retry 2 "$BASE/$f" -o "$DESTINO/$nombre" || { echo "aviso: no se pudo bajar $f"; rm -f "$DESTINO/$nombre"; }
done
fc-cache -f "$DESTINO" >/dev/null 2>&1 || true
echo "Fuentes instaladas en $DESTINO: $(ls "$DESTINO" | wc -l)"
