#!/usr/bin/env node
/* =====================================================================
   SUSANA SEGURA: conversión de un documento a PDF (SOLO LOCALHOST)

   Convierte con LibreOffice (en Docker) un documento ya subido al R2 local y deja el PDF
   junto al original (<clave>.pdf), igual que hace la acción de GitHub en producción.

   Uso (desde la raíz del proyecto, con Docker en marcha):
     docker build -t segpaciente-documentos herramientas/documentos      (una sola vez)
     node herramientas/documentos/convertir-local.mjs documentos/abc12345-modulo-1.pptx
   Con una ruta de archivo en vez de una clave, solo genera el PDF al lado (sin tocar R2):
     node herramientas/documentos/convertir-local.mjs "modulo 1.pptx"
   ===================================================================== */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, copyFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BUCKET = 'segpaciente-media';
const entrada = process.argv[2];
if (!entrada) { console.error('Uso: node herramientas/documentos/convertir-local.mjs <clave-en-R2 | archivo>'); process.exit(1); }

const esArchivo = existsSync(resolve(entrada));
const tmp = mkdtempSync(join(tmpdir(), 'docpdf-'));
const wrangler = (args) => execFileSync('npx.cmd', ['--yes', 'wrangler@4.157.0', ...args], { cwd: RAIZ, stdio: 'inherit', shell: true });
try {
  const origen = join(tmp, 'original' + extname(entrada));
  if (esArchivo) copyFileSync(resolve(entrada), origen);
  else wrangler(['r2', 'object', 'get', `${BUCKET}/${entrada}`, '--local', '--file', origen]);

  console.log('Convirtiendo con LibreOffice (Docker)…');
  execFileSync('docker', ['run', '--rm', '-v', `${tmp}:/datos`, 'segpaciente-documentos', `/datos/${basename(origen)}`, '/datos/salida.pdf'], { stdio: 'inherit' });

  if (esArchivo) {
    const destino = resolve(entrada) + '.pdf';
    copyFileSync(join(tmp, 'salida.pdf'), destino);
    console.log('PDF:', destino);
  } else {
    wrangler(['r2', 'object', 'put', `${BUCKET}/${entrada}.pdf`, '--local', '--file', join(tmp, 'salida.pdf'), '--content-type', 'application/pdf']);
    console.log(`Listo: ${entrada}.pdf en el R2 local.`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
