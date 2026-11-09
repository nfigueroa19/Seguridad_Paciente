# Origen: HLS-Stream-Creator

- Repositorio: https://github.com/bentasker/HLS-Stream-Creator
- Commit clonado: `bd024f05908b62bb9dd0a9db9c80a9fae4ae3b82` (2019-11-20, versión 1.0 del script)
- Fecha de clonación: 2026-11-09
- Licencia: BSD 3-Clause (ver `HLS-Stream-Creator/LICENSE`). Se conserva el aviso de copyright.
- Se eliminó la carpeta `.git` del clon para que no quede como repositorio anidado.

## Modificaciones

Ninguna. El script se usa tal cual; todas las adaptaciones viven en `../procesar-videos.sh`:

| Limitación del original | Cómo la resuelve el wrapper |
| --- | --- |
| `-map 0` incluye pistas de subtítulos (`mov_text`) y datos que MPEG-TS no admite | Añade `-sn -dn` en `FFMPEG_FLAGS` |
| Sin keyframes alineados entre resoluciones (rompe el cambio adaptativo) | `-g`, `-keyint_min`, `-sc_threshold 0` y `-force_key_frames` según la duración del segmento |
| Escala a un tamaño fijo `WxH` (deforma videos 4:3) | Calcula el ancho par que respeta la proporción de cada fuente |
| Nombres de archivo con espacios y prefijos por defecto | Usa un *slug* por video y prefijos fijos (`index`, `seg`) |
