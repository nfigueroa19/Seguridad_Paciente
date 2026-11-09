// Convierte los resultados de una corrida (resumen.json de k6 + procesos.csv) en un resumen Markdown.
// Uso: node resumir.mjs <carpeta-de-resultados>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';

const carpeta = process.argv[2];
if (!carpeta) {
  console.error('Uso: node resumir.mjs <carpeta-de-resultados>');
  process.exit(1);
}

const leer = (archivo) => readFileSync(join(carpeta, archivo), 'utf8').replace(/^﻿/, '');
const { metrics: m } = JSON.parse(leer('resumen.json'));
const dec = (v, d) => v.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
const ms = (v) => (v === undefined ? '—' : v >= 1000 ? `${dec(v / 1000, 2)} s` : `${dec(v, 1)} ms`);
const pct = (v) => `${dec(v * 100, 2)} %`;
const num = (v, d = 0) => v.toLocaleString('es-CO', { maximumFractionDigits: d });
const lineas = [];

// En el JSON de k6, un umbral en "false" significa que NO se cruzó (cumple).
const fallidos = [];
for (const [nombre, metrica] of Object.entries(m)) {
  for (const [regla, cruzado] of Object.entries(metrica.thresholds || {})) {
    if (cruzado) fallidos.push(`\`${nombre}\` → \`${regla}\``);
  }
}

if (existsSync(join(carpeta, 'parametros.txt'))) {
  lineas.push('## Parámetros', '', '```', leer('parametros.txt').trim(), '```', '');
}

const segundos = m.http_reqs.count / m.http_reqs.rate;
lineas.push('## Totales', '');
lineas.push('| Métrica | Valor |', '| --- | --- |');
lineas.push(`| Duración medida | ${num(segundos, 1)} s |`);
lineas.push(`| VUs máximos | ${m.vus_max.value ?? m.vus_max.max} |`);
lineas.push(`| Peticiones HTTP | ${num(m.http_reqs.count)} |`);
lineas.push(`| Peticiones por segundo (media) | ${num(m.http_reqs.rate, 1)} |`);
lineas.push(`| Tasa de error HTTP | ${pct(m.http_req_failed.value)} |`);
lineas.push(`| Checks superados | ${pct(m.checks.value)} |`);
lineas.push(`| Datos recibidos | ${num(m.data_received.count / 1e6, 1)} MB (${num((m.data_received.rate * 8) / 1e6, 1)} Mbit/s) |`);
lineas.push(`| Iteraciones (visitas) | ${num(m.iterations.count)} |`);
if (m.revalidacion_304) lineas.push(`| Revalidaciones con 304 | ${pct(m.revalidacion_304.value)} de ${num(m.revalidacion_304.passes + m.revalidacion_304.fails)} condicionales |`);
lineas.push(`| Umbrales | ${fallidos.length === 0 ? 'todos cumplen' : `${fallidos.length} fallan: ${fallidos.join(', ')}`} |`);
lineas.push('');

lineas.push('## Latencia por tipo de recurso', '');
lineas.push('| Recurso | Mediana | p90 | p95 | p99 | Máx. |', '| --- | --- | --- | --- | --- | --- |');
for (const [nombre, t] of Object.entries(m)) {
  const r = /^http_req_duration\{recurso:([^,}]+)\}$/.exec(nombre);
  if (!r) continue;
  lineas.push(`| ${r[1]} | ${ms(t.med)} | ${ms(t['p(90)'])} | ${ms(t['p(95)'])} | ${ms(t['p(99)'])} | ${ms(t.max)} |`);
}
const todo = m.http_req_duration;
lineas.push(`| **todas** | ${ms(todo.med)} | ${ms(todo['p(90)'])} | ${ms(todo['p(95)'])} | ${ms(todo['p(99)'])} | ${ms(todo.max)} |`);
lineas.push('');
lineas.push(`Desglose de \`http_req_duration\` (p95): espera del servidor (TTFB) ${ms(m.http_req_waiting['p(95)'])}, recepción del cuerpo ${ms(m.http_req_receiving['p(95)'])}, conexión ${ms(m.http_req_connecting['p(95)'])}.`);
lineas.push('');

if (m.hls_arranque_ms) {
  lineas.push('## Calidad de reproducción HLS', '');
  lineas.push('| Métrica | Valor |', '| --- | --- |');
  lineas.push(`| Arranque (master → primer segmento), mediana / p95 | ${ms(m.hls_arranque_ms.med)} / ${ms(m.hls_arranque_ms['p(95)'])} |`);
  lineas.push(`| Descarga del segmento / su duración, p95 / máx. (> 1 = más lento que la reproducción) | ${dec(m.hls_ratio_descarga['p(95)'], 3)} / ${dec(m.hls_ratio_descarga.max, 3)} |`);
  const rb = m.hls_sesiones_con_rebuffer;
  if (rb && rb.passes + rb.fails > 0) {
    lineas.push(`| Sesiones con congelamiento (rebuffer) | ${pct(rb.value)} de ${num(rb.passes + rb.fails)} |`);
    lineas.push(`| Eventos de rebuffer | ${m.hls_rebuffer_eventos ? num(m.hls_rebuffer_eventos.count) : 0} |`);
  } else {
    lineas.push('| Sesiones con congelamiento (rebuffer) | no aplica (RITMO=maximo: sin reproducción simulada) |');
  }
  lineas.push(`| Minutos de video servidos | ${num(m.hls_segundos_reproducidos.count / 60, 1)} |`);
  lineas.push('');
}

// ---------- Por escalón (prueba con ESCALONES) ----------
const parametros = existsSync(join(carpeta, 'parametros.txt')) ? leer('parametros.txt') : '';
const param = (clave) => (new RegExp(`^${clave}: (.+)$`, 'm').exec(parametros) || [])[1];
const aSegundos = (d) => [...String(d).matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)]
  .reduce((t, [, n, u]) => t + Number(n) * { ms: 0.001, s: 1, m: 60, h: 3600 }[u], 0);
const escalones = Object.keys(m)
  .map((k) => /^http_reqs\{escalon:(\d+)\}$/.exec(k))
  .filter(Boolean)
  .map((r) => Number(r[1]))
  .sort((a, b) => a - b);
if (escalones.length > 0) {
  const duracion = aSegundos(param('RAMPA') || '30s') + aSegundos(param('MANTENER') || '2m');
  const cumple = (clave) => Object.values((m[clave] || {}).thresholds || {}).every((cruzado) => !cruzado);
  lineas.push('## Por escalón de usuarios', '');
  lineas.push(`Cada escalón dura ${num(duracion)} s (subida + meseta); las tasas son la media de ese tramo.`, '');
  lineas.push('| Usuarios | Peticiones/s | Mbit/s | p95 ligeros | p95 segmento | Arranque p95 | Descarga/duración p95 | Rebuffer | Errores | Criterios |');
  lineas.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const e of escalones) {
    const k = (base, filtro = '') => `${base}{${filtro ? filtro + ',' : ''}escalon:${e}}`;
    const v = (base, campo, filtro) => (m[k(base, filtro)] || {})[campo];
    const claves = [k('http_req_failed'), k('http_req_duration', 'clase:ligero'), k('hls_arranque_ms'), k('hls_ratio_descarga'), k('hls_sesiones_con_rebuffer')];
    const ok = claves.every(cumple);
    const rb = m[k('hls_sesiones_con_rebuffer')];
    const ratio = v('hls_ratio_descarga', 'p(95)');
    lineas.push([
      '', num(e),
      num(m[k('http_reqs')].count / duracion, 1),
      m[k('data_received')] ? num((m[k('data_received')].count * 8) / 1e6 / duracion, 0) : '—',
      ms(v('http_req_duration', 'p(95)', 'clase:ligero')),
      ms(v('http_req_duration', 'p(95)', 'recurso:segmento')),
      ms(v('hls_arranque_ms', 'p(95)')),
      ratio === undefined ? '—' : dec(ratio, 3),
      rb && rb.passes + rb.fails > 0 ? `${pct(rb.value)} de ${num(rb.passes + rb.fails)}` : '—',
      pct(v('http_req_failed', 'value') || 0),
      ok ? '✅ cumple' : '❌ falla', '',
    ].join(' | ').trim());
  }
  lineas.push('');
}

if (m.mime_incorrecto) {
  lineas.push(`> [!warning] ${m.mime_incorrecto.count} respuestas con Content-Type inesperado (ver consola.txt).`, '');
}

if (existsSync(join(carpeta, 'procesos.csv'))) {
  const filas = leer('procesos.csv').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
  const porProceso = {};
  for (const [, proceso, cpu, memoria, total] of filas) {
    (porProceso[proceso] ||= []).push({ cpu: Number(cpu), memoria: Number(memoria), total: total ? Number(total) : NaN });
  }
  if (Object.keys(porProceso).length > 0) {
    const nucleos = cpus().length;
    lineas.push(`## Recursos (100 % = los ${nucleos} núcleos del equipo)`, '');
    lineas.push('| Proceso | CPU media | CPU máx. | Núcleos máx. | Memoria máx. |', '| --- | --- | --- | --- | --- |');
    for (const [proceso, muestras] of Object.entries(porProceso)) {
      const media = muestras.reduce((s, x) => s + x.cpu, 0) / muestras.length;
      const maxCpu = Math.max(...muestras.map((x) => x.cpu));
      const maxMem = Math.max(...muestras.map((x) => x.memoria));
      lineas.push(`| ${proceso} | ${media.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % | ${maxCpu.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % | ${dec((maxCpu * nucleos) / 100, 1)} | ${num(maxMem)} MB |`);
    }
    const totales = Object.values(porProceso)[0].map((x) => x.total).filter((x) => !Number.isNaN(x));
    if (totales.length > 0) lineas.push(`| *equipo completo* | ${(totales.reduce((s, x) => s + x, 0) / totales.length).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % | ${Math.max(...totales).toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % | | |`);
    lineas.push('');
  }
}

console.log(lineas.join('\n'));
