# Muestrea CPU y memoria del servidor local y del generador de carga mientras corre k6.
# Sirve para saber si el cuello de botella es el servidor (workerd/python) o el propio k6,
# que en una prueba local comparten los mismos núcleos.
param(
  [Parameter(Mandatory = $true)][string]$Salida,
  [int]$IntervaloSeg = 2,
  [string[]]$Procesos = @('k6', 'workerd', 'node', 'python')
)

$nucleos = [Environment]::ProcessorCount
"marca,proceso,cpu_pct_equipo,memoria_mb,cpu_total_pct" | Out-File -FilePath $Salida -Encoding utf8

# Espera a que arranque k6 (hasta 15 s).
$espera = 0
while (-not (Get-Process -Name k6 -ErrorAction SilentlyContinue) -and $espera -lt 15) { Start-Sleep -Seconds 1; $espera++ }

$previo = @{}
$marcaPrevia = Get-Date
while (Get-Process -Name k6 -ErrorAction SilentlyContinue) {
  Start-Sleep -Seconds $IntervaloSeg
  $ahora = Get-Date
  $transcurrido = ($ahora - $marcaPrevia).TotalSeconds
  $marcaPrevia = $ahora
  $total = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
  foreach ($nombre in $Procesos) {
    $lista = Get-Process -Name $nombre -ErrorAction SilentlyContinue
    if (-not $lista) { continue }
    $cpuSeg = ($lista | ForEach-Object { $_.TotalProcessorTime.TotalSeconds } | Measure-Object -Sum).Sum
    $mem = [math]::Round((($lista | Measure-Object -Property WorkingSet64 -Sum).Sum) / 1MB, 1)
    if ($previo.ContainsKey($nombre)) {
      # % del equipo completo (100 % = todos los núcleos ocupados)
      $pct = [math]::Round((($cpuSeg - $previo[$nombre]) / $transcurrido / $nucleos) * 100, 1)
      # Cultura invariante: en Windows en español "-f" escribiría la coma decimal y rompería el CSV.
      [string]::Format([Globalization.CultureInfo]::InvariantCulture, "{0},{1},{2},{3},{4}",
        $ahora.ToString('HH:mm:ss'), $nombre, $pct, $mem, $total) | Out-File -FilePath $Salida -Append -Encoding utf8
    }
    $previo[$nombre] = $cpuSeg
  }
}
