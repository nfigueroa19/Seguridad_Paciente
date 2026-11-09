# Procesador de videos para la intranet (mismo pipeline que en Windows/Git Bash).
#
# Construir (desde herramientas/video/):
#   docker build -f docker/Dockerfile -t susana-segura/procesar-videos .
# Ejecutar:
#   docker run --rm -v /ruta/videos-fuente:/entrada:ro -v /ruta/media/videos:/salida \
#     susana-segura/procesar-videos
FROM alpine:3.22

RUN apk add --no-cache bash ffmpeg coreutils findutils gawk sed grep

WORKDIR /opt/procesar-videos
COPY procesar-videos.sh ./
COPY vendor/HLS-Stream-Creator/HLS-Stream-Creator.sh vendor/HLS-Stream-Creator/LICENSE vendor/HLS-Stream-Creator/
COPY vendor/ORIGEN-HLS-Stream-Creator.md vendor/

ENTRYPOINT ["bash", "/opt/procesar-videos/procesar-videos.sh", "/entrada", "/salida"]
