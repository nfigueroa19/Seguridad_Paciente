#!/usr/bin/env bash
# Convierte un documento de Office (docx, doc, pptx, ppt, xlsx, xls) a PDF con LibreOffice.
# Uso: bash convertir-documento.sh <archivo-de-entrada> <archivo-pdf-de-salida>
# Lo usan la acción de GitHub (producción) y la imagen de Docker (pruebas locales).
set -euo pipefail
entrada="${1:?Falta el archivo de entrada}"
salida="${2:?Falta el archivo PDF de salida}"
trabajo="$(mktemp -d)"
trap 'rm -rf "$trabajo"' EXIT
cp "$entrada" "$trabajo/documento.${entrada##*.}"
# Perfil propio para no chocar con otra instancia; sin pantalla.
timeout 300 soffice --headless --norestore --nolockcheck \
  "-env:UserInstallation=file://$trabajo/perfil" \
  --convert-to pdf:impress_pdf_Export --outdir "$trabajo/salida" "$trabajo/documento."* >/dev/null 2>&1 || true
# Writer y Calc usan sus propios filtros: si el de Impress no produjo nada, reintentar con el genérico.
if [ ! -s "$trabajo/salida/documento.pdf" ]; then
  timeout 300 soffice --headless --norestore --nolockcheck \
    "-env:UserInstallation=file://$trabajo/perfil" \
    --convert-to pdf --outdir "$trabajo/salida" "$trabajo/documento."* >/dev/null 2>&1 || true
fi
test -s "$trabajo/salida/documento.pdf" || { echo "LibreOffice no generó el PDF"; exit 1; }
mkdir -p "$(dirname "$salida")"
cp "$trabajo/salida/documento.pdf" "$salida"
echo "PDF generado: $salida ($(stat -c %s "$salida") bytes)"
