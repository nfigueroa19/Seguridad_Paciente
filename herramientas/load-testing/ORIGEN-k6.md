# Origen: k6 (Grafana Labs)

- Repositorio: https://github.com/grafana/k6
- Versión: `v2.3.0` (publicada 2026-09-21), commit `e088784614`, compilada con Go 1.26.8.
- Archivo descargado: `k6-v2.3.0-windows-amd64.zip` desde la página de *releases* de GitHub (`gh release download v2.3.0 -R grafana/k6`).
- Fecha de descarga: 2026-11-09.
- Verificación:
  - SHA-256 `112276d495e5741c968e2bc09ea6196099c1275bd6db9ee0875d173c7148ce43`, igual al de `k6-v2.3.0-checksums.txt` del mismo release.
  - Firma Authenticode de `k6.exe`: válida, emitida a `CN=Grafana Labs`.
- Licencia: AGPL-3.0. Se usa como herramienta externa sin modificar ni redistribuir; los scripts de prueba de este proyecto no quedan sujetos a esa licencia por ejecutarse con k6.
- Ubicación: `bin/k6.exe` (fuera de Git; ver `.git/info/exclude`).

## Por qué k6

| Opción | Lenguaje de los escenarios | Motivo de descarte o elección |
| --- | --- | --- |
| **k6** | JavaScript (ES modules) | **Elegida.** Ejecutores por rampa de usuarios (`ramping-vus`), umbrales que hacen fallar la corrida, métricas propias y panel web con informe HTML integrado. Un solo binario firmado, sin `node_modules`. |
| Artillery | YAML + JavaScript | Instalación npm de varios cientos de MB y la lógica de reproducción HLS habría quedado repartida entre YAML y *processors*. |
| autocannon | JavaScript | Mide rendimiento bruto de una URL; no modela usuarios con pausas ni flujos con lectura de listas `.m3u8`. |

El motor de k6 está escrito en Go, pero todo lo que se adapta al proyecto (escenarios, lectura de HLS, métricas) es JavaScript.

## Reinstalar

Desde Git Bash, en la raíz del proyecto (compara a ojo que los dos hashes coincidan antes de copiar):

```bash
mkdir -p /tmp/k6 herramientas/load-testing/bin
gh release download v2.3.0 -R grafana/k6 -D /tmp/k6 -p "k6-v2.3.0-windows-amd64.zip" -p "k6-v2.3.0-checksums.txt"
grep windows-amd64.zip /tmp/k6/k6-v2.3.0-checksums.txt; sha256sum /tmp/k6/k6-v2.3.0-windows-amd64.zip
unzip -o /tmp/k6/k6-v2.3.0-windows-amd64.zip -d /tmp/k6
cp /tmp/k6/k6-v2.3.0-windows-amd64/k6.exe herramientas/load-testing/bin/
```

Alternativas: `winget install k6 --source winget` o la imagen Docker `grafana/k6:2.3.0`. `ejecutar-prueba.sh` usa `bin/k6.exe` si existe y, si no, el `k6` del `PATH`.
