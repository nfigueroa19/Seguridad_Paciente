#!/usr/bin/env node
/* =====================================================================
   SUSANA SEGURA: conversión automática de videos (SOLO LOCALHOST)

   Vigila la base D1 local: cuando el editor guarda un curso con un video recién
   subido, el Worker lo marca 'procesando'. Este proceso:
     1. descarga el MP4 original de R2 local (entrada/<id>.mp4),
     2. lo convierte a HLS con procesar-videos.sh (varias calidades + portada),
        dejando el resultado en app-plataforma/media/videos/<id>/,
     3. marca el video como 'listo' (o 'error') en D1.

   Uso (con `wrangler dev --local` en marcha, desde la raíz del proyecto):
     node herramientas/video/convertidor-local.mjs
   Requiere ffmpeg/ffprobe en el PATH y Git Bash (bash) en Windows.
   En producción este paso lo reemplazará la conversión en la nube (pendiente).
   ===================================================================== */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ejecutar = promisify(exec);
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BD = 'segpaciente-contenido';
const BUCKET = 'segpaciente-media';
const WRANGLER = 'npx.cmd --yes wrangler@4.157.0';
const CADA_MS = 5000;
const aRuta = (p) => p.replace(/\\/g, '/');

const log = (...a) => console.log(new Date().toLocaleTimeString('es-CO'), ...a);

async function sql(consulta) {
  const { stdout } = await ejecutar(`${WRANGLER} d1 execute ${BD} --local --json --command "${consulta}"`, { cwd: RAIZ, maxBuffer: 1 << 24 });
  const inicio = stdout.indexOf('[');
  return JSON.parse(stdout.slice(inicio))[0].results || [];
}

async function convertir(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Identificador no válido: ${id}`);
  const carpeta = mkdtempSync(join(tmpdir(), 'ss-video-'));
  const entrada = join(carpeta, 'entrada');
  mkdirSync(entrada);
  try {
    const mp4 = join(entrada, `${id}.mp4`);
    log(`> ${id}: descargando el original…`);
    await ejecutar(`${WRANGLER} r2 object get ${BUCKET}/entrada/${id}.mp4 --local --file "${mp4}"`, { cwd: RAIZ, maxBuffer: 1 << 24 });
    log(`> ${id}: convirtiendo (puede tardar varios minutos)…`);
    const salida = join(RAIZ, 'app-plataforma', 'media', 'videos');
    const { stdout } = await ejecutar(
      `bash herramientas/video/procesar-videos.sh "${aRuta(entrada)}" "${aRuta(salida)}"`,
      { cwd: RAIZ, maxBuffer: 1 << 26, env: { ...process.env, FORZAR: '1' } });
    log(stdout.trim().split('\n').filter((l) => l.startsWith('  ok')).join(' ') || '(sin detalle)');
    if (!existsSync(join(salida, id, 'master.m3u8'))) throw new Error('No se generó master.m3u8');
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }
}

let ocupado = false;
async function ciclo() {
  if (ocupado) return;
  ocupado = true;
  try {
    const cola = await sql(`SELECT id FROM videos WHERE estado='procesando' ORDER BY creado LIMIT 1`);
    if (!cola.length) return;
    const id = cola[0].id;
    try {
      await convertir(id);
      await sql(`UPDATE videos SET estado='listo' WHERE id='${id}'`);
      log(`✔ ${id}: listo`);
    } catch (e) {
      console.error(`✖ ${id}:`, (e.stderr || e.message || e).toString().trim().slice(0, 600));
      await sql(`UPDATE videos SET estado='error' WHERE id='${id}'`);
    }
  } catch (e) {
    console.error('No se pudo consultar la base local (¿está en marcha wrangler dev?):', (e.message || e).toString().slice(0, 300));
  } finally {
    ocupado = false;
  }
}

log('Convertidor local de videos en marcha. Vigilando videos en estado «procesando»… (Ctrl+C para salir)');
ciclo();
setInterval(ciclo, CADA_MS);
