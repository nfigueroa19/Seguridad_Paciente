# Imagen para convertir documentos de Office a PDF en local (misma receta que la acción de GitHub).
# Construir:  docker build -t segpaciente-documentos herramientas/documentos
FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
      libreoffice-impress libreoffice-writer libreoffice-calc \
      fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-core fonts-noto-color-emoji \
      fontconfig curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY instalar-fuentes.sh convertir-documento.sh /herramientas/
RUN bash /herramientas/instalar-fuentes.sh /usr/local/share/fonts
WORKDIR /datos
ENTRYPOINT ["bash", "/herramientas/convertir-documento.sh"]
